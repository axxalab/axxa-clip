/**
 * Detecção de palavra de preenchimento e de gagueira: acha os trechos que uma edição humana apertada
 * cortaria — os sons de hesitação e a repetição imediata de uma palavra. Conservador de propósito: só o som
 * de hesitação inequívoco entra na lista («tipo», «né» e «então» quase sempre são palavras de verdade, e um
 * «ah» no fim da frase carrega emoção — todos ficam).
 * Funções puras; os trechos alimentam o planejador do corte seco como cortes forçados.
 */
import type { TranscriptWord } from "../shared/api-types";
import type { KeptSegment } from "./gaps";

/** Os sons de hesitação inequívocos (só quando são a palavra inteira). */
const FILLER_TOKENS = new Set([
  // português
  "ahn", "ahm", "\u00e3h", "h\u00e3", "hum", "humm", "hmm", "\u00e9\u00e9", "\u00e9\u00e9\u00e9", "eh", "ehm",
  // inglês
  "um", "uh", "er", "erm", "mmm",
  // escrita ideográfica (em escapes Unicode, para o código-fonte não carregar ideogramas)
  "\u55ef", "\u5443", "\u989d", "\u5514", "\u55ef\u55ef", "\u5443\u5443",
]);

/** Uma repetição mais longa que isto provavelmente é ênfase de propósito. */
const STUTTER_MAX_SEC = 0.8;

export interface FillerHit {
  index: number;
  text: string;
  startSec: number;
  endSec: number;
  kind: "filler" | "stutter";
}

/** Tira a pontuação que o passo de recuperação de pontuação pode ter colado na palavra. */
function bareToken(text: string): string {
  return text.toLowerCase().replace(/[,.!?;:\u3002\uff0c\uff01\uff1f\u3001\uff1b\uff1a\u2026\uff5e~\s]/gu, "");
}

/** Acha as palavras de preenchimento e as repetições de gagueira (a PRIMEIRA de cada par repetido). */
export function findFillerWords(words: TranscriptWord[]): FillerHit[] {
  const hits: FillerHit[] = [];
  for (let i = 0; i < words.length; i++) {
    const token = bareToken(words[i].text);
    if (!token) continue;
    if (FILLER_TOKENS.has(token)) {
      hits.push({ index: i, text: words[i].text, startSec: words[i].startSec, endSec: words[i].endSec, kind: "filler" });
      continue;
    }
    const next = words[i + 1];
    if (
      next &&
      token === bareToken(next.text) &&
      words[i].endSec - words[i].startSec < STUTTER_MAX_SEC &&
      next.startSec - words[i].endSec < 0.35
    ) {
      hits.push({ index: i, text: words[i].text, startSec: words[i].startSec, endSec: words[i].endSec, kind: "stutter" });
    }
  }
  return hits;
}

/** As palavras menos os índices marcados (a legenda não pode mostrar o que foi cortado). */
export function dropFillerWords(words: TranscriptWord[], hits: FillerHit[]): TranscriptWord[] {
  const drop = new Set(hits.map((h) => h.index));
  return words.filter((_, i) => !drop.has(i));
}

/** Une os trechos encontrados que se sobrepõem ou se encostam em intervalos de corte forçado. */
export function fillerCutSpans(hits: FillerHit[], mergeGapSec = 0.1): KeptSegment[] {
  const sorted = [...hits].sort((a, b) => a.startSec - b.startSec);
  const out: KeptSegment[] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && h.startSec - last.endSec < mergeGapSec) {
      last.endSec = Math.max(last.endSec, h.endSec);
    } else {
      out.push({ startSec: h.startSec, endSec: h.endSec });
    }
  }
  return out;
}
