import { describe, it, expect } from "vitest";
import { segmentWords, joinWords } from "../transcribe/segment";
import { tokensToWords } from "../transcribe/sensevoice";
import { candidateUrls, SENSEVOICE_MODEL } from "../models";
import type { TranscriptWord } from "../transcribe/types";

const w = (text: string, startSec: number, endSec: number): TranscriptWord => ({ text, startSec, endSec });

describe("joinWords", () => {
  it("a escrita ideográfica se junta sem espaço", () => {
    expect(joinWords([w("\u4eca", 0, 0.2), w("\u5929", 0.2, 0.4), w("\u597d", 0.4, 0.6)])).toBe("\u4eca\u5929\u597d");
  });

  it("o alfabeto latino se junta com espaço e encaixa a pontuação", () => {
    expect(joinWords([w("hello", 0, 0.3), w("world", 0.3, 0.6), w(",", 0.6, 0.7), w("hi", 0.7, 1)])).toBe(
      "hello world, hi"
    );
  });
});

describe("segmentWords", () => {
  it("divide na pontuação que fecha a frase", () => {
    const segs = segmentWords([w("\u4f60\u597d\u3002", 0, 0.5), w("\u518d", 0.6, 0.8), w("\u89c1", 0.8, 1.0)]);
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe("\u4f60\u597d\u3002");
    expect(segs[1].text).toBe("\u518d\u89c1");
    expect(segs[1].startSec).toBeCloseTo(0.6, 3);
  });

  it("divide nos vãos de silêncio quando não há pontuação", () => {
    const segs = segmentWords([w("\u7b2c\u4e00\u6bb5", 0, 1), w("\u7b2c\u4e8c\u6bb5", 2.5, 3.5)], { gapSec: 0.8 });
    expect(segs).toHaveLength(2);
  });

  it("a guarda contra a frase sem fim divide uma fala longa e sem pontuação", () => {
    const words: TranscriptWord[] = [];
    for (let i = 0; i < 100; i++) words.push(w(`\u8bcd${i}`, i * 0.3, i * 0.3 + 0.3));
    const segs = segmentWords(words, { maxSec: 12 });
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.endSec - s.startSec).toBeLessThanOrEqual(13);
  });

  it("pula os tokens vazios ou de espaço e devolve os ids em ordem", () => {
    const segs = segmentWords([w(" ", 0, 0.1), w("\u597d\u3002", 0.1, 0.4), w("\u55ef\u3002", 0.5, 0.8)]);
    expect(segs.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("tokensToWords", () => {
  it("desloca as marcas de tempo e deduz o fim pelo começo da seguinte", () => {
    const words = tokensToWords(
      { text: "ab", tokens: ["a", "b"], timestamps: [0.5, 1.0] },
      10,
      12
    );
    expect(words).toHaveLength(2);
    expect(words[0]).toEqual({ text: "a", startSec: 10.5, endSec: 11.0, timingSource: "native" });
    expect(words[1].startSec).toBe(11.0);
    expect(words[1].endSec).toBeLessThanOrEqual(12);
  });

  it("tolera marca de tempo ou token faltando", () => {
    expect(tokensToWords({ text: "x" }, 0, 1)).toEqual([]);
    const estimated = tokensToWords({ text: "x", tokens: ["x"], timestamps: [] }, 0, 1)[0];
    expect(estimated.startSec).toBe(0);
    expect(estimated.timingSource).toBe("estimated");
  });
});

describe("candidateUrls", () => {
  it("tenta os espelhos antes da origem (o mais perto primeiro)", () => {
    const urls = candidateUrls(SENSEVOICE_MODEL);
    expect(urls.length).toBe(SENSEVOICE_MODEL.mirrors.length + 1);
    expect(urls[urls.length - 1]).toBe(SENSEVOICE_MODEL.url);
    expect(urls[0].startsWith(SENSEVOICE_MODEL.mirrors[0])).toBe(true);
    expect(urls[0]).toContain("github.com");
  });
});
