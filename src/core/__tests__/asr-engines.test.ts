import { describe, expect, it } from "vitest";
import { tokensToWords } from "../transcribe/sherpa-offline";
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
