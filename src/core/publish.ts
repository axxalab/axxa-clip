/**
 * Geração do texto de publicação: para cada clipe, gera em lote um "título de
 * publicação + hashtags + duas frases de descrição", salvos num .post.txt ao lado
 * do mp4 (para quem cria só copiar e colar) e gravados no clips.json — é o último
 * quilômetro do "cortou, já publica": o vídeo existe, mas falta o que escrever no
 * campo de publicação.
 *
 * Todo o material vem da cadeia de evidências da etapa de detecção (título,
 * gancho, texto e palavras-chave), e uma única chamada ao LLM gera tudo para os
 * clipes selecionados. É fail-open: uma geração que falha ou um item que falta
 * significam apenas ficar sem texto, e nunca travar a exportação. As funções puras
 * (prompt, leitura e montagem) são testáveis; a chamada ao LLM é injetada.
 */
import type { LlmConfig } from "../shared/api-types";
import { stripThinkBlocks } from "./highlight/prefilter";
import { ctaMenu, hookAngleMenu, isCtaType, isHookAngle, type CtaTypeId, type HookAngleId } from "./copy-templates";

/** O texto de publicação de um clipe. */
export interface PublishCopy {
  /** Título de publicação (no estilo da plataforma, com gancho, até 60 caracteres). */
  title: string;
  /** Hashtags (com o # na frente, de 3 a 6). */
  hashtags: string[];
  /** Uma ou duas frases de descrição (completam o gancho e convidam à interação). */
  description: string;
  /** O ângulo de gancho que o título usou (menu de copy-templates; ausente significa dado antigo ou que o modelo não marcou). */
  angle?: HookAngleId;
  /** A chamada final em uma frase (na cópia, ela vai logo depois da descrição). */
  cta?: string;
  /** Tipo de CTA (menu de copy-templates). */
  ctaType?: CtaTypeId;
}

/** Entrada da geração: o material da cadeia de evidências de cada clipe. */
export interface PublishSource {
  id: number;
  title: string;
  hook: string;
  /** O texto de dentro do clipe (o que passar do limite é truncado). */
  text: string;
  keywords: string[];
  /** A densidade útil passou da linha (v0.14): o texto deve mirar salvamento e busca (CTA de salvar, título em formato de busca). */
  saveWorthy?: boolean;
}

/** Ponto de injeção com o mesmo formato do chatComplete de detect.ts. */
export type PublishChatFn = (llm: LlmConfig, system: string, user: string, signal?: AbortSignal) => Promise<string>;

/** Tempo máximo de uma geração. */
export const PUBLISH_TIMEOUT_MS = 90_000;
/** Tamanho em que o texto de apoio é truncado (o material principal é o título, o gancho e as palavras-chave; o texto só acrescenta contexto). */
const TEXT_EXCERPT_CHARS = 300;
const MAX_HASHTAGS = 6;

export function publishSystemPrompt(pt: boolean): string {
  if (pt) {
    return [
      "Você é responsável pelas redes de um canal de vídeo curto e escreve o texto de publicação de cada clipe (serve para TikTok, Reels, Shorts e Kwai).",
      "Para cada clipe, produza: title = o título da publicação (até 60 caracteres, e não copie o nome do clipe literalmente). Antes de escrever, escolha no menu de ângulos de gancho o que mais combina com o conteúdo, e varie os ângulos ao longo do lote, em vez de repetir a mesma fórmula em todos:",
      hookAngleMenu(true),
      // Alinhamento com os algoritmos de 2026: salvamento e busca são o que mais
      // pesa — então o título carrega as palavras que o público digitaria, e o CTA
      // de conteúdo útil mira salvamento e playlist
      "[Pontos dos algoritmos em 2026] Hoje as plataformas dão o maior peso à taxa de salvamento e à busca: escreva o título de preferência como \"a pergunta ou a expressão que o público digitaria no campo de busca\" (embuta no título os nomes e os números concretos que aparecem no clipe, em vez de só palavras de emoção); nos clipes marcados com [vale salvar], ctaType precisa ser save, o CTA precisa convidar a \"salvar para depois\" ou apontar \"mais conteúdo dessa transmissão na playlist do perfil\", e o título vai no formato de conteúdo útil.",
      "hashtags = de 3 a 6 hashtags (com #, priorizando os termos do nicho e no máximo um termo genérico);",
      "description = uma ou duas frases de descrição (até 120 caracteres, completando o gancho ou o contexto, sem encher de emoji);",
      "cta = uma frase de chamada final (até 40 caracteres), com o tipo escolhido no menu de acordo com o conteúdo:",
      ctaMenu(true),
      'Responda com JSON estrito e nada mais: {"posts":[{"id":1,"angle":"question","title":"…","hashtags":["#…"],"description":"…","ctaType":"comment","cta":"…"}]}, com os ids correspondendo um a um à entrada e angle e ctaType sempre vindos dos ids dos menus.',
    ].join("\n");
  }
  return [
    "You are a short-video social manager writing post copy for each clip (TikTok/Shorts/Reels).",
    "For each clip output: title = a post title (≤ 60 chars, don't copy the clip name verbatim). Pick the best-fitting hook angle from this menu first, and vary angles across the batch:",
    hookAngleMenu(false),
    "[2026 algorithm notes] Saves and search now carry the most weight: prefer titles phrased as what viewers would type into search (embed the clip's concrete nouns/numbers, not just emotion words); clips tagged [save-worthy] must use ctaType=save with a 'save this for later' CTA and a how-to style title.",
    "hashtags = 3-6 tags (with #, niche terms first, at most one generic tag);",
    "description = one or two sentences (≤ 120 chars, extend the hook, no emoji spam);",
    "cta = one closing call-to-action line (≤ 40 chars), typed from this menu to match the content:",
    ctaMenu(false),
    'Output STRICT JSON only: {"posts":[{"id":1,"angle":"question","title":"…","hashtags":["#…"],"description":"…","ctaType":"comment","cta":"…"}]}, ids matching the input, angle/ctaType from the menus.',
  ].join("\n");
}

export function publishUserPrompt(sources: PublishSource[]): string {
  return sources
    .map((s) => {
      const kw = s.keywords.length > 0 ? ` Palavras-chave: ${s.keywords.join(" / ")}` : "";
      const save = s.saveWorthy ? " [vale salvar]" : "";
      return `[${s.id}]${save} Nome do clipe: ${s.title} · Gancho: ${s.hook}${kw}\nTrecho do texto: ${s.text.slice(0, TEXT_EXCERPT_CHARS)}`;
    })
    .join("\n\n");
}

/**
 * Lê os campos do texto a partir de um objeto de saída do LLM (title é
 * obrigatório, e o resto é validado conforme o acordado).
 * O texto de publicação e as várias versões (variants.ts) usam o mesmo conjunto de
 * campos.
 */
export function parsePostFields(p: unknown): PublishCopy | null {
  const rec = p as {
    title?: unknown; hashtags?: unknown; description?: unknown;
    angle?: unknown; cta?: unknown; ctaType?: unknown;
  } | null;
  if (!rec || typeof rec.title !== "string" || !rec.title.trim()) return null;
  const hashtags = Array.isArray(rec.hashtags)
    ? rec.hashtags
        .filter((h): h is string => typeof h === "string" && h.trim().length > 1)
        .map((h) => (h.trim().startsWith("#") ? h.trim() : `#${h.trim()}`))
        .slice(0, MAX_HASHTAGS)
    : [];
  // Ângulo e tipo de CTA: valores fora do menu são simplesmente descartados (fail-open para "não marcado"), sem adivinhar nem reescrever
  const cta = typeof rec.cta === "string" && rec.cta.trim() ? rec.cta.trim() : undefined;
  return {
    title: rec.title.trim(),
    hashtags,
    description: typeof rec.description === "string" ? rec.description.trim() : "",
    ...(isHookAngle(rec.angle) ? { angle: rec.angle } : {}),
    ...(cta ? { cta } : {}),
    ...(cta && isCtaType(rec.ctaType) ? { ctaType: rec.ctaType } : {}),
  };
}

/** Lê a saída da geração → um mapa de id para texto; saída inaproveitável devolve um Map vazio (fail-open para "sem texto"). */
export function parsePublishCopies(content: string, validIds: Set<number>): Map<number, PublishCopy> {
  const out = new Map<number, PublishCopy>();
  const cleaned = stripThinkBlocks(content);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return out;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return out;
  }
  const posts = (obj as { posts?: unknown }).posts;
  if (!Array.isArray(posts)) return out;
  for (const p of posts) {
    const rec = p as { id?: unknown };
    const id = Number(rec.id);
    if (!Number.isInteger(id) || !validIds.has(id)) continue;
    const copy = parsePostFields(p);
    if (copy) out.set(id, copy);
  }
  return out;
}

/**
 * Gera o texto de publicação em lote. É fail-open: em caso de falha devolve null
 * (e quem chamou, por isso, não escreve o arquivo de texto); um cancelamento vindo
 * de cima é propagado como está.
 */
export async function generatePublishCopies(
  sources: PublishSource[],
  pt: boolean,
  llm: LlmConfig,
  chat: PublishChatFn,
  signal?: AbortSignal
): Promise<Map<number, PublishCopy> | null> {
  if (sources.length === 0) return null;
  try {
    const timeout = AbortSignal.timeout(PUBLISH_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const content = await chat(llm, publishSystemPrompt(pt), publishUserPrompt(sources), combined);
    const parsed = parsePublishCopies(content, new Set(sources.map((s) => s.id)));
    return parsed.size > 0 ? parsed : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/** Conteúdo do .post.txt: título + linha em branco + hashtags + linha em branco + descrição (com o CTA na linha seguinte à descrição), pronto para selecionar tudo e copiar. */
export function postTextFile(copy: PublishCopy, aigc = false): string {
  const parts = [copy.title];
  if (copy.hashtags.length > 0) parts.push(copy.hashtags.join(" "));
  const body = [copy.description, copy.cta ?? ""].filter(Boolean).join("\n");
  if (body) parts.push(body);
  // Com o selo de conteúdo por IA ligado: um aviso geral (as instruções específicas de cada plataforma estão no manifesto e no texto do pacote de publicação)
  if (aigc) parts.push("[Sinalização de conteúdo por IA] Ao publicar, marque a declaração de conteúdo gerado por IA conforme a exigência da plataforma (a punição máxima por não sinalizar é a perda da conta)");
  return parts.join("\n\n") + "\n";
}
