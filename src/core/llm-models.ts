/**
 * Busca a lista de modelos que um endpoint compatível com a OpenAI realmente oferece agora (GET {baseUrl}/models).
 *
 * Por que isto existe: o id de um modelo apodrece — os fornecedores trocam de geração em poucos meses (o
 * deepseek-chat saiu do ar em 24/07/2026 e virou deepseek-v4-*), e um nome fixo num preset dá 404 cedo ou
 * tarde. A base_url quase não muda, e o `/models` é o endpoint mais firme do protocolo compatível com a
 * OpenAI, então deixar a pessoa buscar a lista real com um clique é bem mais confiável que a gente adivinhar um nome.
 *
 * Não são todos os endpoints que implementam /models (os de caminho personalizado especialmente podem não
 * ter), e quando a busca não traz nada voltam uma lista vazia + o motivo, com a interface pedindo o nome à
 * mão — nunca se barra a detecção por causa disso.
 */

import type { ModelListResult } from "../shared/api-types";
import { llmRequestBudget, modelErrorDetail, requestLlmText } from "./llm-transport";

export type { ModelListResult };

/** O teto da lista: uma plataforma agregadora (OpenRouter e afins) tem centenas de modelos, e o corte evita estourar a lista do menu. */
export const MODEL_LIST_MAX = 400;
/** O tempo limite da busca: isto é um botão de interação, e a pessoa não pode ficar esperando de graça. */
export const MODEL_LIST_TIMEOUT_MS = 12_000;

/** Escava a lista de id da resposta /models de cada fornecedor — a da OpenAI é {data:[{id}]}, e algum fornecedor devolve o array direto. */
export function parseModelIds(body: unknown): string[] {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown })?.data)
      ? ((body as { data: unknown[] }).data)
      : Array.isArray((body as { models?: unknown })?.models)
        ? ((body as { models: unknown[] }).models)
        : [];
  const ids = new Set<string>();
  for (const r of rows) {
    const id = typeof r === "string" ? r : typeof r === "object" && r !== null ? (r as { id?: unknown }).id : null;
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  }
  return [...ids].sort((a, b) => a.localeCompare(b)).slice(0, MODEL_LIST_MAX);
}

/**
 * Busca a lista. Falha em aberto: qualquer falha devolve {ids: [], error} em vez de lançar exceção — isto é
 * só um ajudante de preenchimento, e não deve ter o poder de interromper nada.
 */
export async function listModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ModelListResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  try {
    const res = await requestLlmText(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    }, { signal, budget: llmRequestBudget(MODEL_LIST_TIMEOUT_MS) });
    const text = res.text;
    if (!res.ok) {
      return { ids: [], error: `HTTP ${res.status}: ${modelErrorDetail(text, apiKey, 160)}` };
    }
    const ids = parseModelIds(JSON.parse(text));
    return ids.length > 0
      ? { ids, error: null }
      : { ids: [], error: "este endpoint não devolveu lista de modelos / endpoint returned no models" };
  } catch (e) {
    return { ids: [], error: modelErrorDetail(e instanceof Error ? e.message : String(e), apiKey, 300) };
  }
}
