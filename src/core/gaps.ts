/**
 * Planejamento do corte seco: os silêncios de dentro do trecho são removidos, para o vídeo exportado ter o
 * ritmo apertado de uma edição humana em vez da folga de um corte de máquina.
 *
 * Entrada: as palavras do trecho (em tempo absoluto da origem). Silêncio = o vão entre duas palavras
 * seguidas acima de um limite. Saída: os pedaços preservados da origem e as mesmas palavras remapeadas na
 * linha de tempo comprimida (para a legenda).
 * Funções puras — a execução do ffmpeg vive em cut.ts.
 */
import type { TranscriptWord } from "../shared/api-types";
import { peakInRange, type PeakTrack } from "./audio-peaks";
import { hasSpeechInRange, speechAnchorBounds, type SpeechActivitySpan } from "./speech-activity";

export interface KeptSegment {
  /** Tempo absoluto da origem. */
  startSec: number;
  endSec: number;
}

export interface JumpCutOptions {
  /**
   * A trilha de picos de áudio do trecho. Quando ela existe, um vão entre palavras só é cortado se a região
   * a remover estiver de fato quieta — risada, palmas e efeitos da trilha não trazem palavra nenhuma e
   * precisam sobreviver.
   */
  peaks?: PeakTrack;
  /** O pico (de 0 a 1) acima do qual um vão conta como «não silencioso» (~-28dBFS). */
  silenceThreshold?: number;
  /**
   * Os intervalos que têm de ser cortados independentemente de vão ou de volume — palavra de preenchimento e
   * gagueira são fala audível, então nem a regra do vão nem o portão de silêncio os removeriam por conta própria.
   */
  forceCutSpans?: KeptSegment[];
  /** O limite de corte do vão entre palavras; passe Infinity para desligar o corte por vão de vez. */
  gapThresholdSec?: number;
  /**
   * Os intervalos protegidos (em tempo absoluto da origem): a pausa em volta de um evento de emoção (pico de
   * risada, grito, palmas) é o efeito do programa — a respirada antes da piada, o que ecoa depois da explosão —
   * e apagá-las é apagar o ritmo da comédia.
   * Quando o vão a remover cruza qualquer intervalo protegido, aquele vão não é cortado (isto restringe só o
   * corte por vão, e não afeta forceCutSpans — palavra de preenchimento, regravação e colagem são conteúdo que se quer apagar mesmo).
   */
  protectedSpans?: KeptSegment[];
  /**
   * Manter o respiro (v0.14): cada emenda do corte por vão deixa esta quantidade de segundos de pausa natural
   * no fim da fala — a pausa longa continua sendo cortada, mas o resultado não fica colado sem costura, e
   * ainda sobra um fôlego entre as frases. Um corte seco «magro demais» é uma das fontes do gosto de IA (na
   * edição humana se deixa espaço para respirar). 0 ou ausente = o ritmo apertado de sempre, sem mudança.
   */
  breathPadSec?: number;
  /**
   * Os intervalos de VAD confiáveis. Um vão nominalmente sem palavra e quieto é preservado quando este sinal
   * local independente ainda detecta fala (por exemplo, quando o ASR deixou passar).
   */
  speechSpans?: SpeechActivitySpan[];
}

/** Subtrai os intervalos cortados dos pedaços preservados (diferença de intervalos). Pura. */
export function subtractSpans(segments: KeptSegment[], spans: KeptSegment[], minKeepSec = 0.12): KeptSegment[] {
  if (spans.length === 0) return segments;
  const out: KeptSegment[] = [];
  for (const seg of segments) {
    let pieces: KeptSegment[] = [{ ...seg }];
    for (const span of spans) {
      const next: KeptSegment[] = [];
      for (const p of pieces) {
        if (span.endSec <= p.startSec || span.startSec >= p.endSec) {
          next.push(p);
          continue;
        }
        if (span.startSec > p.startSec) next.push({ startSec: p.startSec, endSec: span.startSec });
        if (span.endSec < p.endSec) next.push({ startSec: span.endSec, endSec: p.endSec });
      }
      pieces = next;
    }
    out.push(...pieces.filter((p) => p.endSec - p.startSec >= minKeepSec));
  }
  return out;
}

export interface JumpCutPlan {
  segments: KeptSegment[];
  /** As palavras deslocadas para a linha de tempo de saída (t=0 no início do trecho). */
  words: TranscriptWord[];
  /**
   * As posições, em tempo de saída, em que houve uma emenda (onde o 2º pedaço e os seguintes começam).
   * A quebra de linha da legenda precisa quebrar aqui — o silêncio que antes separava estas frases não existe
   * mais na linha de tempo comprimida.
   */
  breaks: number[];
  /** O total de segundos removidos. */
  removedSec: number;
  /** A duração de saída (a soma dos pedaços preservados). */
  durationSec: number;
  /** Os vãos que teriam sido removidos, mas que uma evidência de fala confiável preservou. */
  speechProtectedGaps?: number;
}

/** Vão entre palavras mais longo que isto é cortado. */
const GAP_THRESHOLD_SEC = 0.6;
/** O espaço deixado por padrão pelo «manter o respiro» (somado ao PAD_AFTER no fim da fala). */
export const BREATH_PAD_SEC = 0.25;
/** O espaço de respiro preservado em volta da fala, dos dois lados de um corte. */
const PAD_BEFORE_SEC = 0.12;
const PAD_AFTER_SEC = 0.18;
/** A folga de entrada e de saída nas bordas do trecho. */
const LEAD_IN_SEC = 0.15;
const TAIL_SEC = 0.3;
/** O pico padrão acima do qual um vão está alto o bastante para ficar (~-28dBFS). */
const SILENCE_PEAK_THRESHOLD = 0.04;
/** Emenda que remove menos que isto é agitação, não ritmo — o vão é devolvido. */
const MIN_CUT_SEC = 0.2;

/** Une os pedaços preservados cujo corte de separação é curto demais para valer uma emenda. */
export function mergeShortCuts(segments: KeptSegment[], minCutSec = MIN_CUT_SEC): KeptSegment[] {
  if (segments.length < 2) return segments;
  const out: KeptSegment[] = [{ ...segments[0] }];
  for (let i = 1; i < segments.length; i++) {
    const prev = out[out.length - 1];
    if (segments[i].startSec - prev.endSec < minCutSec) {
      prev.endSec = Math.max(prev.endSec, segments[i].endSec);
    } else {
      out.push({ ...segments[i] });
    }
  }
  return out;
}

export function computeJumpCut(
  words: TranscriptWord[],
  clipStartSec: number,
  clipEndSec: number,
  options: JumpCutOptions = {}
): JumpCutPlan {
  const { peaks, silenceThreshold = SILENCE_PEAK_THRESHOLD, forceCutSpans = [], gapThresholdSec = GAP_THRESHOLD_SEC, protectedSpans = [], breathPadSec = 0, speechSpans } = options;
  // O respiro é somado ao fim da fala: o intervalo cortado encurta na mesma medida, e o fim da frase fica com um fôlego
  const padAfter = PAD_AFTER_SEC + Math.max(0, breathPadSec);
  const inClip = words.filter((w) => w.endSec > clipStartSec && w.startSec < clipEndSec);
  if (inClip.length === 0) {
    const full = { startSec: clipStartSec, endSec: clipEndSec };
    return {
      segments: [full], words: [], breaks: [], removedSec: 0, durationSec: clipEndSec - clipStartSec,
      ...(speechSpans !== undefined ? { speechProtectedGaps: 0 } : {}),
    };
  }

  let segments: KeptSegment[] = [];
  let speechProtectedGaps = 0;
  const speechAnchors = speechSpans ? speechAnchorBounds(speechSpans, inClip) : {};
  const speechStart = speechAnchors.startSec === undefined ? Infinity : speechAnchors.startSec - 0.08;
  let segStart = Math.max(clipStartSec, Math.min(inClip[0].startSec - LEAD_IN_SEC, speechStart));
  let prevEnd = inClip[0].endSec;
  for (let i = 1; i < inClip.length; i++) {
    const w = inClip[i];
    const gap = w.startSec - prevEnd;
    if (gap > gapThresholdSec) {
      // Portão E: o intervalo removido precisa estar sem palavra E acusticamente quieto.
      const removedFrom = prevEnd + padAfter;
      const removedTo = w.startSec - PAD_BEFORE_SEC;
      const quiet =
        !peaks || removedTo <= removedFrom || peakInRange(peaks, removedFrom, removedTo) < silenceThreshold;
      // Guarda de emoção: o vão a remover que encosta num intervalo protegido (o evento de emoção ± o raio de proteção) não é cortado
      const protectedGap = protectedSpans.some((p) => p.startSec < removedTo && p.endSec > removedFrom);
      const speechProtected = speechSpans !== undefined && hasSpeechInRange(speechSpans, removedFrom, removedTo);
      if (quiet && !protectedGap && speechProtected) speechProtectedGaps++;
      if (quiet && !protectedGap && !speechProtected) {
        segments.push({ startSec: segStart, endSec: Math.min(prevEnd + padAfter, clipEndSec) });
        segStart = Math.max(w.startSec - PAD_BEFORE_SEC, prevEnd + padAfter);
      }
    }
    prevEnd = Math.max(prevEnd, w.endSec);
  }
  const speechEnd = speechAnchors.endSec === undefined ? -Infinity : speechAnchors.endSec + 0.12;
  segments.push({ startSec: segStart, endSec: Math.min(Math.max(prevEnd + TAIL_SEC, speechEnd), clipEndSec) });
  // Primeiro unir e depois subtrair — um corte forçado (uma palavra de preenchimento tem ~0,15s) nunca pode
  // ser «devolvido» pela passada de suavização dos cortes curtos
  segments = mergeShortCuts(segments);
  segments = subtractSpans(segments, forceCutSpans);

  const durationSec = segments.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
  const removedSec = clipEndSec - clipStartSec - durationSec;

  // As palavras são remapeadas na linha de tempo comprimida da saída.
  const remapped: TranscriptWord[] = [];
  const breaks: number[] = [];
  let outOffset = 0;
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (si > 0) breaks.push(outOffset);
    for (const w of inClip) {
      if (w.startSec >= seg.startSec - 1e-6 && w.startSec < seg.endSec) {
        remapped.push({
          text: w.text,
          startSec: outOffset + (w.startSec - seg.startSec),
          endSec: outOffset + Math.min(w.endSec, seg.endSec) - seg.startSec,
          // A marcação de falante acompanha a palavra — sem ela, a legenda na linha de tempo comprimida não dá para colorir nem etiquetar por pessoa
          ...(w.speaker !== undefined ? { speaker: w.speaker } : {}),
          ...(w.timingSource !== undefined ? { timingSource: w.timingSource } : {}),
        });
      }
    }
    outOffset += seg.endSec - seg.startSec;
  }
  return {
    segments, words: remapped, breaks, removedSec, durationSec,
    ...(speechSpans !== undefined ? { speechProtectedGaps } : {}),
  };
}
