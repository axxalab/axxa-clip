import { describe, it, expect } from "vitest";
import { formatSrtTime, srtLinesFromWords, buildSrt, SRT_MAX_LINE_UNITS } from "../srt";
import type { TranscriptWord } from "../../shared/api-types";

const w = (text: string, startSec: number, endSec: number): TranscriptWord => ({ text, startSec, endSec });

describe("formatSrtTime", () => {
  it("o formato HH:MM:SS,mmm e o arredondamento dos milissegundos", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(65.4321)).toBe("00:01:05,432");
    expect(formatSrtTime(3661.5)).toBe("01:01:01,500");
    expect(formatSrtTime(1.9996)).toBe("00:00:02,000"); // arredondado para cima
  });

  it("negativo é preso em 0", () => {
    expect(formatSrtTime(-3)).toBe("00:00:00,000");
  });
});

describe("srtLinesFromWords", () => {
  it("divide pelas regras de quebra, e o fim de uma linha se segura até o começo da seguinte (com teto)", () => {
    const words = [
      ...Array.from({ length: 10 }, (_, i) => w("palavras", i, i + 0.9)), // 8 unidades por palavra → 4 palavras por linha (o teto é 36)
    ];
    const lines = srtLinesFromWords(words);
    expect(lines.length).toBeGreaterThan(1);
    // Sem sobreposição entre as linhas: o end de uma ≤ o start da seguinte
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i - 1].endSec).toBeLessThanOrEqual(lines[i].startSec + 1e-9);
    }
    // A última linha termina na última palavra
    expect(lines[lines.length - 1].endSec).toBeCloseTo(9.9);
  });

  it("entre palavras latinas entra espaço, e na fronteira com a escrita ideográfica não (a mesma regra da legenda queimada)", () => {
    const lines = srtLinesFromWords([w("hello", 0, 0.5), w("world", 0.5, 1), w("\u4f60\u597d", 1, 1.5)]);
    expect(lines[0].text).toBe("hello world\u4f60\u597d");
  });

  it("a tradução é anexada como segunda linha pela maior sobreposição de tempo", () => {
    const words = [w("oi", 0, 1), w("mundo", 1, 2), w("tchau", 30, 31)];
    const lines = srtLinesFromWords(words, [30], [
      { startSec: 0, endSec: 2, text: "Hello world" },
      { startSec: 30, endSec: 31, text: "Goodbye" },
    ]);
    expect(lines[0].secondary).toBe("Hello world");
    expect(lines[lines.length - 1].secondary).toBe("Goodbye");
  });

  it("sem palavras devolve um array vazio", () => {
    expect(srtLinesFromWords([])).toEqual([]);
  });
});

describe("buildSrt", () => {
  it("a estrutura de número / linha de tempo / texto / linha vazia, com duas linhas no bilíngue", () => {
    const srt = buildSrt([
      { startSec: 0, endSec: 1.5, text: "oi mundo", secondary: "Hello world" },
      { startSec: 2, endSec: 3, text: "a segunda" },
    ]);
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\noi mundo\nHello world\n\n2\n00:00:02,000 --> 00:00:03,000\na segunda\n"
    );
  });
});

describe("a constante de largura de linha", () => {
  it("a largura de linha do SRT é maior que a da legenda vertical (o costume dos tocadores comuns)", () => {
    expect(SRT_MAX_LINE_UNITS).toBeGreaterThan(22);
  });
});
