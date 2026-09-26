import { describe, it, expect } from "vitest";
import { tokenizeForWords, rebuildWords, editSegmentText } from "../../shared/edit-transcript";
import type { Transcript } from "../../shared/api-types";

describe("tokenizeForWords", () => {
  it("a escrita ideográfica vai caractere a caractere, o alfabeto latino por palavra, e a pontuação cola na palavra anterior", () => {
    expect(tokenizeForWords("\u4f60\u597d\u4e16\u754c")).toEqual(["\u4f60", "\u597d", "\u4e16", "\u754c"]);
    expect(tokenizeForWords("hello world")).toEqual(["hello", "world"]);
    expect(tokenizeForWords("isso, é o GPT-5 mesmo!")).toEqual(["isso,", "é", "o", "GPT-5", "mesmo!"]);
  });

  it("string vazia ou só espaço devolve vazio; a pontuação do começo forma uma palavra própria e a seguinte cola", () => {
    expect(tokenizeForWords("   ")).toEqual([]);
    expect(tokenizeForWords("\u2014\u2014 virada")).toEqual(["\u2014\u2014", "virada"]);
  });
});

describe("rebuildWords", () => {
  it("o tempo preenche o intervalo sem vão, com as pontas exatamente alinhadas", () => {
    const words = rebuildWords("\u4f60\u597dword", 10, 14);
    expect(words[0].startSec).toBe(10);
    expect(words[words.length - 1].endSec).toBe(14);
    expect(words.every((word) => word.timingSource === "edited")).toBe(true);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].startSec).toBeCloseTo(words[i - 1].endSec, 10);
    }
  });

  it("um ideograma ocupa mais tempo que uma letra latina (o peso da largura visual)", () => {
    const words = rebuildWords("\u597dok", 0, 3); // o ideograma vale 2 e "ok" vale 2 → 1,5s cada
    expect(words[0].endSec).toBeCloseTo(1.5, 5);
  });

  it("texto vazio ou duração zero devolve vazio", () => {
    expect(rebuildWords("", 0, 5)).toEqual([]);
    expect(rebuildWords("a", 5, 5)).toEqual([]);
  });
});

describe("editSegmentText", () => {
  const t: Transcript = {
    language: "zh", engine: "x", durationSec: 20,
    segments: [
      { id: 1, startSec: 0, endSec: 4, text: "a frase errada", words: [{ text: "a", startSec: 0, endSec: 4 }] },
      { id: 2, startSec: 5, endSec: 9, text: "a segunda frase", words: [] },
    ],
  };

  it("o texto é substituído e a linha de palavras daquela frase é reconstruída; as outras ficam como estavam e o objeto original não muda", () => {
    const next = editSegmentText(t, 1, "a frase certa");
    expect(next.segments[0].text).toBe("a frase certa");
    expect(next.segments[0].words.length).toBe(3); // "a", "frase", "certa"
    expect(next.segments[0].words[0].startSec).toBe(0);
    expect(next.segments[0].words[2].endSec).toBe(4);
    expect(next.segments[1]).toBe(t.segments[1]);
    expect(t.segments[0].text).toBe("a frase errada"); // imutável
  });

  it("texto vazio conta como clique errado e tudo volta como está", () => {
    expect(editSegmentText(t, 1, "   ")).toBe(t);
  });
});
