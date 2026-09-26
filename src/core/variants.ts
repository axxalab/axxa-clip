/**
 * Várias versões de um mesmo clipe: o mesmo corte ganha N embalagens diferentes —
 * cartelas de título com ângulos de gancho diferentes, frases de suspense na
 * abertura e textos de publicação distintos, com a capa tirada de outro pico de
 * volume. Ao distribuir o mesmo conteúdo em várias contas, o que sustenta isso é a
 * "diferença de verdade" (ângulo, título, capa e texto todos diferentes), e não a
 * remoção de duplicidade no nível do pixel (perder quadros ou espelhar já é
 * explicitamente julgado como reupload pelas plataformas).
 *
 * Uma única chamada ao LLM produz o plano de todas as versões do lote inteiro; é
 * fail-open — uma geração que falha significa apenas ficar sem versões, e nunca
 * derruba a exportação. A lógica de expansão (plano → as especificações de
 * exportação acrescentadas) é de funções puras e testável.
 */
import type { LlmConfig } from "../shared/api-types";
import { stripThinkBlocks } from "./highlight/prefilter";
import { hookAngleMenu, ctaMenu } from "./copy-templates";
import { parsePostFields, publishUserPrompt, type PublishCopy, type PublishSource, type PublishChatFn } from "./publish";
import type { ExportClipSpec } from "./export";

/** Teto do total de versões (incluindo a original): 3 versões já cobrem a prática mais comum, de "três contas publicando em horários diferentes". */
export const VARIANT_TOTAL_MAX = 3;
/** Tempo máximo de uma geração (o lote inteiro numa chamada). */
export const VARIANTS_TIMEOUT_MS = 120_000;
/** Quantas vezes reenviar quando a leitura falha (mesmo critério do JSON_ATTEMPTS de detect: o token sujo esporádico). */
const ATTEMPTS = 2;

/** Uma embalagem de versão. */
export interface VariantPackaging {
  /** Título da cartela (queimado na imagem e usado também como nome de arquivo). */
  title: string;
  /** Frase de suspense da abertura (em letras grandes nos 3 segundos de ouro); o modelo omite quando não consegue pensar numa que sirva. */
  teaser?: string;
  /** O texto de publicação desta versão (título, hashtags, descrição e CTA). */
  post?: PublishCopy;
}

export function variantSystemPrompt(pt: boolean, extraCount: number): string {
  if (pt) {
    return [
      "Você é responsável pelas redes de um canal de vídeo curto. O mesmo corte vai ser publicado em várias contas, e cada conta precisa de uma embalagem diferente — não é reescrever com sinônimos, é reembalar o mesmo conteúdo a partir de outro ângulo de gancho.",
      `Para cada clipe, além da versão original, entregue ${extraCount} embalagens, e em cada uma produza:`,
      "title = o título da cartela queimado na imagem (até 40 caracteres, obrigatoriamente com outro ângulo, e não o título original com outras palavras);",
      "teaser = a frase de suspense da abertura (até 36 caracteres, em letras grandes sobre o começo; se não conseguir pensar numa que sirva, omita este campo);",
      "post = o objeto do texto de publicação: {title: título de publicação de até 60 caracteres, hashtags: de 3 a 6 com #, description: descrição de até 120 caracteres, cta: chamada final de até 40 caracteres, angle/ctaType: escolhidos nos menus}.",
      "Menu de ângulos de gancho:",
      hookAngleMenu(true),
      "Menu de CTA:",
      ctaMenu(true),
      "As versões de um mesmo clipe precisam usar angle diferentes entre si, e diferentes também do ângulo do título original.",
      'Responda com JSON estrito e nada mais: {"clips":[{"id":1,"variants":[{"title":"…","teaser":"…","post":{"title":"…","hashtags":["#…"],"description":"…","angle":"question","cta":"…","ctaType":"comment"}}]}]}'
    ].join("\n");
  }
  return [
    "You are a short-video social manager. The same clip goes out on multiple accounts, each needing a genuinely different packaging — a different hook angle, not a paraphrase.",
    `For each clip give ${extraCount} extra packaging(s) besides the original. Each one outputs:`,
    "title = on-screen title card (≤ 40 chars, must take a different angle);",
    "teaser = opening hook line (≤ 36 chars; omit the field if nothing fits);",
    "post = post copy object: {title ≤ 60 chars, hashtags: 3-6 with #, description ≤ 120 chars, cta ≤ 40 chars, angle/ctaType from the menus}.",
    "Hook angle menu:",
    hookAngleMenu(false),
    "CTA menu:",
    ctaMenu(false),
    "Variants of one clip must use different angles from each other and from the original title.",
    'Output STRICT JSON only: {"clips":[{"id":1,"variants":[{"title":"…","teaser":"…","post":{…}}]}]}',
  ].join("\n");
}

/**
 * Lê o plano de versões. Quando o conjunto não é JSON, lança erro (e a camada acima
 * usa isso para reenviar uma vez); uma linha isolada com lixo é descartada em
 * silêncio. A quantidade de versões de cada clipe é cortada em perClipMax.
 */
export function parseVariantPlans(
  content: string,
  validIds: Set<number>,
  perClipMax: number
): Map<number, VariantPackaging[]> {
  const cleaned = stripThinkBlocks(content);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("variants: no JSON in response");
  const obj = JSON.parse(match[0]) as { clips?: unknown };
  const out = new Map<number, VariantPackaging[]>();
  if (!Array.isArray(obj.clips)) return out;
  for (const c of obj.clips) {
    const rec = c as { id?: unknown; variants?: unknown };
    const id = Number(rec.id);
    if (!Number.isInteger(id) || !validIds.has(id) || !Array.isArray(rec.variants)) continue;
    const list: VariantPackaging[] = [];
    for (const v of rec.variants) {
      const vr = v as { title?: unknown; teaser?: unknown; post?: unknown };
      if (typeof vr.title !== "string" || !vr.title.trim()) continue;
      const teaser = typeof vr.teaser === "string" && vr.teaser.trim() ? vr.teaser.trim() : undefined;
      const post = parsePostFields(vr.post) ?? undefined;
      list.push({ title: vr.title.trim(), ...(teaser ? { teaser } : {}), ...(post ? { post } : {}) });
      if (list.length >= perClipMax) break;
    }
    if (list.length > 0) out.set(id, list);
  }
  return out;
}

/**
 * Gera o plano de versões (o lote inteiro numa chamada). É fail-open: falha ou saída
 * inaproveitável devolvem null; um cancelamento vindo de cima é propagado como está.
 * totalCount é o total de versões incluindo a original (2 ou 3).
 */
export async function generateVariantPlans(
  sources: PublishSource[],
  totalCount: number,
  pt: boolean,
  llm: LlmConfig,
  chat: PublishChatFn,
  signal?: AbortSignal
): Promise<Map<number, VariantPackaging[]> | null> {
  const extra = Math.min(totalCount, VARIANT_TOTAL_MAX) - 1;
  if (sources.length === 0 || extra < 1) return null;
  const validIds = new Set(sources.map((s) => s.id));
  const system = variantSystemPrompt(pt, extra);
  const user = publishUserPrompt(sources);
  try {
    const timeout = AbortSignal.timeout(VARIANTS_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let lastErr: unknown;
    for (let i = 0; i < ATTEMPTS; i++) {
      const content = await chat(llm, system, user, combined);
      try {
        const parsed = parseVariantPlans(content, validIds, extra);
        return parsed.size > 0 ? parsed : null;
      } catch (e) {
        if (combined.aborted) throw e;
        lastErr = e; // um token sujo esporádico deixa o JSON inteiro inválido — reenvia uma vez
      }
    }
    throw lastErr;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/**
 * Expande o plano de versões nas especificações de exportação acrescentadas: cada
 * versão clona a especificação original trocando o título, a frase de suspense e o
 * texto, e a capa passa a ser tirada do pico de volume seguinte (coverRank), com o
 * id continuando a partir do maior existente para garantir que seja único.
 * Uma versão idêntica letra por letra ao título original é descartada (não tem valor
 * de diferenciação). Com attachPost=false (a pessoa não ligou o texto de publicação),
 * as versões também não levam texto, igual à versão original.
 * Com flashDim=true (a antecipação do pico não está ligada globalmente), a última
 * versão de cada clipe recebe uma camada a mais de diferença estrutural: a
 * antecipação do pico é forçada na abertura — assim a versão não troca só a
 * embalagem, mas também a estrutura de abertura (é a dimensão de "diferença de
 * verdade" contra a impressão digital de produção em massa, da v0.14; se o pico não
 * puder ser mostrado, o recuo é automático, fail-open).
 */
export function expandClipSpecs(
  specs: ExportClipSpec[],
  plans: Map<number, VariantPackaging[]>,
  attachPost: boolean,
  flashDim = false
): ExportClipSpec[] {
  let nextId = specs.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  const out: ExportClipSpec[] = [];
  for (const spec of specs) {
    out.push(spec);
    let seq = 1; // a original é a versão 1
    const usable = (plans.get(spec.id) ?? []).filter((v) => v.title !== spec.title.trim());
    for (const v of usable) {
      seq++;
      out.push({
        ...spec,
        id: nextId++,
        title: v.title,
        variantOf: spec.id,
        variant: seq,
        coverRank: seq - 1, // a versão 2 pega o segundo pico, e assim por diante
        // A última versão troca a estrutura de abertura (antecipação do pico), e as anteriores só trocam a embalagem
        flashForward: flashDim && seq === usable.length + 1 ? true : spec.flashForward,
        publish: attachPost ? (v.post ?? spec.publish) : undefined,
        meta: spec.meta ? { ...spec.meta, teaser: v.teaser ?? spec.meta.teaser } : undefined,
      });
    }
  }
  return out;
}
