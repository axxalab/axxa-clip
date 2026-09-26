/**
 * O julgamento da pré-checagem da configuração do LLM (issue #6): as três derrotas garantidas precisam ser
 * barradas com precisão, e todo o resto passa — falhar em aberto é o limite, e a pré-checagem nunca pode
 * barrar uma configuração que funcionaria.
 */
import { describe, expect, it } from "vitest";
import { preflightVerdict, isLocalBaseUrl } from "../../shared/llm-preflight";

const OLLAMA = "http://localhost:11434/v1";
const CLOUD = "https://api.atlascloud.ai/v1";

describe("isLocalBaseUrl", () => {
  it("localhost e 127.0.0.1 contam como local, e um domínio de nuvem não", () => {
    expect(isLocalBaseUrl(OLLAMA)).toBe(true);
    expect(isLocalBaseUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalBaseUrl(CLOUD)).toBe(false);
  });
  it("aceita o laço local em IPv6, mas não toma um caminho, um nome de usuário ou um domínio parecido por local", () => {
    expect(isLocalBaseUrl("http://[::1]:11434/v1")).toBe(true);
    for (const url of ["https://localhost.example.com/v1", "https://example.com/127.0.0.1", "https://localhost@example.com/v1", "file://localhost/path", "localhost"]) {
      expect(isLocalBaseUrl(url)).toBe(false);
    }
  });
});

describe("preflightVerdict", () => {
  it("local sem resposta → local-down (o Ollama não está instalado ou não subiu)", () => {
    expect(preflightVerdict({ ids: [], error: "fetch failed" }, OLLAMA, "qwen3:8b")).toEqual({ kind: "local-down" });
    expect(preflightVerdict({ ids: [], error: "connect ECONNREFUSED 127.0.0.1:11434" }, OLLAMA, "qwen3:8b")).toEqual({
      kind: "local-down",
    });
    expect(preflightVerdict({ ids: [], error: "Model response timed out" }, "http://[::1]:11434/v1", "qwen3:8b")).toEqual({ kind: "local-down" });
  });

  it("nuvem sem resposta → unreachable (problema de rede ou de endereço)", () => {
    expect(preflightVerdict({ ids: [], error: "fetch failed" }, CLOUD, "m")).toEqual({ kind: "unreachable" });
    expect(preflightVerdict({ ids: [], error: "The operation was aborted due to timeout" }, CLOUD, "m")).toEqual({
      kind: "unreachable",
    });
  });

  it("HTTP 401/403 → auth (chave vazia, errada ou vencida)", () => {
    expect(preflightVerdict({ ids: [], error: "HTTP 401: invalid api key" }, CLOUD, "m")).toEqual({ kind: "auth" });
    expect(preflightVerdict({ ids: [], error: "HTTP 403: forbidden" }, CLOUD, "m")).toEqual({ kind: "auth" });
  });

  it("o endpoint não implementa /models (404 ou lista vazia) → unknown, e passa", () => {
    expect(preflightVerdict({ ids: [], error: "HTTP 404: not found" }, CLOUD, "m")).toEqual({ kind: "unknown" });
    expect(
      preflightVerdict({ ids: [], error: "este endpoint não devolveu lista de modelos / endpoint returned no models" }, CLOUD, "m")
    ).toEqual({ kind: "unknown" });
  });

  it("o modelo local não foi baixado → model-missing, com a lista do que está instalado", () => {
    const res = { ids: ["llama3:latest", "qwen2:7b"], error: null };
    expect(preflightVerdict(res, OLLAMA, "qwen3:8b")).toEqual({
      kind: "model-missing",
      installed: ["llama3:latest", "qwen2:7b"],
    });
  });

  it("no Ollama, omitir a etiqueta :latest também conta como encontrado", () => {
    const res = { ids: ["llama3:latest"], error: null };
    expect(preflightVerdict(res, OLLAMA, "llama3")).toEqual({ kind: "ok" });
  });

  it("o modelo local está na lista → ok", () => {
    expect(preflightVerdict({ ids: ["qwen3:8b"], error: null }, OLLAMA, "qwen3:8b")).toEqual({ kind: "ok" });
  });

  it("a lista da nuvem pode vir incompleta e não barra ninguém → um modelo fora da lista também é ok", () => {
    expect(preflightVerdict({ ids: ["other-model"], error: null }, CLOUD, "my-model")).toEqual({ kind: "ok" });
  });
});
