/**
 * Exportação do arquivo de legenda SRT: cada trecho leva ao lado um .srt de mesmo nome — é dele que dependem
 * o envio de legenda nativa da plataforma (YouTube e afins aceitam), o acabamento no editor e a
 * acessibilidade; a legenda queimada é «para ver», e o SRT é «para usar».
 *
 * As palavras e a tradução vêm da esteira de exportação (o remapeamento do corte seco e a remoção das
 * palavras de preenchimento já valeram), e a divisão em linhas segue as mesmas regras de quebra da legenda
 * queimada, o que garante que o .srt e a legenda na imagem batam linha por linha. Montado só com strings, sem dependência.
 */
import type { TranscriptWord } from "../shared/api-types";
import { groupWordsIntoLines, needsSpaceAfter, CAPTION_HOLD_MAX_SEC, planReadableCaptions, type CaptionReadabilityOptions } from "./subtitle";
import type { TranslationLine } from "./translate";

/** A largura de linha do SRT (em unidades visuais: ideograma=2, letra latina=1) — mais larga que a da legenda vertical, perto do costume dos tocadores comuns. */
export const SRT_MAX_LINE_UNITS = 36;

export interface SrtLine {
  startSec: number;
  endSec: number;
  text: string;
  /** A tradução, quando é bilíngue (renderizada como a segunda linha). */
  secondary?: string;
}

/** O formato de tempo do SRT, HH:MM:SS,mmm (um valor negativo é preso em 0). */
export function formatSrtTime(sec: number): string {
  const total = Math.max(0, Math.round(sec * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000);
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

/**
 * Palavras → linhas de SRT (o tempo é relativo ao trecho; antes de passar words, o deslocamento de
 * clipStartSec e o remapeamento do corte seco já foram feitos, na mesma base de tempo da legenda queimada).
 * A tradução é anexada como segunda linha conforme a sobreposição de tempo.
 */
export function srtLinesFromWords(
  words: TranscriptWord[],
  forcedBreaks: number[] = [],
  translation: TranslationLine[] = [],
  options: CaptionReadabilityOptions = {}
): SrtLine[] {
  const planned = options.readability ? planReadableCaptions(words, SRT_MAX_LINE_UNITS, forcedBreaks, options.endSec) : undefined;
  const lines = planned ? planned.map((line) => line.words) : groupWordsIntoLines(words, SRT_MAX_LINE_UNITS, forcedBreaks).filter((l) => l.length > 0);
  const out: SrtLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startSec = line[0].startSec;
    const lastEnd = line[line.length - 1].endSec;
    const nextStart = lines[i + 1]?.[0].startSec;
    const endSec = planned?.[i].endSec ?? (nextStart !== undefined ? Math.min(nextStart, lastEnd + CAPTION_HOLD_MAX_SEC) : lastEnd);
    const text = line
      .map((w, j) => w.text + (needsSpaceAfter(w.text, line[j + 1]?.text) ? " " : ""))
      .join("")
      .trim();
    if (!text || endSec <= startSec) continue;
    // A tradução: vale a que se sobrepõe por mais tempo a esta linha
    let secondary: string | undefined;
    let bestOverlap = 0;
    for (const t of translation) {
      const ov = Math.min(endSec, t.endSec) - Math.max(startSec, t.startSec);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        secondary = t.text;
      }
    }
    out.push({ startSec, endSec, text, ...(secondary ? { secondary } : {}) });
  }
  return out;
}

/** Monta o documento SRT completo. */
export function buildSrt(lines: SrtLine[]): string {
  return lines
    .map((l, i) => {
      const body = l.secondary ? `${l.text}\n${l.secondary}` : l.text;
      return `${i + 1}\n${formatSrtTime(l.startSec)} --> ${formatSrtTime(l.endSec)}\n${body}\n`;
    })
    .join("\n");
}
