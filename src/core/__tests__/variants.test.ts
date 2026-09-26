/**
 * Várias versões de um mesmo clipe: leitura do plano de versões, expansão das
 * especificações e a separação dos picos da capa. O que sustenta a diferenciação na
 * distribuição em várias contas é "ângulo, título, capa e texto realmente
 * diferentes", e se a lógica de expansão estiver errada (id batendo, capa no mesmo
 * quadro, versão entrando no compilado) a prática inteira se entrega.
 */
import { describe, it, expect } from "vitest";
import { variantSystemPrompt, parseVariantPlans, expandClipSpecs, generateVariantPlans, VARIANT_TOTAL_MAX } from "../variants";
import { pickCoverTime } from "../cover";
import type { ExportClipSpec } from "../export";
import type { PeakTrack } from "../audio-peaks";

const spec = (id: number, title: string): ExportClipSpec => ({
  id,
  title,
  startSec: 10,
  endSec: 30,
  publish: { title: `texto original ${id}`, hashtags: ["#original"], description: "d" },
  meta: { hook: "h", score: 90, reason: "r", text: "t", recommended: true, reviewNote: "", teaser: "suspense original" },
});

const PLAN_JSON = JSON.stringify({
  clips: [
    {
      id: 1,
      variants: [
        { title: "título versão contraste", teaser: "suspense da versão", post: { title: "publicação B", hashtags: ["#b"], description: "db", angle: "contrast" } },
        { title: "título versão pergunta", post: { title: "publicação C", hashtags: ["#c"], description: "dc", angle: "question" } },
      ],
    },
  ],
});

describe("variantSystemPrompt", () => {
  it("o prompt em português deixa claro que \"trocar de ângulo não é reescrever\" e traz o menu de ângulos e a quantidade", () => {
    const p = variantSystemPrompt(true, 2);
    expect(p).toContain("2 embalagens");
    expect(p).toContain("question = pergunta");
    expect(p).toContain("não é reescrever com sinônimos");
  });
});

describe("parseVariantPlans", () => {
  it("lê as versões, teaser pode ser omitido, e post passa pela mesma validação do texto de publicação", () => {
    const out = parseVariantPlans(PLAN_JSON, new Set([1]), 2);
    const vs = out.get(1)!;
    expect(vs).toHaveLength(2);
    expect(vs[0].teaser).toBe("suspense da versão");
    expect(vs[1].teaser).toBeUndefined();
    expect(vs[0].post!.angle).toBe("contrast");
  });

  it("o que passa do teto por clipe é cortado; um id inventado é descartado", () => {
    const many = JSON.stringify({
      clips: [
        { id: 1, variants: [{ title: "a" }, { title: "b" }, { title: "c" }] },
        { id: 99, variants: [{ title: "x" }] },
      ],
    });
    const out = parseVariantPlans(many, new Set([1]), 2);
    expect(out.get(1)).toHaveLength(2);
    expect(out.has(99)).toBe(false);
  });

  it("quando o conjunto não é JSON, lança erro (e a camada acima usa isso para reenviar uma vez)", () => {
    expect(() => parseVariantPlans("eu achei todos bons", new Set([1]), 2)).toThrow();
  });

  it("generateVariantPlans: sujo na primeira e limpo na segunda → sucesso depois da retentativa (critério fail-open)", async () => {
    let calls = 0;
    const chat = async (): Promise<string> => {
      calls++;
      return calls === 1 ? '{"clips":[{"id": vii}]}' : PLAN_JSON;
    };
    const out = await generateVariantPlans(
      [{ id: 1, title: "título original", hook: "h", text: "t", keywords: [] }],
      3,
      true,
      { baseUrl: "http://x", apiKey: "k", model: "m" },
      chat
    );
    expect(calls).toBe(2);
    expect(out!.get(1)).toHaveLength(2);
  });

  it("generateVariantPlans: lixo nas duas vezes devolve null e nunca lança (a exportação segue normal)", async () => {
    const out = await generateVariantPlans(
      [{ id: 1, title: "t", hook: "h", text: "t", keywords: [] }],
      2,
      true,
      { baseUrl: "http://x", apiKey: "k", model: "m" },
      async () => "não é JSON"
    );
    expect(out).toBeNull();
  });
});

describe("expandClipSpecs", () => {
  const plans = parseVariantPlans(PLAN_JSON, new Set([1]), 2);

  it("a versão vem logo depois da original, o id continua a partir do maior, o número de versão começa em 2 e os picos de capa são diferentes", () => {
    const out = expandClipSpecs([spec(1, "título original"), spec(7, "outro clipe")], plans, true);
    expect(out.map((s) => s.title)).toEqual(["título original", "título versão contraste", "título versão pergunta", "outro clipe"]);
    expect(out[1].id).toBe(8);
    expect(out[2].id).toBe(9);
    expect(out[1].variantOf).toBe(1);
    expect(out[1].variant).toBe(2);
    expect(out[2].variant).toBe(3);
    expect(out[1].coverRank).toBe(1);
    expect(out[2].coverRank).toBe(2);
    // Os pontos de corte e a lista de palavras são clonados como estão — a versão só muda a embalagem, e o conteúdo é idêntico
    expect(out[1].startSec).toBe(10);
    expect(out[1].endSec).toBe(30);
  });

  it("a frase de suspense e o texto da versão passam a ser os dela; o que não foi informado segue o da original", () => {
    const out = expandClipSpecs([spec(1, "título original")], plans, true);
    expect(out[1].meta!.teaser).toBe("suspense da versão");
    expect(out[2].meta!.teaser).toBe("suspense original");
    expect(out[1].publish!.title).toBe("publicação B");
  });

  it("sem o texto de publicação ligado, as versões também não levam texto (igual à original)", () => {
    const out = expandClipSpecs([spec(1, "título original")], plans, false);
    expect(out[1].publish).toBeUndefined();
  });

  it("a versão idêntica letra por letra ao título original é descartada (não tem valor de diferenciação)", () => {
    const lazy = new Map([[1, [{ title: "título original" }, { title: "esse é realmente diferente" }]]]);
    const out = expandClipSpecs([spec(1, "título original")], lazy, true);
    expect(out).toHaveLength(2);
    expect(out[1].title).toBe("esse é realmente diferente");
  });

  it("o teto do total de versões é 3 (incluindo a original)", () => {
    expect(VARIANT_TOTAL_MAX).toBe(3);
  });

  it("flashDim: a última versão troca a estrutura de abertura (antecipação do pico), e as outras ficam iguais à original", () => {
    const out = expandClipSpecs([spec(1, "título original")], plans, true, true);
    expect(out.map((s) => Boolean(s.flashForward))).toEqual([false, false, true]);
  });

  it("com flashDim desligado (a antecipação global já está ligada) não há camada extra de diferença estrutural, e o comportamento é o histórico", () => {
    const out = expandClipSpecs([spec(1, "título original")], plans, true);
    expect(out.every((s) => !s.flashForward)).toBe(true);
  });

  it("com flashDim, depois de descartar a versão repetida do título original, a antecipação cai na última versão de verdade", () => {
    const lazy = new Map([[1, [{ title: "título original" }, { title: "esse é realmente diferente" }]]]);
    const out = expandClipSpecs([spec(1, "título original")], lazy, true, true);
    expect(out).toHaveLength(2);
    expect(Boolean(out[0].flashForward)).toBe(false);
    expect(out[1].flashForward).toBe(true);
  });
});

describe("pickCoverTime e a separação dos picos", () => {
  // Três picos claramente separados: 8s (o mais alto), 3s (o segundo) e 14s (o terceiro)
  const peaks: PeakTrack = {
    startSec: 0,
    hopSec: 1,
    values: Float32Array.from([0.1, 0.1, 0.1, 0.7, 0.1, 0.1, 0.1, 0.1, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5, 0.1, 0.1, 0.1, 0.1, 0.1]),
  };
  const ranges = [{ startSec: 0, endSec: 20 }];

  it("rank 0 mantém o comportamento histórico: pega o pico mais alto", () => {
    expect(pickCoverTime(peaks, ranges, 20, 0)).toBe(8);
    expect(pickCoverTime(peaks, ranges, 20)).toBe(8); // com o parâmetro padrão nada muda
  });

  it("rank 1 e 2 pegam o segundo e o terceiro pico — a capa da versão é de um quadro realmente diferente", () => {
    expect(pickCoverTime(peaks, ranges, 20, 1)).toBe(3);
    expect(pickCoverTime(peaks, ranges, 20, 2)).toBe(14);
  });

  it("com picos insuficientes, usa o último disponível, sem sair do intervalo e sem quebrar", () => {
    expect(pickCoverTime(peaks, ranges, 20, 99)).toBe(14);
  });

  it("pontos de amostragem colados contam como o mesmo pico, então as três capas não se amontoam no mesmo segundo", () => {
    const cluster: PeakTrack = { startSec: 0, hopSec: 0.5, values: Float32Array.from([0.1, 0.9, 0.85, 0.8, 0.1, 0.1, 0.1, 0.6, 0.1, 0.1]) };
    const a = pickCoverTime(cluster, [{ startSec: 0, endSec: 5 }], 5, 0);
    const b = pickCoverTime(cluster, [{ startSec: 0, endSec: 5 }], 5, 1);
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(1.5);
  });

  it("com silêncio total, recorre ao quadro fixo (igual ao histórico)", () => {
    const silent: PeakTrack = { startSec: 0, hopSec: 1, values: Float32Array.from([0.01, 0.02, 0.01]) };
    expect(pickCoverTime(silent, ranges, 20, 1)).toBe(0.8);
  });
});
