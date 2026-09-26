import { describe, it, expect } from "vitest";
import {
  contextWindow,
  wordsInWindow,
  snapToWordEdge,
  clampDrag,
  clipText,
  REVIEW_MIN_SEC,
  REVIEW_MAX_SEC,
} from "../../shared/review";
import type { Transcript } from "../../shared/api-types";

// Monta uma transcrição de três frases: 10-13 / 14-17 / 30-33 (com um vão no meio)
function mockTranscript(): Transcript {
  const seg = (id: number, startSec: number, endSec: number, text: string) => ({
    id,
    startSec,
    endSec,
    text,
    words: text.split(" ").map((piece, i, all) => ({
      text: piece,
      startSec: startSec + ((endSec - startSec) * i) / all.length,
      endSec: startSec + ((endSec - startSec) * (i + 1)) / all.length,
    })),
  });
  return {
    language: "pt",
    engine: "mock",
    durationSec: 100,
    segments: [seg(1, 10, 13, "a primeira frase"), seg(2, 14, 17, "a segunda frase"), seg(3, 30, 33, "a terceira frase")],
  };
}

describe("contextWindow", () => {
  it("uma folga de cada lado do trecho, sem sair de [0, duration]", () => {
    const w = contextWindow(10, 20, 100);
    expect(w.winStartSec).toBeCloseTo(4); // pad = max(6, 10*0.4=4) = 6
    expect(w.winEndSec).toBeCloseTo(26);
    expect(contextWindow(2, 8, 100).winStartSec).toBe(0);
    expect(contextWindow(90, 98, 100).winEndSec).toBe(100);
  });

  it("num material longo a folga cresce em proporção, mas o teto é 20s", () => {
    const w = contextWindow(100, 200, 1000); // dur=100 → pad = min(20, 40) = 20
    expect(w.winStartSec).toBe(80);
    expect(w.winEndSec).toBe(220);
  });
});

describe("wordsInWindow", () => {
  it("devolve só as palavras que se sobrepõem à janela, ordenadas no tempo", () => {
    const words = wordsInWindow(mockTranscript(), 12, 15);
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((w) => w.endSec > 12 && w.startSec < 15)).toBe(true);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].startSec).toBeGreaterThanOrEqual(words[i - 1].startSec);
    }
  });

  it("sem palavra fora da janela, devolve vazio", () => {
    expect(wordsInWindow(mockTranscript(), 50, 60)).toEqual([]);
  });
});

describe("snapToWordEdge", () => {
  const words = [
    { startSec: 10, endSec: 10.5 },
    { startSec: 10.6, endSec: 11.2 },
  ];

  it("dentro da tolerância, encaixa no começo/fim da palavra mais próxima", () => {
    expect(snapToWordEdge(10.08, words, "start", 0.15)).toBe(10);
    expect(snapToWordEdge(11.1, words, "end", 0.15)).toBe(11.2);
  });

  it("fora da tolerância volta como está (o ponto pode cair livre)", () => {
    expect(snapToWordEdge(15, words, "start", 0.15)).toBe(15);
    expect(snapToWordEdge(10.3, words, "start", 0.1)).toBe(10.3);
  });

  it("entre vários candidatos vale o mais próximo", () => {
    // 10,55 está mais perto de 10,6 (começo de palavra) que de 10 (começo de palavra)
    expect(snapToWordEdge(10.55, words, "start", 0.2)).toBe(10.6);
  });
});

describe("clampDrag", () => {
  const win = { winStartSec: 0, winEndSec: 100 };

  it("o início não passa do fim (preservando a duração mínima), e no fim vale o mesmo", () => {
    expect(clampDrag("start", 39, 40, win)).toBe(40 - REVIEW_MIN_SEC);
    expect(clampDrag("end", 11, 10, win)).toBe(10 + REVIEW_MIN_SEC);
  });

  it("não sai da janela nem passa da duração máxima", () => {
    expect(clampDrag("start", -5, 50, win)).toBe(0);
    expect(clampDrag("end", 200, 50, win)).toBe(100);
    const wide = { winStartSec: 0, winEndSec: 500 };
    expect(clampDrag("end", 400, 50, wide)).toBe(50 + REVIEW_MAX_SEC);
    expect(clampDrag("start", 0, 300, wide)).toBe(300 - REVIEW_MAX_SEC);
  });

  it("valor válido passa como está", () => {
    expect(clampDrag("start", 20, 50, win)).toBe(20);
    expect(clampDrag("end", 80, 50, win)).toBe(80);
  });

  it("quando a janela é estreita demais para a duração mínima, a guarda de duração tem precedência", () => {
    const tight = { winStartSec: 9, winEndSec: 11 };
    // O início é empurrado para 10-3=7, ainda que fora da janela — não passar do outro lado é regra dura
    expect(clampDrag("start", 9.5, 10, tight)).toBe(10 - REVIEW_MIN_SEC);
  });
});

describe("clipText", () => {
  it("junta as frases que se sobrepõem ao intervalo", () => {
    const t = mockTranscript();
    expect(clipText(t, 10, 17)).toBe("a primeira frase a segunda frase");
    expect(clipText(t, 14, 33)).toBe("a segunda frase a terceira frase");
  });

  it("um intervalo no vão não tem texto", () => {
    expect(clipText(mockTranscript(), 18, 29)).toBe("");
  });
});
