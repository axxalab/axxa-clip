import { describe, it, expect } from "vitest";
import { applyPunctuation } from "../transcribe/punctuate";
import type { TranscriptWord } from "../transcribe/types";

function w(text: string, i: number): TranscriptWord {
  return { text, startSec: i, endSec: i + 1 };
}

describe("applyPunctuation", () => {
  it("a pontuação da escrita ideográfica cola na palavra anterior", () => {
    const words = ["\u4f60", "\u597d", "\u4e16", "\u754c"].map(w);
    const out = applyPunctuation(words, "\u4f60\u597d\uff0c\u4e16\u754c\u3002");
    expect(out.map((x) => x.text)).toEqual(["\u4f60", "\u597d\uff0c", "\u4e16", "\u754c\u3002"]);
    // as marcas de tempo ficam intocadas
    expect(out[1].startSec).toBe(1);
  });

  it("pula o espaço em branco e trata a palavra latina sem diferenciar maiúsculas", () => {
    const words = ["hello", "world"].map(w);
    const out = applyPunctuation(words, "Hello, world!");
    expect(out.map((x) => x.text)).toEqual(["hello,", "world!"]);
  });

  it("falha em aberto quando o texto não bate", () => {
    const words = ["\u4f60", "\u597d"].map(w);
    const out = applyPunctuation(words, "\u5b8c\u5168\u4e0d\u540c\u7684\u6587\u672c\u3002");
    expect(out).toBe(words);
  });

  it("mantém a pontuação do fim, mas recusa letra no fim", () => {
    const words = ["\u597d"].map(w);
    expect(applyPunctuation(words, "\u597d\u3002")[0].text).toBe("\u597d\u3002");
    expect(applyPunctuation(words, "\u597d\u554a")).toBe(words);
  });
});
