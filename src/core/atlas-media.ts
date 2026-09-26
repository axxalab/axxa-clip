/**
 * Cliente de mídia generativa da Atlas Cloud (a edição em nuvem da v0.14): os três passos de enviar,
 * consultar e baixar da geração de imagem e de música, usados tanto pela capa por IA quanto pela trilha
 * por IA. A chave da edição de LLM que a pessoa já configurou é reaproveitada — isto só funciona quando o
 * baseUrl do LLM aponta para a Atlas, sem nenhuma configuração nova (a mesma estratégia da revisão visual na nuvem).
 *
 * Sobre a API (conferida na documentação da Atlas em 08/2026):
 *   POST {origin}/api/v1/model/generateImage|generateAudio → {code,data:{id}}
 *   GET  {origin}/api/v1/model/prediction/{id} consultado até completed → outputs:[url]
 *   (a documentação de alguns modelos escreve result/{id} — os dois são tentados, prediction primeiro e result depois)
 * Implementado só com fetch, com o tempo limite e o cancelamento pelo AbortSignal; a falha é lançada e quem chama trata em falha aberta.
 */

/** O intervalo entre consultas e o orçamento total: imagem leva de 5 a 20s e música de 30 a 90s, então o orçamento é generoso e a camada de cima apara se quiser. */
const POLL_INTERVAL_MS = 2_000;

/**
 * Deduz a raiz da API de geração de mídia da Atlas (…/api/v1/model) a partir do baseUrl do LLM.
 * Só o domínio da Atlas é aceito — outros endpoints (um Ollama local, outra nuvem) não têm esta API de
 * geração, e devolver null significa «a edição de geração por IA não está disponível», o que faz a camada
 * de cima desabilitar a entrada ou pular em silêncio.
 */
export function atlasMediaBase(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    const u = new URL(baseUrl);
    if (!/(^|\.)atlascloud\.ai$/i.test(u.hostname)) return null;
    return `${u.origin}/api/v1/model`;
  } catch {
    return null;
  }
}

interface SubmitResponse {
  code?: number;
  data?: { id?: string };
  /** Algumas formas de erro trazem a message direto, sem embrulho. */
  message?: string;
}

interface PredictionResponse {
  code?: number;
  data?: { status?: string; outputs?: string[]; error?: string };
  /** Aceita também a forma plana (o schema de saída da documentação é plano). */
  status?: string;
  outputs?: string[];
}

/** Tira o estado da tarefa e o resultado das duas formas de resposta (a documentação e a implementação do gateway divergem sobre embrulhar ou não em data). */
function readPrediction(json: PredictionResponse): { status: string; outputs: string[] } {
  const status = (json.data?.status ?? json.status ?? "").toLowerCase();
  const outputs = json.data?.outputs ?? json.outputs ?? [];
  return { status, outputs };
}

/**
 * Envia a tarefa de geração e consulta até a URL do resultado. O kind corresponde aos dois endpoints de
 * geração da Atlas; o body precisa trazer o model e os parâmetros que aquele modelo exige. Qualquer falha
 * (tempo esgotado, erro do gateway, tarefa em failed, nenhum resultado) é sempre lançada — quem chama
 * decide entre falhar em aberto ou avisar a pessoa.
 */
export async function generateMedia(
  kind: "generateImage" | "generateAudio",
  body: Record<string, unknown>,
  opts: { mediaBase: string; apiKey: string; timeoutMs: number; signal?: AbortSignal; pollMs?: number }
): Promise<string> {
  const { mediaBase, apiKey, timeoutMs, signal, pollMs = POLL_INTERVAL_MS } = opts;
  const deadline = Date.now() + timeoutMs;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const timeboxed = (): AbortSignal => {
    const t = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    return signal ? AbortSignal.any([signal, t]) : t;
  };

  const submitRes = await fetch(`${mediaBase}/${kind}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: timeboxed(),
  });
  if (!submitRes.ok) throw new Error(`atlas ${kind} submit HTTP ${submitRes.status}`);
  const submitted = (await submitRes.json()) as SubmitResponse;
  const id = submitted.data?.id;
  if (!id) throw new Error(`atlas ${kind} submit: no prediction id (${submitted.message ?? "unknown"})`);

  // A consulta: a documentação oscila entre prediction/{id} e result/{id}; prediction vem primeiro e,
  // com 404, result assume e fica lembrado nesta tarefa (em vez de tentar os dois em cada rodada)
  let path = "prediction";
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("cancelled");
    await new Promise((r) => setTimeout(r, pollMs));
    const res = await fetch(`${mediaBase}/${path}/${id}`, { headers, signal: timeboxed() });
    if (res.status === 404 && path === "prediction") {
      path = "result";
      continue;
    }
    if (!res.ok) throw new Error(`atlas poll HTTP ${res.status}`);
    const { status, outputs } = readPrediction((await res.json()) as PredictionResponse);
    if (status === "failed") throw new Error("atlas generation failed");
    if ((status === "completed" || status === "succeeded") && outputs.length > 0) return outputs[0];
  }
  throw new Error(`atlas ${kind} timed out after ${timeoutMs}ms`);
}

/** Baixa a URL do resultado para um arquivo local; quem chama cuida de a pasta existir e do nome. */
export async function downloadMedia(url: string, destPath: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("download: empty body");
  const { writeFile } = await import("fs/promises");
  await writeFile(destPath, buf);
}
