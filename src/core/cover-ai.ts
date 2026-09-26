/**
 * Capa por IA em duas edições (v0.14): além da capa tirada de um quadro do vídeo, uma capa vertical
 * de letras grandes é gerada a partir do título do trecho. A edição de volume é o Seedream (ByteDance,
 * forte em diagramação de cartaz, barato) e a edição premium é o Nano Banana Pro (Google, o mais firme
 * em detalhe e em letra grande, uma faixa mais caro) — justamente os dois modelos que a pesquisa cita
 * nas «duas edições de capa». A capa gerada fica ao lado do vídeo pronto como <nome>.capa-ia.jpg,
 * convivendo com a capa de quadro para o usuário escolher; falha em aberto, e uma capa que não sai
 * nunca derruba a exportação.
 */
import { atlasMediaBase, generateMedia, downloadMedia } from "./atlas-media";

export type CoverTier = "volume" | "premium";

/** Os ids dos modelos das duas edições (Atlas Cloud, conferidos em 08/2026). */
export const COVER_MODELS: Record<CoverTier, string> = {
  volume: "bytedance/seedream-v4.5",
  premium: "google/nano-banana-pro/text-to-image",
};

/** O preço de tabela por imagem (em dólares; a Atlas vive em promoção e cobra menos, mas a estimativa usa o preço de tabela para sobrar margem). */
export const COVER_COST_USD: Record<CoverTier, number> = {
  volume: 0.036,
  premium: 0.14,
};

/** O orçamento de tempo de uma imagem (envio + consultas + download). */
export const COVER_TIMEOUT_MS = 90_000;

/** Corte do título: pela largura visual (ideograma=2, latino=1), em 32 unidades — 16 ideogramas ou 32 caracteres latinos. */
function clipHeadline(text: string, maxUnits = 32): string {
  let units = 0;
  let out = "";
  for (const ch of text) {
    units += /[\u2e80-\u9fff\uf900-\ufdff]/.test(ch) ? 2 : 1;
    if (units > maxUnits) break;
    out += ch;
  }
  return out;
}

/**
 * Prompt da capa: o consenso de ofício das capas de corte de live em 2026 — vertical 3:4, título em
 * letra enorme e negrito (renderizado como veio, entre aspas para não ser reescrito), cores de alto
 * contraste batendo entre si, e imagem com cara de live de verdade em vez do plástico de IA.
 * Título comprido é cortado antes de entrar na imagem (letra de capa é pouca e grande; frase longa é acidente de design).
 */
export function coverPrompt(title: string, hook: string | undefined, pt: boolean, visualContext?: string): string {
  const headline = clipHeadline(title.trim());
  const scene = visualContext?.trim()
    ? visualContext.trim().slice(0, 60)
    : hook?.trim()
      ? hook.trim().slice(0, 60)
      : title.trim().slice(0, 40);
  // Teste em máquina real (08/2026, Seedream): substantivo de meta-descrição no prompt (capa / cartaz /
  // corte de live) acaba renderizado como texto dentro da imagem, e a forma negativa «não apareça outro
  // texto» não segura — é preciso (1) não usar esses substantivos na descrição e (2) usar a restrição
  // positiva «o único texto da imagem é o título».
  if (pt) {
    return [
      `Composição vertical 3:4. Assunto da imagem: ${scene}, com cara de foto espontânea, textura de pessoa real, alta definição.`,
      `O único texto da imagem é um título enorme em negrito: «${headline}» — renderize exatamente estas palavras, sem reescrever e sem erro de digitação;`,
      "o título ocupa o terço de cima da imagem, em fonte sem serifa bem grossa, branca, com contorno de alto contraste ou tarja de cor, legível na tela do celular.",
      "Fora esse título, não apareça nenhum outro texto nem marca d'água em lugar algum da imagem (inclusive em objetos do fundo).",
      "No conjunto: alto contraste, cores saturadas batendo entre si, impacto; evite o aspecto plástico de IA e evite texto em inglês sobrando.",
    ].join("\n");
  }
  return [
    `Vertical 3:4 composition. Subject: ${scene}, authentic candid feel, photoreal, sharp.`,
    `The ONLY text in the image is a huge bold headline: "${headline}" — render these exact words, no rewording, no typos;`,
    "headline fills the top third, heavy sans-serif with high-contrast outline or color block, readable on a phone screen.",
    "No other text or watermarks anywhere else in the image, including on background objects.",
    "High contrast, punchy saturated colors; avoid plastic AI look.",
  ].join("\n");
}

/** Monta o corpo do pedido da Atlas conforme a edição (o parâmetro de enquadramento tem nome diferente em cada modelo). */
export function coverRequestBody(tier: CoverTier, prompt: string): Record<string, unknown> {
  if (tier === "premium") {
    return {
      model: COVER_MODELS.premium,
      prompt,
      aspect_ratio: "3:4",
      resolution: "1k",
      output_format: "jpeg",
    };
  }
  return { model: COVER_MODELS.volume, prompt, size: "1728*2304" };
}

/**
 * Gera uma capa por IA em outPath. Se o baseUrl do LLM não for a Atlas (ou não houver chave), devolve
 * false (e quem chama pula em silêncio); as outras falhas são lançadas e tratadas em falha aberta por quem chama.
 */
export async function generateAiCover(opts: {
  tier: CoverTier;
  title: string;
  hook?: string;
  /** A cena observada na revisão de imagem do candidato, preferida ao contexto de gancho que vem só da transcrição. */
  visualContext?: string;
  pt: boolean;
  baseUrl: string;
  apiKey: string;
  outPath: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  const mediaBase = atlasMediaBase(opts.baseUrl);
  if (!mediaBase || !opts.apiKey) return false;
  const url = await generateMedia("generateImage", coverRequestBody(opts.tier, coverPrompt(opts.title, opts.hook, opts.pt, opts.visualContext)), {
    mediaBase,
    apiKey: opts.apiKey,
    timeoutMs: COVER_TIMEOUT_MS,
    signal: opts.signal,
  });
  await downloadMedia(url, opts.outPath, opts.signal);
  return true;
}
