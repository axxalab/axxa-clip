import { describe, expect, it } from "vitest";
import { canSearchSimilarTranscript, indexTranscript, searchSimilarTranscript, searchTranscript } from "../transcript-search";
import { rebuildWords } from "../edit-transcript";

function segments(texts: string[]) { return texts.map((text, i) => ({ id: i + 1, text, startSec: i * 5, endSec: i * 5 + 4, words: rebuildWords(text, i * 5, i * 5 + 4) })); }
describe("busca na transcrição", () => {
  it("encontra a expressão atravessando a borda das legendas e devolve as marcas no texto original", () => {
    const index = indexTranscript(segments(["Hello,", "world!", "Another WORLD"]));
    expect(searchTranscript(index, "hello world")[0]).toMatchObject({ segmentIds: [1, 2], startSec: 0, timing: "estimated", ranges: [{ segmentId: 1, start: 0, end: 5 }, { segmentId: 2, start: 0, end: 5 }] });
    expect(searchTranscript(index, "world")).toHaveLength(2);
  });
  it("aceita formas de compatibilidade, acento composto, árabe, cirílico e ideograma do plano astral", () => {
    for (const [source, query] of [["\uff23\uff41\uff46\uff45́", "café"], ["Привет мир", "ПРИВЕТ"], ["مرحبا بالعالم", "مرحبا"], ["\u{20000}\u4f60\u597d", "\u{20000}\u4f60"]]) {
      const match = searchTranscript(indexTranscript(segments([source])), query)[0];
      expect(match).toBeDefined();
      expect(match.ranges[0].end).toBeLessThanOrEqual(source.length);
    }
  });
  it("lida com busca só de pontuação e limita um resultado gigante", () => {
    const index = indexTranscript(segments(Array(2100).fill("match")));
    expect(searchTranscript(index, "???")).toEqual([]);
    expect(searchTranscript(index, "match")).toHaveLength(2000);
  });
  it("localiza uma palavra do fim em vez de voltar ao começo da frase", () => {
    const segment = { id: 7, text: "Hello, WORLD!", startSec: 10, endSec: 20, words: [
      { text: "Hello", startSec: 11, endSec: 12, timingSource: "native" as const },
      { text: "world", startSec: 17, endSec: 18, timingSource: "aligned" as const },
    ] };
    expect(searchTranscript(indexTranscript([segment]), "world")[0]).toMatchObject({ startSec: 17, endSec: 18, timing: "word" });
  });
  it("mantém a procedência incerta em vez de apresentar o tempo de palavra editada como exato", () => {
    expect(searchTranscript(indexTranscript(segments(["hello world"])), "world")[0]).toMatchObject({ timing: "estimated" });
  });
  it("volta para as bordas da frase quando o texto está velho ou o tempo das palavras está malformado", () => {
    const segment = { id: 1, text: "hello world", startSec: 2, endSec: 8, words: [
      { text: "hello", startSec: 3, endSec: 4 }, { text: "world", startSec: 6, endSec: 7 },
    ] };
    for (const words of [[], [{ text: "stale", startSec: 3, endSec: 4 }],
      [segment.words[0], { ...segment.words[1], startSec: NaN }],
      [segment.words[0], { ...segment.words[1], startSec: 3.5 }],
      [segment.words[0], { ...segment.words[1], endSec: 9 }]]) {
      expect(searchTranscript(indexTranscript([{ ...segment, words }]), "world")[0]).toMatchObject({ startSec: 2, endSec: 8, timing: "segment" });
    }
  });
  it("mantém a posição no texto em UTF-16 alinhada com a marca de tempo das palavras em Unicode", () => {
    const segment = { id: 1, text: "\uff23\uff41\uff46\uff45́\uff0c\u{20000}\u4f60\u597d", startSec: 0, endSec: 10, words: [
      { text: "Café", startSec: 1, endSec: 2 },
      { text: "\u{20000}", startSec: 5, endSec: 6 },
      { text: "\u4f60\u597d", startSec: 7, endSec: 8 },
    ] };
    const hit = searchTranscript(indexTranscript([segment]), "\u{20000}\u4f60")[0];
    expect(hit).toMatchObject({ startSec: 5, endSec: 8, timing: "word" });
    expect(segment.text.slice(hit.ranges[0].start, hit.ranges[0].end)).toBe("\u{20000}\u4f60");
    expect(searchTranscript(indexTranscript([segment]), "\u4f60\u597d")[0]).toMatchObject({ startSec: 7, endSec: 8 });
  });
  it("acha troca, omissão e acréscimo de um caractere só quando isso é pedido", () => {
    const index = indexTranscript(segments(["\u4eca\u5929\u4ecb\u7ecd\u65b0\u4ea7\u54c1", "\u6b22\u8fce\u5927\u5bb6\u6765\u89c2\u770b"]));
    expect(searchTranscript(index, "\u4eca\u5929\u4ecb\u7ecd\u946b\u4ea7\u54c1")).toEqual([]);
    for (const query of ["\u4eca\u5929\u4ecb\u7ecd\u946b\u4ea7\u54c1", "\u4eca\u5929\u4ecb\u65b0\u4ea7\u54c1", "\u4eca\u5929\u4ecb\u7ecd\u65b0\u65b0\u4ea7\u54c1"]) {
      expect(searchSimilarTranscript(index, query)[0]).toMatchObject({ match: "approximate", segmentIds: [1], timing: "estimated" });
    }
    expect(searchSimilarTranscript(index, "\u4eca\u5929\u5b8c\u5168\u4e0d\u540c")).toEqual([]);
    expect(searchSimilarTranscript(index, "\u65b0\u4ea7")).toEqual([]);
    expect(canSearchSimilarTranscript("\u65b0\u4ea7")).toBe(false);
    expect(canSearchSimilarTranscript("a".repeat(33))).toBe(false);
  });
  it("mantém as marcas Unicode e o tempo na expressão original que quase casou", () => {
    const segment = { id: 3, text: "\u{20000}\u4f60\u597d\u554a", startSec: 0, endSec: 5, words: [
      { text: "\u{20000}", startSec: 0.5, endSec: 1 },
      { text: "\u4f60", startSec: 1, endSec: 2 },
      { text: "\u597d", startSec: 2, endSec: 3 },
      { text: "\u554a", startSec: 3, endSec: 4 },
    ] };
    const hit = searchSimilarTranscript(indexTranscript([segment]), "\u{20000}\u4f60\u574f\u554a")[0];
    expect(hit).toMatchObject({ startSec: 0.5, endSec: 4, timing: "word", match: "approximate" });
    expect(segment.text.slice(hit.ranges[0].start, hit.ranges[0].end)).toBe("\u{20000}\u4f60\u597d\u554a");
  });
});
