/**
 * Sinal de pico visual: um modelo de visão rodando na própria máquina (Ollama com
 * qwen3-vl, por exemplo) amostra quadros para julgar os "momentos de alta energia
 * visual", e esses momentos viram trechos que entram no prompt do LLM como o
 * terceiro sinal de imagem e som — resolvendo o defeito clássico do mercado, em que
 * a detecção só por texto "não vê a imagem" (uma cena de meme, uma piada corporal
 * ou um momento visual impactante são um vazio no texto transcrito).
 *
 * Os instantes de amostragem vêm primeiro do meio das janelas que os sinais de
 * nível 0 (picos de volume, trechos com troca densa de plano) delimitaram — eles
 * são o palpite gratuito de que "aqui pode ter imagem"; a cota restante é espalhada
 * uniformemente pelo material inteiro, para não deixar nada de fora. O julgamento é
 * feito em lote por mosaico 3×3: nove quadros viram um mosaico numerado, e uma
 * chamada devolve nove notas — o que reduz a quantidade de chamadas em uma ordem de
 * grandeza em relação a ir quadro a quadro (27 quadros custam só 3 chamadas). Tudo
 * é fail-open: endpoint indisponível, um mosaico que falha ou o orçamento esgotado
 * não podem derrubar a detecção, e no pior caso o resultado volta a ser o de texto
 * puro.
 * As funções puras (planejamento, leitura e fusão de trechos) são testáveis; a
 * montagem do mosaico e o HTTP são substituíveis por pontos de injeção.
 */
import type { LlmConfig } from "../../shared/api-types";
import { chunkCells, composeContactSheetJpeg } from "../contact-sheet";
import type { AnalysisVideoOptions } from "../analysis-video";
import type { MediaSignals, TimeRange } from "../signals";
import { stripThinkBlocks } from "./prefilter";
import { llmRequestBudget, modelErrorDetail, requestLlmText } from "../llm-transport";
import { advanceCompat, recallCompat, rememberCompat, samplingParams, MAX_PARAM_RETRIES } from "../llm-params";

/** Teto de quadros amostrados no material inteiro — com o julgamento em lote por mosaico, uma chamada olha nove quadros, então 27 quadros são 3 chamadas. */
export const VISION_MAX_FRAMES = 27;
/** Intervalo mínimo entre dois quadros: amostrar dois quadros do mesmo auge visual desperdiça cota. */
export const VISION_MIN_SPACING_SEC = 8;
/** Só os quadros que atingem este valor de energy (de 0 a 10) contam como "alta energia visual". */
export const VISION_ENERGY_THRESHOLD = 7;
/** O raio do trecho que se abre para os dois lados de um quadro de alta energia (um auge visual costuma durar alguns segundos). */
export const VISION_PEAK_PAD_SEC = 3.5;
/** Quando dois trechos vizinhos de alta energia têm intervalo menor que este valor, eles são fundidos. */
export const VISION_MERGE_GAP_SEC = 10;
/** Tempo máximo do julgamento de um mosaico; o orçamento total está em budgetMs (o padrão é 180s, e passando dele o trabalho encerra com o que já foi obtido). */
export const VISION_CALL_TIMEOUT_MS = 60_000;
const VISION_BUDGET_MS = 180_000;
/** Abaixo desta quantidade de quadros julgados com sucesso a evidência é fina demais, e é melhor não dar sinal nenhum do que dar ruído. */
const MIN_SCORED_FRAMES = 3;

// ---- O nível de varredura completa (v0.13): a varredura rápida de 27 quadros vira
// "um quadro a cada ~30 segundos ao longo de tudo" ----
// Três rodadas de pesquisa mudaram o veredito: depois que o preço do token de vídeo
// desabou, "entregar a transmissão inteira ao modelo de visão" passou a ser uma
// operação comum, de alguns centavos a poucos reais por transmissão. A forma de
// engenharia escolhida é "mosaico com marcação de tempo + transcrição por trecho":
// o mesmo endpoint compatível com OpenAI é reaproveitado, o Ollama local sai de
// graça e na nuvem, num nível como o do qwen3-vl-flash, a transmissão inteira custa
// centavos, sem depender de nenhuma API de envio de vídeo específica de um
// provedor (a entrada nativa de vídeo fica como caminho de evolução futuro).
/** Intervalo de amostragem da varredura completa (em segundos). */
export const SCAN_FRAME_INTERVAL_SEC = 30;
/** Teto de quadros da varredura completa (270 quadros = 30 mosaicos, o que cobre exatamente uma transmissão de 3 horas). */
export const SCAN_MAX_FRAMES = 270;
/** Distância mínima entre quadros na varredura completa (é mais densa que a rápida, porque aqui a cobertura uniforme vem primeiro). */
export const SCAN_MIN_SPACING_SEC = 10;
/** Orçamento total da varredura completa (um endpoint local é lento, então a folga é grande; na nuvem ela nunca é usada por inteiro). */
export const SCAN_BUDGET_MS = 600_000;
/** Limite de energia e teto de itens da linha do tempo visual (só o que é realmente de alta energia entra no prompt). */
export const SCAN_NOTE_ENERGY_MIN = 6;
export const SCAN_NOTES_MAX = 20;

/** Duração → quantidade de quadros da varredura completa (no mínimo um mosaico cheio, com teto em SCAN_MAX_FRAMES). */
export function scanFrameBudget(durationSec: number): number {
  if (!(durationSec > 1)) return 0;
  return Math.min(SCAN_MAX_FRAMES, Math.max(9, Math.ceil(durationSec / SCAN_FRAME_INTERVAL_SEC)));
}

/**
 * Escolhe a "linha do tempo visual" entre os quadros com nota: os que atingem a
 * energia e têm descrição, pegando os N maiores por energia e ordenando por tempo.
 * É a nona via de evidência que a varredura completa devolve ao LLM de seleção (os
 * acontecimentos em tela que a transcrição não vê). Função pura.
 */
export function pickVisualNotes(
  scored: Array<{ t: number; energy: number; note: string; visibleText?: string[] }>,
  energyMin = SCAN_NOTE_ENERGY_MIN,
  max = SCAN_NOTES_MAX
): Array<{ t: number; energy: number; note: string; visibleText?: string[] }> {
  const byEnergy = [...scored].filter((s) => s.energy >= energyMin).sort((a, b) => b.energy - a.energy);
  // A energia visual de um slide estático ou de uma cartela de preço pode ser bem
  // baixa, mas o texto nítido na tela é essencial para cortes de conhecimento e de
  // venda.
  // Eles ficam com um quarto das vagas reservado; sem evidência de texto, a cota
  // volta inteira para a imagem de alta energia.
  const textReserve = Math.min(max, Math.ceil(max / 4));
  const byText = [...scored]
    .filter((s) => (s.visibleText?.length ?? 0) > 0)
    .sort((a, b) => b.energy - a.energy || a.t - b.t);
  const selected = new Set<typeof scored[number]>();
  for (const item of byEnergy.slice(0, Math.max(0, max - textReserve))) selected.add(item);
  for (const item of byText.slice(0, textReserve)) selected.add(item);
  for (const item of [...byEnergy, ...byText]) {
    if (selected.size >= max) break;
    selected.add(item);
  }
  return [...selected].slice(0, max).sort((a, b) => a.t - b.t);
}

export interface VisionConfig {
  baseUrl: string;
  model: string;
  /** Chave de API do endpoint de nuvem; ausente no Ollama local (um "ollama" é colocado como preenchimento). */
  apiKey?: string;
}

export interface VisionStats {
  /** Quantos quadros foram planejados. */
  framesTotal: number;
  /** Quantos quadros foram de fato julgados com sucesso. */
  framesScored: number;
  /** Quantos trechos de alta energia visual foram delimitados. */
  peakCount: number;
  /** Esta rodada é do nível de varredura completa. */
  fullScan?: boolean;
  /** Quantidade de momentos que voltaram com descrição da imagem (a linha do tempo visual). */
  notedMoments?: number;
}

export interface VisionOutcome {
  visualPeaks: TimeRange[];
  /** A linha do tempo visual (só tem conteúdo no nível de varredura completa; na varredura rápida é um array vazio). */
  visualNotes: Array<{ t: number; energy: number; note: string; visibleText?: string[] }>;
  stats: VisionStats;
}

/** Ponto de injeção com a mesma ideia do chatComplete, levando junto um jpeg (em base64). */
export type VisionChatFn = (
  llm: LlmConfig,
  system: string,
  userText: string,
  imageBase64Jpeg: string,
  signal?: AbortSignal
) => Promise<string>;

/** Ponto de injeção da montagem do mosaico (times → jpeg em base64; null em caso de falha). */
export type SheetComposer = (
  videoPath: string,
  times: number[],
  analysis?: AnalysisVideoOptions
) => Promise<string | null>;

/**
 * Planeja os instantes de amostragem: primeiro o meio das janelas de sinal (em
 * ordem de tempo) e depois uma grade uniforme para completar a cota;
 * o intervalo mínimo é mantido do começo ao fim, e tudo fica dentro de
 * [0,5, duração menos 0,5]. Função pura.
 */
export function planFrameTimes(
  durationSec: number,
  signals: MediaSignals | undefined,
  maxFrames = VISION_MAX_FRAMES,
  minSpacingSec = VISION_MIN_SPACING_SEC
): number[] {
  if (!(durationSec > 1) || maxFrames < 1) return [];
  const lo = 0.5;
  const hi = durationSec - 0.5;
  const clamp = (t: number): number => Math.min(hi, Math.max(lo, t));
  const picked: number[] = [];
  const fits = (t: number): boolean => picked.every((p) => Math.abs(p - t) >= minSpacingSec);
  const tryPick = (t: number): void => {
    const c = clamp(t);
    if (picked.length < maxFrames && fits(c)) picked.push(c);
  };
  // O meio das janelas de sinal vem primeiro — é ali que o palpite de "pode ter imagem" é mais forte
  const priority = [
    ...(signals?.loudPeaks ?? []).map((r) => (r.startSec + r.endSec) / 2),
    ...(signals?.cutDense ?? []).map((r) => (r.startSec + r.endSec) / 2),
    ...(signals?.motionPeaks ?? []).map((r) => (r.startSec + r.endSec) / 2),
    ...[...(signals?.activityKeyframes ?? [])].sort((a, b) => b.score - a.score || a.t - b.t).map((frame) => frame.t),
  ];
  // Pelo menos um terço do orçamento fica sempre reservado para a cobertura
  // uniforme, para que a atividade densa perto do começo não esconda uma cena
  // silenciosa mas importante mais adiante.
  const priorityBudget = Math.max(1, Math.floor((maxFrames * 2) / 3));
  for (const t of priority) {
    if (picked.length >= priorityBudget) break;
    tryPick(t);
  }
  // As células reservadas da varredura completa são preenchidas explicitamente
  // antes, e só então a grade fina completa o resto; do contrário, ir preenchendo em
  // ordem desde o começo esgotaria a cota cedo quando há muitos instantes
  // prioritários, e o fim de um vídeo longo ainda poderia perder cobertura.
  const uniformReserve = Math.max(1, maxFrames - priorityBudget);
  for (let i = 1; i <= uniformReserve; i++) tryPick((durationSec * i) / (uniformReserve + 1));
  // A grade fina uniforme completa a cota restante, para que um trecho inteiro na "zona cega de sinal" não fique de fora
  for (let i = 1; i <= maxFrames; i++) tryPick((durationSec * i) / (maxFrames + 1));
  return picked.sort((a, b) => a - b);
}

/**
 * Lê a saída do julgamento em lote do mosaico:
 * {"cells":[{"i":1,"energy":0-10,"note":"…"}…]}.
 * Só as células válidas de 1 até cellCount são aceitas (uma repetida fica com a
 * primeira, e energy é trazido de volta para a faixa de 0 a 10);
 * quando não há nenhuma célula válida (saída inaproveitável), devolve null.
 */
export function parseSheetVerdicts(
  content: string,
  cellCount: number
): Array<{ i: number; energy: number; note: string; visibleText?: string[] }> | null {
  const cleaned = stripThinkBlocks(content);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const cells = (obj as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return null;
  const seen = new Set<number>();
  const out: Array<{ i: number; energy: number; note: string; visibleText?: string[] }> = [];
  for (const c of cells) {
    const rec = c as { i?: unknown; energy?: unknown; note?: unknown; visibleText?: unknown };
    const i = Number(rec.i);
    const energy = Number(rec.energy);
    if (!Number.isInteger(i) || i < 1 || i > cellCount || seen.has(i)) continue;
    if (!Number.isFinite(energy)) continue;
    seen.add(i);
    const visibleText = sanitizeVisibleText(rec.visibleText);
    out.push({
      i,
      energy: Math.max(0, Math.min(10, energy)),
      note: typeof rec.note === "string" ? rec.note.trim().slice(0, 40) : "",
      ...(visibleText.length > 0 ? { visibleText } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

/** Um modelo de visão não é um OCR pixel a pixel: só resultados literais curtos, poucos e sem repetição são mantidos; na dúvida, é melhor faltar do que sobrar. */
export function sanitizeVisibleText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim().slice(0, 40);
    const key = text.toLocaleLowerCase();
    if (!text || /^(nenhum|nenhuma|sem texto|n[aã]o d[aá] para ler|ileg[íi]vel|none|no text|n\/a|unknown)$/i.test(text) || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= 5) break;
  }
  return out;
}

/** Quadro de alta energia → trecho (±pad), fundido pelo intervalo e preso dentro de [0, duração]. Função pura. */
export function visualPeakRanges(
  scored: Array<{ t: number; energy: number }>,
  durationSec: number,
  threshold = VISION_ENERGY_THRESHOLD,
  padSec = VISION_PEAK_PAD_SEC,
  mergeGapSec = VISION_MERGE_GAP_SEC
): TimeRange[] {
  const hits = scored
    .filter((s) => s.energy >= threshold)
    .map((s) => ({
      startSec: Math.max(0, s.t - padSec),
      endSec: Math.min(durationSec, s.t + padSec),
    }))
    .sort((a, b) => a.startSec - b.startSec);
  const out: TimeRange[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.startSec - last.endSec < mergeGapSec) {
      last.endSec = Math.max(last.endSec, h.endSec);
    } else {
      out.push({ ...h });
    }
  }
  return out;
}

export function visionSystemPrompt(cellCount: number): string {
  return [
    `Você está avaliando a "energia de destaque" da imagem para cortes de vídeo curto. A figura é um mosaico formado por ${cellCount} quadros,`,
    "numerados a partir de 1, da esquerda para a direita e de cima para baixo (cada célula tem o número em branco no canto superior esquerdo; ignore as células preta sobrando).",
    "Dê a cada célula uma nota energy de 0 a 10: expressão exagerada, movimento corporal intenso, conflito ou interação intensa entre pessoas, objeto ou texto chamativo, cena impactante recebem nota alta;",
    "locução estática, cena vazia, slide e conversa comum sentada recebem nota baixa (de 0 a 3).",
    "visibleText: copie apenas o título, o nome de produto, o preço, o placar ou o tópico de slide que dá para confirmar letra por letra na imagem; se estiver em dúvida, se for pequeno demais ou se você só deduziu pelo contexto, devolva um array vazio, com no máximo 3 itens por célula;",
    `Responda com JSON estrito e nada mais: {"cells":[{"i":1,"energy":0-10,"note":"descrição da imagem em até 15 palavras","visibleText":["o texto como está"]}…]}, com ${cellCount} itens no total, sem escrever mais nada.`,
  ].join("\n");
}

/** Prompt de usuário do mosaico: informa o instante do material a que cada célula corresponde, ajudando o modelo a alinhar o contexto. */
export function sheetUserPrompt(times: number[]): string {
  const clock = (t: number): string => {
    const s = Math.floor(t);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  return `Avalie a energia de destaque da imagem célula por célula. Instante de cada célula: ${times.map((t, i) => `${i + 1}=${clock(t)}`).join(" ")}`;
}

/** Implementação padrão do julgamento: chat multimodal compatível com OpenAI (o /v1 do Ollama também aceita image_url). */
export const visionChatComplete: VisionChatFn = async (llm, system, userText, imageBase64Jpeg, signal) => {
  const url = `${llm.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // Mesmo recuo de parâmetro do caminho de texto: as gerações novas da OpenAI recusam max_tokens e
  // temperatura fora do padrão, e sem isto a varredura visual falharia inteira nesses modelos.
  let compat = recallCompat(llm.baseUrl, llm.model);
  const send = (): Promise<Awaited<ReturnType<typeof requestLlmText>>> => requestLlmText(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64Jpeg}` } },
          ],
        },
      ],
      ...samplingParams(compat, 300, 0.2),
    }),
  }, { signal, budget: llmRequestBudget(VISION_CALL_TIMEOUT_MS, 1) });

  let res = await send();
  for (let i = 0; !res.ok && i < MAX_PARAM_RETRIES; i++) {
    const next = advanceCompat(`HTTP ${res.status}: ${res.text}`, compat);
    if (!next) break;
    compat = next;
    rememberCompat(llm.baseUrl, llm.model, next);
    res = await send();
  }
  const text = res.text;
  if (!res.ok) throw new Error(`vision HTTP ${res.status}: ${modelErrorDetail(text, llm.apiKey, 200)}`);
  const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("vision empty response");
  return content;
};

/**
 * Coleta o sinal de pico visual (em lote por mosaico: nove quadros num mosaico,
 * uma chamada devolvendo nove notas).
 * É fail-open:
 * - a montagem ou o julgamento de um mosaico que falha → aquele mosaico é pulado e o
 *   resto continua;
 * - quadros bem-sucedidos abaixo de MIN_SCORED_FRAMES → devolve null (evidência fina
 *   demais não vira sinal);
 * - orçamento total estourado → o julgamento para e o trabalho encerra com os quadros
 *   já obtidos;
 * - cancelamento pelo AbortSignal de cima → propagado como está (a detecção inteira
 *   precisa parar).
 */
export async function collectVisionSignal(opts: {
  videoPath: string;
  durationSec: number;
  config: VisionConfig;
  signals?: MediaSignals;
  signal?: AbortSignal;
  /** Arquivo de fonte usado para escrever o número (é o padrão da montagem; ausente, o número não é queimado). */
  fontFile?: string;
  composeSheet?: SheetComposer;
  chat?: VisionChatFn;
  budgetMs?: number;
  /** Nível de varredura completa (v0.13): um quadro a cada ~30 segundos ao longo de tudo, devolvendo também a linha do tempo com descrição da imagem. */
  scan?: boolean;
  analysis?: AnalysisVideoOptions;
}): Promise<VisionOutcome | null> {
  const scan = opts.scan === true;
  const {
    videoPath, durationSec, config, signals, signal,
    composeSheet = (v, ts, analysis) => composeContactSheetJpeg(v, ts, { fontFile: opts.fontFile, ...analysis }),
    chat = visionChatComplete,
    budgetMs = scan ? SCAN_BUDGET_MS : VISION_BUDGET_MS,
  } = opts;
  const times = scan
    ? planFrameTimes(durationSec, signals, scanFrameBudget(durationSec), SCAN_MIN_SPACING_SEC)
    : planFrameTimes(durationSec, signals);
  if (times.length === 0) return null;
  const llm: LlmConfig = { baseUrl: config.baseUrl, apiKey: config.apiKey || "ollama", model: config.model };
  const deadline = Date.now() + budgetMs;
  const scored: Array<{ t: number; energy: number; note: string; visibleText?: string[] }> = [];
  for (const group of chunkCells(times)) {
    if (signal?.aborted) throw new Error("aborted");
    if (Date.now() > deadline) break; // orçamento esgotado, o trabalho encerra com o que já foi obtido
    const sheet = await composeSheet(videoPath, group, opts.analysis);
    if (!sheet) continue;
    try {
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(VISION_CALL_TIMEOUT_MS, deadline - Date.now())));
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const content = await chat(llm, visionSystemPrompt(group.length), sheetUserPrompt(group), sheet, combined);
      const verdicts = parseSheetVerdicts(content, group.length);
      if (verdicts) {
        for (const v of verdicts) scored.push({
          t: group[v.i - 1],
          energy: v.energy,
          note: v.note,
          ...(v.visibleText ? { visibleText: v.visibleText } : {}),
        });
      }
    } catch (e) {
      if (signal?.aborted) throw e; // um cancelamento pedido de cima precisa interromper a detecção inteira
      // Os outros erros pulam aquele mosaico (partida a frio do endpoint e tempo esgotado num mosaico não são fatais)
    }
  }
  if (scored.length < MIN_SCORED_FRAMES) return null;
  const visualPeaks = visualPeakRanges(scored, durationSec);
  // A linha do tempo visual só volta no nível de varredura completa — na varredura rápida os 27 quadros são esparsos demais, e a descrição devolvida traz mais ruído que informação
  const visualNotes = scan ? pickVisualNotes(scored) : [];
  return {
    visualPeaks,
    visualNotes,
    stats: {
      framesTotal: times.length,
      framesScored: scored.length,
      peakCount: visualPeaks.length,
      ...(scan ? { fullScan: true, notedMoments: visualNotes.length } : {}),
    },
  };
}
