import { describe, it, expect } from "vitest";
import {
  normalizeForCompare,
  sentenceSimilarity,
  findRetakes,
  retakeCutSpans,
  dropRetakeWords,
} from "../retakes";
import type { TranscriptWord } from "../../shared/api-types";

/** Abre as frases num fluxo de palavras (0,2s cada), com 0,3s entre frases (abaixo do limite de 0,8s que corta por silêncio). */
function speak(sentences: string[], startSec = 0, wordSec = 0.2, gapSec = 0.3): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let t = startSec;
  for (const s of sentences) {
    for (const piece of s.split(" ")) {
      words.push({ text: piece, startSec: Number(t.toFixed(3)), endSec: Number((t + wordSec).toFixed(3)) });
      t += wordSec;
    }
    t += gapSec;
  }
  return words;
}

describe("normalizeForCompare", () => {
  it("tira a pontuação e o espaço e passa para minúsculas — uma diferença de pontuação não pode virar duas frases", () => {
    expect(normalizeForCompare("esse aqui, é muito bom!")).toBe("esseaquiémuitobom");
    expect(normalizeForCompare("Hello, World!")).toBe("helloworld");
  });
});

describe("sentenceSimilarity", () => {
  it("igual = 1, e sem nada a ver ≈ 0", () => {
    expect(sentenceSimilarity("esse produto é muito bom", "esse produto é muito bom")).toBe(1);
    expect(sentenceSimilarity("esse produto é muito bom", "amanhã tem reunião às três")).toBeLessThan(0.2);
  });

  it("só a pontuação diferente continua sendo a mesma frase", () => {
    expect(sentenceSimilarity("esse produto é muito bom", "esse produto, é muito bom!")).toBe(1);
  });

  it("começou a falar e recomeçou (repetição de prefixo) dá nota alta", () => {
    expect(sentenceSimilarity("o diferencial desse produto é", "o diferencial desse produto é absorver rápido")).toBeGreaterThan(0.72);
  });

  it("string vazia não quebra", () => {
    expect(sentenceSimilarity("", "tem conteúdo")).toBe(0);
    expect(sentenceSimilarity("", "")).toBe(0);
  });
});

describe("findRetakes", () => {
  it("falou duas vezes seguidas → a primeira sai e a última fica", () => {
    const words = speak([
      "o diferencial desse produto é absorver rápido.",
      "o diferencial desse produto é absorver rápido.",
      "vamos para o próximo.",
    ]);
    const hits = findRetakes(words);
    expect(hits.length).toBe(1);
    expect(hits[0].text).toContain("diferencial");
    expect(hits[0].similarity).toBeGreaterThanOrEqual(0.72);
    // O que sai é a primeira tomada: ela termina antes de a segunda começar
    expect(hits[0].endSec).toBeLessThan(words[words.length - 1].startSec);
    expect(hits[0].startSec).toBe(words[0].startSec);
  });

  it("errou três vezes → as duas primeiras saem e só a última fica", () => {
    const line = "hoje eu trouxe uma coisa muito boa.";
    const words = speak([line, line, line]);
    const hits = findRetakes(words);
    expect(hits.length).toBe(2);
    expect(hits[0].startSec).toBeLessThan(hits[1].startSec);
  });

  it("com uma frase de permeio o par ainda é achado (numa regravação costuma entrar um «ah, não é isso»)", () => {
    const words = speak([
      "o diferencial desse produto é absorver rápido.",
      "ah não é isso peraí.",
      "o diferencial desse produto é absorver muito.",
    ]);
    const hits = findRetakes(words);
    expect(hits.length).toBe(1);
    expect(hits[0].text).toContain("rápido");
  });

  it("frase curta se repete naturalmente e não é tocada (tá / sim / vem)", () => {
    const words = speak(["tá.", "tá.", "sim.", "sim."]);
    expect(findRetakes(words)).toEqual([]);
  });

  it("o bordão repetido muito depois não é tocado (é fala de venda, não regravação)", () => {
    const line = "três dois um, link no ar, corre para garantir.";
    // A segunda vez vem 10 minutos depois
    const words = [...speak([line], 0), ...speak([line], 600)];
    expect(findRetakes(words)).toEqual([]);
  });

  it("frases seguidas sem semelhança não cortam nada", () => {
    const words = speak([
      "hoje a gente fala do primeiro assunto.",
      "amanhã tem reunião às três para discutir.",
      "esse plano precisa ser refeito do zero.",
    ]);
    expect(findRetakes(words)).toEqual([]);
  });

  it("entrada vazia e de uma frase só devolvem vazio sem quebrar", () => {
    expect(findRetakes([])).toEqual([]);
    expect(findRetakes(speak(["foi só uma frase inteira aqui."]))).toEqual([]);
  });

  it("o limite é ajustável: em 1, só o que é idêntico conta", () => {
    const words = speak([
      "o diferencial desse produto é absorver rápido.",
      "o diferencial desse produto é absorver muito.",
    ]);
    expect(findRetakes(words).length).toBe(1);
    expect(findRetakes(words, { similarity: 1 })).toEqual([]);
  });
});

describe("retakeCutSpans / dropRetakeWords", () => {
  it("as tomadas queimadas viram intervalos de corte, e as vizinhas se juntam num só", () => {
    const spans = retakeCutSpans([
      { startSec: 10, endSec: 14, text: "a", keptText: "a", similarity: 1 },
      { startSec: 14.1, endSec: 18, text: "b", keptText: "b", similarity: 1 },
      { startSec: 40, endSec: 44, text: "c", keptText: "c", similarity: 1 },
    ]);
    expect(spans).toEqual([
      { startSec: 10, endSec: 18 },
      { startSec: 40, endSec: 44 },
    ]);
  });

  it("o que foi cortado não aparece mais no fluxo de palavras da legenda", () => {
    const words = speak([
      "o diferencial desse produto é absorver rápido.",
      "o diferencial desse produto é absorver rápido.",
    ]);
    const hits = findRetakes(words);
    const kept = dropRetakeWords(words, hits);
    expect(kept.length).toBeLessThan(words.length);
    // Todas as palavras que ficaram são da segunda tomada (a primeira foi cortada)
    expect(Math.min(...kept.map((w) => w.startSec))).toBeGreaterThanOrEqual(hits[0].endSec);
  });

  it("sem nenhuma ocorrência, devolve o que veio", () => {
    const words = speak(["uma frase comum qualquer."]);
    expect(dropRetakeWords(words, [])).toBe(words);
  });
});
