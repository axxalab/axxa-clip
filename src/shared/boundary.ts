/**
 * Ajuste da borda de um trecho por frases inteiras: cada lado é esticado ou recolhido em frases inteiras da
 * transcrição (as bordas exatas na palavra vêm de graça — os segmentos são construídos a partir das marcas
 * de tempo das palavras). Puro e independente de plataforma, então tanto a camada de renderização (o ajuste
 * interativo) quanto o core podem usar.
 */
import type { Transcript, TranscriptSegment, ClipPiece } from "./api-types";
import { mergePieces, PIECE_JOINER } from "./pieces";

const EPS = 1e-3;
/** O ajuste manual tem uma faixa mais larga que a da detecção automática. */
const MIN_SEC = 3;
const MAX_SEC = 120;

function overlapping(transcript: Transcript, startSec: number, endSec: number): TranscriptSegment[] {
  return transcript.segments.filter((s) => s.endSec > startSec + EPS && s.startSec < endSec - EPS);
}

export interface AdjustedBoundary {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Move uma borda do trecho em uma frase. O `dir` segue a linha de tempo:
 *  - na borda de início: -1 traz a frase anterior para dentro, +1 descarta a primeira
 *  - na borda de fim:    +1 traz a frase seguinte para dentro, -1 descarta a última
 * Devolve null quando o movimento é impossível (sem frase vizinha, o trecho colapsaria, ou a duração sairia
 * dos limites razoáveis).
 */
export function adjustClipBoundary(
  transcript: Transcript,
  clip: { startSec: number; endSec: number },
  edge: "start" | "end",
  dir: 1 | -1
): AdjustedBoundary | null {
  const segs = transcript.segments;
  const inside = overlapping(transcript, clip.startSec, clip.endSec);
  if (inside.length === 0) return null;

  let startSec = clip.startSec;
  let endSec = clip.endSec;

  if (edge === "start") {
    const firstIdx = segs.findIndex((s) => s.id === inside[0].id);
    if (dir === -1) {
      if (firstIdx <= 0) return null;
      startSec = segs[firstIdx - 1].startSec;
    } else {
      if (inside.length < 2) return null;
      startSec = inside[1].startSec;
    }
  } else {
    const lastIdx = segs.findIndex((s) => s.id === inside[inside.length - 1].id);
    if (dir === 1) {
      if (lastIdx < 0 || lastIdx + 1 >= segs.length) return null;
      endSec = segs[lastIdx + 1].endSec;
    } else {
      if (inside.length < 2) return null;
      endSec = inside[inside.length - 2].endSec;
    }
  }

  const dur = endSec - startSec;
  if (dur < MIN_SEC || dur > MAX_SEC) return null;
  const text = overlapping(transcript, startSec, endSec)
    .map((s) => s.text)
    .join(" ");
  return { startSec, endSec, text };
}

export interface AdjustedCandidate extends AdjustedBoundary {
  /** A lista de pedaços depois do ajuste de um trecho colado; um trecho de pedaço único não traz este campo. */
  pieces?: ClipPiece[];
}

/**
 * O ajuste do ponto de corte no nível do candidato. Num trecho colado só se move **o início do primeiro
 * pedaço** e **o fim do último** — os pedaços do meio foram escolhidos pela IA para o contraste, e não
 * devem sair de lugar em silêncio quando a pessoa usa as setas; se o ajuste fundiria dois pedaços num só (e
 * a colagem deixaria de existir), ele é simplesmente recusado, e a pessoa muda isso na mesa de revisão.
 */
export function adjustCandidateBoundary(
  transcript: Transcript,
  clip: { startSec: number; endSec: number; pieces?: ClipPiece[] },
  edge: "start" | "end",
  dir: 1 | -1
): AdjustedCandidate | null {
  const pieces = clip.pieces;
  if (!pieces || pieces.length < 2) return adjustClipBoundary(transcript, clip, edge, dir);

  const idx = edge === "start" ? 0 : pieces.length - 1;
  const moved = adjustClipBoundary(transcript, pieces[idx], edge, dir);
  if (!moved) return null;
  // mergePieces em vez de normalizePieces: aqui só as bordas do primeiro e do último pedaço se moveram, e o
  // número de pedaços não deve ser mudado em silêncio pela regularização do lado da detecção («no máximo 4 pedaços / no mínimo 2 segundos») — uma escolha manual pode passar de 4 pedaços
  const next = mergePieces(
    pieces.map((p, i) => (i === idx ? { startSec: moved.startSec, endSec: moved.endSec } : p))
  );
  if (next.length < 2) return null;
  return {
    startSec: next[0].startSec,
    endSec: next[next.length - 1].endSec,
    pieces: next,
    text: piecesText(transcript, next),
  };
}

/** O texto exibido de um trecho colado: o texto de cada pedaço unido por uma marca de omissão, de modo que se veja de relance que houve um salto no meio. */
export function piecesText(transcript: Transcript, pieces: ClipPiece[]): string {
  return pieces
    .map((p) => overlapping(transcript, p.startSec, p.endSec).map((s) => s.text).join(" "))
    .join(PIECE_JOINER);
}
