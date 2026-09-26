import { describe, it, expect } from "vitest";
import {
  collectClipSegments,
  translationUserPrompt,
  parseTranslationLines,
  chunkForTranslate,
  translateSegments,
  clipTranslationLines,
  clampTranslationLines,
  remapTranslationLines,
  type TranslatableSegment,
  type TranslateChatFn,
} from "../translate";
import type { Transcript } from "../transcribe/types";

const LLM = { baseUrl: "http://x/v1", apiKey: "k", model: "m" };

// n frases de transcrição, de 4 segundos cada
function mockTranscript(n: number): Transcript {
  return {
    language: "zh",
    engine: "mock",
    durationSec: n * 4,
    segments: Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      startSec: i * 4,
      endSec: i * 4 + 3.5,
      text: `frase ${i + 1}`,
      words: [],
    })),
  };
}

describe("collectClipSegments", () => {
  it("só as frases cobertas pelo trecho (incluindo o pad) entram, sem repetir entre trechos", () => {
    const t = mockTranscript(20);
    const segs = collectClipSegments(t, [
      { startSec: 8, endSec: 16 }, // frases 3 a 5 (com o pad, o fim da frase 2 entra? a frase 2 termina em 7,5 > 8-1,5=6,5 → entra)
      { startSec: 12, endSec: 20 }, // se sobrepõe ao trecho anterior
    ]);
    const ids = segs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // sem repetição
    expect(ids).toContain(3);
    expect(ids).toContain(5);
    expect(ids).not.toContain(10);
  });
});

describe("parseTranslationLines", () => {
  it("lê a saída padrão e filtra pelos validIds", () => {
    const map = parseTranslationLines(
      '{"lines":[{"id":1,"text":"Hello"},{"id":2,"text":"World"},{"id":99,"text":"bad"}]}',
      new Set([1, 2])
    );
    expect(map.get(1)).toBe("Hello");
    expect(map.get(2)).toBe("World");
    expect(map.has(99)).toBe(false);
  });

  it("tira o bloco de raciocínio; saída lixo devolve um Map vazio", () => {
    expect(parseTranslationLines('<think>hum</think>{"lines":[{"id":1,"text":"Hi"}]}', new Set([1])).get(1)).toBe("Hi");
    expect(parseTranslationLines("desculpa, não consigo fazer isso", new Set([1])).size).toBe(0);
    expect(parseTranslationLines('{"lines":"não é um array"}', new Set([1])).size).toBe(0);
  });
});

describe("chunkForTranslate", () => {
  it("os blocos são formados por frases inteiras, dentro do orçamento de caracteres", () => {
    const segs: TranslatableSegment[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, startSec: i, endSec: i + 1, text: "a".repeat(500),
    }));
    const chunks = chunkForTranslate(segs, 1800);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat().length).toBe(10);
    for (const c of chunks) expect(c.reduce((a, s) => a + s.text.length, 0)).toBeLessThanOrEqual(2000);
  });
});

describe("translateSegments", () => {
  const segs: TranslatableSegment[] = [
    { id: 1, startSec: 0, endSec: 3, text: "oi" },
    { id: 2, startSec: 4, endSec: 7, text: "mundo" },
  ];

  it("no caminho normal devolve id → tradução", async () => {
    const chat: TranslateChatFn = async (_llm, _sys, user) => {
      expect(user).toContain("[1] oi");
      return '{"lines":[{"id":1,"text":"Hello"},{"id":2,"text":"World"}]}';
    };
    const map = await translateSegments(segs, "en", LLM, chat);
    expect(map?.get(2)).toBe("World");
  });

  it("com o endpoint todo fora do ar, falha em aberto devolvendo null", async () => {
    const chat: TranslateChatFn = async () => { throw new Error("ECONNREFUSED"); };
    expect(await translateSegments(segs, "en", LLM, chat)).toBeNull();
  });

  it("o cancelamento vindo de cima é relançado como veio", async () => {
    const ac = new AbortController();
    ac.abort();
    const chat: TranslateChatFn = async () => { throw new Error("aborted"); };
    await expect(translateSegments(segs, "en", LLM, chat, ac.signal)).rejects.toThrow();
  });

  it("entrada vazia devolve null", async () => {
    const chat: TranslateChatFn = async () => "{}";
    expect(await translateSegments([], "en", LLM, chat)).toBeNull();
  });
});

describe("clipTranslationLines / clampTranslationLines", () => {
  const segs: TranslatableSegment[] = [
    { id: 1, startSec: 0, endSec: 4, text: "um" },
    { id: 2, startSec: 4, endSec: 8, text: "dois" },
    { id: 3, startSec: 8, endSec: 12, text: "três" },
  ];
  const tr = new Map([[1, "one"], [2, "two"], [3, "three"]]);

  it("só as frases que caem dentro do trecho entram, com o tempo aparado no trecho", () => {
    const lines = clipTranslationLines(segs, tr, 3, 9);
    expect(lines.map((l) => l.text)).toEqual(["one", "two", "three"]);
    expect(lines[0].startSec).toBe(3); // aparado no início do trecho
    expect(lines[2].endSec).toBe(9); // aparado no fim do trecho
  });

  it("frase sem tradução é pulada; interseção curta demais é descartada", () => {
    const partial = new Map([[2, "two"]]);
    expect(clipTranslationLines(segs, partial, 0, 12).length).toBe(1);
    expect(clipTranslationLines(segs, tr, 3.9, 9).map((l) => l.text)).toEqual(["two", "three"]); // da frase 1 sobram só 0,1s
  });

  it("o ajudante de clamp filtra pela mesma duração mínima", () => {
    const lines = [{ startSec: 0, endSec: 10, text: "x" }, { startSec: 11.9, endSec: 12, text: "y" }];
    const out = clampTranslationLines(lines, 2, 12);
    expect(out.length).toBe(1);
    expect(out[0]).toEqual({ startSec: 2, endSec: 10, text: "x" });
  });
});

describe("remapTranslationLines", () => {
  // Intervalos preservados: [10,14] e [16,20] → a saída vai de 0 a 4 e de 4 a 8
  const kept = [
    { startSec: 10, endSec: 14 },
    { startSec: 16, endSec: 20 },
  ];

  it("a linha que atravessa um ponto de corte usa o começo e o fim da interseção (o meio foi cortado)", () => {
    const out = remapTranslationLines([{ startSec: 12, endSec: 18, text: "atravessa" }], kept);
    expect(out.length).toBe(1);
    expect(out[0].startSec).toBeCloseTo(2); // 12 fica a 2 do início do primeiro intervalo
    expect(out[0].endSec).toBeCloseTo(6); // 18 fica a 2 do início do segundo intervalo + os 4 segundos do intervalo anterior
  });

  it("a linha que cai inteira numa região cortada é descartada", () => {
    expect(remapTranslationLines([{ startSec: 14.2, endSec: 15.8, text: "cortada" }], kept)).toEqual([]);
  });

  it("a linha que cabe inteira num intervalo preservado só é deslocada", () => {
    const out = remapTranslationLines([{ startSec: 16.5, endSec: 19, text: "dentro" }], kept);
    expect(out[0].startSec).toBeCloseTo(4.5);
    expect(out[0].endSec).toBeCloseTo(7);
  });
});

describe("translationUserPrompt", () => {
  it("o id e o texto original vêm em pares, linha a linha", () => {
    const p = translationUserPrompt([
      { id: 7, startSec: 0, endSec: 1, text: "oi" },
      { id: 8, startSec: 1, endSec: 2, text: "tchau" },
    ]);
    expect(p).toBe("[7] oi\n[8] tchau");
  });
});
