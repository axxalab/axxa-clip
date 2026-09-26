import { describe, expect, it } from "vitest";
import { searchVisualEvidence } from "../evidence-search";

describe("searchVisualEvidence", () => {
  const notes = [
    { t: 30, energy: 7, note: "demonstração do produto", visibleText: ["três camadas", "R$ 2,90"] },
    { t: 10, energy: 5, note: "quem apresenta explicando", visibleText: ["HotClip"] },
    { t: 20, energy: 8, note: "close na placa de preço", visibleText: ["R$ 2,90"] },
  ];

  it("encontra tanto a descrição quanto o texto de tela confirmado, com normalização de compatibilidade", () => {
    expect(searchVisualEvidence(notes, "preço").map((hit) => hit.t)).toEqual([20]);
    expect(searchVisualEvidence(notes, "\uff32\uff04 2,90").map((hit) => hit.t)).toEqual([20, 30]);
    expect(searchVisualEvidence(notes, "hotclip")[0]).toMatchObject({ t: 10, match: "screen-text" });
  });

  it("ordena, limita e ignora marca de tempo malformada", () => {
    const result = searchVisualEvidence([
      ...notes,
      { t: -1, energy: 9, note: "preço" },
      { t: Number.NaN, energy: 9, note: "preço" },
      { t: 5, energy: 9, note: "preço" },
    ], "preço", 2);
    expect(result.map((hit) => hit.t)).toEqual([5, 20]);
    expect(searchVisualEvidence(notes, "preço", 0)).toEqual([]);
  });

  it("falha fechado com entrada vazia e não repete a mesma nota", () => {
    expect(searchVisualEvidence(undefined, "preço")).toEqual([]);
    expect(searchVisualEvidence(notes, "")).toEqual([]);
    expect(searchVisualEvidence([
      { ...notes[0] },
      { ...notes[0] },
    ], "produto")).toHaveLength(1);
  });
});
