import { afterEach, describe, expect, it, vi } from "vitest";
import { llmRequestBudget, modelErrorDetail, requestLlmText, retryAfterMs } from "../llm-transport";

const URL = "http://127.0.0.1:11434/v1/chat/completions";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a espera e as fronteiras de resposta do pedido ao modelo", () => {
  it("quando o cabeçalho nunca chega, o tempo esgota e o pedido que pode já ter sido recebido não é reenviado", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    vi.stubGlobal("fetch", fetchMock);
    const pending = requestLlmText(URL, {}, { budget: llmRequestBudget(100, 1) });
    const check = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await check;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("com o cabeçalho recebido e o corpo travado, o tempo também esgota e o fluxo é fechado", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("partial")); }, cancel,
    }))));
    const pending = requestLlmText(URL, {}, { budget: llmRequestBudget(100) });
    const check = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await check;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("o cancelamento durante a leitura do corpo preserva o motivo e libera o fluxo", async () => {
    const controller = new AbortController();
    let began!: () => void;
    const reading = new Promise<void>((resolve) => { began = resolve; });
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull() { began(); }, cancel }))));
    const pending = requestLlmText(URL, {}, { signal: controller.signal });
    const reason = new Error("user-cancelled");
    const check = expect(pending).rejects.toBe(reason);
    await reading;
    controller.abort(reason);
    await check;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("um caractere UTF-8 partido entre dois blocos de resposta não corrompe o texto", async () => {
    const bytes = new TextEncoder().encode("legenda café");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(bytes.slice(0, 1)); c.enqueue(bytes.slice(1, 5)); c.enqueue(bytes.slice(5)); c.close();
    } }))));
    expect((await requestLlmText(URL, {})).text).toBe("legenda café");
  });

  it.each([true, false])("recusa um corpo grande demais tanto com Content-Length conhecido quanto acumulando em fluxo (%s)", async (declared) => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel }), {
      headers: declared ? { "content-length": "20" } : {},
    })));
    await expect(requestLlmText(URL, {}, { maxBytes: 10 })).rejects.toMatchObject({ kind: "response-too-large" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancelado antes do pedido, o serviço do modelo não é acessado", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(requestLlmText(URL, {}, { signal: AbortSignal.abort(new Error("stopped")) })).rejects.toThrow("stopped");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a repetição limitada do pedido ao modelo", () => {
  it("respeita o Retry-After tanto em segundos quanto em formato de data", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("0")).toBe(0);
    expect(retryAfterMs("Wed, 16 Sep 2026 12:00:02 GMT", Date.parse("2026-09-16T12:00:00Z"))).toBe(2000);
    for (const value of [null, "", "-1", "nonsense"]) expect(retryAfterMs(value)).toBeNull();
  });

  it.each([429, 503])("depois de um HTTP %s passageiro, espera, dá certo e libera todos os temporizadores", async (status) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("busy", { status, headers: { "retry-after": "1" } })).mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = requestLlmText(URL, {}, { budget: llmRequestBudget(5000, 1) });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 404, 500])("HTTP %s não repete sozinho", async (status) => {
    const fetchMock = vi.fn(async () => new Response("failure", { status })); vi.stubGlobal("fetch", fetchMock);
    expect((await requestLlmText(URL, {}, { budget: llmRequestBudget(5000, 1) })).status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("um 429 por saldo insuficiente não fica repetindo o pedido", async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await requestLlmText(URL, {}, { budget: llmRequestBudget(5000, 1) })).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("quando o servidor pede uma espera longa, a decisão volta para quem chamou, sem repetir antes da hora", async () => {
    const fetchMock = vi.fn(async () => new Response("busy", { status: 429, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await requestLlmText(URL, {}, { budget: llmRequestBudget(300000, 1) })).headers.get("retry-after")).toBe("120");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancelar durante a espera da repetição não manda outro pedido", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => new Response("busy", { status: 503, headers: { "retry-after": "2" } }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = requestLlmText(URL, {}, { signal: controller.signal, budget: llmRequestBudget(5000, 1) });
    const check = expect(pending).rejects.toThrow("stopped");
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new Error("stopped"));
    await check;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uma queda de rede não faz o pedido ser reenviado", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("fetch failed"); }); vi.stubGlobal("fetch", fetchMock);
    await expect(requestLlmText(URL, {}, { budget: llmRequestBudget(5000, 1) })).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("o detalhe do erro esconde a chave que o fornecedor devolve no eco", () => {
    expect(modelErrorDetail('{"error":{"message":"Invalid key sk-secret"}}', "sk-secret")).toBe("Invalid key [redacted]");
    expect(modelErrorDetail("Authorization: Bearer secret-value", "")).not.toContain("secret-value");
  });
});
