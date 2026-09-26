import { afterEach, describe, it, expect, vi } from "vitest";
import { listModels, parseModelIds, MODEL_LIST_MAX, MODEL_LIST_TIMEOUT_MS } from "../llm-models";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("as fronteiras do pedido de listModels", () => {
  it("um corpo que trava termina em até 12 segundos e o preenchimento à mão continua possível", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }))));
    const pending = listModels("http://[::1]:11434/v1", "");
    await vi.advanceTimersByTimeAsync(MODEL_LIST_TIMEOUT_MS);
    expect(await pending).toEqual({ ids: [], error: expect.stringContaining("tempo demais") });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("o erro da API esconde a chave e o pedido de lista de modelos não é reenviado sozinho", async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"busy for sk-private"}}', { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listModels("https://example.com/v1", "sk-private")).toEqual({ ids: [], error: "HTTP 503: busy for [redacted]" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("quando o cabeçalho declara uma lista de modelos grande demais, o fluxo é fechado e o preenchimento à mão continua possível", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-length": "9000000" } })));
    expect(await listModels("http://127.0.0.1:11434/v1", "")).toEqual({ ids: [], error: expect.stringContaining("grande demais") });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("parseModelIds", () => {
  it("reconhece a forma padrão da OpenAI, {data:[{id}]}", () => {
    expect(parseModelIds({ data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }] })).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
  });

  it("reconhece também o array solto e {models:[]} (algum fornecedor não segue o padrão)", () => {
    expect(parseModelIds(["glm-4.7"])).toEqual(["glm-4.7"]);
    expect(parseModelIds({ models: [{ id: "qwen-plus" }] })).toEqual(["qwen-plus"]);
  });

  it("remove repetidos, tira o espaço e ordena alfabeticamente — o menu não deve trazer item repetido", () => {
    expect(parseModelIds({ data: [{ id: "b" }, { id: " b " }, { id: "a" }, { id: "" }] })).toEqual(["a", "b"]);
  });

  it("com a forma errada devolve um array vazio em vez de lançar exceção (isto é só um ajudante de preenchimento)", () => {
    expect(parseModelIds(null)).toEqual([]);
    expect(parseModelIds({ error: "unauthorized" })).toEqual([]);
    expect(parseModelIds("nope")).toEqual([]);
  });

  it("com as centenas de modelos de uma plataforma agregadora, a lista é cortada e o menu não estoura", () => {
    const many = Array.from({ length: MODEL_LIST_MAX + 50 }, (_, i) => ({ id: `m${String(i).padStart(4, "0")}` }));
    expect(parseModelIds({ data: many })).toHaveLength(MODEL_LIST_MAX);
  });
});
