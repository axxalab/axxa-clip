/**
 * Pré-checagem da configuração do LLM (a resposta de produto para a issue #6): antes de a pessoa clicar em
 * «começar», o caminho é sondado uma vez pelo endpoint mais firme do protocolo compatível com a OpenAI, o
 * /models — as três derrotas garantidas («o Ollama local não está instalado ou não subiu», «a chave está
 * vazia ou errada», «o modelo local não foi baixado») são barradas no próprio painel de configuração, com
 * o que fazer em seguida, em vez de aparecer um fetch failed no meio da detecção.
 * Falhar em aberto é o limite: o que a sonda não consegue afirmar (um endpoint que não implementa /models,
 * por exemplo) passa sempre, e a pré-checagem nunca pode barrar uma configuração que funcionaria.
 * Função pura, usada pela camada de renderização e pelos testes.
 */
import type { ModelListResult } from "./api-types";

export type PreflightVerdict =
  | { kind: "ok" }
  /** A própria sonda não consegue afirmar nada (o endpoint não implementa /models, etc.) — passa. */
  | { kind: "unknown" }
  /** O endpoint local não respondeu: o Ollama não está instalado ou não subiu. */
  | { kind: "local-down" }
  /** O endpoint na nuvem não responde: problema de rede ou do endereço da API. */
  | { kind: "unreachable" }
  /** Falha de autenticação: a API Key está vazia, errada ou vencida. */
  | { kind: "auth" }
  /** O serviço local está no ar, mas o modelo preenchido ainda não foi baixado; a lista do que está instalado vem junto, para trocar a escolha ali mesmo. */
  | { kind: "model-missing"; installed: string[] };

/** Endpoint local (Ollama, LM Studio e afins): não precisa de chave, mas precisa que o serviço esteja de fato rodando na máquina. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

/** As marcas de uma falha de conexão (o fetch failed do undici, o ECONNREFUSED do sistema, o tempo esgotado). */
const CONNECT_FAIL = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|abort|timeout|timed\s*out|network/i;

/** O Ollama aceita omitir a etiqueta :latest — "llama3" encontra o "llama3:latest" instalado. */
function hasModel(ids: string[], model: string): boolean {
  return ids.includes(model) || ids.includes(`${model}:latest`);
}

export function preflightVerdict(res: ModelListResult, baseUrl: string, model: string): PreflightVerdict {
  const local = isLocalBaseUrl(baseUrl);
  if (res.error) {
    if (CONNECT_FAIL.test(res.error)) return local ? { kind: "local-down" } : { kind: "unreachable" };
    if (/^HTTP (401|403)/.test(res.error)) return { kind: "auth" };
    // O resto (404 por não implementar /models, lista vazia, falha de leitura) não é prova de que o chat vai falhar
    return { kind: "unknown" };
  }
  // A lista local é determinística (o que o Ollama lista é tudo o que está instalado); a da nuvem pode vir incompleta, e ninguém é barrado por ela
  if (local && res.ids.length > 0 && !hasModel(res.ids, model)) {
    return { kind: "model-missing", installed: res.ids };
  }
  return { kind: "ok" };
}
