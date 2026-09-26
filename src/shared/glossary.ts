/**
 * Glossário de termos: o reconhecimento de fala erra nomes de pessoa, marcas e
 * termos técnicos a transmissão inteira, e corrigir frase por frase não dá conta.
 * O glossário guarda o par "errado → certo", e depois que a transcrição termina a
 * palavra inteira é substituída em todo o material — palavra-chave em tempo de
 * decodificação não existe em motores que não são transducer, como SenseVoice,
 * Paraformer e FireRed, então a substituição posterior na camada de texto é o
 * único caminho que trata os quatro motores (inclusive o de nuvem) por igual.
 * São funções puras, testáveis por completo.
 *
 * Regras de correspondência:
 * - Termos em alfabeto latino ganham proteção de limite de palavra ("IA" não
 *   toca em "MAIS") e ignoram maiúsculas; escritas ideográficas combinam como
 *   subcadeia direta
 * - Quando vários termos combinam ao mesmo tempo, o termo errado mais longo tem
 *   prioridade; a substituição é numa passagem só, e o resultado de uma
 *   substituição nunca é reescrito por outro termo
 * - A linha do tempo por palavra da frase alterada é reconstruída pela largura
 *   dos caracteres (reaproveitando a esteira da correção no clique), e o karaokê
 *   não sai do lugar
 */
import type { GlossaryEntry, Transcript, TranscriptSegment } from "./api-types";
import { rebuildWords } from "./edit-transcript";

const LATIN_RE = /[A-Za-z0-9]/;
// Faixas de escritas ideográficas (ideogramas CJK, kana e hangul), escritas como
// escapes Unicode para que o código-fonte não carregue esses caracteres.
const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** Leitura tolerante do glossário vindo do disco ou do IPC: remove espaços e descarta entradas inválidas e as que apontam para si mesmas. */
export function sanitizeGlossary(raw: unknown): GlossaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const wrong = typeof (item as GlossaryEntry).wrong === "string" ? (item as GlossaryEntry).wrong.trim() : "";
    const right = typeof (item as GlossaryEntry).right === "string" ? (item as GlossaryEntry).right.trim() : "";
    if (!wrong || !right || wrong === right) continue;
    const key = wrong.toLowerCase();
    if (seen.has(key)) continue; // do mesmo termo errado, só a primeira entrada fica
    seen.add(key);
    out.push({ wrong, right });
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Trecho de correspondência de um termo errado: em alfabeto latino, ganha proteção de limite de palavra nas duas pontas, para não atingir uma palavra mais longa. */
function entryPattern(wrong: string): string {
  const head = LATIN_RE.test(wrong[0]) ? "(?<![A-Za-z0-9])" : "";
  const tail = LATIN_RE.test(wrong[wrong.length - 1]) ? "(?![A-Za-z0-9])" : "";
  return `${head}${escapeRegExp(wrong)}${tail}`;
}

/**
 * Aplica o glossário a um texto. O termo errado mais longo tem prioridade (a
 * alternância é ordenada por tamanho, do maior para o menor) e a substituição é
 * feita numa passagem só — o resultado de uma entrada nunca é atingido por outra.
 * A correspondência em alfabeto latino ignora maiúsculas.
 */
export function applyGlossaryToText(text: string, entries: GlossaryEntry[]): string {
  const list = sanitizeGlossary(entries);
  if (list.length === 0 || !text) return text;
  const sorted = [...list].sort((a, b) => b.wrong.length - a.wrong.length);
  const byKey = new Map(sorted.map((e) => [e.wrong.toLowerCase(), e.right]));
  const re = new RegExp(sorted.map((e) => entryPattern(e.wrong)).join("|"), "giu");
  return text.replace(re, (m) => byKey.get(m.toLowerCase()) ?? m);
}

export interface GlossaryApplyResult {
  transcript: Transcript;
  /** Quantas frases foram corrigidas; 0 significa que a referência original de transcript não mudou. */
  replaced: number;
}

/**
 * Aplica o glossário a uma transcrição inteira: só as frases que mudaram são
 * reconstruídas (com a linha do tempo por palavra recalculada pela largura dos
 * caracteres e a identificação do falante preservada), e as demais mantêm a
 * referência original; se nenhuma frase mudou, a mesma referência de transcript
 * é devolvida como está.
 */
export function applyGlossaryToTranscript(transcript: Transcript, entries: GlossaryEntry[]): GlossaryApplyResult {
  const list = sanitizeGlossary(entries);
  if (list.length === 0) return { transcript, replaced: 0 };
  let replaced = 0;
  const segments = transcript.segments.map((seg): TranscriptSegment => {
    const text = applyGlossaryToText(seg.text, list);
    if (text === seg.text) return seg;
    replaced++;
    const words = rebuildWords(text, seg.startSec, seg.endSec).map((w) =>
      seg.speaker !== undefined ? { ...w, speaker: seg.speaker } : w
    );
    return { ...seg, text, words, glossaryApplied: true };
  });
  if (replaced === 0) return { transcript, replaced: 0 };
  return { transcript: { ...transcript, segments }, replaced };
}

/** Contagem de frases atingidas (o N de "aplicar a todo o material (N ocorrências)"). */
export function countGlossaryHits(transcript: Transcript, entries: GlossaryEntry[]): number {
  const list = sanitizeGlossary(entries);
  if (list.length === 0) return 0;
  let n = 0;
  for (const seg of transcript.segments) {
    if (applyGlossaryToText(seg.text, list) !== seg.text) n++;
  }
  return n;
}

/** Tamanho máximo de uma entrada: passando disso, é reescrita de frase inteira e não correção de termo, então nada é sugerido para o glossário. */
const MAX_TERM_LEN = 16;

/**
 * Extrai, a partir do texto antes e depois da correção, uma entrada candidata
 * "errado → certo": corta o maior prefixo e o maior sufixo em comum e depois
 * expande os limites até a palavra latina inteira. Inserção pura, remoção pura e
 * alteração longa demais (reescrita da frase inteira) devolvem null — esses casos
 * não são correção de termo.
 */
export function diffReplacement(oldText: string, newText: string): GlossaryEntry | null {
  const a = Array.from(oldText.trim());
  const b = Array.from(newText.trim());
  if (a.join("") === b.join("")) return null;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  // Expansão dos limites: não corte uma palavra latina pela metade ("colour" → "color" precisa dar a palavra inteira, e não "u" → "")
  while (p > 0 && LATIN_RE.test(a[p - 1]) && (LATIN_RE.test(a[p] ?? "") || LATIN_RE.test(b[p] ?? ""))) p--;
  while (
    s > 0 &&
    LATIN_RE.test(a[a.length - s]) &&
    (LATIN_RE.test(a[a.length - 1 - s] ?? "") || LATIN_RE.test(b[b.length - 1 - s] ?? ""))
  )
    s--;
  // Se, depois de expandir a palavra latina, um dos lados continuar vazio, é inserção ou remoção pura (não é correção de grafia), então não vira entrada
  if (a.length - s - p === 0 || b.length - s - p === 0) return null;
  // Uma entrada de um caractere só é perigosa demais (um único ideograma pode
  // atingir uma palavra maior que o contém): os caracteres ideográficos vizinhos
  // que são comuns aos dois lados são trazidos de volta para dentro da entrada,
  // até que os dois lados tenham pelo menos dois caracteres
  while ((a.length - s - p < 2 || b.length - s - p < 2) && s > 0 && CJK_RE.test(a[a.length - s])) s--;
  while ((a.length - s - p < 2 || b.length - s - p < 2) && p > 0 && CJK_RE.test(a[p - 1])) p--;
  const wrong = a.slice(p, a.length - s).join("").trim();
  const right = b.slice(p, b.length - s).join("").trim();
  if (!wrong || !right || wrong === right) return null;
  if (wrong.length > MAX_TERM_LEN || right.length > MAX_TERM_LEN) return null;
  return { wrong, right };
}

/** Funde uma entrada no glossário: o mesmo termo errado (ignorando maiúsculas) substitui o termo certo antigo, e o resto é acrescentado. */
export function upsertGlossaryEntry(entries: GlossaryEntry[], entry: GlossaryEntry): GlossaryEntry[] {
  const list = sanitizeGlossary(entries);
  const add = sanitizeGlossary([entry]);
  if (add.length === 0) return list;
  const key = add[0].wrong.toLowerCase();
  const rest = list.filter((e) => e.wrong.toLowerCase() !== key);
  return [...rest, add[0]];
}
