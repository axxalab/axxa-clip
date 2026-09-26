import { describe, expect, it } from "vitest";
import { findFillerWords, dropFillerWords, fillerCutSpans } from "../fillers";
import { computeJumpCut, subtractSpans } from "../gaps";
import type { TranscriptWord } from "../../shared/api-types";

const w = (text: string, s: number, e: number): TranscriptWord => ({ text, startSec: s, endSec: e });

describe("findFillerWords", () => {
  it("marca os sons de hesitação, tolerando a pontuação colada", () => {
    const words = [w("ahn,", 0, 0.2), w("esse", 0.3, 0.6), w("produto", 0.6, 1.0), w("eh", 1.2, 1.4), w("é bom", 1.5, 2.0)];
    const hits = findFillerWords(words);
    expect(hits.map((h) => h.index)).toEqual([0, 3]);
    expect(hits[0].kind).toBe("filler");
  });

  it("as palavras de verdade que só parecem preenchimento no contexto ficam", () => {
    const words = [w("então", 0, 0.3), w("tipo", 0.4, 0.7), w("né", 0.8, 1.0)];
    expect(findFillerWords(words)).toEqual([]);
  });

  it("marca a primeira de uma repetição imediata de gagueira, e não a repetição lenta e proposital", () => {
    const stutter = [w("esse", 0, 0.3), w("esse", 0.35, 0.65), w("produto", 0.7, 1.0)];
    const hits = findFillerWords(stutter);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ index: 0, kind: "stutter" });
    // Um segundo de pausa entre as repetições se lê como ênfase — fica como está
    const deliberate = [w("muito bom", 0, 0.3), w("muito bom", 1.5, 1.8)];
    expect(findFillerWords(deliberate)).toEqual([]);
  });
});

describe("dropFillerWords / fillerCutSpans", () => {
  it("remove as palavras marcadas e une os trechos vizinhos", () => {
    const words = [w("ahn", 0, 0.2), w("eh", 0.25, 0.4), w("certo", 0.6, 1.0)];
    const hits = findFillerWords(words);
    expect(dropFillerWords(words, hits).map((x) => x.text)).toEqual(["certo"]);
    const spans = fillerCutSpans(hits);
    expect(spans).toEqual([{ startSec: 0, endSec: 0.4 }]);
  });
});

describe("subtractSpans", () => {
  it("parte os pedaços preservados em volta dos cortes forçados e descarta as lasquinhas", () => {
    const out = subtractSpans(
      [{ startSec: 0, endSec: 10 }],
      [{ startSec: 2, endSec: 2.5 }, { startSec: 9.95, endSec: 10 }]
    );
    expect(out).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 2.5, endSec: 9.95 },
    ]);
  });
});

describe("computeJumpCut com cortes forçados de preenchimento", () => {
  it("corta um preenchimento audível que a regra do vão e o portão de silêncio deixariam passar", () => {
    // O «ahn» de 1,0 a 1,3s fica entre palavras com vãos pequenos — nenhum corte por vão é possível
    const words = [w("antes", 0.2, 0.9), w("depois", 1.5, 2.2)];
    const plan = computeJumpCut(words, 0, 2.5, {
      forceCutSpans: [{ startSec: 1.0, endSec: 1.3 }],
      gapThresholdSec: Infinity,
    });
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0].endSec).toBeCloseTo(1.0, 5);
    expect(plan.segments[1].startSec).toBeCloseTo(1.3, 5);
    // O ponto da emenda vira uma quebra forçada da legenda
    expect(plan.breaks).toHaveLength(1);
  });

  it("a suavização dos cortes curtos não pode devolver um corte forçado", () => {
    const words = [w("antes", 0.2, 0.9), w("depois", 1.2, 2.0)];
    const plan = computeJumpCut(words, 0, 2.5, {
      forceCutSpans: [{ startSec: 0.95, endSec: 1.1 }], // 0.15s < MIN_CUT_SEC
      gapThresholdSec: Infinity,
    });
    expect(plan.segments).toHaveLength(2);
    expect(plan.removedSec).toBeGreaterThan(0.1);
  });
});