/** As fronteiras do pedido HTTP a um modelo: o tempo total, a espera cancelável, a repetição limitada e o teto do corpo da resposta. */
export const LLM_REMOTE_TIMEOUT_MS = 180_000;
export const LLM_LOCAL_TIMEOUT_MS = 300_000;
export const LLM_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const LLM_RETRY_WAIT_MAX_MS = 5_000;

export interface LlmRequestBudget { deadline: number; retriesRemaining: number }
export function llmRequestBudget(timeoutMs: number, retries = 0): LlmRequestBudget {
  return { deadline: Date.now() + timeoutMs, retriesRemaining: retries };
}

export class LlmTransportError extends Error {
  constructor(readonly kind: "timeout" | "response-too-large") {
    super(kind === "timeout"
      ? "a resposta do modelo levou tempo demais; tente de novo mais tarde ou escolha um modelo menor. / Model response timed out; retry later or choose a smaller model."
      : "a resposta do modelo é grande demais e a leitura foi interrompida; confira o endereço da API ou troque de modelo. / Model response too large; check the endpoint or choose another model.");
    this.name = "LlmTransportError";
  }
}

/** O Retry-After aceita tanto segundos quanto uma data HTTP; valor inválido não conta como instrução de espera do servidor. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const ms = Number(value) * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  // Evita que o Date.parse interprete um número negativo ou malformado como data.
  if (!/[A-Za-z]/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const reader = response.body?.getReader();
  if (!reader) return "";
  const cancel = (): void => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let complete = false;
  try {
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) throw new LlmTransportError("response-too-large");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maxBytes) throw new LlmTransportError("response-too-large");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

/** A repetição só acontece numa resposta clara de limite de uso ou de indisponibilidade momentânea; queda de rede, tempo esgotado e um corpo que já chegou com sucesso não são reenviados. */
export async function requestLlmText(url: string, init: Omit<RequestInit, "signal">, options: {
  signal?: AbortSignal; budget?: LlmRequestBudget; maxBytes?: number;
} = {}): Promise<{ ok: boolean; status: number; headers: Headers; text: string }> {
  const budget = options.budget ?? llmRequestBudget(LLM_REMOTE_TIMEOUT_MS);
  const timeout = new AbortController();
  const remaining = budget.deadline - Date.now();
  options.signal?.throwIfAborted();
  if (remaining <= 0) throw new LlmTransportError("timeout");
  const timer = setTimeout(() => timeout.abort(), remaining);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  try {
    for (;;) {
      signal.throwIfAborted();
      const response = await fetch(url, { ...init, signal });
      const text = await readBounded(response, response.ok ? options.maxBytes ?? LLM_RESPONSE_MAX_BYTES : 64 * 1024, signal);
      const wait = retryAfterMs(response.headers.get("retry-after")) ?? 1_000;
      // As mensagens de saldo/crédito dos fornecedores, em inglês, em português e em mandarim (os ideogramas ficam como escapes Unicode)
      const quotaFailure = /insufficient_quota|quota_exhausted|billing_hard_limit|credit[_ ]balance|saldo insuficiente|sem saldo|cr[eé]dito insuficiente|\u4f59\u989d\u4e0d\u8db3|\u6b20\u8d39/i.test(text);
      if ((response.status === 429 || response.status === 503) && !quotaFailure && budget.retriesRemaining > 0 &&
          wait <= LLM_RETRY_WAIT_MAX_MS && wait < budget.deadline - Date.now()) {
        budget.retriesRemaining--;
        await waitForRetry(wait, signal);
        continue;
      }
      return { ok: response.ok, status: response.status, headers: response.headers, text };
    }
  } catch (error) {
    options.signal?.throwIfAborted();
    if (timeout.signal.aborted) throw new LlmTransportError("timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** O diagnóstico do servidor é preservado para a pessoa, mas a chave que o fornecedor devolve no eco não entra no aviso de erro. */
export function modelErrorDetail(text: string, apiKey: string, maxLength = 300): string {
  let detail = text;
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof body?.error === "string" ? body.error : body?.error?.message ?? body?.message;
    if (typeof message === "string") detail = message;
  } catch { /* um erro que não é JSON também mantém o diagnóstico limitado. */ }
  if (apiKey) detail = detail.split(apiKey).join("[redacted]");
  return detail.replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]").slice(0, maxLength);
}
