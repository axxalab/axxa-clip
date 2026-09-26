/**
 * Tradução da legenda bilíngue: as frases inteiras (os segmentos) cobertas pelos trechos são traduzidas
 * em lote para o idioma de destino e queimadas na mesma tela numa trilha menor, à parte, junto da legenda
 * original — a forma padrão de quem leva vídeo curto para fora (o karaokê do original em cima e a frase
 * inteira traduzida embaixo).
 *
 * A tradução é por frase inteira, e não por linha de legenda: a frase tem contexto completo, a tradução
 * sai melhor e nada disso é afetado pela quebra de linha por palavra nem pelo rearranjo do corte seco.
 * Tudo falha em aberto: uma tradução que falha ou uma frase que falta significam só «esta frase ficou sem
 * tradução», nunca derrubar a exportação. As funções puras (coleta / leitura / aparo / remapeamento) são
 * testáveis, e a chamada ao LLM é injetada.
 */
import type { LlmConfig, Transcript } from "../shared/api-types";
import type { KeptSegment } from "./gaps";
import { stripThinkBlocks } from "./highlight/prefilter";

/** O teto de caracteres de um bloco de pedido de tradução (os blocos são formados por frases inteiras). */
export const TRANSLATE_CHUNK_CHARS = 1800;
/** O tempo limite de um bloco de tradução. */
export const TRANSLATE_TIMEOUT_MS = 90_000;
/** Uma linha traduzida mais curta que estes segundos não vale o piscar (depois do remapeamento, o corte seco pode ter reduzido a um instante). */
const MIN_LINE_SEC = 0.3;

/** Uma linha traduzida (na mesma base de tempo das palavras da legenda: sem corte seco, é o tempo absoluto do vídeo de origem). */
export interface TranslationLine {
  startSec: number;
  endSec: number;
  text: string;
}

/** A frase inteira a traduzir (o id vem do id do segmento da transcrição, único em todos os blocos). */
export interface TranslatableSegment {
  id: number;
  startSec: number;
  endSec: number;
  text: string;
}

/** O ponto de injeção, com a mesma forma do chatComplete de detect.ts. */
export type TranslateChatFn = (llm: LlmConfig, system: string, user: string, signal?: AbortSignal) => Promise<string>;

/** Junta as frases cobertas por todos os trechos (sem repetir segmento; o pad acomoda o deslocamento do encaixe de corte na exportação). */
export function collectClipSegments(
  transcript: Transcript,
  clips: Array<{ startSec: number; endSec: number }>,
  padSec = 1.5
): TranslatableSegment[] {
  const out: TranslatableSegment[] = [];
  const seen = new Set<number>();
  for (const seg of transcript.segments) {
    if (seen.has(seg.id) || !seg.text.trim()) continue;
    const hit = clips.some((c) => seg.endSec > c.startSec - padSec && seg.startSec < c.endSec + padSec);
    if (hit) {
      seen.add(seg.id);
      out.push({ id: seg.id, startSec: seg.startSec, endSec: seg.endSec, text: seg.text.trim() });
    }
  }
  return out;
}

const LANG_LABEL: Record<string, string> = { en: "inglês", es: "espanhol", pt: "português" };

export function translationSystemPrompt(targetLang: string): string {
  const label = LANG_LABEL[targetLang] ?? targetLang;
  return [
    `Você traduz legenda de vídeo curto. Traduza cada frase de legenda falada para ${label}.`,
    "Exigências: linguagem falada, curta e forte, boa de ler na legenda; mantenha o tom e os números; nome de marca e nome próprio não se traduz à força; não acrescente explicação.",
    'Devolva estritamente só JSON: {"lines":[{"id":1,"text":"tradução"}]}, com os id correspondendo um a um aos da entrada, e nada mais.',
  ].join("\n");
}

export function translationUserPrompt(segments: TranslatableSegment[]): string {
  return segments.map((s) => `[${s.id}] ${s.text}`).join("\n");
}

/** Lê a saída da tradução → id → texto traduzido; saída lixo devolve um Map vazio (falha em aberto para «sem tradução»). */
export function parseTranslationLines(content: string, validIds: Set<number>): Map<number, string> {
  const out = new Map<number, string>();
  const cleaned = stripThinkBlocks(content);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return out;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return out;
  }
  const lines = (obj as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return out;
  for (const l of lines) {
    const rec = l as { id?: unknown; text?: unknown };
    const id = Number(rec.id);
    if (Number.isInteger(id) && validIds.has(id) && typeof rec.text === "string" && rec.text.trim()) {
      out.set(id, rec.text.trim());
    }
  }
  return out;
}

/** Divide as frases em blocos pelo orçamento de caracteres (sempre por frase inteira). */
export function chunkForTranslate(segments: TranslatableSegment[], targetChars = TRANSLATE_CHUNK_CHARS): TranslatableSegment[][] {
  const chunks: TranslatableSegment[][] = [];
  let cur: TranslatableSegment[] = [];
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

/**
 * Tradução em lote. Cada bloco é uma chamada, e a falha de um bloco só perde a tradução daquele bloco
 * (falha em aberto); se todos falharem, devolve null (e quem chama registra no recibo que não houve
 * tradução). Um cancelamento vindo de cima é relançado como veio.
 */
export async function translateSegments(
  segments: TranslatableSegment[],
  targetLang: string,
  llm: LlmConfig,
  chat: TranslateChatFn,
  signal?: AbortSignal
): Promise<Map<number, string> | null> {
  if (segments.length === 0) return null;
  const system = translationSystemPrompt(targetLang);
  const result = new Map<number, string>();
  let anySucceeded = false;
  for (const chunk of chunkForTranslate(segments)) {
    try {
      const timeout = AbortSignal.timeout(TRANSLATE_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const content = await chat(llm, system, translationUserPrompt(chunk), combined);
      const parsed = parseTranslationLines(content, new Set(chunk.map((s) => s.id)));
      if (parsed.size > 0) anySucceeded = true;
      for (const [id, text] of parsed) result.set(id, text);
    } catch (e) {
      if (signal?.aborted) throw e; // um cancelamento pedido de cima interrompe a exportação inteira
      // Este bloco ficou sem tradução; segue para o próximo
    }
  }
  return anySucceeded ? result : null;
}

/** Pega as linhas traduzidas das frases que caem dentro do trecho, com o tempo aparado no intervalo do trecho (tempo absoluto do vídeo de origem). */
export function clipTranslationLines(
  segments: TranslatableSegment[],
  translations: Map<number, string>,
  clipStartSec: number,
  clipEndSec: number
): TranslationLine[] {
  const out: TranslationLine[] = [];
  for (const s of segments) {
    const text = translations.get(s.id);
    if (!text) continue;
    if (s.endSec <= clipStartSec || s.startSec >= clipEndSec) continue;
    const startSec = Math.max(s.startSec, clipStartSec);
    const endSec = Math.min(s.endSec, clipEndSec);
    if (endSec - startSec >= MIN_LINE_SEC) out.push({ startSec, endSec, text });
  }
  return out;
}

/** Apara as linhas traduzidas no intervalo final do trecho (que o encaixe de corte pode ter deslocado) e descarta as curtas demais. */
export function clampTranslationLines(lines: TranslationLine[], clipStartSec: number, clipEndSec: number): TranslationLine[] {
  const out: TranslationLine[] = [];
  for (const l of lines) {
    const startSec = Math.max(l.startSec, clipStartSec);
    const endSec = Math.min(l.endSec, clipEndSec);
    if (endSec - startSec >= MIN_LINE_SEC) out.push({ startSec, endSec, text: l.text });
  }
  return out;
}

/**
 * Remapeamento do corte seco: as linhas traduzidas, em tempo de origem, são mapeadas para a linha de
 * tempo comprimida da saída.
 * Uma linha pode ter o meio cortado — o jeito conservador é tomar o começo e o fim da interseção dela com
 * cada intervalo preservado, e a linha que cai inteira numa região cortada é simplesmente descartada.
 */
export function remapTranslationLines(lines: TranslationLine[], kept: KeptSegment[]): TranslationLine[] {
  const out: TranslationLine[] = [];
  for (const line of lines) {
    let outStart: number | null = null;
    let outEnd: number | null = null;
    let offset = 0;
    for (const seg of kept) {
      const from = Math.max(line.startSec, seg.startSec);
      const to = Math.min(line.endSec, seg.endSec);
      if (to > from) {
        const os = offset + (from - seg.startSec);
        const oe = offset + (to - seg.startSec);
        if (outStart === null) outStart = os;
        outEnd = oe;
      }
      offset += seg.endSec - seg.startSec;
    }
    if (outStart !== null && outEnd !== null && outEnd - outStart >= MIN_LINE_SEC) {
      out.push({ startSec: outStart, endSec: outEnd, text: line.text });
    }
  }
  return out;
}
