/**
 * Sinais audiovisuais de nível 0: evidência barata e totalmente local que alimenta a detecção de estouros
 * ao lado da transcrição — os picos de volume (explosão de emoção, risada, grito) e a densidade de cortes
 * de cena (ação visual). As leituras são funções puras (testáveis), e a execução do ffmpeg fica isolada em
 * collectSignals.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveFfmpegPath } from "./binaries";
import { analysisVideoFilter, type AnalysisVideoOptions } from "./analysis-video";
import { ffmpegVideoStreamSpecifier } from "./probe";
import {
  compactVisualSignalSamples,
  parseVisualSignalSamples,
  type VisualSignalSample,
} from "./visual-enhance";

const execFileAsync = promisify(execFile);

export interface TimeRange {
  startSec: number;
  endSec: number;
}

export interface MotionSample {
  t: number;
  /** A nota de diferença entre quadros em baixa resolução, de 0 a 1. */
  score: number;
}

export interface MediaSignals {
  /** As explosões de volume sustentadas, bem acima da mediana do material. */
  loudPeaks: TimeRange[];
  /** As janelas com cortes de cena densos (ritmo visual rápido). */
  cutDense: TimeRange[];
  /** A atividade sustentada de diferença entre quadros em baixa resolução (movimento e ação, não compreensão de sentido). */
  motionPeaks?: TimeRange[];
  /** Um valor máximo de diferença entre quadros por segundo de origem, guardado para reuso e avaliação. */
  motionSamples?: MotionSample[];
  /** As marcas de tempo fortes e bem espaçadas da origem, que podem guiar a amostragem visual mais adiante. */
  activityKeyframes?: MotionSample[];
  /** A evidência compacta de luminância e saturação por segundo, para o acabamento adaptativo que se liga por escolha. */
  visualSamples?: VisualSignalSample[];
  /**
   * As amostras cruas do ebur128 (t + dB momentâneo). São guardadas de passagem na coleta — a linha de
   * tempo da bancada precisa desenhar a curva de volume do material inteiro, e sem guardar seria preciso
   * decodificar a mesma trilha de 2 horas outra vez. Usadas só dentro do processo principal: não entram
   * no prompt nem na camada de renderização (o IPC da linha de tempo as comprime num valor por célula antes de enviar).
   */
  loudnessSamples?: Array<{ t: number; m: number }>;
  /** Os trechos de imagem de alta energia cercados pela amostragem de quadros do modelo de visão local (opcional, veja highlight/vision.ts). */
  visualPeaks?: TimeRange[];
  /** Os trechos de pico de expressão (YuNet+FER+, sem configuração; opcional, veja emotion.ts). */
  emotionPeaks?: TimeRange[];
  /** Os trechos com a voz exaltada (a segunda varredura em janelas curtas das etiquetas de emoção do SenseVoice; opcional, veja voice-emotion.ts). */
  voiceEmotionPeaks?: TimeRange[];
  /** Os trechos de risada, palmas e choro (as etiquetas de evento de áudio do SenseVoice; opcional, veja voice-emotion.ts). */
  audioEventPeaks?: TimeRange[];
  /** Os trechos de pico de calor do chat (o .xml de mesmo nome descoberto sozinho; opcional, veja danmaku.ts). */
  danmakuPeaks?: TimeRange[];
  /** Os instantes em que quem transmite pediu o corte («corta esse pedaço / clip that» — um estouro que a própria pessoa certifica, e o conteúdo vem antes do pedido; veja highlight/commands.ts). */
  clipCommandMarks?: number[];
  /** A linha do tempo da imagem da varredura completa; visibleText só recebe o texto curto que dá para confirmar palavra por palavra na imagem, nunca o inferido. */
  visualNotes?: Array<{ t: number; energy: number; note: string; visibleText?: string[] }>;
}

/** Lê as linhas de stderr do `ebur128`: "t: 12.5 ... M: -18.2 ..." → as amostras [t, M]. */
export function parseEbur128(stderr: string): Array<{ t: number; m: number }> {
  const out: Array<{ t: number; m: number }> = [];
  const re = /t:\s*([\d.]+)\s+.*?M:\s*(-?[\d.]+)/g;
  for (const match of stderr.matchAll(re)) {
    const t = Number(match[1]);
    const m = Number(match[2]);
    if (Number.isFinite(t) && Number.isFinite(m) && m > -70) out.push({ t, m });
  }
  return out;
}

/** Lê a stderr do `showinfo`: o pts_time dos quadros que sobreviveram ao filtro de cena. */
export function parseShowinfoTimes(stderr: string): number[] {
  const out: number[] = [];
  for (const match of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    const t = Number(match[1]);
    if (Number.isFinite(t)) out.push(t);
  }
  return out;
}

/** Lê os pares de metadata=print do FFmpeg que contêm pts_time e lavfi.scene_score. */
export function parseSceneScoreSamples(stderr: string): MotionSample[] {
  const out: MotionSample[] = [];
  let pendingTime: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const time = line.match(/\bpts_time:([\d.]+)/);
    if (time) {
      const value = Number(time[1]);
      pendingTime = Number.isFinite(value) ? value : null;
    }
    const score = line.match(/lavfi\.scene_score=([\d.eE+-]+)/);
    if (score && pendingTime !== null) {
      const value = Number(score[1]);
      if (Number.isFinite(value)) out.push({ t: pendingTime, score: Math.max(0, Math.min(1, value)) });
      pendingTime = null;
    }
  }
  return out;
}

/** Guarda uma amostra compacta e determinística da atividade máxima de cada segundo de origem. */
export function compactMotionSamples(samples: MotionSample[]): MotionSample[] {
  const bins = new Map<number, MotionSample>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.t) || !Number.isFinite(sample.score) || sample.t < 0) continue;
    const second = Math.floor(sample.t);
    const current = bins.get(second);
    if (!current || sample.score > current.score) bins.set(second, sample);
  }
  return [...bins.values()]
    .sort((a, b) => a.t - b.t)
    .map((sample) => ({ t: Number(sample.t.toFixed(3)), score: Number(sample.score.toFixed(5)) }));
}

/** As amostras de alta diferença entre quadros viram intervalos curtos de atividade, ordenados e limitados. */
export function motionPeakRanges(samples: MotionSample[], durationSec: number, maxRanges = 12): TimeRange[] {
  const usable = samples.filter((sample) => Number.isFinite(sample.score) && sample.score > 0);
  if (usable.length < 8 || !(durationSec > 0)) return [];
  const scores = usable.map((sample) => sample.score).sort((a, b) => a - b);
  const threshold = Math.max(0.012, scores[Math.floor(scores.length * 0.85)] ?? 0);
  const hits = usable
    .filter((sample) => sample.score >= threshold)
    .map((sample) => ({ startSec: Math.max(0, sample.t - 1), endSec: Math.min(durationSec, sample.t + 1), score: sample.score }))
    .sort((a, b) => a.startSec - b.startSec);
  const merged: Array<TimeRange & { score: number }> = [];
  for (const hit of hits) {
    const last = merged[merged.length - 1];
    if (last && hit.startSec <= last.endSec + 1.5) {
      last.endSec = Math.max(last.endSec, hit.endSec);
      last.score = Math.max(last.score, hit.score);
    } else merged.push({ ...hit });
  }
  return merged
    .sort((a, b) => b.score - a.score || a.startSec - b.startSec)
    .slice(0, Math.max(0, maxRanges))
    .sort((a, b) => a.startSec - b.startSec)
    .map(({ startSec, endSec }) => ({ startSec: Number(startSec.toFixed(3)), endSec: Number(endSec.toFixed(3)) }));
}

/** As marcas de tempo fortes e separadas para a folha de contato e a amostragem do VLM; nenhum byte de imagem é gravado. */
export function activityKeyframes(samples: MotionSample[], maxFrames = 48, minSpacingSec = 8): MotionSample[] {
  const scores = samples.map((sample) => sample.score).filter((score) => Number.isFinite(score) && score > 0).sort((a, b) => a - b);
  if (scores.length < 8) return [];
  const threshold = Math.max(0.012, scores[Math.floor(scores.length * 0.85)] ?? 0);
  const picked: MotionSample[] = [];
  for (const sample of [...samples].sort((a, b) => b.score - a.score || a.t - b.t)) {
    if (sample.score < threshold || picked.some((item) => Math.abs(item.t - sample.t) < minSpacingSec)) continue;
    picked.push({ t: Number(sample.t.toFixed(3)), score: Number(sample.score.toFixed(5)) });
    if (picked.length >= maxFrames) break;
  }
  return picked.sort((a, b) => a.t - b.t);
}

/** As amostras ≥ mediana+`riseDb` são unidas em intervalos (com ≥ minDurSec, tolerando vãos). */
export function loudnessPeaks(
  samples: Array<{ t: number; m: number }>,
  riseDb = 6,
  minDurSec = 1.5,
  mergeGapSec = 2
): TimeRange[] {
  if (samples.length < 10) return [];
  const sorted = [...samples].map((s) => s.m).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median + riseDb;
  const ranges: TimeRange[] = [];
  let cur: TimeRange | null = null;
  for (const s of samples) {
    if (s.m >= threshold) {
      if (cur && s.t - cur.endSec <= mergeGapSec) cur.endSec = s.t;
      else {
        if (cur) ranges.push(cur);
        cur = { startSec: s.t, endSec: s.t };
      }
    }
  }
  if (cur) ranges.push(cur);
  return ranges.filter((r) => r.endSec - r.startSec >= minDurSec);
}

/** Densidade de cortes por janela deslizante: as janelas com ≥ minCuts cortes, unidas. */
export function cutDensity(cutTimes: number[], windowSec = 15, minCuts = 4): TimeRange[] {
  if (cutTimes.length < minCuts) return [];
  const ranges: TimeRange[] = [];
  let i = 0;
  for (let j = 0; j < cutTimes.length; j++) {
    while (cutTimes[j] - cutTimes[i] > windowSec) i++;
    if (j - i + 1 >= minCuts) {
      const r = { startSec: cutTimes[i], endSec: cutTimes[j] };
      const last = ranges[ranges.length - 1];
      if (last && r.startSec <= last.endSec + windowSec / 2) last.endSec = r.endSec;
      else ranges.push(r);
    }
  }
  return ranges;
}

/** O teto para a injeção no prompt do LLM — os sinais são pistas, não a história inteira. */
const MAX_RANGES = 12;

/**
 * O planejamento da amostragem guiado pelos sinais: dentro das janelas de alta energia já conhecidas
 * (pico de volume / corte denso / pico do chat) a amostragem é densa, por passo, e depois uma grade
 * uniforme gasta a cota que sobrou para nenhum trecho escapar num ponto cego dos sinais, sempre
 * respeitando a distância mínima. A coleta dos sinais de segundo nível (expressão por amostragem de
 * quadros, emoção da voz em janelas curtas) usa isto — o orçamento limitado de inferência é gasto onde
 * mais provavelmente há estouro; o pico do chat é o voto que o público dá a cada segundo, e é ali que a
 * risada e a expressão devem ser procuradas, então o chat vem antes da coleta cara (ele só lê um arquivo). Função pura.
 */
export function planSignalGuidedTimes(
  durationSec: number,
  signals: MediaSignals | undefined,
  maxCount: number,
  minSpacingSec: number,
  windowStepSec: number,
  edgePadSec = 0.5
): number[] {
  if (!(durationSec > 1) || maxCount < 1) return [];
  const lo = Math.min(edgePadSec, durationSec / 2);
  const hi = Math.max(lo, durationSec - edgePadSec);
  const clamp = (t: number): number => Math.min(hi, Math.max(lo, t));
  const picked: number[] = [];
  const fits = (t: number): boolean => picked.every((p) => Math.abs(p - t) >= minSpacingSec);
  const tryPick = (t: number): void => {
    const c = clamp(t);
    if (picked.length < maxCount && fits(c)) picked.push(c);
  };
  // A amostragem por passo dentro das janelas de sinal (o estouro se esconde justo no pico de volume, no corte denso e no pico do chat)
  const windows = [
    ...(signals?.loudPeaks ?? []),
    ...(signals?.cutDense ?? []),
    ...(signals?.danmakuPeaks ?? []),
  ].sort((a, b) => a.startSec - b.startSec);
  for (const w of windows) {
    for (let t = w.startSec; t <= w.endSec; t += windowStepSec) tryPick(t);
  }
  // A grade uniforme como rede de segurança, para um trecho inteiro não escapar num ponto cego dos sinais
  for (let i = 1; i <= maxCount; i++) tryPick((durationSec * i) / (maxCount + 1));
  return picked.sort((a, b) => a - b);
}

/**
 * Roda as duas sondagens (a de áudio e a do vídeo reduzido em baixa taxa de quadros) em paralelo.
 * Falha em aberto: o erro de qualquer sondagem devolve sinais vazios — a detecção não pode morrer porque
 * o material não tem trilha de áudio ou de vídeo, ou porque o ffmpeg engasgou.
 */
export async function collectSignals(
  inputPath: string,
  signal?: AbortSignal,
  analysis: AnalysisVideoOptions = {}
): Promise<MediaSignals> {
  const ffmpeg = resolveFfmpegPath();
  const run = (args: string[]): Promise<string> =>
    execFileAsync(ffmpeg, args, { maxBuffer: 128 * 1024 * 1024, signal }).then(
      (r) => r.stderr,
      (error) => {
        if (signal?.aborted) throw error;
        return "";
      }
    );

  const [loudErr, sceneErr] = await Promise.all([
    run(["-hide_banner", "-i", inputPath, "-vn", "-filter_complex", "ebur128", "-f", "null", "-"]),
    run([
      "-hide_banner", "-i", inputPath, "-an",
      "-vf", analysisVideoFilter([
        "fps=4",
        "scale=160:-2",
        "select='gte(scene,0)'",
        "signalstats",
        "metadata=print:key=lavfi.scene_score",
        "metadata=print:key=lavfi.signalstats.YLOW",
        "metadata=print:key=lavfi.signalstats.YAVG",
        "metadata=print:key=lavfi.signalstats.YHIGH",
        "metadata=print:key=lavfi.signalstats.SATAVG",
      ], analysis.color),
      "-map", ffmpegVideoStreamSpecifier(analysis.videoStreamIndex),
      "-f", "null", "-",
    ]),
  ]);

  const loudSamples = parseEbur128(loudErr);
  const frameSamples = parseSceneScoreSamples(sceneErr);
  const compactMotion = compactMotionSamples(frameSamples);
  const visualSamples = compactVisualSignalSamples(parseVisualSignalSamples(sceneErr));
  return {
    loudPeaks: loudnessPeaks(loudSamples).slice(0, MAX_RANGES),
    cutDense: cutDensity(frameSamples.filter((sample) => sample.score > 0.3).map((sample) => sample.t)).slice(0, MAX_RANGES),
    motionPeaks: motionPeakRanges(frameSamples, frameSamples.at(-1)?.t ?? 0),
    motionSamples: compactMotion,
    activityKeyframes: activityKeyframes(frameSamples),
    visualSamples,
    loudnessSamples: loudSamples,
  };
}

/**
 * Comprime as amostras do ebur128 na curva da linha de tempo: cada célula fica com o maior volume da sua
 * janela, e depois tudo é normalizado de 0 a 1 pelos percentis de 5% a 99% do material inteiro (por
 * percentil, e não por min/max — um estrondo só não deve achatar a curva inteira). Função pura.
 */
export function loudnessCurve(
  samples: Array<{ t: number; m: number }>,
  durationSec: number,
  bins: number
): number[] {
  if (!(durationSec > 0) || bins < 1) return [];
  const out = new Float64Array(bins).fill(Number.NEGATIVE_INFINITY);
  for (const s of samples) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((s.t / durationSec) * bins)));
    if (s.m > out[i]) out[i] = s.m;
  }
  const present = [...out].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (present.length < 4) return new Array(bins).fill(0);
  const lo = present[Math.floor(present.length * 0.05)];
  const hi = present[Math.min(present.length - 1, Math.floor(present.length * 0.99))];
  const span = Math.max(1, hi - lo);
  return [...out].map((v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, (v - lo) / span)) : 0));
}

/** As amostras compactas de movimento → a curva de 0 a 1 da linha de tempo, com escala robusta pelo percentil de cima. */
export function motionCurve(samples: MotionSample[], durationSec: number, bins: number): number[] {
  if (!(durationSec > 0) || bins < 1) return [];
  const out = new Float64Array(bins);
  for (const sample of samples) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((sample.t / durationSec) * bins)));
    out[index] = Math.max(out[index], sample.score);
  }
  const present = [...out].filter((value) => value > 0).sort((a, b) => a - b);
  if (present.length < 4) return new Array(bins).fill(0);
  const lo = present[Math.floor(present.length * 0.25)];
  const hi = present[Math.min(present.length - 1, Math.floor(present.length * 0.98))];
  const span = Math.max(0.001, hi - lo);
  return [...out].map((value) => Math.min(1, Math.max(0, (value - lo) / span)));
}
