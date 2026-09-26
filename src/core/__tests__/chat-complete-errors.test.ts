/**
 * A mensagem de erro de falha ao conectar no LLM precisa ser executável (issue #6):
 * quem escolheu o Ollama local sem ter instalado ou iniciado, vendo apenas "fetch
 * failed", não descobre o próximo passo — o caso local e o de nuvem precisam dar
 * orientações diferentes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete, MAX_TOKENS, RETRY_MAX_TOKENS, thinkingParams } from "../highlight/detect";

const OLLAMA = { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "qwen3:8b" };
const CLOUD = { baseUrl: "https://api.atlascloud.ai/v1", apiKey: "sk-x", model: "qwen/qwen3.5-flash" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("orientação do chatComplete em falha de conexão", () => {
  it("endpoint local inalcançável → orienta instalar ou iniciar o Ollama, ou trocar para a nuvem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
    await expect(chatComplete(OLLAMA, "s", "u")).rejects.toThrow(/Ollama/);
    await expect(chatComplete(OLLAMA, "s", "u")).rejects.toThrow(/ollama\.com/);
  });

  it("endpoint de nuvem inalcançável → orienta conferir a conexão e a URL base, sem mencionar o Ollama", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
    const err = (await chatComplete(CLOUD, "s", "u").catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("Confira sua conexão");
    expect(err.message).not.toContain("Ollama");
  });

  it("404 no local (o modelo não foi baixado) → acrescenta o comando ollama pull", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("model not found", { status: 404 })));
    await expect(chatComplete(OLLAMA, "s", "u")).rejects.toThrow(/ollama pull qwen3:8b/);
  });

  it("404 na nuvem → não acrescenta a dica do ollama pull", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no such model", { status: 404 })));
    const err = (await chatComplete(CLOUD, "s", "u").catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("HTTP 404");
    expect(err.message).not.toContain("ollama pull");
  });
});

/** Monta uma resposta compatível com OpenAI. */
function chatResponse(message: Record<string, unknown>, finishReason = "stop"): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message }] }), { status: 200 });
}

describe("limites de recuperação de requisição do chatComplete", () => {
  it("a recuperação de limite de taxa e o recuo de parâmetro do Qwen compartilham a mesma cota de uma retentativa", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response("unsupported parameter: enable_thinking", { status: 400 }))
      .mockResolvedValueOnce(new Response("busy again", { status: 503, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatComplete(CLOUD, "s", "u")).rejects.toThrow("HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).enable_thinking)).toEqual([false, false, undefined]);
  });

  it("o recuo de parâmetro usa apenas o tempo que sobrou da primeira requisição", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 170_000);
        return new Response("unsupported parameter: enable_thinking", { status: 400 });
      })
      .mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = chatComplete(CLOUD, "s", "u");
    const check = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("quando o servidor pede uma espera longa, a dica de espera é preservada e a chave ecoada é escondida", async () => {
    const fetchMock = vi.fn(async () => new Response(`rate limited for ${CLOUD.apiKey}`, {
      status: 429, headers: { "retry-after": "120" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await chatComplete(CLOUD, "s", "u").catch((e: Error) => e) as Error;
    expect(error.message).toContain("120 segundos");
    expect(error.message).not.toContain(CLOUD.apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("com o conteúdo em branco, ainda é possível recuperar o reasoning de um encerramento normal", async () => {
    const fetchMock = vi.fn(async () => chatResponse({ content: " \n ", reasoning: '{"clips":[]}' }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatComplete(CLOUD, "s", "u")).resolves.toBe('{"clips":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("tratamento de resposta vazia no chatComplete (issue #8)", () => {
  it("no primeiro pedido, os modelos Qwen3 de raciocínio híbrido têm o thinking desligado, para o orçamento do conteúdo não ser consumido", async () => {
    const fetchMock = vi.fn(async () => chatResponse({ content: '{"clips":[]}' }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatComplete({ ...CLOUD, model: "qwen3.5-flash" }, "s", "u")).resolves.toBe('{"clips":[]}');
    const body = JSON.parse(((fetchMock.mock.calls[0] as unknown) as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.enable_thinking).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("quando um gateway estrito não conhece o enable_thinking, a requisição volta a ser a padrão", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unsupported parameter: enable_thinking", { status: 400 }))
      .mockResolvedValueOnce(chatResponse({ content: '{"clips":[]}' }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatComplete({ ...CLOUD, model: "qwen3.5-flash" }, "s", "u")).resolves.toBe('{"clips":[]}');
    const firstBody = JSON.parse(((fetchMock.mock.calls[0] as unknown) as [string, { body: string }])[1].body) as Record<string, unknown>;
    const secondBody = JSON.parse(((fetchMock.mock.calls[1] as unknown) as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(firstBody.enable_thinking).toBe(false);
    expect(secondBody.enable_thinking).toBeUndefined();
  });

  it("aceita o array content multimodal da OpenAI e o antigo choices.text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse({ content: [{ type: "text", text: "{" }, { type: "text", text: '"clips":[]}' }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatComplete(CLOUD, "s", "u")).resolves.toBe('{"clips":[]}');

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ text: "legacy" }] }), { status: 200 })));
    await expect(chatComplete(CLOUD, "s", "u")).resolves.toBe("legacy");
  });

  it("o parâmetro que desliga o thinking só é injetado no Qwen e no QwQ", () => {
    expect(thinkingParams("qwen3.5-flash")).toEqual({ enable_thinking: false });
    expect(thinkingParams("Qwen/QwQ-32B")).toEqual({ enable_thinking: false });
    expect(thinkingParams("deepseek-v4-flash")).toEqual({});
  });

  it("modelo de raciocínio que queima o orçamento (finish=length) → retentativa com orçamento grande e sucesso", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse({ content: "", reasoning_content: "deixa eu pensar…" }, "length"))
      .mockResolvedValueOnce(chatResponse({ content: '{"clips":[]}' }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatComplete(CLOUD, "s", "u")).resolves.toBe('{"clips":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const budgets = fetchMock.mock.calls.map(
      (c) => (JSON.parse((c as [string, { body: string }])[1].body) as { max_tokens: number }).max_tokens
    );
    expect(budgets).toEqual([MAX_TOKENS, RETRY_MAX_TOKENS]);
  });

  it("nas duas vezes só há raciocínio e nenhum conteúdo → orienta trocar por um modelo sem raciocínio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => chatResponse({ content: "", reasoning_content: "pensei bastante" }, "length"))
    );
    const err = (await chatComplete(CLOUD, "s", "u").catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("não devolveu conteúdo");
    expect(err.message).toContain("raciocínio profundo");
    expect(err.message).toContain("non-thinking");
  });

  it("conteúdo que o gateway colocou no reasoning por engano (com encerramento normal) → o reasoning é usado direto, sem retentativa", async () => {
    const fetchMock = vi.fn(async () => chatResponse({ content: "", reasoning: '{"clips":[]}' }, "stop"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatComplete(CLOUD, "s", "u")).resolves.toBe('{"clips":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bloqueio da revisão de segurança (content_filter) → sugere trocar de provedor ou de material", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chatResponse({ content: "" }, "content_filter")));
    const err = (await chatComplete(CLOUD, "s", "u").catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("revisão de segurança");
  });

  it("a própria retentativa devolvendo erro de HTTP → não substitui o diagnóstico de \"resposta vazia\"", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse({ content: "", reasoning_content: "…" }, "length"))
      .mockResolvedValueOnce(new Response("max_tokens too large", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = (await chatComplete(CLOUD, "s", "u").catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("não devolveu conteúdo");
    expect(err.message).toContain("raciocínio profundo");
  });

  it("resposta vazia comum (sem rastro de raciocínio) → depois de uma retentativa, dá a orientação geral", async () => {
    const fetchMock = vi.fn(async () => chatResponse({ content: "" }));
    vi.stubGlobal("fetch", fetchMock);
    const err = (await chatComplete(CLOUD, "s", "u").catch((e: unknown) => e)) as Error;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err.message).toContain("conteúdo vazio");
    expect(err.message).not.toContain("raciocínio profundo");
  });
});
