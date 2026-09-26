/**
 * Revisão visual dos candidatos pelo modelo de visão (v0.12): com os candidatos já
 * fechados, cada um recebe uma amostragem de até 9 quadros dentro do seu intervalo
 * de tempo, montados num mosaico, e o modelo de visão olha a imagem e responde — o
 * quanto ela é marcante, o ponto forte em uma frase e se a imagem combina com o
 * texto.
 * A conclusão volta para o candidato: nota visual alta dá um pequeno bônus, um
 * candidato vindo de sinal com imagem sem vida perde alguns pontos, e o ponto forte
 * entra na justificativa (mantendo a cadeia de evidências auditável).
 *
 * Por que isso vale a pena: escolher trechos só pelo texto "não vê a imagem", e esse
 * é um defeito clássico do mercado (em dança, pets e rua, o texto do momento de pico
 * costuma ser só um "caraca"); o ClipAnything do OpusClip é a única seleção
 * multimodal que terceiros reconheceram como superior em conteúdo que não é
 * locução. Um mosaico por candidato equivale a uma chamada, o Ollama local sai de
 * graça e na nuvem (Atlas MiMo ou Qwen3-VL) cada candidato custa centavos — pelo
 * mesmo canal compatível com OpenAI, sem nenhuma infraestrutura nova.
 *
 * As funções puras (planejamento da amostragem, prompt, leitura e retorno) são
 * testáveis; a rede e a montagem do mosaico são substituíveis por pontos de injeção.
 * É fail-open: a revisão de um candidato que falha é pulada, e uma falha geral volta
 * aos candidatos originais — a revisão só acrescenta.
 */
import type { HighlightCandidate, LlmConfig } from "../../shared/api-types";
import { composeContactSheetJpeg } from "../contact-sheet";
import type { AnalysisVideoOptions } from "../analysis-video";
import { stripThinkBlocks } from "./prefilter";
import { sanitizeVisibleText, visionChatComplete, VISION_CALL_TIMEOUT_MS, type VisionChatFn, type VisionConfig, type SheetComposer } from "./vision";

/** Teto de quadros amostrados por candidato (um mosaico 3×3 equivale a uma chamada). */
export const REVIEW_FRAMES_PER_CANDIDATE = 9;
/** Quantos candidatos, no máximo, uma rodada de revisão olha (os N melhores por nota, para a cauda longa não gastar cota). */
export const REVIEW_MAX_CANDIDATES = 8;
/** Orçamento total da revisão (esgotado o tempo, o trabalho encerra com o que já foi obtido). */
const REVIEW_BUDGET_MS = 120_000;
/** A partir desta nota visual (de um total de 10) o candidato ganha bônus. */
export const REVIEW_BOOST_THRESHOLD = 8;
/** Abaixo desta nota visual o candidato vindo de sinal perde pontos — o que sustenta esse tipo de candidato é justamente "ter algo na imagem". */
export const REVIEW_DEMOTE_THRESHOLD = 3;
/** Teto do bônus e do desconto: a revisão corrige, não derruba, e a evidência de texto continua sendo o principal. */
const BOOST_PER_POINT = 4;
const BOOST_MAX = 12;
const DEMOTE_DELTA = 6;

/** A conclusão da revisão de um candidato. */
export interface CandidateReview {
  /** O quanto a imagem é marcante, de 0 a 10. */
  visual: number;
  /** O ponto forte da imagem em uma frase (até 30 palavras). */
  scene: string;
  /** Se a imagem combina com o título e o gancho (uma incoerência evidente é marcada como false). */
  match: boolean;
  /** O texto na tela que pode ser confirmado letra por letra nos quadros amostrados; em caso de dúvida, é omitido. */
  visibleText?: string[];
}

export interface ReviewVisionStats {
  reviewed: number;
  boosted: number;
  demoted: number;
}

/**
 * Amostragem dentro do candidato: numa costura de vários trechos, a quantidade de
 * quadros é distribuída na proporção da duração de cada um (com pelo menos 1 quadro
 * por trecho) e espalhada uniformemente dentro dele; num trecho único, é espalhada
 * uniformemente direto.
 * Os quadros ficam a 0,3s de distância das bordas de cada trecho (o quadro da borda
 * costuma ser um quadro perdido de transição). Função pura.
 */
export function planCandidateFrames(
  candidate: Pick<HighlightCandidate, "startSec" | "endSec" | "pieces">,
  maxFrames = REVIEW_FRAMES_PER_CANDIDATE
): number[] {
  const pieces =
    candidate.pieces && candidate.pieces.length > 1
      ? candidate.pieces
      : [{ startSec: candidate.startSec, endSec: candidate.endSec }];
  const total = pieces.reduce((a, p) => a + Math.max(0, p.endSec - p.startSec), 0);
  if (!(total > 0)) return [];
  const times: number[] = [];
  // Distribui os quadros na proporção (com pelo menos 1), e a cota que sobra é distribuída em outra rodada, desde o começo
  const quota = pieces.map((p) => Math.max(1, Math.floor((maxFrames * (p.endSec - p.startSec)) / total)));
  let used = quota.reduce((a, b) => a + b, 0);
  for (let i = 0; used > maxFrames && i < quota.length; i++) {
    // Passando da conta, os quadros são recolhidos do trecho que tem mais
    const maxIdx = quota.indexOf(Math.max(...quota));
    if (quota[maxIdx] > 1) {
      quota[maxIdx]--;
      used--;
    } else break;
  }
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const pad = Math.min(0.3, (p.endSec - p.startSec) / 4);
    const lo = p.startSec + pad;
    const hi = p.endSec - pad;
    const n = quota[i];
    for (let k = 1; k <= n; k++) {
      times.push(lo + ((hi - lo) * k) / (n + 1));
    }
  }
  return times.sort((a, b) => a - b).slice(0, maxFrames);
}

export function reviewSystemPrompt(cellCount: number): string {
  return [
    `Você está revisando a imagem de um corte de vídeo curto. A figura é um mosaico com ${cellCount} quadros de dentro do mesmo clipe candidato,`,
    "numerados a partir de 1, da esquerda para a direita e de cima para baixo (ignore as células preta sobrando). Responda considerando todos os quadros:",
    "visual: o quanto a imagem deste clipe é marcante, de 0 a 10 (expressão exagerada, movimento intenso, conflito ou interação e cena impactante recebem nota alta; locução estática, cena vazia e slide recebem nota baixa);",
    "scene: diga em uma frase qual é o maior ponto forte da imagem (até 30 palavras; se não houver, diga em que ela é sem graça);",
    "match: se a imagem combina com o título e o gancho informados (o que o título diz simplesmente não aparecer na imagem = false).",
    "visibleText: copie apenas o nome de produto, o preço, o placar, o título ou o tópico de slide que dá para confirmar letra por letra em algum dos quadros; em caso de dúvida ou de dedução, devolva um array vazio, com no máximo 5 itens.",
    'Responda com JSON estrito e nada mais: {"visual":0-10,"scene":"…","match":true/false,"visibleText":["o texto como está"]}, sem escrever mais nada.',
  ].join("\n");
}

/** Prompt de usuário: leva o título, o gancho e um trecho da transcrição, que é o que permite ao modelo julgar o match. */
export function reviewUserPrompt(candidate: Pick<HighlightCandidate, "title" | "hook" | "text">): string {
  const excerpt = (candidate.text ?? "").replace(/\s+/g, " ").slice(0, 160);
  return [
    `Título do candidato: ${candidate.title}`,
    `Gancho de abertura: ${candidate.hook}`,
    `Trecho da transcrição: ${excerpt}`,
    "Responda em JSON, conforme as instruções do sistema.",
  ].join("\n");
}

/** Lê a saída da revisão; saída inaproveitável devolve null (e aquele candidato é tratado como não revisado). Função pura. */
export function parseCandidateReview(content: string): CandidateReview | null {
  const cleaned = stripThinkBlocks(content);
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const rec = obj as { visual?: unknown; scene?: unknown; match?: unknown; visibleText?: unknown };
  const visual = Number(rec.visual);
  if (!Number.isFinite(visual)) return null;
  const visibleText = sanitizeVisibleText(rec.visibleText);
  return {
    visual: Math.max(0, Math.min(10, visual)),
    scene: typeof rec.scene === "string" ? rec.scene.trim().slice(0, 40) : "",
    match: rec.match !== false,
    ...(visibleText.length > 0 ? { visibleText } : {}),
  };
}

/**
 * A conclusão da revisão volta para o candidato (função pura):
 * - visual maior ou igual a 8: cada ponto acima disso vale 4, com teto de +12 e nota
 *   total no máximo 99 (a imagem é um bônus de verdade)
 * - boundary="signal" e visual menor ou igual a 3: desconto de 6 pontos, com piso em 1
 *   (um candidato vindo de sinal com imagem sem vida é evidência negativa)
 * - match=false: a incoerência é registrada explicitamente na justificativa (sem
 *   mexer na nota — o julgamento ainda não é estável, então primeiro a pessoa vê)
 * - scene entra na justificativa (cadeia de evidências); e tudo é reordenado pela
 *   nota nova.
 */
export function applyCandidateReviews(
  candidates: HighlightCandidate[],
  reviews: Map<number, CandidateReview>
): { candidates: HighlightCandidate[]; stats: ReviewVisionStats } {
  let boosted = 0;
  let demoted = 0;
  const out = candidates.map((c) => {
    const r = reviews.get(c.id);
    if (!r) return c;
    let score = c.score;
    if (r.visual >= REVIEW_BOOST_THRESHOLD) {
      score = Math.min(99, score + Math.min(BOOST_MAX, (r.visual - (REVIEW_BOOST_THRESHOLD - 1)) * BOOST_PER_POINT));
      boosted++;
    } else if (c.boundary === "signal" && r.visual <= REVIEW_DEMOTE_THRESHOLD) {
      score = Math.max(1, score - DEMOTE_DELTA);
      demoted++;
    }
    const notes = [
      r.scene ? `revisão da imagem ${r.visual}/10: ${r.scene}` : `revisão da imagem ${r.visual}/10`,
      ...(r.visibleText?.length ? [`texto na tela: ${r.visibleText.join(" / ")}`] : []),
      ...(r.match ? [] : ["⚠ a imagem pode não combinar com o título"]),
    ].join(";");
    return {
      ...c,
      score,
      reason: c.reason ? `${c.reason};${notes}` : notes,
      visualEvidence: {
        score: r.visual,
        scene: r.scene,
        match: r.match,
        ...(r.visibleText?.length ? { visibleText: r.visibleText } : {}),
      },
    };
  });
  out.sort((a, b) => b.score - a.score);
  return { candidates: out, stats: { reviewed: reviews.size, boosted, demoted } };
}

/**
 * Executa uma rodada de revisão dos candidatos: os N melhores por nota, cada um com
 * um mosaico e uma chamada.
 * É fail-open: um candidato que falha é pulado, e se nenhum for revisado com sucesso,
 * devolve null (e quem chamou segue com os candidatos originais).
 */
export async function reviewCandidatesVision(opts: {
  videoPath: string;
  candidates: HighlightCandidate[];
  config: VisionConfig;
  signal?: AbortSignal;
  fontFile?: string;
  composeSheet?: SheetComposer;
  chat?: VisionChatFn;
  budgetMs?: number;
  maxCandidates?: number;
  analysis?: AnalysisVideoOptions;
}): Promise<{ candidates: HighlightCandidate[]; stats: ReviewVisionStats } | null> {
  const {
    videoPath, candidates, config, signal,
    composeSheet = (v, ts, analysis) => composeContactSheetJpeg(v, ts, { fontFile: opts.fontFile, ...analysis }),
    chat = visionChatComplete,
    budgetMs = REVIEW_BUDGET_MS,
    maxCandidates = REVIEW_MAX_CANDIDATES,
  } = opts;
  if (candidates.length === 0) return null;
  const llm: LlmConfig = { baseUrl: config.baseUrl, apiKey: config.apiKey || "ollama", model: config.model };
  const targets = [...candidates].sort((a, b) => b.score - a.score).slice(0, maxCandidates);
  const deadline = Date.now() + budgetMs;
  const reviews = new Map<number, CandidateReview>();
  for (const c of targets) {
    if (signal?.aborted) throw new Error("aborted");
    if (Date.now() > deadline) break;
    const times = planCandidateFrames(c);
    if (times.length === 0) continue;
    const sheet = await composeSheet(videoPath, times, opts.analysis);
    if (!sheet) continue;
    try {
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(VISION_CALL_TIMEOUT_MS, deadline - Date.now())));
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const content = await chat(llm, reviewSystemPrompt(times.length), reviewUserPrompt(c), sheet, combined);
      const verdict = parseCandidateReview(content);
      if (verdict) reviews.set(c.id, verdict);
    } catch (e) {
      if (signal?.aborted) throw e;
      // A falha de um candidato não é fatal, então ele é pulado e o resto continua
    }
  }
  if (reviews.size === 0) return null;
  return applyCandidateReviews(candidates, reviews);
}
