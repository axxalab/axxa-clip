/**
 * A lógica pura da mesa de revisão dos trechos candidatos: a janela de contexto, o encaixe do arrasto nas
 * bordas das palavras, o aparo do intervalo arrastado e o recálculo do texto do trecho. Independe de
 * plataforma, e é compartilhada pela interação da camada de renderização e pelos testes unitários.
 */
import type { Transcript, TranscriptWord } from "./api-types";

const EPS = 1e-3;
/** A faixa de duração que o ajuste manual permite (a mesma guarda de boundary.ts). */
export const REVIEW_MIN_SEC = 3;
export const REVIEW_MAX_SEC = 120;

export interface ReviewWindow {
  winStartSec: number;
  winEndSec: number;
}

/** A janela de contexto da linha de tempo de revisão: uma folga de cada lado do trecho, para dar espaço a esticar o corte para fora. */
export function contextWindow(startSec: number, endSec: number, durationSec: number): ReviewWindow {
  const pad = Math.min(20, Math.max(6, (endSec - startSec) * 0.4));
  return {
    winStartSec: Math.max(0, startSec - pad),
    winEndSec: Math.max(endSec, Math.min(durationSec, endSec + pad)),
  };
}

/** Todas as palavras da janela (inclusive as que atravessam a borda), ordenadas no tempo — são os pontos candidatos ao encaixe na linha de tempo. */
export function wordsInWindow(transcript: Transcript, winStartSec: number, winEndSec: number): TranscriptWord[] {
  return transcript.segments
    .filter((s) => s.endSec > winStartSec && s.startSec < winEndSec)
    .flatMap((s) => s.words)
    .filter((w) => w.endSec > winStartSec && w.startSec < winEndSec)
    .sort((a, b) => a.startSec - b.startSec);
}

/**
 * Encaixe do arrasto: o início encaixa no começo da palavra mais próxima e o fim no fim da palavra mais
 * próxima (dentro da tolerância); fora da tolerância tudo fica como está — arrastar para um lugar sem
 * palavra (imagem sem fala, silêncio) também pode cair livremente.
 */
export function snapToWordEdge(
  sec: number,
  words: readonly Pick<TranscriptWord, "startSec" | "endSec">[],
  edge: "start" | "end",
  toleranceSec: number
): number {
  let best = sec;
  let bestDist = toleranceSec + EPS;
  for (const w of words) {
    const cand = edge === "start" ? w.startSec : w.endSec;
    const d = Math.abs(cand - sec);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

/**
 * O aparo ao arrastar uma das alças: não passa da outra (o que preserva a duração mínima), não passa da
 * duração máxima e não sai da janela. «Não passar da outra» é regra dura, e a borda da janela cede quando houver conflito.
 */
export function clampDrag(
  edge: "start" | "end",
  sec: number,
  oppositeSec: number,
  win: ReviewWindow
): number {
  if (edge === "start") {
    const hi = oppositeSec - REVIEW_MIN_SEC;
    const lo = Math.min(hi, Math.max(win.winStartSec, oppositeSec - REVIEW_MAX_SEC));
    return Math.min(hi, Math.max(lo, sec));
  }
  const lo = oppositeSec + REVIEW_MIN_SEC;
  const hi = Math.max(lo, Math.min(win.winEndSec, oppositeSec + REVIEW_MAX_SEC));
  return Math.max(lo, Math.min(hi, sec));
}

/** Recalcula o texto da transcrição coberto pelo intervalo atual (com a mesma regra de sobreposição de boundary.ts). */
export function clipText(transcript: Transcript, startSec: number, endSec: number): string {
  return transcript.segments
    .filter((s) => s.endSec > startSec + EPS && s.startSec < endSec - EPS)
    .map((s) => s.text)
    .join(" ");
}
