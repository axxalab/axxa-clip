/**
 * Busca reversa no texto: localiza as citações literais que o LLM escolheu dentro
 * do fluxo de tokens com tempo, para derivar limites de clipe precisos no quadro.
 *
 * Por quê: os LLMs são pouco confiáveis para emitir marcações de tempo, mas
 * excelentes para citar texto. Então o LLM devolve as citações mais os intervalos
 * de id de frase, e É ESTE módulo que mapeia isso de volta para o tempo dos tokens.
 * A escada de correspondência (da melhor para a pior):
 *   1. "exact"    — a citação normalizada inteira foi encontrada no fluxo de tokens
 *   2. "anchored" — as âncoras de citação inicial e final foram as duas encontradas
 *   3. "segment"  — recorre aos limites do intervalo de id de frase dado pelo LLM
 */
import type { Transcript, TranscriptWord } from "../transcribe/types";
import { normalizePieces, PIECE_JOINER, type ClipPiece } from "../../shared/pieces";

/** Normalização: remove tudo o que não é letra, dígito ou caractere ideográfico, e passa o alfabeto latino para minúsculas. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

interface TokenIndexEntry {
  tokenIdx: number;
}

/** Visão achatada e normalizada do fluxo de tokens da transcrição. */
export interface TokenIndex {
  words: TranscriptWord[];
  /** O texto normalizado de todos os tokens, concatenado. */
  normalized: string;
  /** Para cada caractere de `normalized`, de qual token ele veio. */
  charToToken: TokenIndexEntry[];
}

export function buildTokenIndex(words: TranscriptWord[]): TokenIndex {
  let normalized = "";
  const charToToken: TokenIndexEntry[] = [];
  words.forEach((w, tokenIdx) => {
    const n = normalizeText(w.text);
    normalized += n;
    for (let i = 0; i < n.length; i++) charToToken.push({ tokenIdx });
  });
  return { words, normalized, charToToken };
}

export interface MatchedRange {
  startSec: number;
  endSec: number;
  boundary: "exact" | "anchored";
}

/** Procura uma agulha normalizada no índice a partir de fromChar (inclusive); devolve -1 se não existir. */
function findFrom(index: TokenIndex, needle: string, fromChar: number): number {
  if (!needle) return -1;
  return index.normalized.indexOf(needle, fromChar);
}

/**
 * Estende o índice do token final através dos tokens finais que são só pontuação.
 * A normalização apaga a pontuação, então uma citação que termina numa palavra
 * seria cortada ANTES do token de ponto final, cortando fora o último tempo da
 * frase.
 */
function absorbTrailingPunct(words: TranscriptWord[], endTok: number): number {
  let i = endTok;
  while (i + 1 < words.length && normalizeText(words[i + 1].text) === "") i++;
  return i;
}

/**
 * Localiza uma citação inteira (a seleção literal) no fluxo de tokens.
 * Recorre a ancorar pelo começo e pelo fim da citação quando o meio divergir (de
 * vez em quando os LLMs suprimem palavras de preenchimento ao citar trechos
 * longos).
 */
export function matchQuote(
  index: TokenIndex,
  quoteStart: string,
  quoteEnd: string,
  searchFromSec = 0
): MatchedRange | null {
  const { words, charToToken } = index;
  if (words.length === 0) return null;

  // restringe a busca aos tokens a partir de searchFromSec (inclusive), o que permite frases repetidas
  let fromChar = 0;
  if (searchFromSec > 0) {
    const firstTokenIdx = words.findIndex((w) => w.endSec > searchFromSec);
    if (firstTokenIdx > 0) {
      fromChar = charToToken.findIndex((e) => e.tokenIdx >= firstTokenIdx);
      if (fromChar < 0) fromChar = 0;
    }
  }

  const head = normalizeText(quoteStart);
  const tail = normalizeText(quoteEnd);
  if (!head && !tail) return null;

  // 1) exact: começo e fim formam uma citação contínua (comum em clipes curtos)
  if (head && tail) {
    const joined = head === tail ? head : head + tail;
    const at = findFrom(index, joined, fromChar);
    if (at >= 0) {
      const startTok = charToToken[at].tokenIdx;
      const endTok = absorbTrailingPunct(words, charToToken[at + joined.length - 1].tokenIdx);
      return { startSec: words[startTok].startSec, endSec: words[endTok].endSec, boundary: "exact" };
    }
  }

  // 2) anchored: encontra o começo e depois o fim, a partir dele
  const headAt = findFrom(index, head, fromChar);
  if (headAt < 0) return null;
  const startTok = charToToken[headAt].tokenIdx;
  if (!tail) {
    const endTok = absorbTrailingPunct(words, charToToken[headAt + head.length - 1].tokenIdx);
    return { startSec: words[startTok].startSec, endSec: words[endTok].endSec, boundary: "anchored" };
  }
  const tailAt = findFrom(index, tail, headAt + head.length);
  if (tailAt < 0) return null;
  const endTok = absorbTrailingPunct(words, charToToken[tailAt + tail.length - 1].tokenIdx);
  return { startSec: words[startTok].startSec, endSec: words[endTok].endSec, boundary: "anchored" };
}

/** Um trecho dentro de uma costura de vários trechos: a forma de localizar é exatamente a de um trecho único, só sem título e sem nota. */
export interface RawPart {
  startSegmentId: number;
  endSegmentId: number;
  quoteStart: string;
  quoteEnd: string;
}

export interface RawSelection {
  title: string;
  hook: string;
  score: number;
  reason: string;
  startSegmentId: number;
  endSegmentId: number;
  quoteStart: string;
  quoteEnd: string;
  /** Palavras-chave literais de dentro do clipe, para a ênfase na legenda (pode vir vazio). */
  keywords: string[];
  /**
   * Costura de vários trechos: dois ou três pontos bem distantes entre si são
   * juntados num clipe só (é o que torna possível um destaque do tipo
   * "contradição").
   * Ausente significa um clipe contínuo comum; quando não dá para ler pelo menos
   * dois trechos, o sistema volta sozinho para a localização de trecho único pela
   * citação de topo.
   */
  parts?: RawPart[];
}

export interface ResolvedRange {
  startSec: number;
  endSec: number;
  text: string;
  boundary: "exact" | "anchored" | "segment";
  /** A lista de trechos da costura (só existe com 2 ou mais); startSec e endSec são as pontas do intervalo dela. */
  pieces?: ClipPiece[];
}

/** Ordem de qualidade da correspondência: numa costura de vários trechos, o pior trecho define a qualidade anotada no candidato inteiro. */
const BOUNDARY_RANK: Record<ResolvedRange["boundary"], number> = { exact: 2, anchored: 1, segment: 0 };

/**
 * Resolve uma seleção do LLM em limites com tempo.
 *
 * Primeiro tenta os vários trechos (sel.parts): cada trecho é buscado por conta
 * própria, e a costura só se sustenta se sobrarem pelo menos dois depois da
 * organização; do contrário, volta para trecho único — o quoteStart e o quoteEnd de
 * topo sempre carregam o começo do primeiro trecho e o fim do último, então o
 * caminho de recuo nunca fica sem localização.
 */
export function resolveSelection(transcript: Transcript, sel: RawSelection): ResolvedRange | null {
  if (sel.parts && sel.parts.length >= 2) {
    const stitched = resolveParts(transcript, sel.parts);
    if (stitched) return stitched;
  }
  return resolveSingle(transcript, sel);
}

/** Busca reversa trecho por trecho mais a organização; com menos de dois trechos devolve null (e quem chamou volta para trecho único). */
function resolveParts(transcript: Transcript, parts: RawPart[]): ResolvedRange | null {
  const resolved = parts
    .map((p) => resolveSingle(transcript, p))
    .filter((r): r is ResolvedRange => r !== null);
  if (resolved.length < 2) return null;
  const pieces = normalizePieces(resolved.map((r) => ({ startSec: r.startSec, endSec: r.endSec })));
  if (pieces.length < 2) return null;
  const boundary = resolved.reduce<ResolvedRange["boundary"]>(
    (worst, r) => (BOUNDARY_RANK[r.boundary] < BOUNDARY_RANK[worst] ? r.boundary : worst),
    "exact"
  );
  return {
    startSec: pieces[0].startSec,
    endSec: pieces[pieces.length - 1].endSec,
    pieces,
    // A marca de omissão faz quem revisa e quem usa perceberem de relance que "houve um salto aqui" — o maior risco de uma costura é justamente distorcer o sentido
    text: pieces.map((p) => textBetween(transcript, p.startSec, p.endSec)).join(PIECE_JOINER),
    boundary,
  };
}

/** Localização de trecho único (o comportamento histórico): a citação vem primeiro, e em caso de falha recorre ao intervalo de id de frase. */
function resolveSingle(
  transcript: Transcript,
  sel: Pick<RawSelection, "startSegmentId" | "endSegmentId" | "quoteStart" | "quoteEnd">
): ResolvedRange | null {
  const segments = transcript.segments;
  if (segments.length === 0) return null;

  const startSeg = segments.find((s) => s.id === sel.startSegmentId) ?? null;
  const endSeg = segments.find((s) => s.id === sel.endSegmentId) ?? null;

  // as palavras dentro da janela do trecho (com folga de 1 trecho para cada lado), para a busca da citação delimitada
  const loIdx = startSeg ? Math.max(0, segments.indexOf(startSeg) - 1) : 0;
  const hiIdx = endSeg ? Math.min(segments.length - 1, segments.indexOf(endSeg) + 1) : segments.length - 1;
  const scopedWords = segments.slice(loIdx, hiIdx + 1).flatMap((s) => s.words);
  const scopedIndex = buildTokenIndex(scopedWords);

  const matched = matchQuote(scopedIndex, sel.quoteStart, sel.quoteEnd);
  if (matched) {
    const text = textBetween(transcript, matched.startSec, matched.endSec);
    return { ...matched, text };
  }

  // 3) recuo para o trecho: confia nos ids de frase declarados
  if (startSeg && endSeg && endSeg.endSec > startSeg.startSec) {
    return {
      startSec: startSeg.startSec,
      endSec: endSeg.endSec,
      text: segments
        .slice(segments.indexOf(startSeg), segments.indexOf(endSeg) + 1)
        .map((s) => s.text)
        .join(" "),
      boundary: "segment",
    };
  }
  return null;
}

/** Reúne os textos dos trechos que se sobrepõem a [startSec, endSec], para exibição. */
function textBetween(transcript: Transcript, startSec: number, endSec: number): string {
  return transcript.segments
    .filter((s) => s.endSec > startSec && s.startSec < endSec)
    .map((s) => s.text)
    .join(" ");
}
