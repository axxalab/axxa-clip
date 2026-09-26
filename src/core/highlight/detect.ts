/**
 * Orquestrador da detecção de destaques: transcrição → seleções do LLM → busca
 * reversa → lista validada de HighlightCandidate.
 */
import type { Transcript } from "../transcribe/types";
import type { MediaSignals } from "../signals";
import type { ReferenceProfile } from "../reference";
import type { ReviewRecord } from "../review-memory";
import type { PerformanceEntry } from "../performance-memory";
import type { HighlightCandidate, LlmConfig, PrefilterConfig, FunnelStats, ClipLength } from "../../shared/api-types";
import {
  highlightSystemPrompt,
  buildHighlightPrompt,
  reviewSystemPrompt,
  buildReviewPrompt,
  extractJson,
  CLIP_LENGTH_RANGES,
  isPortugueseTranscript,
  MOMENT_SYSTEM_PROMPT_PT,
  MOMENT_SYSTEM_PROMPT_EN,
  buildMomentPrompt,
} from "./prompt";
import { resolveSelection, type RawSelection, type RawPart } from "./match";
import { prefilterTranscript } from "./prefilter";
import { detectClipCommands } from "./commands";
import { applyRuleGate, type GateTier } from "./gate";
import { utilityDensity, utilityBoost, UTILITY_SAVE_WORTHY } from "../../shared/utility-density";
import { clipDurationSec, MAX_PIECES, type ClipPiece } from "../../shared/pieces";
import { isLocalBaseUrl } from "../../shared/llm-preflight";
import { LLM_LOCAL_TIMEOUT_MS, LLM_REMOTE_TIMEOUT_MS, LlmTransportError, llmRequestBudget, modelErrorDetail, requestLlmText, retryAfterMs, type LlmRequestBudget } from "../llm-transport";
import { genrePreset, normalizeGenreId, type EvidenceClass } from "../genre";
import {
  fuseMoments,
  shouldRunMoments,
  speechRatio,
  MOMENT_WEIGHTS,
  topMoments,
  type SignalMoment,
} from "./moments";

/**
 * Limites de filtragem da faixa de duração: uma folga em torno do alvo (metade
 * abaixo e uma vez e meia acima) — os candidatos em que o LLM passou um pouco
 * ficam para a pessoa decidir, e os absurdos são descartados; o piso absoluto é 4
 * segundos, para evitar fragmento.
 */
export function clipLengthBounds(length: ClipLength = "standard"): { lo: number; hi: number } {
  const r = CLIP_LENGTH_RANGES[length];
  return { lo: Math.max(4, Math.round(r.minSec * 0.5)), hi: Math.round(r.maxSec * 1.5) };
}

/**
 * O nível sem chave do Pollinations serve um modelo de raciocínio com orçamento
 * de saída pequeno — sem reasoning_effort:"low" ele gasta cada token pensando e
 * devolve conteúdo vazio. Isto vale só para aquele host; a OpenAI de verdade
 * recusa o parâmetro.
 */
export function extraParams(baseUrl: string): Record<string, unknown> {
  return /pollinations\.ai/i.test(baseUrl) ? { reasoning_effort: "low" } : {};
}

/**
 * Os modelos Qwen híbridos vêm com o raciocínio ligado em vários hosts
 * compatíveis com OpenAI.
 * A detecção de destaques precisa de uma resposta curta e estruturada; gastar o
 * orçamento inteiro de conclusão em raciocínio escondido produz um campo
 * `content` vazio.
 * Isto fica restrito aos ids de modelo que documentam a chave, para que provedores
 * compatíveis comuns não recebam um parâmetro sem suporte.
 */
export function thinkingParams(model: string): Record<string, unknown> {
  return /(?:^|[/:-])qwen3(?:[.:-]|$)|(?:^|[/:-])qwq(?:[.:-]|$)/i.test(model)
    ? { enable_thinking: false }
    : {};
}

/** Orçamento de saída de uma chamada. Atenção: os tokens de raciocínio dos modelos de raciocínio entram neste mesmo orçamento. */
export const MAX_TOKENS = 4000;
/** Orçamento ampliado da retentativa por conteúdo vazio: quando um modelo de raciocínio queima o orçamento normal só pensando, a segunda tentativa recebe espaço de sobra. */
export const RETRY_MAX_TOKENS = 16000;

/** O resultado em três partes de uma chamada de chat: além do conteúdo, vêm o rastro de raciocínio e o motivo do encerramento, para diagnosticar resposta vazia. */
interface ChatAttempt {
  content: string;
  /** O rastro de raciocínio dos modelos de raciocínio (reasoning_content, ou reasoning no estilo do OpenRouter). */
  reasoning: string;
  finishReason: string;
}

/** Faz uma requisição compatível com OpenAI. Erros de rede, de HTTP e de leitura vêm todos com uma orientação executável. */
async function chatAttempt(
  llm: LlmConfig,
  system: string,
  user: string,
  signal: AbortSignal | undefined,
  maxTokens: number,
  budget: LlmRequestBudget,
  includeThinkingParam = true
): Promise<ChatAttempt> {
  const url = `${llm.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let res: Awaited<ReturnType<typeof requestLlmText>>;
  try {
    res = await requestLlmText(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.6,
        max_tokens: maxTokens,
        ...extraParams(llm.baseUrl),
        ...(includeThinkingParam ? thinkingParams(llm.model) : {}),
      }),
    }, { signal, budget });
  } catch (e) {
    signal?.throwIfAborted();
    if (e instanceof LlmTransportError) throw e;
    // O cenário mais comum de não conseguir conectar é "escolheu o Ollama local
    // mas não instalou ou não iniciou" (issue #6) — a mensagem precisa dizer o
    // próximo passo, porque um "fetch failed" seco só deixa a pessoa parada
    const hint = isLocalBaseUrl(llm.baseUrl)
      ? "O serviço de LLM desta máquina não respondeu: se você usa o Ollama, instale e inicie a partir de ollama.com e rode ollama pull para baixar o modelo; ou clique em \"Conectar um modelo de IA\" e escolha um provedor de nuvem, colando uma chave de API. / Local LLM not responding: install & start Ollama (ollama.com) and pull the model, or switch to a cloud provider with an API key."
      : "Confira sua conexão e verifique se a URL base está correta. / Check your network and verify the Base URL.";
    throw new Error(`Não foi possível conectar ao serviço de LLM / cannot reach LLM endpoint\n${hint}`);
  }
  const text = res.text;
  if (!res.ok) {
    // O Ollama está rodando mas o modelo não foi baixado: no 404, o comando de
    // download é acrescentado, para a pessoa não achar que o programa quebrou
    const retryWait = retryAfterMs(res.headers.get("retry-after"));
    const hint = isLocalBaseUrl(llm.baseUrl) && res.status === 404
      ? `\nEsta máquina provavelmente ainda não baixou este modelo: rode antes ollama pull ${llm.model} / model likely not pulled yet: run ollama pull ${llm.model}`
      : res.status === 429 || res.status === 503
        ? retryWait !== null && retryWait > 0
          ? `\nO provedor sugere esperar ${Math.ceil(retryWait / 1000)} segundos antes de tentar de novo. / Retry after ${Math.ceil(retryWait / 1000)} seconds.`
          : "\nO serviço está indisponível no momento ou a cota foi limitada; tente de novo mais tarde e confira o estado do serviço e a cota. / Check service availability and quota, then retry later."
        : "";
    throw new Error(`A requisição ao LLM falhou / LLM request failed (HTTP ${res.status}): ${modelErrorDetail(text, llm.apiKey)}${hint}`);
  }
  let data: {
    choices?: Array<{
      finish_reason?: string;
      text?: string;
      message?: {
        content?: string | Array<{ type?: string; text?: unknown }>;
        reasoning_content?: string;
        reasoning?: string;
      };
    }>;
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("O LLM devolveu uma resposta que não é JSON; verifique a URL base. / Non-JSON response; check the Base URL.");
  }
  const choice = data?.choices?.[0];
  const msg = choice?.message;
  const content = Array.isArray(msg?.content)
    ? msg.content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
    : typeof msg?.content === "string"
      ? msg.content
      : typeof choice?.text === "string"
        ? choice.text
        : "";
  return {
    content: content.trim(),
    reasoning: (
      (typeof msg?.reasoning_content === "string" && msg.reasoning_content) ||
      (typeof msg?.reasoning === "string" && msg.reasoning) ||
      "").trim(),
    finishReason: String(choice?.finish_reason ?? ""),
  };
}

/**
 * Chama um endpoint de chat compatível com OpenAI. Lança erro com uma mensagem
 * executável.
 *
 * O tratamento de conteúdo vazio em três camadas (issue #8; os modelos de
 * "raciocínio profundo" de várias plataformas caem nisso):
 * 1. O modelo de raciocínio queima o orçamento de 4 mil tokens inteiro pensando
 *    (finish=length, com reasoning e sem content) — a retentativa automática usa
 *    quatro vezes o orçamento, o que resolve a maioria dos casos na hora;
 * 2. Alguns gateways colocam o conteúdo no campo reasoning por engano (o modelo
 *    encerra normalmente mas content fica vazio) — o reasoning é entregue direto
 *    para a camada de leitura, e se não der para ler, a retentativa que já existe
 *    entra em ação;
 * 3. Continuando vazio: o erro é atribuído pela evidência (modelo de raciocínio
 *    que queimou o orçamento, bloqueio da revisão de segurança, falha
 *    esporádica do servidor), e cada caso diz o que a pessoa deve trocar.
 */
export async function chatComplete(llm: LlmConfig, system: string, user: string, signal?: AbortSignal): Promise<string> {
  // O recuo de parâmetro e a retentativa por conteúdo vazio compartilham o mesmo
  // prazo e a mesma cota de uma retentativa por limite de taxa, sem multiplicar a
  // quantidade de requisições camada por camada.
  const budget = llmRequestBudget(isLocalBaseUrl(llm.baseUrl) ? LLM_LOCAL_TIMEOUT_MS : LLM_REMOTE_TIMEOUT_MS, 1);
  let includeThinkingParam = Object.keys(thinkingParams(llm.model)).length > 0;
  let first: ChatAttempt;
  try {
    first = await chatAttempt(llm, system, user, signal, MAX_TOKENS, budget, includeThinkingParam);
  } catch (e) {
    // Um gateway estritamente compatível com OpenAI pode recusar a chave
    // específica do provedor. A retentativa é feita uma vez sem ela; falhas
    // comuns de HTTP e de autenticação continuam lançando erro.
    const message = e instanceof Error ? e.message : String(e);
    if (!includeThinkingParam || !/HTTP 400/i.test(message) || !/thinking|unknown parameter|unsupported/i.test(message)) throw e;
    includeThinkingParam = false;
    first = await chatAttempt(llm, system, user, signal, MAX_TOKENS, budget, false);
  }
  if (first.content) return first.content;
  if (first.reasoning && first.finishReason !== "length") return first.reasoning;
  // O erro da própria retentativa com orçamento grande (um 400 por passar do
  // limite de saída do modelo, por exemplo) não substitui o diagnóstico mais
  // preciso de "resposta vazia"; um cancelamento pedido pela pessoa interrompe
  // normalmente
  let retry: ChatAttempt | null = null;
  try {
    retry = await chatAttempt(llm, system, user, signal, RETRY_MAX_TOKENS, budget, includeThinkingParam);
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof LlmTransportError) throw e;
  }
  if (retry?.content) return retry.content;
  if (retry?.reasoning && retry.finishReason !== "length") return retry.reasoning;
  const filtered = first.finishReason === "content_filter" || retry?.finishReason === "content_filter";
  // Sem devolver reasoning ainda é possível que o modelo esteja pensando: alguns
  // provedores esconderam o rastro de raciocínio, mas com finish=length e conteúdo
  // vazio, o orçamento só pode ter sido consumido pelo pensamento
  const thinking =
    Boolean(first.reasoning || retry?.reasoning) ||
    first.finishReason === "length" ||
    retry?.finishReason === "length";
  const hint = filtered
    ? "O conteúdo foi bloqueado pela revisão de segurança do provedor; troque de provedor ou use outro material. / Blocked by the provider's content filter — try another provider or different footage."
    : thinking
      ? "O modelo atual é de \"raciocínio profundo\", e o próprio processo de pensar consumiu todo o orçamento de saída. Na lista de modelos, troque pela versão sem raciocínio dele (em geral com instruct ou chat no nome, ou com o raciocínio profundo desligável na plataforma), ou escolha um modelo de conversa comum. / This is a reasoning model that spends the whole output budget thinking — switch to its non-thinking variant (usually named instruct/chat) or a regular chat model."
      : "O provedor devolveu conteúdo vazio; você pode tentar de novo, e se continuar acontecendo, troque de modelo. / The provider returned empty content — retry, or switch models if it persists.";
  throw new Error(`O LLM não devolveu conteúdo / empty LLM response\n${hint}`);
}

/** Quantas tentativas no máximo para uma chamada que espera JSON (1 retentativa). */
export const JSON_ATTEMPTS = 2;

/**
 * Chamada que espera JSON: uma falha de leitura provoca uma nova tentativa.
 *
 * Por que isso é necessário: na prática, os provedores conhecidos **emitem de vez
 * em quando um token sujo no meio do JSON** — `"score": mais ou menos 90`,
 * `"endSegmentId": to 3`, `"momentId": vii` e `"score": —` já apareceram de
 * verdade, e por causa disso a resposta inteira deixa de ser JSON válido. Isso não
 * é algo que o prompt resolva (reenviar o mesmo prompt já vem limpo), e o preço de
 * não tentar de novo é a pessoa ver "a busca de destaques falhou" e perder a
 * rodada inteira.
 *
 * Só a falha de leitura é repetida; erros de rede e de autenticação são lançados
 * direto (repetir não resolveria), e um cancelamento da pessoa interrompe na hora.
 */
export async function chatCompleteJson<T>(
  llm: LlmConfig,
  system: string,
  user: string,
  parse: (content: string) => T,
  signal?: AbortSignal
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < JSON_ATTEMPTS; i++) {
    const content = await chatComplete(llm, system, user, signal);
    try {
      return parse(content);
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Lê o array parts da costura de vários trechos (ausente ou malformado conta como
 * não informado, voltando para trecho único).
 * Cada trecho só é aceito se tiver pelo menos a citação ou um id de frase válido;
 * os trechos que passam de MAX_PIECES são escolhidos por duração dentro de
 * normalizePieces, e aqui só existe o corte que evita volume excessivo.
 */
export function parseParts(raw: unknown): RawPart[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const out: RawPart[] = [];
  for (const p of raw.slice(0, MAX_PIECES * 2)) {
    if (typeof p !== "object" || p === null) continue;
    const o = p as Record<string, unknown>;
    const quoteStart = String(o.quoteStart ?? "").trim();
    const startSegmentId = Number(o.startSegmentId);
    const endSegmentId = Number(o.endSegmentId);
    if (!quoteStart && !Number.isFinite(startSegmentId)) continue;
    out.push({
      startSegmentId: Number.isFinite(startSegmentId) ? startSegmentId : -1,
      endSegmentId: Number.isFinite(endSegmentId) ? endSegmentId : -1,
      quoteStart,
      quoteEnd: String(o.quoteEnd ?? "").trim(),
    });
  }
  return out.length >= 2 ? out : undefined;
}

/** Lê e valida o JSON de clipes do LLM, transformando em RawSelections (as linhas malformadas são descartadas). */
export function parseSelections(content: string): RawSelection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    throw new Error(`O conteúdo devolvido pelo LLM não é JSON válido / invalid JSON: ${content.slice(0, 200)}`);
  }
  const clips = (parsed as { clips?: unknown[] })?.clips;
  if (!Array.isArray(clips)) throw new Error("A saída do LLM não tem o array clips / missing clips array");
  const out: RawSelection[] = [];
  for (const c of clips) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    const quoteStart = String(r.quoteStart ?? "").trim();
    const quoteEnd = String(r.quoteEnd ?? "").trim();
    const startSegmentId = Number(r.startSegmentId);
    const endSegmentId = Number(r.endSegmentId);
    if (!quoteStart && !Number.isFinite(startSegmentId)) continue;
    out.push({
      parts: parseParts(r.parts),
      title: String(r.title ?? "").trim() || "Trecho sem nome",
      hook: String(r.hook ?? "").trim(),
      score: Math.max(0, Math.min(100, Number(r.score) || 0)),
      reason: String(r.reason ?? "").trim(),
      startSegmentId: Number.isFinite(startSegmentId) ? startSegmentId : -1,
      endSegmentId: Number.isFinite(endSegmentId) ? endSegmentId : -1,
      quoteStart,
      quoteEnd,
      keywords: Array.isArray(r.keywords)
        ? r.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 8)
        : [],
    });
  }
  return out;
}

/** Uma escolha do canal de sinais: o LLM só informa o número do momento, sem citar a fala. */
export interface RawMomentPick {
  momentId: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
  keywords: string[];
}

/** Lê a saída do canal de sinais (as linhas malformadas são descartadas). */
export function parseMomentPicks(content: string): RawMomentPick[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    throw new Error(`O conteúdo devolvido pelo LLM não é JSON válido / invalid JSON: ${content.slice(0, 200)}`);
  }
  const clips = (parsed as { clips?: unknown[] })?.clips;
  if (!Array.isArray(clips)) throw new Error("A saída do LLM não tem o array clips / missing clips array");
  const out: RawMomentPick[] = [];
  for (const c of clips) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    const momentId = Number(r.momentId);
    if (!Number.isFinite(momentId)) continue;
    out.push({
      momentId,
      title: String(r.title ?? "").trim() || "Trecho sem nome",
      hook: String(r.hook ?? "").trim(),
      score: Math.max(0, Math.min(100, Number(r.score) || 0)),
      reason: String(r.reason ?? "").trim(),
      keywords: Array.isArray(r.keywords)
        ? r.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 8)
        : [],
    });
  }
  return out;
}

/** O texto das frases inteiras que caem em [startSec, endSec] (é o texto exibido dos candidatos vindos de sinal). */
export function textInRange(transcript: Transcript, startSec: number, endSec: number): string {
  return transcript.segments
    .filter((s) => s.endSec > startSec && s.startSec < endSec)
    .map((s) => s.text)
    .join(" ");
}

/**
 * Transforma as escolhas de momento do LLM em candidatos. O tempo vem
 * inteiramente dos sinais (sem nenhuma busca reversa), e boundary é marcado como
 * "signal" — a interface e o comprovante precisam deixar ver que este candidato
 * não foi cortado a partir da fala.
 */
export function momentsToCandidates(
  transcript: Transcript,
  moments: SignalMoment[],
  picks: RawMomentPick[]
): HighlightCandidate[] {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const out: HighlightCandidate[] = [];
  for (const p of picks) {
    const m = byId.get(p.momentId);
    if (!m) continue; // o número foi inventado, então é descartado — o tempo nunca é adivinhado
    const text = textInRange(transcript, m.startSec, m.endSec);
    out.push({
      id: out.length + 1,
      startSec: m.startSec,
      endSec: m.endSec,
      text,
      title: p.title,
      hook: p.hook,
      score: p.score,
      reason: p.reason,
      boundary: "signal",
      // As palavras-chave podem vir da descrição da imagem e não da fala, então aqui não existe o filtro de "precisa aparecer dentro do clipe"
      keywords: p.keywords,
      recommended: true,
      reviewNote: "",
      signalEvidence: m.evidence,
    });
  }
  return out;
}

export interface ScoreDims {
  hook: number;
  flow: number;
  value: number;
  trend: number;
}

export interface ReviewVerdict {
  id: number;
  keep: boolean;
  /** Os três níveis da porta de qualidade (v0.13). Quando um modelo antigo não devolve verdict, o nível é deduzido do keep (true → publish, false → o nível conservador review). */
  gate: GateTier;
  score: number;
  note: string;
  dims?: ScoreDims;
  dimNotes?: { hook: string; flow: string; value: string; trend: string };
  teaser?: string;
}

/** Hook rules the scroll; trend is the softest signal. */
const DIM_WEIGHTS: ScoreDims = { hook: 0.35, flow: 0.25, value: 0.25, trend: 0.15 };

/** Weighted composite of the four dimensions, 0-100. */
export function compositeScore(dims: ScoreDims): number {
  return Math.round(
    dims.hook * DIM_WEIGHTS.hook + dims.flow * DIM_WEIGHTS.flow + dims.value * DIM_WEIGHTS.value + dims.trend * DIM_WEIGHTS.trend
  );
}

/** Parse the stage-2 reviewer output (drops malformed rows). */
export function parseReviews(content: string): ReviewVerdict[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    throw new Error(`reviewer returned invalid JSON: ${content.slice(0, 200)}`);
  }
  const reviews = (parsed as { reviews?: unknown[] })?.reviews;
  if (!Array.isArray(reviews)) throw new Error("reviewer output missing reviews array");
  const out: ReviewVerdict[] = [];
  for (const r of reviews) {
    if (typeof r !== "object" || r === null) continue;
    const v = r as Record<string, unknown>;
    const id = Number(v.id);
    if (!Number.isFinite(id)) continue;
    const clamp = (x: unknown): number => Math.max(0, Math.min(100, Number(x) || 0));
    // four-dimension shape, with legacy single-score fallback
    const hasDims = ["hook", "flow", "value", "trend"].some((k) => Number.isFinite(Number(v[k])));
    const dims = hasDims
      ? { hook: clamp(v.hook), flow: clamp(v.flow), value: clamp(v.value), trend: clamp(v.trend) }
      : undefined;
    // Julgamento em três níveis: quando é inválido ou ausente, o nível é deduzido
    // do keep — keep=false vai para o conservador review
    // (modelos antigos nunca viram o campo verdict, então a recusa deles não pode
    // ser convertida direto em drop)
    const rawVerdict = String(v.verdict ?? "");
    const gate: GateTier =
      rawVerdict === "publish" || rawVerdict === "review" || rawVerdict === "drop"
        ? rawVerdict
        : v.keep !== false
          ? "publish"
          : "review";
    out.push({
      id,
      keep: gate === "publish",
      gate,
      score: dims ? compositeScore(dims) : clamp(v.score),
      note: String(v.note ?? "").trim(),
      dims,
      dimNotes: dims
        ? {
            hook: String(v.hookNote ?? "").trim(),
            flow: String(v.flowNote ?? "").trim(),
            value: String(v.valueNote ?? "").trim(),
            trend: String(v.trendNote ?? "").trim(),
          }
        : undefined,
      teaser: String(v.teaser ?? "").trim().slice(0, 30) || undefined,
    });
  }
  return out;
}

/** Merge verdicts onto candidates. Unreviewed ids stay recommended (fail-open). */
export function applyReviews(candidates: HighlightCandidate[], reviews: ReviewVerdict[]): HighlightCandidate[] {
  const byId = new Map(reviews.map((r) => [r.id, r]));
  return candidates.map((c) => {
    const r = byId.get(c.id);
    if (!r) return c;
    return {
      ...c,
      score: r.score || c.score,
      recommended: r.keep,
      reviewNote: r.note,
      // Os três níveis da porta de qualidade entram no candidato; o motivo de um drop precisa ficar visível (a interface mostra na área recolhida de descartados)
      gate: r.gate,
      gateNotes: r.note ? [r.note] : undefined,
      scoreDims: r.dims,
      dimNotes: r.dimNotes,
      teaser: r.teaser || undefined,
    };
  });
}

/**
 * Rank-normalise scores the way commercial tools do: the displayed number is
 * a RANK dressed as a score, which sidesteps LLM score drift between runs.
 * Recommended clips land in 76-99 (single clip → 97); rejected ones in 50-70
 * so they always sort below every recommended clip. Order is preserved.
 */
export function normalizeScores(candidates: HighlightCandidate[]): HighlightCandidate[] {
  const assign = (group: HighlightCandidate[], top: number, bottom: number, single: number): Map<number, number> => {
    const ranked = [...group].sort((a, b) => b.score - a.score);
    const m = new Map<number, number>();
    ranked.forEach((c, i) => {
      m.set(c.id, ranked.length === 1 ? single : Math.round(top - ((top - bottom) * i) / (ranked.length - 1)));
    });
    return m;
  };
  const rec = assign(candidates.filter((c) => c.recommended), 99, 76, 97);
  const rej = assign(candidates.filter((c) => !c.recommended), 70, 50, 62);
  return candidates.map((c) => ({ ...c, score: (c.recommended ? rec : rej).get(c.id) ?? c.score }));
}

/** O intervalo da origem que de fato é ocupado: numa costura de vários trechos é a comparação trecho a trecho, e fora disso é o intervalo inteiro. */
function occupiedRanges(c: HighlightCandidate): ClipPiece[] {
  return c.pieces && c.pieces.length > 1 ? c.pieces : [{ startSec: c.startSec, endSec: c.endSec }];
}

/**
 * Drop overlapping candidates, keeping higher scores (they arrive score-sorted).
 * Uma costura de vários trechos compara a sobreposição "trecho por trecho" — do
 * contrário, um clipe costurado que atravessa quinze minutos engoliria todos os
 * candidatos do meio, quando na verdade ele só ocupa dois trechos curtos.
 */
export function dropOverlaps(candidates: HighlightCandidate[]): HighlightCandidate[] {
  const kept: HighlightCandidate[] = [];
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    const mine = occupiedRanges(c);
    const overlaps = kept.some((k) =>
      occupiedRanges(k).some((b) => mine.some((a) => a.startSec < b.endSec && a.endSec > b.startSec))
    );
    if (!overlaps) kept.push(c);
  }
  return kept.sort((a, b) => a.startSec - b.startSec).map((c, i) => ({ ...c, id: i + 1 }));
}

export interface DetectOutcome {
  candidates: HighlightCandidate[];
  /** Estatística do funil quando a triagem local entra em ação; ausente quando não é usada ou quando volta ao texto completo. */
  funnel?: FunnelStats;
}

/** Full detection pass. */
/**
 * Junta de forma determinística os produtos nas keywords do candidato: só conta
 * quando o texto do clipe realmente os contém (em alfabeto latino, ignorando
 * maiúsculas), sem repetição e preservando a ordem — a ênfase de produto na
 * legenda de palavras-chave e as hashtags do texto de publicação se beneficiam
 * daqui. Função pura.
 */
export function mergeProductKeywords(keywords: string[], clipText: string, products: string[]): string[] {
  if (products.length === 0) return keywords;
  const lower = clipText.toLowerCase();
  const hits = products.map((p) => p.trim()).filter((p) => p && lower.includes(p.toLowerCase()));
  const seen = new Set(keywords.map((k) => k.toLowerCase()));
  return [...keywords, ...hits.filter((h) => !seen.has(h.toLowerCase()))];
}

export async function detectHighlights(
  transcript: Transcript,
  llm: LlmConfig,
  signal?: AbortSignal,
  signals?: MediaSignals,
  prefilter?: PrefilterConfig | null,
  length?: ClipLength,
  products?: string[],
  reference?: ReferenceProfile,
  reviewMemory?: ReviewRecord[],
  /** Critérios do gênero da transmissão (o id do preset interno mais o texto personalizado; veja core/genre.ts). */
  genre?: { id?: string; custom?: string },
  /** Briefing do usuário: o que procurar e o que excluir explicitamente (v0.13; veja prompt.briefSection). */
  brief?: { focus?: string; exclude?: string },
  /** O desempenho real das publicações que a pessoa importou (memória local; só o resumo de alto e baixo desempenho é injetado). */
  performanceMemory?: PerformanceEntry[]
): Promise<DetectOutcome> {
  if (transcript.segments.length === 0) return { candidates: [] };
  const pt = isPortugueseTranscript(transcript);

  // Marcação do pedido de corte de quem transmite (v0.13): "corta esse pedaço" ou
  // "clip that" é um destaque que a própria pessoa certificou, a varredura é só de
  // texto e custa zero, e todos os pontos de entrada (desktop, monitoramento, MCP)
  // ganham isso automaticamente. Como usar essa marca, que é atrasada, fica a cargo
  // do prompt (o conteúdo está antes do pedido).
  const commandMarks = detectClipCommands(transcript);
  if (commandMarks.length > 0) {
    signals = { loudPeaks: [], cutDense: [], ...signals, clipCommandMarks: commandMarks };
  }

  // Primeiro nível do funil de dois estágios: o modelo pequeno local delimita os
  // intervalos selecionados, e a nuvem só lê com atenção essa parte.
  // Qualquer falha volta em silêncio ao texto completo (a busca reversa continua
  // usando a transcrição inteira, então quem está adiante não sente nada).
  let promptTranscript = transcript;
  let funnel: FunnelStats | undefined;
  if (prefilter?.baseUrl && prefilter.model) {
    const local: LlmConfig = { baseUrl: prefilter.baseUrl, apiKey: "ollama", model: prefilter.model };
    const outcome = await prefilterTranscript(transcript, local, chatComplete, signal).catch((e) => {
      // Um cancelamento pedido de cima interrompe a detecção inteira; os outros erros voltam ao texto completo
      if (signal?.aborted) throw e;
      return null;
    });
    if (outcome) {
      promptTranscript = outcome.transcript;
      funnel = outcome.funnel;
    }
  }

  const selections = await chatCompleteJson(
    llm,
    highlightSystemPrompt(promptTranscript, length, products ?? [], reference, reviewMemory, genre, brief, performanceMemory),
    buildHighlightPrompt(promptTranscript, 6, signals),
    parseSelections,
    signal
  );

  const { lo, hi } = clipLengthBounds(length);
  const candidates: HighlightCandidate[] = [];
  for (const sel of selections) {
    const resolved = resolveSelection(transcript, sel);
    if (!resolved) continue;
    // A duração é contada como "duração do vídeo final": numa costura de vários
    // trechos é a soma deles, e não o intervalo (que pode ter quinze minutos)
    const dur = clipDurationSec(resolved);
    if (dur < lo || dur > hi) continue;
    candidates.push({
      id: candidates.length + 1,
      startSec: resolved.startSec,
      endSec: resolved.endSec,
      pieces: resolved.pieces,
      text: resolved.text,
      title: sel.title,
      hook: sel.hook,
      score: sel.score,
      reason: sel.reason,
      boundary: resolved.boundary,
      // keep only keywords the clip actually contains — hallucinated ones
      // de qualquer forma não faria nada na ênfase da legenda; o preenchimento
      // determinístico dos produtos encontrados (sem depender de o LLM lembrar de
      // escrever) beneficia tanto a legenda de palavras-chave quanto o texto de
      // publicação
      keywords: mergeProductKeywords(
        sel.keywords.filter((k) => resolved.text.toLowerCase().includes(k.toLowerCase())),
        resolved.text,
        products ?? []
      ),
      recommended: true,
      reviewNote: "",
    });
  }
  const textKept = dropOverlaps(candidates);

  // Canal guiado por sinal: nos gêneros em que a transcrição não tem conteúdo
  // (dança, pets, comida, rua, jogos, rádio…) não há como escolher nada citando a
  // fala, então a escolha passa a sair dos "momentos de alta energia" que vêm da
  // fusão dos sinais de imagem e som.
  // É fail-open: qualquer falha por aqui significa apenas ficar sem candidatos
  // extras, e nunca derruba o resultado do canal de texto.
  const evidence: EvidenceClass = genrePreset(normalizeGenreId(genre?.id)).evidence;
  const ratio = speechRatio(transcript);
  let momentKept: HighlightCandidate[] = [];
  if (signals && shouldRunMoments(evidence, ratio, textKept.length)) {
    momentKept = await detectMoments(transcript, llm, signals, evidence, length, signal).catch((e) => {
      if (signal?.aborted) throw e;
      return [];
    });
  }

  const kept = dropOverlaps([...textKept, ...momentKept]);
  if (kept.length === 0) return { candidates: kept, funnel };

  // Stage 2: adversarial review — a stricter pass judges each clip's hook,
  // completeness and standalone value; weak clips get flagged (not silently
  // dropped) so the UI can default-deselect them and hands-off mode skips
  // them. Fail-open: a broken review call must never take down detection.
  // O contexto da reavaliação usa a transcrição inteira (e não a que passou pelo funil) — quem revisa precisa ver o antes e o depois do trecho para não deixar passar uma distorção de sentido.
  //
  // Os candidatos vindos de sinal **não são enviados à reavaliação**: as quatro
  // dimensões dela (gancho, estrutura, valor e tendência) dão nota lendo o texto,
  // e usar isso para avaliar um trecho de dança ou de pets condenaria todos eles —
  // que são justamente os gêneros que este canal existe para salvar.
  // O applyReviews já mantém como estão os ids que não foram avaliados (fail-open),
  // então basta pular.
  // A camada de regras da porta de qualidade fecha a etapa: a checagem
  // determinística dos defeitos evidentes roda sempre, com ou sem reavaliação e
  // independente de ela dar certo
  // (só rebaixa até review e nunca dá drop; o fail-open está em gate.ts).
  // A densidade útil dá o bônus depois da reavaliação (que sobrescreve score) e antes da normalização (porque precisa afetar a ordenação).
  const finish = (list: HighlightCandidate[]): HighlightCandidate[] =>
    applyRuleGate(transcript, normalizeScores(applyUtilitySignal(list, pt)), pt);
  const reviewable = kept.filter((c) => c.boundary !== "signal");
  if (reviewable.length === 0) return { candidates: finish(kept), funnel };
  try {
    const reviews = await chatCompleteJson(
      llm,
      reviewSystemPrompt(transcript),
      buildReviewPrompt(transcript, reviewable),
      parseReviews,
      signal
    );
    return { candidates: finish(applyReviews(kept, reviews)), funnel };
  } catch {
    return { candidates: finish(kept), funnel };
  }
}

/**
 * O sinal do décimo caminho, a densidade útil (v0.14, função pura): mede nos
 * candidatos de texto a concentração de informação que "vale salvar"
 * (passos, listas, números concretos, método). Passando da linha, o candidato
 * recebe um pequeno bônus, é etiquetado como utility e ganha uma explicação a mais
 * na justificativa.
 * Base: a taxa de salvamento já é o primeiro peso (a avaliação lenta de 7 dias
 * olha salvamento e volta pela busca), e "ser útil" é uma dimensão diferente de
 * "ser espetacular" — a densidade é apenas um bônus e não derruba a ordenação por
 * potencial viral. Candidatos vindos de sinal são pulados (eles não se sustentam
 * pelo texto).
 */
export function applyUtilitySignal(candidates: HighlightCandidate[], pt: boolean): HighlightCandidate[] {
  return candidates.map((c) => {
    if (c.boundary === "signal") return c;
    const u = utilityDensity(c.text);
    if (u.score < UTILITY_SAVE_WORTHY) return c;
    const note = pt
      ? `densidade útil ${u.score}/10 (${u.hits.slice(0, 3).join(" / ")}), conteúdo que vale salvar`
      : `utility density ${u.score}/10 (${u.hits.slice(0, 3).join("/")}), save-worthy`;
    return {
      ...c,
      score: Math.min(99, c.score + utilityBoost(u.score)),
      utility: u,
      reason: c.reason ? `${c.reason};${note}` : note,
    };
  });
}

/**
 * Uma passagem de detecção pelo canal de sinais: os sinais fundidos dão os
 * momentos → o LLM escolhe pelo número → os escolhidos viram candidatos.
 * O tempo vem inteiramente dos sinais, e o LLM não precisa (nem tem permissão
 * para) citar a fala.
 */
export async function detectMoments(
  transcript: Transcript,
  llm: LlmConfig,
  signals: MediaSignals,
  evidence: EvidenceClass,
  length: ClipLength | undefined,
  signal?: AbortSignal
): Promise<HighlightCandidate[]> {
  const range = CLIP_LENGTH_RANGES[length ?? "standard"];
  // Chegar aqui com a classe words significa que o gatilho foi "fala de menos" ou
  // "o canal de texto não produziu nada", então o peso de reaction serve de reserva
  const weights = MOMENT_WEIGHTS[evidence === "visual" ? "visual" : "reaction"];
  // Todos os momentos que saíram da fusão são reduzidos por intensidade até o teto do prompt — dar opções demais faz o modelo entregar folha em branco
  const moments = topMoments(
    fuseMoments(signals, transcript.durationSec, {
      weights,
      minSec: range.minSec,
      maxSec: range.maxSec,
    })
  );
  if (moments.length === 0) return [];

  const pt = isPortugueseTranscript(transcript);
  const picks = await chatCompleteJson(
    llm,
    pt ? MOMENT_SYSTEM_PROMPT_PT : MOMENT_SYSTEM_PROMPT_EN,
    buildMomentPrompt(
      moments.map((m) => ({
        id: m.id,
        startSec: m.startSec,
        endSec: m.endSec,
        evidence: m.evidence,
        text: textInRange(transcript, m.startSec, m.endSec),
      })),
      4,
      pt
    ),
    parseMomentPicks,
    signal
  );
  return momentsToCandidates(transcript, moments, picks);
}
