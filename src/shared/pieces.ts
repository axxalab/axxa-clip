/**
 * Costura de vários trechos: um clipe é montado a partir de vários intervalos
 * não contínuos da origem, em ordem de tempo.
 *
 * Por que isso é necessário: um corte que viraliza de verdade muitas vezes não é
 * um trecho contínuo de gravação — uma "contradição" só se sustenta colocando
 * lado a lado duas falas separadas por quinze minutos, e os "três atos" da venda
 * também pegam um trecho de cada posição diferente da live. O lado da detecção só
 * entrega a lista de trechos, e a costura em si reaproveita a máquina de corte
 * seco que já existe: os intervalos entre os trechos são entregues ao
 * computeJumpCut como intervalos de remoção obrigatória, e assim legendas,
 * tradução, EDL, capa e verificação de qualidade se alinham sozinhos, sem
 * precisar de uma segunda lógica de linha do tempo.
 *
 * É um módulo de funções puras, que não toca no ffmpeg — fica em shared porque o
 * processo de renderização (bancada de revisão e cartões de candidato) também
 * precisa calcular a duração final e desenhar as barras de trecho pelas mesmas
 * regras, e os dois lados têm que usar exatamente o mesmo código.
 */
import type { TranscriptWord, ClipPiece } from "./api-types";

export type { ClipPiece };

/** Duração mínima de um trecho: mais curto que isso, o que entra é só um fragmento, e o público só sente o pulo. */
export const MIN_PIECE_SEC = 2;
/** Quantos trechos no máximo: mais do que isso deixa de ser "contraste" e vira colagem, e o risco de distorcer o sentido sobe muito. */
export const MAX_PIECES = 4;
/** Um intervalo menor que este valor entre dois trechos conta como o mesmo trecho (aquele pedacinho de silêncio não vale o corte). */
export const PIECE_MERGE_GAP_SEC = 1.2;
/** Folga no fim e no começo de cada trecho: a emenda não fica colada na palavra, senão a sensação é de fala cortada na marra. */
export const PIECE_PAD_AFTER_SEC = 0.25;
export const PIECE_PAD_BEFORE_SEC = 0.15;
/** Marca de omissão no texto costurado — é por ela que a bancada de revisão e o prompt de reavaliação percebem que "houve um salto aqui". */
export const PIECE_JOINER = " …… ";

/**
 * Ordenar e fundir: ordena por tempo e funde os trechos vizinhos com intervalo
 * menor que gapSec. Não descarta trecho curto e não impõe teto de quantidade —
 * é por aqui que passa a seleção manual (as frases que a pessoa escolheu a dedo),
 * e a decisão humana é preservada como está.
 */
export function mergePieces(raw: ClipPiece[], gapSec: number = PIECE_MERGE_GAP_SEC): ClipPiece[] {
  const valid = raw
    .filter((p) => Number.isFinite(p.startSec) && Number.isFinite(p.endSec) && p.endSec > p.startSec)
    .map((p) => ({ startSec: p.startSec, endSec: p.endSec }))
    .sort((a, b) => a.startSec - b.startSec);
  if (valid.length === 0) return [];

  const merged: ClipPiece[] = [valid[0]];
  for (const p of valid.slice(1)) {
    const last = merged[merged.length - 1];
    if (p.startSec - last.endSec < gapSec) {
      last.endSec = Math.max(last.endSec, p.endSec);
    } else {
      merged.push(p);
    }
  }
  return merged;
}

/**
 * Organiza a lista de trechos (usada no que vem da detecção por IA): ordena por
 * tempo → funde os sobrepostos e os encostados → descarta os fragmentos curtos
 * demais → e, passando da conta, mantém os trechos mais longos (recolocados em
 * ordem de tempo). Devolver menos de 2 significa que isto na verdade é um trecho
 * único, e quem chamou trata como trecho único.
 */
export function normalizePieces(raw: ClipPiece[]): ClipPiece[] {
  const merged = mergePieces(raw);
  if (merged.length === 0) return [];

  const long = merged.filter((p) => p.endSec - p.startSec >= MIN_PIECE_SEC);
  // Quando todos são curtos demais, não apague o candidato inteiro — mantenha o mais longo e deixe que a camada acima volte a tratá-lo como trecho único
  const kept = long.length > 0 ? long : [merged.reduce((a, b) => (b.endSec - b.startSec > a.endSec - a.startSec ? b : a))];
  if (kept.length <= MAX_PIECES) return kept;
  return [...kept]
    .sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec))
    .slice(0, MAX_PIECES)
    .sort((a, b) => a.startSec - b.startSec);
}

/** Duração final depois da costura (a soma da duração de cada trecho, sem os intervalos pulados). */
export function piecesDurationSec(pieces: ClipPiece[]): number {
  return pieces.reduce((acc, p) => acc + (p.endSec - p.startSec), 0);
}

/** Duração real do vídeo final de um clipe: com vários trechos é a soma deles, com um só é o tamanho do intervalo. */
export function clipDurationSec(clip: { startSec: number; endSec: number; pieces?: ClipPiece[] }): number {
  const p = clip.pieces;
  return p && p.length > 1 ? piecesDurationSec(p) : clip.endSec - clip.startSec;
}

/** Só conta como costura com vários trechos: 0 ou 1 trecho é um clipe comum. */
export function isStitched(pieces: ClipPiece[] | undefined): boolean {
  return (pieces?.length ?? 0) > 1;
}

/**
 * Os intervalos a remover entre um trecho e outro (o forceCutSpans entregue ao
 * computeJumpCut).
 * A seleção automática deixa uma folga nas duas pontas; a seleção manual em modo
 * exato respeita estritamente os limites que a pessoa definiu.
 */
export function pieceCutSpans(pieces: ClipPiece[], options: { exact?: boolean } = {}): ClipPiece[] {
  const out: ClipPiece[] = [];
  for (let i = 1; i < pieces.length; i++) {
    const startSec = pieces[i - 1].endSec + (options.exact ? 0 : PIECE_PAD_AFTER_SEC);
    const endSec = pieces[i].startSec - (options.exact ? 0 : PIECE_PAD_BEFORE_SEC);
    if (endSec > startSec) out.push({ startSec, endSec });
  }
  return out;
}

/** Diz se um intervalo cai inteiro dentro de um dos trechos — é a proteção do que só pode ser feito dentro de um trecho, como a abertura fria e o enquadramento. */
export function withinOnePiece(pieces: ClipPiece[], startSec: number, endSec: number): boolean {
  return pieces.some((p) => startSec >= p.startSec - 1e-3 && endSec <= p.endSec + 1e-3);
}

/** Mesmo formato do JumpCutPlan de core/gaps (shared não depende de core, então é declarado pela estrutura). */
export interface PiecePlan {
  segments: ClipPiece[];
  words: TranscriptWord[];
  breaks: number[];
  removedSec: number;
  durationSec: number;
}

/**
 * Plano do vídeo final para quando não há lista de palavras (sem queimar legenda
 * e sem corte seco): a própria lista de trechos já é o conjunto de intervalos
 * preservados.
 * O formato é igual ao que o computeJumpCut produz, então quem está adiante
 * (cutJumpClip, capa, EDL e verificação de qualidade) não sente diferença.
 */
export function planFromPieces(pieces: ClipPiece[]): PiecePlan {
  const durationSec = piecesDurationSec(pieces);
  const breaks: number[] = [];
  let out = 0;
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) breaks.push(out);
    out += pieces[i].endSec - pieces[i].startSec;
  }
  const span = pieces.length > 0 ? pieces[pieces.length - 1].endSec - pieces[0].startSec : 0;
  return { segments: pieces.map((p) => ({ ...p })), words: [], breaks, removedSec: span - durationSec, durationSec };
}

/** Funde a lista de palavras entre os trechos: só as palavras que caem dentro de um deles ficam (o conteúdo dos intervalos não entra no vídeo final). */
export function wordsInPieces<T extends { startSec: number; endSec: number }>(
  words: T[],
  pieces: ClipPiece[]
): T[] {
  return words.filter((w) => {
    const mid = (w.startSec + w.endSec) / 2;
    return pieces.some((p) => mid >= p.startSec && mid <= p.endSec);
  });
}
