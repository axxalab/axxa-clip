import { describe, it, expect } from "vitest";
import { selectionToPieces, pickVerdict, MANUAL_MAX_PIECES, MANUAL_MIN_SEC, MANUAL_MAX_SEC } from "../../shared/pick";
import type { TranscriptSegment } from "../../shared/api-types";

// Seis frases em sequência: [0-4] [4-8] [8-12] [12-16] [16-20] [20-24]
const segs: TranscriptSegment[] = [0, 1, 2, 3, 4, 5].map((i) => ({
  id: i + 1,
  startSec: i * 4,
  endSec: i * 4 + 4,
  text: `frase ${i + 1}`,
  words: [],
}));

const sel = (...ids: number[]): Set<number> => new Set(ids);

describe("selectionToPieces", () => {
  it("marcações vizinhas se unem num pedaço", () => {
    expect(selectionToPieces(segs, sel(2, 3, 4))).toEqual([{ startSec: 4, endSec: 16 }]);
  });

  it("as marcações separadas formam cada uma o seu pedaço, na ordem do tempo", () => {
    expect(selectionToPieces(segs, sel(1, 2, 5, 6))).toEqual([
      { startSec: 0, endSec: 8 },
      { startSec: 16, endSec: 24 },
    ]);
  });

  it("a frase pulada no meio nunca entra — pular foi uma decisão explícita da pessoa", () => {
    // A frase 3 foi pulada e, mesmo com só 4 segundos e intervalo 0, o resultado tem de continuar sendo dois pedaços
    const pieces = selectionToPieces(segs, sel(2, 4));
    expect(pieces).toEqual([
      { startSec: 4, endSec: 8 },
      { startSec: 12, endSec: 16 },
    ]);
  });

  it("seleção vazia devolve vazio", () => {
    expect(selectionToPieces(segs, sel())).toEqual([]);
  });

  it("um id que não existe no conjunto escolhido não muda o resultado", () => {
    expect(selectionToPieces(segs, sel(2, 999))).toEqual([{ startSec: 4, endSec: 8 }]);
  });
});

describe("pickVerdict", () => {
  const p = (startSec: number, endSec: number): { startSec: number; endSec: number } => ({ startSec, endSec });

  it("seleção vazia → empty", () => {
    expect(pickVerdict([], 0)).toBe("empty");
  });

  it("curto ou longo demais é recusado pela faixa de duração", () => {
    expect(pickVerdict([p(0, 2)], MANUAL_MIN_SEC - 0.5)).toBe("tooShort");
    expect(pickVerdict([p(0, 130)], MANUAL_MAX_SEC + 1)).toBe("tooLong");
  });

  it("passar do teto manual de pedaços → tooMany", () => {
    const many = Array.from({ length: MANUAL_MAX_PIECES + 1 }, (_, i) => p(i * 10, i * 10 + 4));
    expect(pickVerdict(many, 36)).toBe("tooMany");
  });

  it("dentro da faixa normal → ok (vários pedaços dentro do teto manual passam — a proteção de 4 pedaços da IA não vale para o manual)", () => {
    const many = Array.from({ length: MANUAL_MAX_PIECES }, (_, i) => p(i * 10, i * 10 + 4));
    expect(pickVerdict(many, 32)).toBe("ok");
    expect(pickVerdict([p(0, 30)], 30)).toBe("ok");
  });
});
