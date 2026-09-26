/**
 * Sinal de emoção da voz / eventos de áudio: em cada decodificação o SenseVoice já entrega,
 * além do texto, a etiqueta de emoção do trecho inteiro (<|HAPPY|>/<|ANGRY|>…) e a etiqueta de
 * evento de áudio (<|Laughter|>/<|Applause|>…) — o mesmo modelo e os mesmos pesos que a edição
 * de transcrição já usa, só que esses dois campos nunca eram lidos. Aqui uma segunda varredura
 * em janelas curtas os transforma em evidência com tempo:
 *   - trechos em que a voz está exaltada (falando rindo / gritando / assustada)
 *   - trechos de risada / palmas / choro (a reação de quem está ali, que não aparece na transcrição)
 * Os dois são «o estouro que a transcrição não mostra»: se a mesma frase saiu séria ou na risada,
 * só o som sabe.
 *
 * Nenhum modelo novo, nenhum megabyte novo — a pasta de modelos do SenseVoice é reaproveitada.
 *
 * O controle de custo é igual ao do sinal de expressão (emotion.ts): a varredura é densa nos picos
 * de volume / nos trechos de corte denso, uma grade uniforme cobre o resto, e tanto o número de
 * janelas quanto a duração total têm teto. Tudo falha em aberto: modelo ausente / falha de
 * decodificação / orçamento esgotado só significam ficar sem este sinal, nunca derrubar a detecção.
 * As funções puras (leitura da etiqueta / planejamento das janelas / fusão dos acertos) são testáveis,
 * e a decodificação do sherpa é trocada por um ponto de injeção.
 */
import { join } from "path";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { resolveFfmpegPath } from "./binaries";
import { extractPcmF32le16k, isModelInstalled, modelDir, readF32leSamples, SENSEVOICE_MODEL } from "./models";
import { toAnsiSafeDir } from "./win-ansi-path";
import { loadSherpa, type SherpaResult } from "./transcribe/sherpa-offline";
import { planSignalGuidedTimes, type MediaSignals, type TimeRange } from "./signals";

/** Duração de uma janela de varredura (o SenseVoice classifica o trecho inteiro: curta demais não tem contexto, longa demais é diluída pelo neutro). */
export const VOICE_WINDOW_SEC = 6;
/** Teto do número de janelas (janelas × duração da janela = áudio realmente decodificado, que é o que determina o tempo gasto). */
export const VOICE_MAX_WINDOWS = 100;
/** Passo da varredura dentro de uma janela de sinal. */
export const VOICE_WINDOW_STEP_SEC = 5;
/** Distância mínima entre os centros de duas janelas (um pouco menor que a janela, deixando vizinhas se sobreporem de leve para não perder a borda). */
export const VOICE_MIN_SPACING_SEC = 5;
/** Acertos vizinhos com intervalo menor que este viram um único trecho. */
const MERGE_GAP_SEC = 4;
/** Teto de trechos apontados por cada sinal (para não entupir o prompt). */
const MAX_RANGES = 12;
/** Orçamento total: ao esgotar o tempo, encerra com o que já tem. */
const VOICE_BUDGET_MS = 90_000;
/** Com menos janelas decodificadas com sucesso que este número, a evidência é fraca e o sinal não sai. */
const MIN_SCORED_WINDOWS = 3;
/**
 * Limite de saturação: se a taxa de acerto de uma etiqueta passar dele, a trilha inteira é descartada.
 * Na prática o SenseVoice classifica «falar com energia» como HAPPY quase sempre — com alguém animado
 * do começo ao fim, esta trilha degenera numa constante, e "o vídeo inteiro é estouro" é o mesmo que
 * estouro nenhum: no prompt só diluiria as outras evidências. Melhor sinal nenhum que sinal falso.
 *
 * O limite é bem alto (0,9) porque os trechos que passam do teto ainda são filtrados por topByDuration,
 * que os ordena por duração: em material de stand-up, com risada o tempo todo (na prática 62% das janelas
 * acertam risada), o que deve ser descartado não é a trilha inteira, e sim aquela risada de cortesia que
 * passa num instante — ficam as risadas mais longas, que são o estouro. Só quando quase toda janela
 * acerta, e a ordenação perde o sentido, a trilha é abandonada por completo.
 */
const SATURATION_RATIO = 0.9;

/**
 * As etiquetas de emoção do SenseVoice que contam como «voz exaltada». As mesmas três emoções de estouro
 * do sinal de expressão (FER+ pega riso/susto/raiva): alegria, raiva e surpresa. NEUTRAL/SAD/DISGUSTED
 * ficam fora — falar sem entonação e a emoção para baixo não são estouro de corte, e contá-los só dilui o sinal.
 */
const HOT_EMOTIONS = new Set(["HAPPY", "ANGRY", "SURPRISED"]);
/**
 * As etiquetas de evento de áudio que contam como «reação de quem está ali». BGM/Speech/Breath ficam fora
 * (uma é fundo, a outra é o estado normal); risada, palmas e choro é que são a evidência de estouro que
 * não aparece na transcrição.
 */
const HOT_EVENTS = new Set(["LAUGHTER", "APPLAUSE", "CRY"]);

export interface VoiceTagStats {
  windowsPlanned: number;
  /** Quantas janelas foram de fato decodificadas. */
  windowsScored: number;
  emotionPeakCount: number;
  eventPeakCount: number;
  /** A trilha foi descartada inteira por acertar demais e não distinguir nada (veja SATURATION_RATIO). */
  emotionSaturated?: boolean;
  eventSaturated?: boolean;
}

export interface VoiceEmotionOutcome {
  /** Trechos com a voz exaltada (falando rindo / gritando / assustada). */
  voiceEmotionPeaks: TimeRange[];
  /** Trechos de risada/palmas/choro (a reação de quem está ali). */
  audioEventPeaks: TimeRange[];
  stats: VoiceTagStats;
}

/**
 * Tira o embrulho `<|TAG|>` do SenseVoice e normaliza em maiúsculas: `"<|HAPPY|>"` → `"HAPPY"`.
 * O que não é etiqueta volta como veio (se o modelo mudar de versão e de formato, nada explode). Função pura.
 */
export function stripSenseVoiceTag(raw: string | undefined | null): string {
  if (!raw) return "";
  const m = raw.match(/<\|([^|>]+)\|>/);
  return (m ? m[1] : raw).trim().toUpperCase();
}

/** Se esta etiqueta de emoção conta como «voz exaltada». Função pura. */
export function isHotEmotion(tag: string | undefined | null): boolean {
  return HOT_EMOTIONS.has(stripSenseVoiceTag(tag));
}

/** Se esta etiqueta de evento conta como «reação de quem está ali». Função pura. */
export function isHotEvent(tag: string | undefined | null): boolean {
  return HOT_EVENTS.has(stripSenseVoiceTag(tag));
}

/**
 * Planeja as janelas de varredura: densas dentro das janelas de sinal, com uma grade uniforme cobrindo
 * o resto (a mesma estratégia de orçamento do sinal de expressão). Devolve o [início, fim] de cada
 * janela, já aparado ao trecho e ordenado no tempo. Função pura.
 */
export function planVoiceScanWindows(
  durationSec: number,
  signals: MediaSignals | undefined,
  maxWindows = VOICE_MAX_WINDOWS,
  windowSec = VOICE_WINDOW_SEC
): TimeRange[] {
  if (!(durationSec > 1)) return [];
  const centers = planSignalGuidedTimes(
    durationSec,
    signals,
    maxWindows,
    VOICE_MIN_SPACING_SEC,
    VOICE_WINDOW_STEP_SEC,
    windowSec / 2
  );
  const half = windowSec / 2;
  return centers.map((c) => {
    const startSec = Math.max(0, Math.min(c - half, durationSec - windowSec));
    return { startSec: Math.max(0, startSec), endSec: Math.min(durationSec, startSec + windowSec) };
  });
}

/**
 * Janela que acertou → trecho: as janelas vizinhas que acertaram (intervalo ≤ mergeGapSec) viram um trecho só.
 * A entrada precisa estar ordenada no tempo. Função pura.
 */
export function mergeHitWindows(hits: TimeRange[], mergeGapSec = MERGE_GAP_SEC): TimeRange[] {
  const out: TimeRange[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.startSec - last.endSec <= mergeGapSec) last.endSec = Math.max(last.endSec, h.endSec);
    else out.push({ startSec: h.startSec, endSec: h.endSec });
  }
  return out;
}

/**
 * Passando do teto, os trechos são tomados em ordem decrescente de **duração** (os `max` primeiros) e
 * devolvidos na ordem do tempo. Pegar os `max` primeiros direto seria o mesmo que «olhar só o começo do
 * vídeo»; e quanto mais uma risada ou uma exaltação dura, mais forte foi a reação — a duração é o próprio
 * indicador indireto da intensidade, e é ela que acha as ondas mais fortes num stand-up que ri o tempo todo.
 * Função pura.
 */
export function topByDuration(ranges: TimeRange[], max: number): TimeRange[] {
  if (ranges.length <= max) return ranges;
  return [...ranges]
    .sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec))
    .slice(0, max)
    .sort((a, b) => a.startSec - b.startSec);
}

/** O resultado de decodificar uma janela (só as duas etiquetas interessam; o texto é descartado). */
export interface VoiceWindowTags {
  emotion: string;
  event: string;
}

export interface VoiceEmotionDeps {
  /** Decodifica a janela [startSec, endSec) e devolve as etiquetas de emoção/evento; null quer dizer que a janela é inutilizável (pulada, sem contar). */
  tagWindow: (startSec: number, endSec: number) => Promise<VoiceWindowTags | null>;
}

/** Etiquetador de janelas curtas do SenseVoice: reaproveita a pasta de modelos da transcrição e lê só os campos emotion/event. */
export class VoiceTagger {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private recognizer: any = null;

  constructor(private modelsRoot: string) {}

  async init(): Promise<void> {
    const sh = loadSherpa();
    // O arquivo do modelo é aberto pela camada nativa (ANSI): no Windows, o caminho com acento vira primeiro o caminho curto 8.3 (issue #4)
    const dir = await toAnsiSafeDir(modelDir(this.modelsRoot, SENSEVOICE_MODEL));
    this.recognizer = new sh.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: { model: join(dir, "model.int8.onnx"), useInverseTextNormalization: 0 },
        tokens: join(dir, "tokens.txt"),
        numThreads: 2,
        provider: "cpu",
        debug: 0,
      },
    });
  }

  async tag(samples: Float32Array): Promise<VoiceWindowTags> {
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples });
    this.recognizer.decode(stream);
    const r = this.recognizer.getResult(stream) as SherpaResult & { emotion?: string; event?: string };
    return { emotion: stripSenseVoiceTag(r.emotion), event: stripSenseVoiceTag(r.event) };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Colhe o sinal de emoção da voz / eventos de áudio. Falha em aberto:
 * - o modelo do SenseVoice não está instalado (a pessoa usa a nuvem ou outra edição de transcrição) → null;
 * - falha ao extrair o áudio ou ao inicializar → null;
 * - falha ao decodificar uma janela → aquela janela é pulada;
 * - menos janelas bem-sucedidas que MIN_SCORED_WINDOWS → null;
 * - orçamento total estourado → encerra com o que já tem.
 */
export async function collectVoiceEmotionSignal(opts: {
  videoPath: string;
  durationSec: number;
  modelsRoot: string;
  signals?: MediaSignals;
  deps?: VoiceEmotionDeps;
  budgetMs?: number;
}): Promise<VoiceEmotionOutcome | null> {
  const { videoPath, durationSec, modelsRoot, signals, budgetMs = VOICE_BUDGET_MS } = opts;
  const windows = planVoiceScanWindows(durationSec, signals);
  if (windows.length === 0) return null;

  // Com a dependência injetada (nos testes) o disco não é tocado; fora disso o modelo precisa estar pronto —
  // aqui nunca se dispara um download: a pessoa pode nem usar a transcrição local, e não deve baixar 170MB escondido por um sinal auxiliar.
  if (!opts.deps && !(await isModelInstalled(modelsRoot, SENSEVOICE_MODEL).catch(() => false))) return null;

  const pcmPath = join(tmpdir(), `hotclip-voicetag-${Date.now()}-16k.f32le`);
  try {
    let deps = opts.deps;
    if (!deps) {
      await extractPcmF32le16k(resolveFfmpegPath(), videoPath, pcmPath);
      const samples = await readF32leSamples(pcmPath);
      const tagger = new VoiceTagger(modelsRoot);
      await tagger.init();
      const sampleRate = 16000;
      deps = {
        tagWindow: async (startSec, endSec) => {
          const from = Math.floor(startSec * sampleRate);
          const to = Math.min(samples.length, Math.floor(endSec * sampleRate));
          if (to - from < sampleRate) return null; // uma janela final com menos de 1s não tem valor de classificação
          return tagger.tag(samples.subarray(from, to));
        },
      };
    }

    const deadline = Date.now() + budgetMs;
    const emotionHits: TimeRange[] = [];
    const eventHits: TimeRange[] = [];
    let windowsScored = 0;

    for (const w of windows) {
      if (Date.now() > deadline) break; // orçamento esgotado, encerra com o que já tem
      try {
        const tags = await deps.tagWindow(w.startSec, w.endSec);
        if (!tags) continue;
        windowsScored++;
        if (isHotEmotion(tags.emotion)) emotionHits.push(w);
        if (isHotEvent(tags.event)) eventHits.push(w);
      } catch {
        // falha de uma janela: pula
      }
    }

    if (windowsScored < MIN_SCORED_WINDOWS) return null;
    // A trilha saturada é descartada inteira (veja SATURATION_RATIO): acertar o vídeo todo = não distinguir nada
    const emotionSaturated = emotionHits.length > windowsScored * SATURATION_RATIO;
    const eventSaturated = eventHits.length > windowsScored * SATURATION_RATIO;
    const voiceEmotionPeaks = emotionSaturated ? [] : topByDuration(mergeHitWindows(emotionHits), MAX_RANGES);
    const audioEventPeaks = eventSaturated ? [] : topByDuration(mergeHitWindows(eventHits), MAX_RANGES);
    return {
      voiceEmotionPeaks,
      audioEventPeaks,
      stats: {
        windowsPlanned: windows.length,
        windowsScored,
        emotionPeakCount: voiceEmotionPeaks.length,
        eventPeakCount: audioEventPeaks.length,
        emotionSaturated,
        eventSaturated,
      },
    };
  } catch {
    return null; // falha ao extrair o áudio / inicializar o modelo: em silêncio, sem este sinal
  } finally {
    await rm(pcmPath, { force: true });
  }
}
