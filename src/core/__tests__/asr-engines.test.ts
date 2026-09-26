import { describe, expect, it } from "vitest";
import { mergeSubwordTokens, tokensToWords } from "../transcribe/sherpa-offline";
import { whisperPrefix, whisperLanguage } from "../transcribe/whisper";
import { PARAKEET_MODEL, WHISPER_LARGE_V3_MODEL, WHISPER_TURBO_MODEL } from "../models";
import { MODEL_CATALOG } from "../models-inventory";
import { ASR_CATALOG } from "../../shared/asr-catalog";

describe("tempo das palavras quando o motor não dá marca de tempo", () => {
  it("reparte os tokens dentro da janela em vez de empilhar todos no começo", () => {
    const words = tokensToWords({ text: "um dois tres", tokens: ["um", "dois", "tres"] }, 10, 13);
    expect(words).toHaveLength(3);
    expect(words[0].startSec).toBe(10);
    expect(words[2].endSec).toBe(13);
    // estritamente crescente: é isto que a versão antiga quebrava (tudo começava em 10)
    expect(words[1].startSec).toBeGreaterThan(words[0].startSec);
    expect(words[2].startSec).toBeGreaterThan(words[1].startSec);
    expect(words.every((w) => w.timingSource === "estimated")).toBe(true);
  });

  it("a palavra mais longa ocupa mais tempo que a curta", () => {
    const [curta, longa] = tokensToWords({ text: "a interessante", tokens: ["a", "interessante"] }, 0, 10);
    expect(longa.endSec - longa.startSec).toBeGreaterThan(curta.endSec - curta.startSec);
  });

  it("uma marca de tempo de verdade continua valendo como nativa", () => {
    const words = tokensToWords({ text: "ab", tokens: ["a", "b"], timestamps: [0, 0.5] }, 0, 1);
    expect(words[0].timingSource).toBe("native");
  });
});

describe("pacotes de Whisper do sherpa-onnx", () => {
  it("deduz o prefixo dos arquivos pelo nome da pasta extraída", () => {
    expect(whisperPrefix(WHISPER_LARGE_V3_MODEL)).toBe("large-v3");
    expect(whisperPrefix(WHISPER_TURBO_MODEL)).toBe("turbo");
  });

  it("«auto» e vazio viram detecção pelo próprio modelo, e o resto vira o código curto", () => {
    expect(whisperLanguage("auto")).toBe("");
    expect(whisperLanguage(undefined)).toBe("");
    expect(whisperLanguage("pt-BR")).toBe("pt");
    expect(whisperLanguage("PT")).toBe("pt");
  });
});

describe("registro dos modelos novos", () => {
  it("todo modelo novo entra no inventário, senão some da página de modelos", () => {
    const ids = MODEL_CATALOG.map((m) => m.asset.id);
    for (const asset of [PARAKEET_MODEL, WHISPER_TURBO_MODEL, WHISPER_LARGE_V3_MODEL]) {
      expect(ids).toContain(asset.id);
    }
  });

  it("o catálogo de ASR anuncia os motores novos, com o português na frente", () => {
    const ids = ASR_CATALOG.map((e) => e.id);
    expect(ids[0]).toBe("parakeet");
    expect(ids).toContain("whisper-turbo");
    expect(ids).toContain("whisper-large-v3");
  });
});

describe("vocabulário de subpalavra (Parakeet, Whisper)", () => {
  // Saída real do sherpa-onnx para «Bom dia pessoal!», colhida rodando o modelo de verdade
  const PIECES = [" B", "om", " dia", " pesso", "al", "!"];
  const STAMPS = [0, 0.16, 0.32, 0.64, 0.96, 1.28];

  it("junta os pedaços numa palavra só, em vez de «B om dia pesso al»", () => {
    expect(mergeSubwordTokens(PIECES, STAMPS).tokens).toEqual(["Bom", "dia", "pessoal!"]);
  });

  it("a palavra herda o tempo do primeiro pedaço", () => {
    expect(mergeSubwordTokens(PIECES, STAMPS).stamps).toEqual([0, 0.32, 0.64]);
  });

  it("de ponta a ponta, o tempo de cada palavra fecha com o começo da seguinte", () => {
    const words = tokensToWords({ text: "", tokens: PIECES, timestamps: STAMPS }, 0, 1.52);
    expect(words.map((w) => w.text)).toEqual(["Bom", "dia", "pessoal!"]);
    expect(words.map((w) => w.startSec)).toEqual([0, 0.32, 0.64]);
    expect(words[0].endSec).toBe(words[1].startSec);
    expect(words.every((w) => w.timingSource === "native")).toBe(true);
  });

  it("o marcador U+2581 do SentencePiece vale igual ao espaço", () => {
    expect(mergeSubwordTokens(["\u2581bom", "dia"], [0, 1]).tokens).toEqual(["bomdia"]);
    expect(mergeSubwordTokens(["\u2581bom", "\u2581dia"], [0, 1]).tokens).toEqual(["bom", "dia"]);
  });

  it("escrita ideográfica não tem marcador e não pode ser colada numa palavra só", () => {
    const cjk = ["\u4f60", "\u597d", "\u5417"];
    expect(mergeSubwordTokens(cjk, [0, 1, 2]).tokens).toEqual(cjk);
  });

  it("sem marca de tempo (o caso do Whisper), a lista de tempos continua vazia", () => {
    expect(mergeSubwordTokens([" oi", " tudo", "bem"], []).stamps).toEqual([]);
  });
});
