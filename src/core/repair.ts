/**
 * Laço de reparo da verificação de qualidade (inspirado no ciclo do video-use de «conferir depois de
 * renderizar → corrigir sozinho → conferir de novo», aqui em uma rodada só): o que, entre os avisos da
 * verificação, «a máquina consegue consertar sozinha» é consertado ali mesmo —
 *  - silêncio longo ou tela preta nas pontas → o começo/fim do vídeo pronto é aparado (sem precisar
 *    rodar a esteira de renderização inteira de novo: a legenda já está queimada na imagem, e aparar a
 *    ponta não desalinha nada);
 *  - volume longe do alvo de -14 / pico real acima do limite → o vídeo é copiado e só o áudio passa
 *    outra vez pelo loudnorm.
 * Depois do conserto a verificação roda de novo: só é aceito se o relatório melhorar, senão o vídeo
 * original fica — a máquina não pode deixar o vídeo pior. O aviso de corte no meio de uma palavra
 * segue sendo só aviso (o corte seco e o encaixe, mais acima, já têm guarda na borda das palavras, e
 * recortar tudo rende pouco e arrisca muito); tela preta ou silêncio no meio do vídeo é a mesma coisa:
 * aquilo é conteúdo, e a máquina não deve apagar conteúdo no lugar de ninguém.
 *
 * planRepair/buildRepairArgs são funções puras (testáveis); só applyRepair toca no ffmpeg e no sistema
 * de arquivos. A semântica de falha é a mesma da verificação: falha em aberto, nunca derrubando a exportação.
 */
import { rename, rm } from "fs/promises";
import { toFfmpegTime } from "./time";
import { runFfmpeg, edgeFadeFilters, LOUDNORM_FILTER, LOUDNORM_OUT_RATE } from "./cut";
import { colorOutputArgs, type ColorRenderPlan } from "./color";
import { ffmpegAudioStreamSpecifier, ffmpegVideoStreamSpecifier } from "./probe";
import type { ClipQaReport, QaRepairRecord } from "./qa";

/** A margem que decide se um trecho de silêncio ou de tela preta está «encostado» no começo ou no fim (segundos). */
const EDGE_TOUCH_SEC = 0.25;
/** O respiro deixado antes da fala ao aparar o silêncio (segundos) — aparar em cima da voz soa afobado. */
const KEEP_PAD_SEC = 0.25;
/** Piso do quanto aparar (segundos): abaixo disso não vale codificar outra vez. */
const MIN_TRIM_SEC = 0.4;
/** Piso da duração do vídeo depois do conserto (segundos) e piso da proporção preservada: aparar demais é pior que não aparar. */
const MIN_CLIP_SEC = 3;
const MIN_KEEP_FRAC = 0.5;
/** Os limites de desvio de volume e de pico real (os mesmos do julgamento em qa.ts). */
const LOUDNESS_TOLERANCE_LU = 2;
const TRUE_PEAK_CEILING_DB = -1;

export interface RepairContext {
  /** A normalização de volume estava ligada na exportação (é só aí que consertar o volume faz sentido). */
  normalizeLoudness: boolean;
  /** O começo pode ser aparado (com o clímax na frente, o mini-trecho do gancho está colado no começo e ele não pode ser tocado). */
  headTrimmable: boolean;
}

/** O plano de uma rodada de reparo (na linha de tempo de saída). */
export interface RepairPlan {
  /** O áudio passa outra vez pelo loudnorm (volume desviado / pico real acima do limite). */
  loudness: boolean;
  /** O novo início (>0 = o começo foi aparado). */
  trimStartSec: number;
  /** O novo fim (diferente de null = o fim foi aparado). */
  trimEndSec: number | null;
  /** Quantos segundos foram aparados no total (usado para corrigir a duração prevista na reverificação). */
  trimmedSec: number;
  /** A lista de ações em linguagem de gente (vai para qa.repair.actions no clips.json). */
  actions: string[];
}

const fmtSec = (v: number): string => v.toFixed(1);

/**
 * Deduz o plano de reparo a partir do relatório da verificação; sem nada auto-curável, devolve null.
 * Só o silêncio e a tela preta encostados nas pontas contam — um trecho no meio é escolha de conteúdo,
 * e isso não é da conta da máquina.
 */
export function planRepair(report: ClipQaReport, ctx: RepairContext): RepairPlan | null {
  const dur = report.durationSec;
  const actions: string[] = [];

  // Aparar o começo: entre o silêncio encostado no começo (deixando o respiro) e a tela preta (aparada inteira), vale o ponto mais tardio
  let trimStart = 0;
  if (ctx.headTrimmable) {
    for (const s of report.silenceSpans) {
      if (s.startSec <= EDGE_TOUCH_SEC) trimStart = Math.max(trimStart, s.endSec - KEEP_PAD_SEC);
    }
    for (const b of report.blackSpans) {
      if (b.startSec <= EDGE_TOUCH_SEC) trimStart = Math.max(trimStart, b.endSec);
    }
    trimStart = Math.max(0, trimStart);
    if (trimStart < MIN_TRIM_SEC) trimStart = 0;
  }

  // Aparar o fim: entre o silêncio e a tela preta encostados no fim, vale o novo fim mais cedo
  let trimEnd: number | null = null;
  for (const s of report.silenceSpans) {
    if (s.endSec >= dur - EDGE_TOUCH_SEC) {
      const at = s.startSec + KEEP_PAD_SEC;
      trimEnd = trimEnd === null ? at : Math.min(trimEnd, at);
    }
  }
  for (const b of report.blackSpans) {
    if (b.endSec >= dur - EDGE_TOUCH_SEC) {
      trimEnd = trimEnd === null ? b.startSec : Math.min(trimEnd, b.startSec);
    }
  }
  if (trimEnd !== null && (dur - trimEnd < MIN_TRIM_SEC || trimEnd <= 0)) trimEnd = null;

  // Guarda contra aparar demais: se o resultado ficar curto demais ou perder demais → aparar é abandonado (o aviso de silêncio fica para a pessoa julgar)
  const newDur = (trimEnd ?? dur) - trimStart;
  if (newDur < MIN_CLIP_SEC || newDur < dur * MIN_KEEP_FRAC) {
    trimStart = 0;
    trimEnd = null;
  }

  if (trimStart > 0) actions.push(`aparados ${fmtSec(trimStart)}s de silêncio/tela preta do começo`);
  if (trimEnd !== null) actions.push(`aparados ${fmtSec(dur - trimEnd)}s de silêncio/tela preta do fim`);

  // Volume: só é renormalizado quando a normalização estava ligada na exportação E a medição mostra desvio ou pico acima do limite
  const loudness =
    ctx.normalizeLoudness &&
    report.loudness !== null &&
    (Math.abs(report.loudness.integratedLufs - -14) > LOUDNESS_TOLERANCE_LU ||
      report.loudness.truePeakDb > TRUE_PEAK_CEILING_DB);
  if (loudness) actions.push("segunda normalização do volume do áudio (-14 LUFS)");

  if (actions.length === 0) return null;
  const trimmedSec = trimStart + (trimEnd !== null ? dur - trimEnd : 0);
  return { loudness, trimStartSec: trimStart, trimEndSec: trimEnd, trimmedSec: Number(trimmedSec.toFixed(3)), actions };
}

/**
 * Os parâmetros do ffmpeg do reparo (função pura). Aparar exige recodificar (para ser exato no quadro);
 * quando só o volume é consertado, o vídeo é copiado, o que leva segundos e não perde qualidade nenhuma.
 */
export function buildRepairArgs(
  inPath: string,
  outPath: string,
  plan: RepairPlan,
  durationSec: number,
  color?: ColorRenderPlan,
  videoStreamIndex?: number,
  audioStreamIndex?: number
): string[] {
  const trims = plan.trimStartSec > 0 || plan.trimEndSec !== null;
  const maps = [
    "-map", ffmpegVideoStreamSpecifier(videoStreamIndex),
    "-map", ffmpegAudioStreamSpecifier(audioStreamIndex, 0, true),
  ];
  if (!trims) {
    // Só o volume: -c:v copy, e apenas o áudio é recodificado
    return [
      "-hide_banner", "-y",
      "-i", inPath,
      ...maps,
      "-c:v", "copy",
      "-af", LOUDNORM_FILTER,
      "-ar", LOUDNORM_OUT_RATE,
      "-c:a", "aac",
      "-b:a", "192k",
      ...colorOutputArgs(color),
      "-movflags", "+faststart",
      outPath,
    ];
  }
  const start = Math.max(0, plan.trimStartSec);
  const newDur = Math.max(0.1, (plan.trimEndSec ?? durationSec) - start);
  // A cadeia de áudio segue a regra da exportação: loudnorm primeiro, e 30ms de suavização nas bordas novas para não estalar
  const audioChain = [...(plan.loudness ? [LOUDNORM_FILTER] : []), ...edgeFadeFilters(newDur)];
  return [
    "-hide_banner", "-y",
    "-ss", toFfmpegTime(start),
    "-i", inPath,
    "-t", toFfmpegTime(newDur),
    ...maps,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    ...colorOutputArgs(color),
    ...(audioChain.length > 0 ? ["-af", audioChain.join(",")] : []),
    ...(plan.loudness ? ["-ar", LOUDNORM_OUT_RATE] : []),
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    outPath,
  ];
}

export interface RepairOutcome {
  /** O relatório final da verificação (com o registro de repair; quando o conserto não é aceito, é o relatório original + o registro). */
  report: ClipQaReport;
  /** true = o vídeo pronto foi substituído pela versão consertada. */
  applied: boolean;
}

/**
 * Roda uma rodada de reparo: renderiza a versão consertada → roda a verificação de novo → só troca o
 * vídeo original se os avisos diminuírem de verdade, e senão apaga a versão consertada e mantém o
 * original (a máquina não pode deixar o vídeo pior). reQa é injetada por quem chama (com a duração
 * prevista e o contexto dos pontos de corte certos). O erro lançado é tratado por quem chama (falha em aberto).
 */
export async function applyRepair(
  path: string,
  plan: RepairPlan,
  before: ClipQaReport,
  reQa: (fixedPath: string) => Promise<ClipQaReport>,
  signal?: AbortSignal,
  color?: ColorRenderPlan,
  videoStreamIndex?: number,
  audioStreamIndex?: number
): Promise<RepairOutcome> {
  const fixPath = path.replace(/\.mp4$/, ".fix.mp4");
  const record = (applied: boolean): QaRepairRecord => ({
    actions: plan.actions,
    beforeIssues: before.issues,
    applied,
  });
  try {
    await runFfmpeg(
      buildRepairArgs(path, fixPath, plan, before.durationSec, color, videoStreamIndex, audioStreamIndex),
      { signal }
    );
    const fixed = await reQa(fixPath);
    if (fixed.issues.length < before.issues.length) {
      await rename(fixPath, path);
      return { report: { ...fixed, repair: record(true) }, applied: true };
    }
    await rm(fixPath, { force: true });
    return { report: { ...before, repair: record(false) }, applied: false };
  } catch (e) {
    await rm(fixPath, { force: true }).catch(() => {});
    throw e;
  }
}
