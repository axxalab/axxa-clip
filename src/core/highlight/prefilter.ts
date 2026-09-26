/**
 * Funil local de dois níveis · primeiro nível: um modelo pequeno rodando na
 * máquina (Ollama e outros endpoints compatíveis com OpenAI) lê o texto inteiro
 * primeiro e delimita os intervalos de frases que "podem ter um destaque"; o
 * modelo grande na nuvem só lê com atenção a parte selecionada (segundo nível).
 * Em vídeos longos, o gasto de tokens na nuvem cai uma ordem de grandeza.
 * Regra de ferro, fail-open: endpoint local inalcançável, tempo esgotado ou
 * saída impossível de interpretar levam, em silêncio, de volta ao envio do texto
 * completo — o funil só economiza dinheiro, nunca leva a culpa.
 */
import type { Transcript, TranscriptSegment } from "../transcribe/types";
import type { LlmConfig, FunnelStats } from "../../shared/api-types";
import { isPortugueseTranscript } from "./prompt";

/** Abaixo desta quantidade de caracteres o funil não é usado — uma transcrição curta enviada direto para a nuvem sai mais precisa e mais rápida. */
export const PREFILTER_MIN_CHARS = 3000;
/** Quantidade de caracteres que cada bloco enviado ao modelo pequeno deve ter (o contexto de um modelo pequeno é curto, então os blocos precisam ser pequenos). */
export const CHUNK_TARGET_CHARS = 2600;
/** Quantas frases a janela selecionada se estende para cada lado (deixa contexto para a nuvem e evita cortar fora a preparação do gancho). */
export const WINDOW_PAD_SEGMENTS = 2;
/** Tempo total de toda a pré-seleção; esgotado, volta ao texto completo (um modelo local lento não pode travar a cadeia inteira). */
export const PREFILTER_TIMEOUT_MS = 120_000;
/** O modelo desta máquina só admite poucas requisições em andamento; em transcrições longas, os demais blocos entram na fila. */
export const PREFILTER_CONCURRENCY = 2;

/** Ponto de injeção com o mesmo formato de chatComplete (evita dependência circular com detect.ts e facilita o teste). */
export type ChatFn = (llm: LlmConfig, system: string, user: string, signal?: AbortSignal) => Promise<string>;

/** Divide a transcrição frase a frase em blocos por contagem de caracteres (a unidade é a frase inteira, que nunca é partida). */
export function chunkSegments(segments: TranscriptSegment[], targetChars = CHUNK_TARGET_CHARS): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = [];
  let cur: TranscriptSegment[] = [];
  let chars = 0;
  for (const s of segments) {
    if (cur.length > 0 && chars + s.text.length > targetChars) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += s.text.length;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/** Remove os blocos de raciocínio (modelos pequenos de raciocínio como o qwen3 imprimem <think>…</think> antes de entregar o JSON). */
export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export interface IdWindow {
  start: number;
  end: number;
}

/** Interpreta os intervalos selecionados que o modelo pequeno devolveu; mantém apenas as janelas cujos dois ids realmente existem. */
export function parseWindows(content: string, validIds: Set<number>): IdWindow[] {
  let parsed: unknown;
  try {
    const cleaned = stripThinkBlocks(content);
    const brace = cleaned.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(brace ? brace[0] : cleaned);
  } catch {
    throw new Error("prefilter returned unparseable output");
  }
  const windows = (parsed as { windows?: unknown[] })?.windows;
  if (!Array.isArray(windows)) throw new Error("prefilter output missing windows array");
  const out: IdWindow[] = [];
  for (const w of windows) {
    if (typeof w !== "object" || w === null) continue;
    const r = w as Record<string, unknown>;
    let start = Number(r.start);
    let end = Number(r.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start > end) [start, end] = [end, start];
    if (!validIds.has(start) || !validIds.has(end)) continue;
    out.push({ start, end });
  }
  return out;
}

/**
 * Organização das janelas: expande pad frases para cada lado seguindo a ordem
 * das frases no texto completo (os ids podem não ser contínuos, então a expansão
 * é feita por posição) e depois funde as janelas sobrepostas ou vizinhas,
 * devolvendo o conjunto de ids das frases selecionadas.
 */
export function expandAndMergeWindows(
  windows: IdWindow[],
  orderedIds: number[],
  padSegments = WINDOW_PAD_SEGMENTS
): Set<number> {
  const pos = new Map(orderedIds.map((id, i) => [id, i]));
  const kept = new Set<number>();
  for (const w of windows) {
    const a = pos.get(w.start);
    const b = pos.get(w.end);
    if (a === undefined || b === undefined) continue;
    const from = Math.max(0, Math.min(a, b) - padSegments);
    const to = Math.min(orderedIds.length - 1, Math.max(a, b) + padSegments);
    for (let i = from; i <= to; i++) kept.add(orderedIds[i]);
  }
  return kept;
}

/** Mantém apenas a transcrição das frases selecionadas (os ids são preservados como estão — um id citado pela nuvem continua localizável no texto completo). */
export function filterTranscriptByIds(transcript: Transcript, keptIds: Set<number>): Transcript {
  return { ...transcript, segments: transcript.segments.filter((s) => keptIds.has(s.id)) };
}

export function funnelStats(full: Transcript, filtered: Transcript): FunnelStats {
  const chars = (t: Transcript): number => t.segments.reduce((n, s) => n + s.text.length, 0);
  return {
    totalSegments: full.segments.length,
    keptSegments: filtered.segments.length,
    totalChars: chars(full),
    keptChars: chars(filtered),
  };
}

/** Prompt de sistema da pré-seleção: tarefa estreita e formato de saída mínimo — só assim um modelo pequeno dá conta. */
export function prefilterSystemPrompt(pt: boolean): string {
  return pt
    ? `Você é o responsável pela primeira triagem de cortes para vídeo curto. Você recebe parte da transcrição frase a frase de um vídeo longo, uma linha por frase, no formato [id] conteúdo. Marque os intervalos de frases que PODERIAM virar um corte viral: conflito, suspense, frase marcante, explosão de emoção, reviravolta, conteúdo denso e útil. É melhor incluir demais do que deixar passar — os intervalos que você marcar vão para um modelo mais forte fazer a escolha final, e o que você pular some para sempre. Cada intervalo tem de 2 a 10 frases. Responda com JSON estrito e nada mais: {"windows":[{"start":id_da_primeira,"end":id_da_ultima}]}. Se nada se qualificar, responda {"windows":[]}. Nenhum outro texto.`
    : `You are a first-pass screener for short-video clipping. You get part of a long-video transcript, one line per sentence: [id] text. Mark sentence ranges that COULD become viral clips: conflict, suspense, quotable lines, emotional peaks, twists, dense insight. Over-include rather than miss — your ranges go to a stronger model for final picking; anything you skip is gone forever. Each range spans 2-10 sentences. Output STRICT JSON only: {"windows":[{"start":firstId,"end":lastId}]}. If nothing qualifies output {"windows":[]}. No other text.`;
}

/** Prompt de usuário de cada bloco. A família qwen3 recebe /no_think no final para desligar o fluxo de raciocínio (os demais modelos não recebem). */
export function prefilterUserPrompt(chunk: TranscriptSegment[], pt: boolean, model: string): string {
  const lines = chunk.map((s) => `[${s.id}] ${s.text}`).join("\n");
  const noThink = /qwen3/i.test(model) ? "\n/no_think" : "";
  return (pt ? `A transcrição frase a frase é esta:\n${lines}` : `Transcript chunk:\n${lines}`) + noThink;
}

export interface PrefilterOutcome {
  transcript: Transcript;
  funnel: FunnelStats;
}

/**
 * Executa o primeiro nível inteiro do funil. Devolver null significa "não use o
 * funil / não é confiável, use o texto completo": transcrição curta demais,
 * todos os endpoints fora do ar, tempo esgotado, ou o modelo pequeno afirmando
 * que o texto inteiro não tem destaque nenhum (o que não é confiável: melhor
 * gastar do que deixar passar).
 * A falha de um bloco não é fatal — aquele bloco inteiro entra na seleção
 * (fail-open para "gastar um pouco mais", e não para "perder conteúdo").
 */
export async function prefilterTranscript(
  transcript: Transcript,
  local: LlmConfig,
  chat: ChatFn,
  signal?: AbortSignal
): Promise<PrefilterOutcome | null> {
  signal?.throwIfAborted();
  const totalChars = transcript.segments.reduce((n, s) => n + s.text.length, 0);
  if (totalChars < PREFILTER_MIN_CHARS) return null;

  const pt = isPortugueseTranscript(transcript);
  const chunks = chunkSegments(transcript.segments);
  const orderedIds = transcript.segments.map((s) => s.id);
  const validIds = new Set(orderedIds);
  const system = prefilterSystemPrompt(pt);

  // Tempo total combinado com o sinal de cancelamento vindo de cima; esgotado o tempo, todas as requisições em andamento são encerradas juntas
  const timeout = AbortSignal.timeout(PREFILTER_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let anySucceeded = false;
  const windows: IdWindow[] = [];
  // Blocos que não começaram ou que falharam são mantidos por inteiro; quando o tempo se esgota o despacho para, e nada que não foi lido pode ser descartado.
  const results = chunks.map((chunk) => ({
    windows: [{ start: chunk[0].id, end: chunk[chunk.length - 1].id }], failed: true,
  }));
  let nextChunk = 0;
  await Promise.all(
    Array.from({ length: Math.min(PREFILTER_CONCURRENCY, chunks.length) }, async () => {
      while (!combined.aborted && nextChunk < chunks.length) {
        const index = nextChunk++;
        const chunk = chunks[index];
        try {
          const content = await chat(local, system, prefilterUserPrompt(chunk, pt, local.model), combined);
          if (!combined.aborted) results[index] = { windows: parseWindows(content, validIds), failed: false };
        } catch {
          // Mantém o bloco inteiro e deixa para a etapa seguinte.
        }
      }
    })
  );
  for (const r of results) {
    if (!r.failed) anySucceeded = true;
    windows.push(...r.windows);
  }
  // Um cancelamento pedido de cima precisa ser propagado, e não engolido como "volta ao texto completo"
  signal?.throwIfAborted();
  if (!anySucceeded) return null; // nenhum endpoint disponível → o funil não entra em ação
  if (windows.length === 0) return null; // o modelo pequeno dizer "não há destaque nenhum" não é confiável → envia o texto completo

  const keptIds = expandAndMergeWindows(windows, orderedIds);
  const filtered = filterTranscriptByIds(transcript, keptIds);
  // Se pouca coisa foi filtrada (85% ou mais preservado), não compensa usar o funil: vai o texto completo — o que também é honesto na estatística
  if (filtered.segments.length >= transcript.segments.length * 0.85) return null;
  return { transcript: filtered, funnel: funnelStats(transcript, filtered) };
}
