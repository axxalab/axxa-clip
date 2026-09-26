/**
 * Detecção de regravação (a tomada queimada): gravando uma fala, a pessoa erra e refaz — a mesma frase
 * é dita duas ou até três vezes seguidas, e a primeira coisa que alguém faz ao editar é apagar as
 * tomadas queimadas e ficar só com a última. Aqui a semelhança entre frases vizinhas da transcrição
 * acha essas repetições e transforma as tomadas queimadas em trechos de corte forçado, reaproveitando
 * o mecanismo de colagem do corte seco.
 *
 * Os critérios são conservadores de propósito — melhor deixar de cortar que cortar conteúdo que importa:
 *  - só o que está logo ao lado conta (com uma frase de distância permitida, já que entre duas tomadas
 *    costuma entrar um «ah, não é isso / peraí»);
 *  - as duas tomadas precisam estar próximas (20 segundos por padrão), porque a mesma frase meia hora
 *    depois é o bordão de sempre, não uma regravação;
 *  - frase curta demais não é tocada («beleza», «isso», «vem») — ela se repete naturalmente, e cortar só quebra o fluxo;
 *  - a última tomada fica (foi a que saiu certa e seguiu adiante) e as anteriores saem.
 * Função pura, testável.
 */
import type { TranscriptWord } from "../shared/api-types";
import { segmentWords } from "./transcribe/segment";
import type { KeptSegment } from "./gaps";

/** O limite de semelhança para julgar que é a mesma frase (coeficiente de Dice sobre bigramas). */
export const RETAKE_SIMILARITY = 0.72;
/** A frase mais curta que entra na comparação (em caracteres): frase curta se repete naturalmente e não é tocada. */
export const RETAKE_MIN_CHARS = 6;
/** O intervalo máximo entre as duas tomadas (segundos): acima disso é bordão, não regravação. */
export const RETAKE_MAX_GAP_SEC = 20;
/** Quantas frases no máximo se pode atravessar procurando a regravação (com um «ah, não é isso / peraí» no meio). */
export const RETAKE_LOOKAHEAD = 2;

export interface RetakeHit {
  /** O intervalo de tempo da tomada queimada (o que será cortado). */
  startSec: number;
  endSec: number;
  /** O texto da tomada queimada (para a interface e o registro mostrarem «o que foi cortado»). */
  text: string;
  /** O texto da tomada que ficou. */
  keptText: string;
  similarity: number;
}

export interface RetakeOptions {
  similarity?: number;
  minChars?: number;
  maxGapSec?: number;
  lookahead?: number;
}

/**
 * Normalização: tira a pontuação e o espaço e passa para minúsculas. A comparação é sempre por
 * «sequência de caracteres que significam algo», para uma diferença de pontuação recuperada ("esse é bom"
 * vs "esse é bom!") não transformar a mesma frase em duas. Função pura.
 */
export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

/** O conjunto de bigramas de caracteres vizinhos (por caractere, tanto em escrita ideográfica quanto latina — uma métrica só para todos os idiomas). */
function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  if (s.length < 2) {
    if (s.length === 1) out.set(s, 1);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/**
 * Semelhança de Dice (de 0 a 1): 2× os bigramas em comum / o total de bigramas dos dois.
 * É bem sensível à repetição de prefixo, do tipo «começou a falar e recomeçou», que é justamente a forma
 * típica de uma regravação. Função pura.
 */
export function sentenceSimilarity(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let shared = 0;
  let totalA = 0;
  let totalB = 0;
  for (const n of ga.values()) totalA += n;
  for (const [g, n] of gb) {
    totalB += n;
    const inA = ga.get(g);
    if (inA) shared += Math.min(inA, n);
  }
  return totalA + totalB === 0 ? 0 : (2 * shared) / (totalA + totalB);
}

/**
 * Acha as tomadas queimadas. A entrada é a transcrição palavra a palavra de um trecho (ou do material
 * inteiro), que por dentro é dobrada em frases.
 * Uma frase pode ser regravada várias vezes (dois erros seguidos), e aí todas as tomadas anteriores
 * entram no resultado, ficando só a última.
 */
export function findRetakes(words: TranscriptWord[], options: RetakeOptions = {}): RetakeHit[] {
  const threshold = options.similarity ?? RETAKE_SIMILARITY;
  const minChars = options.minChars ?? RETAKE_MIN_CHARS;
  const maxGapSec = options.maxGapSec ?? RETAKE_MAX_GAP_SEC;
  const lookahead = options.lookahead ?? RETAKE_LOOKAHEAD;
  if (words.length === 0) return [];

  const sentences = segmentWords(words);
  const dropped = new Set<number>();
  const hits: RetakeHit[] = [];

  for (let i = 0; i < sentences.length; i++) {
    if (dropped.has(i)) continue;
    const cur = sentences[i];
    if (normalizeForCompare(cur.text).length < minChars) continue;
    // Procura para a frente a repetição mais próxima; ao achar, «esta tomada» é julgada queimada,
    // e a busca continua tomando a de trás como base (com três erros seguidos, as duas primeiras caem em cadeia)
    for (let j = i + 1; j <= Math.min(i + lookahead, sentences.length - 1); j++) {
      if (dropped.has(j)) continue;
      const next = sentences[j];
      if (normalizeForCompare(next.text).length < minChars) continue;
      if (next.startSec - cur.endSec > maxGapSec) break;
      const sim = sentenceSimilarity(cur.text, next.text);
      if (sim >= threshold) {
        dropped.add(i);
        hits.push({
          startSec: cur.startSec,
          endSec: cur.endSec,
          text: cur.text,
          keptText: next.text,
          similarity: Number(sim.toFixed(3)),
        });
        break;
      }
    }
  }
  return hits.sort((a, b) => a.startSec - b.startSec);
}

/** Tomada queimada → intervalo de corte forçado (com a mesma forma de fillerCutSpans, para alimentar o planejador do corte seco). */
export function retakeCutSpans(hits: RetakeHit[], mergeGapSec = 0.2): KeptSegment[] {
  const sorted = [...hits].sort((a, b) => a.startSec - b.startSec);
  const out: KeptSegment[] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && h.startSec - last.endSec < mergeGapSec) last.endSec = Math.max(last.endSec, h.endSec);
    else out.push({ startSec: h.startSec, endSec: h.endSec });
  }
  return out;
}

/** As palavras que caem dentro de uma tomada queimada saem da legenda (o que foi cortado não pode continuar impresso na imagem). */
export function dropRetakeWords(words: TranscriptWord[], hits: RetakeHit[]): TranscriptWord[] {
  if (hits.length === 0) return words;
  const spans = retakeCutSpans(hits);
  return words.filter((w) => {
    const mid = (w.startSec + w.endSec) / 2;
    return !spans.some((s) => mid >= s.startSec && mid < s.endSec);
  });
}
