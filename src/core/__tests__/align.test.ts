import { describe, it, expect } from "vitest";
import { refineWordTimings, toAlignUnits, ALIGN_MIN_MATCH_FRAC } from "../align";
import type { TranscriptWord } from "../../shared/api-types";

function w(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec };
}

// Os ideogramas ficam como escapes Unicode: material em escrita ideográfica continua
// sendo alinhado caractere a caractere, e o código-fonte não carrega ideograma nenhum.
const IDEO = ["\u4f60", "\u597d"]; // duas palavras de um caractere cada

describe("toAlignUnits (unidades normalizadas de alinhamento)", () => {
  it("cada caractere vira uma unidade, a pontuação e o espaço são descartados, e o índice de origem é guardado", () => {
    const units = toAlignUnits([{ text: "oi," }, { text: "AI 99!" }]);
    expect(units.map((u) => u.ch).join("")).toBe("oiai99");
    expect(units.map((u) => u.idx)).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it("a escrita ideográfica também vai caractere a caractere", () => {
    const units = toAlignUnits([{ text: `${IDEO[0]}${IDEO[1]}\uff0c` }]);
    expect(units.map((u) => u.ch)).toEqual([IDEO[0], IDEO[1]]);
  });
});

describe("refineWordTimings (remapeamento de tempo da segunda passada)", () => {
  it("texto inteiro casando: o vocabulário adota o tempo da referência (e o texto fica como estava)", () => {
    // O tempo da transcrição principal está 0,5s deslocado; o fluxo de referência traz o tempo certo
    const words = [w("hoje", 10.5, 11.1), w("custa", 11.1, 11.7), w("nove reais", 11.7, 12.6)];
    const ref = [
      w("hoje", 10.0, 10.6),
      w("custa", 10.6, 11.2),
      w("nove", 11.2, 11.7), w("reais", 11.7, 12.1),
    ];
    const res = refineWordTimings(words, ref)!;
    expect(res.words.map((x) => x.text)).toEqual(["hoje", "custa", "nove reais"]);
    expect(res.matchedFrac).toBe(1);
    expect(res.alignedWords).toBe(3);
    expect(res.words.every((x) => x.timingSource === "aligned")).toBe(true);
    expect(res.words[0].startSec).toBeCloseTo(10.0, 3);
    expect(res.words[1].startSec).toBeCloseTo(10.6, 3);
    expect(res.words[2].endSec).toBeCloseTo(12.1, 3);
  });

  it("com alucinação ou palavra faltando na referência o alinhamento ainda funciona, e a palavra sem par é interpolada entre as âncoras", () => {
    const words = [w("oi", 10, 10.6), w("mundo", 10.6, 11.2), w("tchau", 11.2, 11.8)];
    // No fluxo de referência «mundo» não foi reconhecido, mas «oi» e «tchau» estão com o tempo certo
    const ref = [w("oi", 9.5, 10.1), w("tchau", 11.5, 12.1)];
    const res = refineWordTimings(words, ref)!;
    expect(res.words[0].startSec).toBeCloseTo(9.5, 3);
    expect(res.words[2].startSec).toBeCloseTo(11.5, 3);
    // «mundo» é interpolado entre 10,1 (fim da âncora anterior) e 11,5 (começo da seguinte), sem quebrar a monotonia
    expect(res.words[1].startSec).toBeGreaterThanOrEqual(10.1 - 1e-6);
    expect(res.words[1].endSec).toBeLessThanOrEqual(11.5 + 1e-6);
    expect(res.words[1].startSec).toBeLessThan(res.words[1].endSec);
  });

  it("nada casando: matchedFrac fica abaixo do limite (e quem chama volta ao original)", () => {
    const words = [w("xxxx", 0, 0.5), w("yyyy", 0.5, 1)];
    const ref = [w("bbbb", 0, 0.3), w("cccc", 0.3, 0.6)];
    const res = refineWordTimings(words, ref);
    expect(res!.matchedFrac).toBeLessThan(ALIGN_MIN_MATCH_FRAC);
  });

  it("depois do remapeamento o tempo é estritamente monótono e não há palavra de duração zero", () => {
    const words = [w("ah", 5, 5.1), w("esse", 5.1, 5.5), w("produto", 5.5, 6)];
    const ref = [w("esse", 4.0, 4.4), w("produto", 4.4, 4.8)];
    const res = refineWordTimings(words, ref)!;
    for (let i = 0; i < res.words.length; i++) {
      expect(res.words[i].endSec).toBeGreaterThan(res.words[i].startSec);
      if (i > 0) expect(res.words[i].startSec).toBeGreaterThanOrEqual(res.words[i - 1].endSec - 1e-6);
    }
  });
});
