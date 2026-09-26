/**
 * Edição em nuvem da v0.14: o cliente de geração de mídia da Atlas / a capa por IA em duas edições /
 * a trilha por IA. Todo fetch é substituído por um dublê — o que se testa é a forma do protocolo e a
 * tolerância a falha, sem tocar na rede de verdade.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { atlasMediaBase, generateMedia } from "../atlas-media";
import { coverPrompt, coverRequestBody, COVER_MODELS, COVER_COST_USD } from "../cover-ai";
import { bgmPrompt, BGM_MODEL } from "../bgm-ai";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("atlasMediaBase (dedução do endpoint)", () => {
  it("domínio da Atlas → …/api/v1/model; outro endpoint ou entrada ruim → null", () => {
    expect(atlasMediaBase("https://api.atlascloud.ai/v1")).toBe("https://api.atlascloud.ai/api/v1/model");
    expect(atlasMediaBase("http://localhost:11434/v1")).toBeNull();
    expect(atlasMediaBase("https://api.openai.com/v1")).toBeNull();
    expect(atlasMediaBase("not a url")).toBeNull();
    expect(atlasMediaBase(undefined)).toBeNull();
  });
});

describe("coverPrompt / coverRequestBody (capa em duas edições)", () => {
  it("o título entra entre aspas como veio, e o comprido é cortado em 32 unidades; uma versão em português e uma em inglês", () => {
    const pt = coverPrompt("onde está a diferença entre o de dez e o de três reais, um título enorme", "teste real da velocidade de absorção", true);
    expect(pt).toContain("«onde está a diferença entre o de»"); // cortado em 32 unidades de largura
    expect(pt).toContain("teste real da velocidade de absorção");
    const en = coverPrompt("Why cheap tissues fail", undefined, false);
    expect(en).toContain('"Why cheap tissues fail"');
  });
  it("a cena real da revisão de imagem do candidato tem preferência sobre o gancho só de texto", () => {
    const prompt = coverPrompt("título", "quem apresenta diz que o produto é bom", true, "close de quem apresenta com o fone azul na mão");
    expect(prompt).toContain("close de quem apresenta com o fone azul na mão");
    expect(prompt).not.toContain("quem apresenta diz que o produto é bom");
  });
  it("a edição de volume Seedream usa size vertical; a premium Nano Banana usa aspect_ratio 3:4 em jpeg", () => {
    const vol = coverRequestBody("volume", "p");
    expect(vol.model).toBe(COVER_MODELS.volume);
    expect(vol.size).toBe("1728*2304");
    const pre = coverRequestBody("premium", "p");
    expect(pre.model).toBe(COVER_MODELS.premium);
    expect(pre.aspect_ratio).toBe("3:4");
    expect(pre.output_format).toBe("jpeg");
    // A constante de preço: a edição de volume tem de ser mais barata que a premium (é o que as faixas querem dizer)
    expect(COVER_COST_USD.volume).toBeLessThan(COVER_COST_USD.premium);
  });
});

describe("bgmPrompt (estilo por categoria)", () => {
  it("as restrições de música instrumental e de laço estão sempre presentes; o mapa de categoria funciona e a desconhecida volta à faixa genérica", () => {
    for (const g of ["shopping", "knowledge", undefined, "no-such-genre"]) {
      const p = bgmPrompt(g);
      expect(p).toContain("instrumental only");
      expect(p).toContain("no vocals");
      expect(p).toContain("loop-friendly");
    }
    expect(bgmPrompt("knowledge")).toContain("lofi");
    expect(bgmPrompt("shopping")).not.toBe(bgmPrompt("game"));
    expect(BGM_MODEL).toBe("minimax/music-2.6");
  });
});

/** Dublê de fetch que responde em sequência: cada chamada tira uma resposta pronta da fila. */
const stubFetch = (responses: Array<{ status?: number; json?: unknown }>): ReturnType<typeof vi.fn> => {
  const fn = vi.fn(async () => {
    const next = responses.shift() ?? { status: 500, json: {} };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.json ?? {},
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
};

const OPTS = { mediaBase: "https://api.atlascloud.ai/api/v1/model", apiKey: "k", timeoutMs: 5_000, pollMs: 1 };

describe("generateMedia (envio e consulta)", () => {
  it("envia e recebe o id → consulta até completed → devolve a URL do resultado (aceitando também a forma embrulhada em data)", async () => {
    const fn = stubFetch([
      { json: { code: 200, data: { id: "pred-1" } } },
      { json: { data: { status: "processing", outputs: [] } } },
      { json: { data: { status: "completed", outputs: ["https://cdn.x/img.jpg"] } } },
    ]);
    const url = await generateMedia("generateImage", { model: "m", prompt: "p" }, OPTS);
    expect(url).toBe("https://cdn.x/img.jpg");
    // A consulta passa pelo caminho prediction
    expect(String(fn.mock.calls[1][0])).toContain("/prediction/pred-1");
  });
  it("a forma plana (o schema de saída da documentação) também é lida; succeeded conta como concluído", async () => {
    stubFetch([
      { json: { code: 200, data: { id: "pred-2" } } },
      { json: { status: "succeeded", outputs: ["https://cdn.x/a.mp3"] } },
    ]);
    await expect(generateMedia("generateAudio", { model: "m", prompt: "p" }, OPTS)).resolves.toBe("https://cdn.x/a.mp3");
  });
  it("com 404 em prediction, a consulta troca para o caminho result e continua (as duas formas da documentação são cobertas)", async () => {
    const fn = stubFetch([
      { json: { code: 200, data: { id: "pred-3" } } },
      { status: 404 },
      { json: { data: { status: "completed", outputs: ["https://cdn.x/b.jpg"] } } },
    ]);
    await expect(generateMedia("generateImage", { model: "m", prompt: "p" }, OPTS)).resolves.toBe("https://cdn.x/b.jpg");
    expect(String(fn.mock.calls[2][0])).toContain("/result/pred-3");
  });
  it("tarefa em failed e envio sem id lançam erro (quem chama trata em falha aberta)", async () => {
    stubFetch([
      { json: { code: 200, data: { id: "pred-4" } } },
      { json: { data: { status: "failed" } } },
    ]);
    await expect(generateMedia("generateImage", { model: "m", prompt: "p" }, OPTS)).rejects.toThrow(/failed/);
    stubFetch([{ json: { code: 401, message: "bad key" } }]);
    await expect(generateMedia("generateImage", { model: "m", prompt: "p" }, OPTS)).rejects.toThrow(/no prediction id/);
  });
});
