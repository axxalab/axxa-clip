/**
 * Correção da transcrição frase a frase: o erro de escrita do ASR seria queimado na legenda, na tradução e
 * no texto de publicação, então corrigir ali mesmo na página de transcrição é o caminho mais curto. Depois
 * de mudar o texto da frase, a linha de tempo por palavra daquela frase é reconstruída pela «proporção da
 * largura visual dos caracteres» (caractere a caractere na escrita ideográfica e por palavra no alfabeto
 * latino) — a varredura de cor do karaokê fica um pouco mais uniforme dentro daquela frase, mas as palavras
 * estão certas; entre um erro de escrita e uma varredura um pouco tosca, a escolha é sempre a segunda.
 * Função pura, testável por inteiro.
 */
import type { Transcript, TranscriptWord } from "./api-types";

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_CHAR_RE = /[\p{L}\p{M}\p{N}'’\-]/u;

/** Quebra a frase editada em unidades de palavra do karaokê: um caractere por vez na escrita ideográfica, a palavra inteira no alfabeto latino, e a pontuação colada na palavra anterior. */
export function tokenizeForWords(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  const flushLatin = (): void => {
    if (latin) {
      tokens.push(latin);
      latin = "";
    }
  };
  for (const ch of Array.from(text)) {
    if (!CJK_RE.test(ch) && WORD_CHAR_RE.test(ch)) {
      latin += ch;
      continue;
    }
    flushLatin();
    if (/\s/.test(ch)) continue;
    if (CJK_RE.test(ch)) {
      tokens.push(ch);
    } else if (tokens.length > 0) {
      tokens[tokens.length - 1] += ch; // a pontuação cola na palavra anterior (igual à forma das palavras do ASR)
    } else {
      tokens.push(ch);
    }
  }
  flushLatin();
  return tokens;
}

/** A largura visual: ideograma=2, letra/número=1 e o resto (pontuação)=0,5 — é o peso da divisão do tempo. */
function tokenWeight(token: string): number {
  let w = 0;
  for (const ch of Array.from(token)) {
    w += CJK_RE.test(ch) ? 2 : WORD_CHAR_RE.test(ch) ? 1 : 0.5;
  }
  return Math.max(0.5, w);
}

/** Divide [startSec, endSec] entre as palavras conforme o peso (alinhado nas pontas, sem vão e sem sobreposição). */
export function rebuildWords(text: string, startSec: number, endSec: number): TranscriptWord[] {
  const tokens = tokenizeForWords(text);
  const dur = Math.max(0, endSec - startSec);
  if (tokens.length === 0 || dur <= 0) return [];
  const weights = tokens.map(tokenWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: TranscriptWord[] = [];
  let t = startSec;
  for (let i = 0; i < tokens.length; i++) {
    const end = i === tokens.length - 1 ? endSec : t + (dur * weights[i]) / total;
    out.push({ text: tokens[i], startSec: t, endSec: end, timingSource: "edited" });
    t = end;
  }
  return out;
}

/**
 * Muda o texto de uma frase: o text é substituído e as words daquela frase são reconstruídas, enquanto as
 * outras frases ficam como estavam. Texto vazio conta como clique errado, e a transcrição volta sem mudança.
 */
export function editSegmentText(transcript: Transcript, segmentId: number, newText: string): Transcript {
  const text = newText.trim();
  if (!text || transcript.segments.find((s) => s.id === segmentId)?.text === text) return transcript;
  return {
    ...transcript,
    segments: transcript.segments.map((seg) =>
      seg.id === segmentId
        ? { ...seg, text, words: rebuildWords(text, seg.startSec, seg.endSec) }
        : seg
    ),
  };
}
