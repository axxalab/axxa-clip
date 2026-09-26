/**
 * Escolha de trechos pelo texto (editar vídeo escrevendo): as frases marcadas viram a lista de pedaços a colar.
 * A união é só por «vizinhança no texto» — a frase que a pessoa pulou no meio nunca entra (mesmo que o vão
 * de tempo seja curtíssimo: pular foi uma decisão explícita dela); os grupos marcados que não são vizinhos
 * formam cada um o seu pedaço, e a ordem é a do tempo.
 * Função pura, compartilhada pelo processo de renderização (a janela de escolha) e pelos testes.
 */
import type { TranscriptSegment, ClipPiece } from "./api-types";

/** O teto de pedaços colados à mão: mais que isso não é um corte, é um projeto de edição, e a mesa de revisão também não daria conta. */
export const MANUAL_MAX_PIECES = 8;
/** A faixa de duração de um vídeo montado à mão (a mesma dos MIN/MAX do ajuste manual de boundary.ts). */
export const MANUAL_MIN_SEC = 3;
export const MANUAL_MAX_SEC = 120;

/** Une as frases marcadas em pedaços seguindo a ordem do texto: marcação vizinha estende o pedaço atual, e uma quebra começa outro. */
export function selectionToPieces(
  segments: TranscriptSegment[],
  selected: ReadonlySet<number>
): ClipPiece[] {
  const out: ClipPiece[] = [];
  let open: ClipPiece | null = null;
  for (const seg of segments) {
    if (selected.has(seg.id)) {
      if (open) {
        open.endSec = seg.endSec;
      } else {
        open = { startSec: seg.startSec, endSec: seg.endSec };
        out.push(open);
      }
    } else {
      open = null;
    }
  }
  return out;
}

/** Se a escolha dá para virar vídeo; quando não dá, o motivo vem junto (para desabilitar o botão «juntar aos candidatos» e explicar por quê). */
export type PickVerdict = "ok" | "empty" | "tooShort" | "tooLong" | "tooMany";

export function pickVerdict(pieces: ClipPiece[], durationSec: number): PickVerdict {
  if (pieces.length === 0) return "empty";
  if (pieces.length > MANUAL_MAX_PIECES) return "tooMany";
  if (durationSec < MANUAL_MIN_SEC) return "tooShort";
  if (durationSec > MANUAL_MAX_SEC) return "tooLong";
  return "ok";
}
