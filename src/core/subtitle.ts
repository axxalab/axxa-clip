/**
 * Karaoke caption generation: word-level transcript timestamps → an ASS file
 * with per-word `\k` highlighting, burned into clips via ffmpeg's subtitles
 * filter (libass). Everything here is a pure string builder — unit-testable
 * without ffmpeg; only the caller touches the filesystem.
 */
import type { Transcript, TranscriptWord } from "../shared/api-types";
import { hexToAssColor, hexToAssInline, isValidHex } from "./brand";

export interface AssLayout {
  playResX: number;
  playResY: number;
  fontSize: number;
  /** Distance from the bottom edge to the caption block. */
  marginV: number;
  marginH: number;
  outline: number;
  /** Max visual width units per line (CJK char = 2 units, latin char = 1). */
  maxLineUnits: number;
}

/**
 * 9:16 output — caption baseline lands at ~71% of frame height, inside the
 * 62-72% band that clears every major platform's UI overlays (Douyin/Kuaishou
 * bottom bars, TikTok's taller action zone, Shorts' right rail).
 */
export const VERTICAL_LAYOUT: AssLayout = {
  playResX: 1080,
  playResY: 1920,
  fontSize: 78,
  marginV: 560,
  marginH: 60,
  outline: 4,
  maxLineUnits: 22,
};

/** 16:9 output — classic bottom-center captions. */
export const HORIZONTAL_LAYOUT: AssLayout = {
  playResX: 1920,
  playResY: 1080,
  fontSize: 66,
  marginV: 90,
  marginH: 120,
  outline: 3,
  maxLineUnits: 36,
};

/**
 * The bundled caption font (resources/fonts/SourceHanSansSC-Bold.otf, OFL).
 * Shipping our own font + passing fontsdir to the subtitles filter is the only
 * way to get identical CJK rendering on every machine — fontconfig fallback is
 * a lottery (missing zh fonts render as tofu boxes on bare Windows installs).
 */
export const BUNDLED_FONT_FAMILY = "Source Han Sans SC";

/** Bundled font first; per-platform system font as a fontconfig fallback. */
export function defaultFontName(platform: NodeJS.Platform = process.platform): string {
  void platform;
  return BUNDLED_FONT_FAMILY;
}

// Faixas de escritas ideográficas (kana, ideogramas CJK e hangul). Escritas como
// escapes Unicode: o código-fonte deste projeto não carrega esses caracteres, mas a
// medição de largura precisa continuar correta para material gravado nesses idiomas.
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/** Visual width units of a token: CJK chars count double. */
export function widthUnits(text: string): number {
  let units = 0;
  for (const ch of text) units += CJK_RE.test(ch) ? 2 : 1;
  return units;
}

/** Pull the words a clip covers out of the full transcript (by word midpoint). */
export function sliceWords(transcript: Transcript, startSec: number, endSec: number): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const seg of transcript.segments) {
    if (seg.endSec < startSec || seg.startSec > endSec) continue;
    for (const w of seg.words) {
      const mid = (w.startSec + w.endSec) / 2;
      if (mid >= startSec && mid <= endSec) out.push(w);
    }
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

const HARD_PUNCT_END = /[.!?…\u3002\uff01\uff1f]$/;
/**
 * Clause-boundary punctuation (comma / ideographic comma / semicolon / colon).
 * The ASR punctuation model places these at real syntactic pauses, so breaking
 * here is the keyless equivalent of an LLM-inserted semantic [br] — no extra
 * model call, no cloud key, works on every clip. Only fires once the line is
 * substantial (SOFT_BREAK_MIN_FRAC of the width cap) so short clauses still
 * merge into one readable line instead of fragmenting on every comma.
 */
const SOFT_PUNCT_END = /[,;:\uff0c\u3001\uff1b\uff1a]$/;
const SOFT_BREAK_MIN_FRAC = 0.5;
/**
 * Structural / aspectual / modal particles a Chinese line may safely end on.
 * When a comma-free clause is longer than the width cap it would otherwise
 * split mid-phrase; backing the break up to the nearest such particle keeps
 * expressão inteira ("…o preço de / dez reais…" e não "…o preço de dez / reais…"). É o
 * for an LLM semantic break on long clauses; falls back to a width cut when the
 * run has no particle either.
 */
/**
 * Palavras funcionais em que uma linha de legenda em português NÃO deve terminar.
 * Quando uma oração sem vírgula é mais longa que o limite de largura, ela seria
 * partida no meio da expressão; recuar a quebra até a última palavra que não é uma
 * dessas mantém a expressão inteira ("…o preço de / dez reais…" e não
 * "…o preço de dez / reais…"). É o substituto sem chave de API para a quebra
 * semântica que um LLM faria em orações longas.
 */
const NO_BREAK_AFTER_PT =
  /^(?:de|da|do|das|dos|a|o|as|os|um|uma|uns|umas|em|na|no|nas|nos|para|pra|por|pelo|pela|pelos|pelas|com|sem|sob|sobre|entre|e|ou|mas|que|se|ao|aos|à|às|meu|minha|seu|sua|nosso|nossa|este|esta|esse|essa|aquele|aquela|mais|menos|muito|bem|já|só|não|é)$/i;

/**
 * Partículas estruturais, de aspecto e modais em que uma linha em escrita ideográfica
 * pode terminar com segurança (escritas como escapes Unicode, para o código-fonte não
 * carregar ideogramas). Material gravado nesses idiomas continua quebrando a linha no
 * lugar certo.
 */
const BREAK_AFTER_PARTICLE_CJK =
  /[\u7684\u4e86\u7740\u8fc7\u5730\u5f97\u5427\u5462\u5417\u554a\u561b\u5440]$/;

/** Diz se uma linha pode terminar depois desta palavra sem partir a expressão no meio. */
function isPhraseBreakAfter(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (CJK_RE.test(t)) return BREAK_AFTER_PARTICLE_CJK.test(t);
  const bare = t.replace(/[^\p{L}\p{N}]/gu, "");
  return bare.length > 0 && !NO_BREAK_AFTER_PT.test(bare);
}
const LOOKBACK_MIN_FRAC = 0.35;

/**
 * How long a caption line may hold on screen waiting for the next one. A line
 * ends the instant its last word does, which flashes a blank frame between
 * consecutive lines of continuous speech (the default karaoke/keyword styles
 * showed this). Holding until the next line begins removes the flicker — but
 * only across a gap the line grouper did NOT treat as a real pause
 * (≤ GAP_BREAK_SEC); a longer, genuine pause still clears the caption.
 */
export const CAPTION_HOLD_MAX_SEC = 0.8;

/** Product defaults for reading speed, not an accuracy/confidence score. */
export function captionReadingCps(text: string): number {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 7;
  if (/\p{Script=Han}/u.test(text)) return 9;
  if (/\p{Script=Hangul}/u.test(text)) return 12;
  return 20;
}

export function captionReadableChars(text: string): number {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)).filter((part) => !/^\s+$/u.test(part.segment)).length;
}

export interface CaptionReadabilityOptions { readability?: boolean; endSec?: number }
export interface PlannedCaptionLine { words: TranscriptWord[]; startSec: number; endSec: number; maxCps: number }

/** Only display events change: speech/karaoke word timestamps remain intact.
 * Short neighboring lines may merge within width, speaker and splice bounds. */
export function planReadableCaptions(words: TranscriptWord[], maxUnits: number, forcedBreaks: number[] = [], endSec = Infinity): PlannedCaptionLine[] {
  const breaks = [...forcedBreaks].filter(Number.isFinite).sort((a, b) => a - b);
  const grouped = groupWordsIntoLines(words, maxUnits, breaks);
  const merged: TranscriptWord[][] = [];
  for (const line of grouped) {
    const previous = merged[merged.length - 1];
    const prevEnd = previous?.[previous.length - 1].endSec;
    const start = line[0].startSec;
    const short = previous && prevEnd - previous[0].startSec < 0.7;
    const sameSpeaker = previous && new Set([...previous, ...line].map((w) => w.speaker ?? -1)).size === 1;
    const crosses = previous && breaks.some((b) => b > previous[0].startSec && b <= start + 1e-6);
    if (short && sameSpeaker && !crosses && start >= prevEnd - 0.001 && start - prevEnd <= 0.25 &&
        [...previous, ...line].reduce((n, w) => n + widthUnits(w.text), 0) <= maxUnits) previous.push(...line);
    else merged.push([...line]);
  }
  return merged.map((line, i) => {
    const startSec = line[0].startSec;
    const lastEnd = line[line.length - 1].endSec;
    const text = line.map((w) => w.text).join("");
    const maxCps = captionReadingCps(text);
    const wanted = Math.max(lastEnd, startSec + 0.7, startSec + captionReadableChars(text) / maxCps);
    const nextStart = merged[i + 1]?.[0].startSec ?? Infinity;
    const splice = breaks.find((b) => b > startSec + 1e-6) ?? Infinity;
    const boundary = Math.min(endSec, nextStart, splice);
    const hold = Math.min(lastEnd + CAPTION_HOLD_MAX_SEC, Math.max(wanted, Math.min(nextStart, lastEnd + 0.2)));
    return { words: line, startSec, endSec: Math.max(startSec, Math.min(hold, boundary)), maxCps };
  });
}

/**
 * Numa quebra por transbordo de largura, encontra dentro de `line` a última palavra
 * limite bom que não parte a expressão, e que ainda deixa um começo substancial (de
 * LOOKBACK_MIN_FRAC do limite ou mais). Devolve o índice depois do qual quebrar, ou -1
 * quando não existe limite bom.
 */
function particleBreakIndex(line: TranscriptWord[], maxLineUnits: number): number {
  const min = maxLineUnits * LOOKBACK_MIN_FRAC;
  let prefix = 0;
  const prefixUnits = line.map((wd) => (prefix += widthUnits(wd.text)));
  for (let k = line.length - 2; k >= 0; k--) {
    if (prefixUnits[k] >= min && isPhraseBreakAfter(line[k].text)) return k;
  }
  return -1;
}

/**
 * Break the word stream into caption lines: width cap, silence-gap breaks,
 * sentence-final punctuation breaks, clause-boundary (soft-punctuation) breaks
 * once a line is substantial, and forced breaks (e.g. jump-cut splice points,
 * where the silence that used to separate sentences no longer exists).
 */
export function groupWordsIntoLines(
  words: TranscriptWord[],
  maxLineUnits: number,
  forcedBreaks: number[] = []
): TranscriptWord[][] {
  const GAP_BREAK_SEC = 0.8;
  const softBreakMin = maxLineUnits * SOFT_BREAK_MIN_FRAC;
  const lines: TranscriptWord[][] = [];
  let line: TranscriptWord[] = [];
  let units = 0;
  let bi = 0;
  const flush = (): void => {
    if (line.length > 0) lines.push(line);
    line = [];
    units = 0;
  };
  for (const w of words) {
    let forced = false;
    while (bi < forcedBreaks.length && w.startSec >= forcedBreaks[bi] - 1e-6) {
      forced = true;
      bi++;
    }
    const wUnits = widthUnits(w.text);
    const prev = line[line.length - 1];
    const gapBreak = prev !== undefined && w.startSec - prev.endSec > GAP_BREAK_SEC;
    const speakerBreak = prev !== undefined && prev.speaker !== w.speaker && (prev.speaker !== undefined || w.speaker !== undefined);
    const overflow = units + wUnits > maxLineUnits;
    if (line.length > 0 && (forced || overflow || gapBreak || speakerBreak)) {
      // Width-only overflow backs the break up to the nearest particle boundary
      // so a long comma-free clause doesn't split mid-phrase; the trailing words
      // carry onto the next line with `w`. Forced (jump-cut) and silence-gap
      // breaks are real boundaries — honor them exactly, no look-back.
      let carry: TranscriptWord[] = [];
      if (overflow && !forced && !gapBreak && !speakerBreak) {
        const k = particleBreakIndex(line, maxLineUnits);
        if (k >= 0 && k < line.length - 1) carry = line.splice(k + 1);
      }
      flush();
      if (carry.length > 0) {
        line = carry;
        units = carry.reduce((s, c) => s + widthUnits(c.text), 0);
      }
    }
    line.push(w);
    units += wUnits;
    // Hard sentence end always flushes; a clause boundary flushes only once the
    // line already carries enough to stand on its own (avoids one-word lines).
    if (HARD_PUNCT_END.test(w.text)) flush();
    else if (SOFT_PUNCT_END.test(w.text) && units >= softBreakMin) flush();
  }
  flush();
  return lines;
}

/**
 * Merge each run of words covered by a keyword into ONE word so line breaking
 * can never split a keyword (which would silently kill its highlight).
 */
export function mergeKeywordWords(words: TranscriptWord[], keywords: string[]): TranscriptWord[] {
  if (keywords.length === 0 || words.length === 0) return words;
  const spans: Array<{ from: number; to: number }> = [];
  let joined = "";
  for (let i = 0; i < words.length; i++) {
    const from = joined.length;
    joined += words[i].text;
    spans.push({ from, to: joined.length });
    if (needsSpaceAfter(words[i].text, words[i + 1]?.text)) joined += " ";
  }
  const haystack = joined.toLowerCase();
  const covered = new Array<boolean>(words.length).fill(false);
  for (const kw of keywords) {
    const needle = kw.trim().toLowerCase();
    if (!needle) continue;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      const to = at + needle.length;
      spans.forEach((s, i) => {
        if (s.from < to && s.to > at) covered[i] = true;
      });
    }
  }
  const out: TranscriptWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const prev = out[out.length - 1];
    if (covered[i] && i > 0 && covered[i - 1] && prev) {
      const space = needsSpaceAfter(prev.text, words[i].text) ? " " : "";
      prev.text += space + words[i].text;
      prev.endSec = words[i].endSec;
    } else {
      out.push({ ...words[i] });
    }
  }
  return out;
}

/** ASS timestamp: H:MM:SS.CC (centiseconds). */
export function toAssTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const cs = Math.round(clamped * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** ASS override braces / backslashes would corrupt the event line — strip them. */
function escapeAssText(text: string): string {
  return text.replace(/[{}\\]/g, "").replace(/[\r\n]+/g, " ");
}

/** Latin↔latin token boundaries need a space; CJK joins bare. */
export function needsSpaceAfter(current: string, next: string | undefined): boolean {
  if (!next) return false;
  return !CJK_RE.test(current.slice(-1)) && !CJK_RE.test(next.charAt(0));
}

/**
 * One line of karaoke text: `{\k<cs>}word` per word. Each word's sweep runs
 * until the NEXT word starts (absorbing inter-word silence) so the highlight
 * moves continuously instead of stalling mid-line.
 */
function karaokeText(line: TranscriptWord[]): string {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i++) {
    const w = line[i];
    const next = line[i + 1];
    const sweepEnd = next ? next.startSec : w.endSec;
    const cs = Math.max(1, Math.round((sweepEnd - w.startSec) * 100));
    const space = needsSpaceAfter(w.text, next?.text) ? " " : "";
    parts.push(`{\\k${cs}}${escapeAssText(w.text)}${space}`);
  }
  return parts.join("");
}

/**
 * Paleta das marcas de falante (a mesma origem das cores de falante do template de
 * balão; a marca não usa branco, porque precisa se distinguir do texto branco).
 * As cores são escolhidas em laço, na "ordem da primeira fala".
 */
const SPEAKER_LABEL_HEX = ["#7FD4FF", "#FFD36B", "#9DFF8F", "#FF9DC4"];

/** O falante dominante de uma linha ou bloco: por maioria da duração das palavras; sem nenhuma identificação de falante, devolve undefined. */
export function lineSpeaker(line: TranscriptWord[]): number | undefined {
  const byId = new Map<number, number>();
  for (const w of line) {
    if (w.speaker === undefined) continue;
    byId.set(w.speaker, (byId.get(w.speaker) ?? 0) + Math.max(0, w.endSec - w.startSec));
  }
  let best: number | undefined;
  let bestSec = -1;
  for (const [id, sec] of byId) {
    if (sec > bestSec) { best = id; bestSec = sec; }
  }
  return best;
}

/**
 * Marcador de falante (a v0.14 e o "assistir conversa sem som"): só é ativado quando a
 * lista de palavras tem 2 ou mais falantes; sempre que o falante dominante da linha ou
 * do bloco muda em relação à linha anterior, uma pequena marca colorida "A:" é
 * colocada no começo da linha (as letras são atribuídas na ordem da primeira fala
 * dentro da lista inteira, e ficam estáveis de uma linha para a outra). A marca só
 * aparece quando a pessoa muda, e não fica repetindo — assim quem assiste um corte de
 * conversa sem som consegue ver quem está falando, o que é padrão nos cortes desse tipo
 * em 2026.
 * A função devolvida guarda estado (lembra quem era o falante da linha anterior), e
 * cada clipe cria uma nova.
 * A função devolvida guarda estado (lembra quem era o falante da linha anterior), e cada clipe cria uma nova.
 */
export function createSpeakerLabeler(
  words: TranscriptWord[],
  enabled: boolean
): (line: TranscriptWord[]) => string {
  const order = new Map<number, number>();
  for (const w of words) {
    if (w.speaker !== undefined && !order.has(w.speaker)) order.set(w.speaker, order.size);
  }
  if (!enabled || order.size < 2) return () => "";
  let prev: number | undefined;
  return (line) => {
    const sp = lineSpeaker(line);
    if (sp === undefined || sp === prev) return "";
    prev = sp;
    const idx = order.get(sp) ?? order.size;
    const letter = String.fromCharCode(65 + (idx % 26));
    const color = hexToAssInline(SPEAKER_LABEL_HEX[idx % SPEAKER_LABEL_HEX.length]) ?? WHITE_INLINE;
    // O "A:" colorido, um tamanho menor; o \c e o \fscx100 sozinhos devolvem a cor e a escala aos valores padrão do estilo
    return `{\\c${color}\\fscx85\\fscy85}${letter}:{\\c\\fscx100\\fscy100}`;
  };
}

/** ASS colors are &HAABBGGRR. Highlight = flame orange, base = white. */
const EMBER_COLOR = "&H000D6EFF"; // #FF6E0D
const WHITE_COLOR = "&H00FFFFFF";
const OUTLINE_COLOR = "&H00201510";
/** Inline override forms (no alpha byte). */
const EMBER_INLINE = "&H0D6EFF&";
const WHITE_INLINE = "&HFFFFFF&";

/**
 * Caption style presets (2026 short-video canon):
 *  - karaoke: whole line visible, words light up as spoken
 *  - keyword: whole line visible, LLM-picked keywords tinted & slightly larger
 *  - pop: 2-4 character chunks appear one at a time with a damped bounce,
 *    current word lit in the highlight color (word-by-word emphasis)
 *  - hormozi: letras grandes de impacto — blocos curtos, corpo enorme em negrito,
 *    sombra dura, centralizado um pouco acima, com o karaokê acendendo palavra por
 *    palavra e as palavras latinas em maiúsculas (o estilo Hormozi, comum em vídeo
 *    curto de venda e de marketing lá fora)
 *  - minimal: minimalista dinâmico — o que virou padrão em 2026, depois do cansaço do
 *    Hormozi: blocos curtos entrando no tempo da fala, letras brancas com contorno fino
 *    e sombra suave, sem maiúsculas, e no máximo 1 palavra por bloco destacada na cor
 *    da marca (com prioridade para número e palavra-chave), mais uma entrada contida de
 *    96% para 100% (fonte da pesquisa: RESEARCH-2026-08-CLIP-QUALITY.md, seção 2)
 */
export type CaptionStyle = "karaoke" | "keyword" | "pop" | "hormozi" | "minimal";

export interface CaptionOptions extends CaptionReadabilityOptions {
  fontName?: string;
  /** Verbatim keywords to emphasize (keyword style). */
  keywords?: string[];
  /** Timeline positions that must start a new line/chunk (jump-cut splices). */
  forcedBreaks?: number[];
  /** Burn the clip title into the top safe zone for the whole clip. */
  titleCard?: { text: string; durationSec: number };
  /**
   * Gancho de abertura: a chamada da IA (a frase de suspense) queimada em letras grandes
   * no terço superior durante os primeiros segundos do clipe — é o gancho de texto dos 3
   * segundos de ouro para o qual a chamada foi escrita.
   */
  openingHook?: { text: string; durationSec: number };
  /** Cor principal de destaque da marca, no formato "#RRGGBB" (o aceso do karaokê, a ênfase na palavra-chave e o texto do gancho); ausente usa o laranja de chama. */
  highlightHex?: string;
  /**
   * As linhas de tradução da legenda bilíngue (no nível da frase inteira), com a mesma
   * base de tempo de words (deslocada igualmente por clipStartSec).
   * São renderizadas como a trilha Trans, menor, abaixo da legenda principal.
   */
  translation?: Array<{ startSec: number; endSec: number; text: string }>;
  /** Sinalização explícita de IA: a frase pequena "Gerado por IA" no canto superior esquerdo, visível do começo ao fim (a sinalização explícita que as regras de rotulagem exigem). */
  aigcBadge?: { durationSec: number };
  /**
   * Marca de falante (v0.14): em clipes com várias pessoas, a troca de falante coloca uma
   * marca colorida "A:" no começo da linha, para quem assiste uma conversa sem som não se
   * perder. Só vale quando a lista de palavras traz 2 ou mais falantes identificados.
   */
  speakerLabels?: boolean;
}

/** Title block sits below platform top overlays (~8% of height) with air. */
function titleMarginV(layout: AssLayout): number {
  return Math.round(layout.playResY * 0.1);
}

/** Opening hook sits in the upper third — below the title, clear of center faces. */
function hookMarginV(layout: AssLayout): number {
  return Math.round(layout.playResY * 0.3);
}

/** Tamanho da fonte da trilha de tradução: 0,6 vez o da legenda principal — é a hierarquia entre principal e secundária na legenda bilíngue. */
export function transFontSize(layout: AssLayout): number {
  return Math.round(layout.fontSize * 0.6);
}

/** Posição da trilha de tradução: logo abaixo do bloco da legenda principal (um marginV menor fica mais perto da borda de baixo), com uma reserva para não encostar na borda. */
export function transMarginV(layout: AssLayout): number {
  return Math.max(14, layout.marginV - Math.round(transFontSize(layout) * 1.7));
}

function assHeader(style: CaptionStyle, layout: AssLayout, fontName: string, highlightHex?: string): string[] {
  // A cor de destaque da marca substitui o laranja de chama padrão (a cor do aceso do karaokê e a do texto do gancho de abertura vêm da mesma fonte)
  const highlight = (highlightHex && hexToAssColor(highlightHex)) || EMBER_COLOR;
  // karaoke/hormozi: Primary = sung color, Secondary = not-yet-sung; others: plain white
  const primary = style === "karaoke" || style === "hormozi" ? highlight : WHITE_COLOR;
  const fontSize =
    style === "pop" ? Math.round(layout.fontSize * 1.45)
    : style === "hormozi" ? Math.round(layout.fontSize * 1.5)
    : style === "minimal" ? Math.round(layout.fontSize * 1.12)
    : layout.fontSize;
  // hormozi: contorno mais grosso mais sombra dura para sustentar as letras grandes; a
  // posição sobe para a linha de 60% da altura (mais chamativa que a legenda de rodapé e
  // ao mesmo tempo longe do rosto no centro) — é uma posição fixa, que não acompanha o
  // nível de posição da marca
  // minimal: contorno fino mais um pouco de sombra suave — a textura minimalista dinâmica de "letra branca com sombra macia"
  const outline =
    style === "hormozi" ? layout.outline + 3
    : style === "minimal" ? Math.max(2, layout.outline - 2)
    : layout.outline;
  const shadow = style === "hormozi" ? 3 : style === "minimal" ? 1 : 0;
  const captionMarginV = style === "hormozi" ? Math.round(layout.playResY * 0.4) : layout.marginV;
  const titleSize = Math.round(layout.fontSize * 0.82);
  const hookSize = Math.round(layout.fontSize * 1.25);
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${layout.playResX}`,
    `PlayResY: ${layout.playResY}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${fontName},${fontSize},${primary},${WHITE_COLOR},${OUTLINE_COLOR},&H7F000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,${layout.marginH},${layout.marginH},${captionMarginV},1`,
    // title card: opaque-box style (BorderStyle=3) → soft dark plate behind text
    `Style: Title,${fontName},${titleSize},${WHITE_COLOR},${WHITE_COLOR},&H73000000,&H73000000,-1,0,0,0,100,100,0,0,3,12,0,8,${layout.marginH},${layout.marginH},${titleMarginV(layout)},1`,
    // opening hook: ember text on a dark plate, big, upper-third (Alignment 8 + high MarginV)
    `Style: Hook,${fontName},${hookSize},${highlight},${WHITE_COLOR},&H73000000,&H73000000,-1,0,0,0,100,100,0,0,3,14,0,8,${layout.marginH},${layout.marginH},${hookMarginV(layout)},1`,
    // Trilha de tradução bilíngue: letras brancas menores, logo abaixo do bloco da legenda principal (no nível da frase inteira, sem participar do karaokê)
    `Style: Trans,${fontName},${transFontSize(layout)},${WHITE_COLOR},${WHITE_COLOR},${OUTLINE_COLOR},&H7F000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, layout.outline - 1)},0,2,${layout.marginH},${layout.marginH},${transMarginV(layout)},1`,
    // Sinalização explícita de IA: uma frase pequena e semitransparente no canto superior esquerdo (Alignment 7, que evita a posição padrão da marca d'água, no canto superior direito)
    `Style: Aigc,${fontName},${Math.round(layout.fontSize * 0.42)},&H55FFFFFF,${WHITE_COLOR},&H55000000,&H7F000000,0,0,0,0,100,100,0,0,1,2,0,7,${Math.round(layout.marginH * 0.7)},${layout.marginH},${Math.round(layout.playResY * 0.035)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
}

/** Manual title wrapping (no libunibreak in ffmpeg-static): ~14 CJK units/line, max 2 lines. */
export function wrapTitle(text: string, maxUnits = 28): string {
  const chars = Array.from(escapeAssText(text));
  let units = 0;
  let breakAt = -1;
  for (let i = 0; i < chars.length; i++) {
    units += CJK_RE.test(chars[i]) ? 2 : 1;
    if (units > maxUnits && breakAt === -1) breakAt = i;
  }
  if (breakAt === -1) return chars.join("");
  return `${chars.slice(0, breakAt).join("")}\\N${chars.slice(breakAt).join("")}`;
}

function dialogue(startSec: number, endSec: number, text: string): string {
  return `Dialogue: 0,${toAssTime(startSec)},${toAssTime(endSec)},Caption,,0,0,0,,${text}`;
}

/**
 * Keyword style: mark which words fall inside any keyword occurrence, then
 * wrap those runs with a color+scale override. Matching runs on the joined
 * line text (same spacing rules as display), case-insensitive.
 */
export function keywordText(line: TranscriptWord[], keywords: string[], highlightHex?: string): string {
  // A cor de destaque da marca substitui o laranja de chama padrão (na forma de sobrescrita \c dentro da linha)
  const highlightInline = (highlightHex && hexToAssInline(highlightHex)) || EMBER_INLINE;
  // joined text + each word's [start,end) position inside it
  const spans: Array<{ from: number; to: number }> = [];
  let joined = "";
  for (let i = 0; i < line.length; i++) {
    const from = joined.length;
    joined += line[i].text;
    spans.push({ from, to: joined.length });
    if (needsSpaceAfter(line[i].text, line[i + 1]?.text)) joined += " ";
  }
  const haystack = joined.toLowerCase();
  const covered = new Array<boolean>(line.length).fill(false);
  for (const kw of [...new Set(keywords)].sort((a, b) => b.length - a.length)) {
    const needle = kw.trim().toLowerCase();
    if (!needle) continue;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      const to = at + needle.length;
      spans.forEach((s, i) => {
        if (s.from < to && s.to > at) covered[i] = true;
      });
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < line.length; i++) {
    if (covered[i] && (i === 0 || !covered[i - 1])) parts.push(`{\\c${highlightInline}\\fscx108\\fscy108}`);
    if (!covered[i] && i > 0 && covered[i - 1]) parts.push(`{\\c${WHITE_INLINE}\\fscx100\\fscy100}`);
    parts.push(escapeAssText(line[i].text));
    if (needsSpaceAfter(line[i].text, line[i + 1]?.text)) parts.push(" ");
  }
  return parts.join("");
}

/** Entrada amortecida do pop: 0,8 → 1,04 → 1,0 em 165 ms no total — com elasticidade, mas sem exagero (ajustado para a sensação de uma mola bem amortecida). */
const POP_INTRO = "{\\fscx80\\fscy80\\t(0,90,\\fscx104\\fscy104)\\t(90,165,\\fscx100\\fscy100)}";

/** Pop chunks: 2-4 CJK chars (or 1-2 latin words) shown one at a time. */
const POP_MAX_UNITS = 8;

/** De quantos milissegundos o aceso da palavra atual se antecipa: a sensação de "acompanhar a mão" é melhor quando o destaque vem de 50 a 100 ms antes da fala. */
const POP_HIGHLIGHT_LEAD_MS = 80;

/**
 * Texto do bloco no estilo pop: a "palavra atual" do bloco acende na cor da marca e
 * volta ao branco quando a palavra seguinte assume.
 * Trocar a cor palavra por palavra é a forma dominante de ênfase na legenda palavra a
 * palavra de hoje (melhor que varrer a frase inteira, que o bloco de fundo e que
 * aumentar a letra).
 * Um \t de duração zero é uma troca instantânea; o tempo é relativo ao início do evento
 * do bloco (que é o início da primeira palavra dele). Função pura, testável.
 */
export function popText(unit: TranscriptWord[], chunkStartSec: number, highlightHex?: string): string {
  const highlightInline = (highlightHex && hexToAssInline(highlightHex)) || EMBER_INLINE;
  const onAt = (j: number): number =>
    Math.max(0, Math.round((unit[j].startSec - chunkStartSec) * 1000) - POP_HIGHLIGHT_LEAD_MS);
  const parts: string[] = [];
  for (let j = 0; j < unit.length; j++) {
    const on = onAt(j);
    const off = Math.max(
      on + 1,
      j + 1 < unit.length ? onAt(j + 1) : Math.round((unit[j].endSec - chunkStartSec) * 1000)
    );
    const tags =
      on > 0
        ? `{\\c${WHITE_INLINE}\\t(${on},${on},\\c${highlightInline})\\t(${off},${off},\\c${WHITE_INLINE})}`
        : `{\\c${highlightInline}\\t(${off},${off},\\c${WHITE_INLINE})}`;
    parts.push(tags + escapeAssText(unit[j].text));
    if (needsSpaceAfter(unit[j].text, unit[j + 1]?.text)) parts.push(" ");
  }
  return parts.join("");
}

/** Entrada rápida do Hormozi: entra e para de uma vez (mais firme e mais seca que o salto do pop). */
const HORMOZI_INTRO = "{\\fscx82\\fscy82\\t(0,70,\\fscx100\\fscy100)}";

/** Largura do bloco curto do Hormozi: cerca de 2 a 3 palavras por tela. */
const HORMOZI_MAX_UNITS = 10;

/** Entrada do minimalista dinâmico: de 96% para 100% em 80 ms — tem vida, mas não rouba a cena. */
const MINIMAL_INTRO = "{\\fad(80,0)\\fscx96\\fscy96\\t(0,80,\\fscx100\\fscy100)}";

/** Largura do bloco curto do minimalista dinâmico: no mesmo nível do Hormozi, e como a fonte é um tamanho menor, fica mais arejado. */
const MINIMAL_MAX_UNITS = 10;

/** The exact width budget used by each rendered caption style. */
export function captionMaxLineUnits(style: CaptionStyle, layout: AssLayout): number {
  if (style === "pop") return POP_MAX_UNITS;
  if (style === "hormozi") return HORMOZI_MAX_UNITS;
  if (style === "minimal") return MINIMAL_MAX_UNITS;
  return layout.maxLineUnits;
}

/** Tokens numéricos (incluindo porcentagem e preço): é o destaque de reserva quando nenhuma palavra-chave é encontrada. */
const DIGIT_TOKEN_RE = /[0-9][0-9.,]*%?/;

/**
 * Texto do bloco no minimalista dinâmico: no máximo 1 palavra destacada por bloco (pelo
 * critério da pesquisa, "no máximo 1 palavra por frase, com prioridade para número e
 * palavra-chave"). A prioridade é: o primeiro trecho contínuo em que a palavra-chave foi
 * encontrada > o primeiro token que contém número;
 * sem nenhum dos dois, fica tudo branco. O destaque é a cor da marca mais 8% de aumento
 * (o mesmo vocabulário de ênfase do estilo keyword).
 * Função pura, testável.
 */
export function minimalText(line: TranscriptWord[], keywords: string[], highlightHex?: string): string {
  const highlightInline = (highlightHex && hexToAssInline(highlightHex)) || EMBER_INLINE;
  // Verificação de cobertura da palavra-chave (as mesmas regras de concatenação e de correspondência de keywordText)
  const spans: Array<{ from: number; to: number }> = [];
  let joined = "";
  for (let i = 0; i < line.length; i++) {
    const from = joined.length;
    joined += line[i].text;
    spans.push({ from, to: joined.length });
    if (needsSpaceAfter(line[i].text, line[i + 1]?.text)) joined += " ";
  }
  const haystack = joined.toLowerCase();
  const covered = new Array<boolean>(line.length).fill(false);
  for (const kw of [...new Set(keywords)].sort((a, b) => b.length - a.length)) {
    const needle = kw.trim().toLowerCase();
    if (!needle) continue;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      const to = at + needle.length;
      spans.forEach((s, i) => {
        if (s.from < to && s.to > at) covered[i] = true;
      });
    }
  }
  // Só o primeiro trecho contínuo encontrado é mantido, e o resto volta ao branco — é o "no máximo 1 destaque por bloco"
  let inFirstRun = false;
  let runDone = false;
  for (let i = 0; i < line.length; i++) {
    if (covered[i] && !runDone) {
      inFirstRun = true;
    } else if (inFirstRun) {
      runDone = true;
      inFirstRun = false;
    }
    if (runDone) covered[i] = false;
  }
  // Sem nenhuma palavra-chave: o primeiro token numérico é destacado (preço e porcentagem são pontos de ênfase naturais)
  if (!covered.some(Boolean)) {
    const di = line.findIndex((w) => DIGIT_TOKEN_RE.test(w.text));
    if (di >= 0) covered[di] = true;
  }
  const parts: string[] = [];
  for (let i = 0; i < line.length; i++) {
    if (covered[i] && (i === 0 || !covered[i - 1])) parts.push(`{\\c${highlightInline}\\fscx108\\fscy108}`);
    if (!covered[i] && i > 0 && covered[i - 1]) parts.push(`{\\c${WHITE_INLINE}\\fscx100\\fscy100}`);
    parts.push(escapeAssText(line[i].text));
    if (needsSpaceAfter(line[i].text, line[i + 1]?.text)) parts.push(" ");
  }
  return parts.join("");
}

/**
 * Build a complete ASS document for one clip in the given style. Word
 * timestamps are absolute (source time); `clipStartSec` shifts them.
 */
export function buildCaptionAss(
  words: TranscriptWord[],
  clipStartSec: number,
  layout: AssLayout,
  style: CaptionStyle = "karaoke",
  options: CaptionOptions = {}
): string {
  const fontName = options.fontName ?? defaultFontName();
  const highlightHex = isValidHex(options.highlightHex) ? options.highlightHex : undefined;
  const events: string[] = [];

  if (options.titleCard && options.titleCard.text.trim()) {
    const tc = options.titleCard;
    events.push(
      `Dialogue: 1,${toAssTime(0)},${toAssTime(tc.durationSec)},Title,,0,0,0,,${wrapTitle(tc.text)}`
    );
  }

  // Opening hook (layer 2, above title & captions): the teaser, faded in/out.
  if (options.openingHook && options.openingHook.text.trim()) {
    const hk = options.openingHook;
    events.push(
      `Dialogue: 2,${toAssTime(0)},${toAssTime(hk.durationSec)},Hook,,0,0,0,,{\\fad(220,300)}${wrapTitle(hk.text)}`
    );
  }

  // Sinalização explícita de IA: a frase pequena do canto superior esquerdo, presente do começo ao fim (layer 3, acima de todas as trilhas)
  if (options.aigcBadge && options.aigcBadge.durationSec > 0) {
    events.push(`Dialogue: 3,${toAssTime(0)},${toAssTime(options.aigcBadge.durationSec)},Aigc,,0,0,0,,Gerado por IA`);
  }

  // Trilha de tradução bilíngue: um Dialogue no nível da frase inteira, com o tempo na
  // mesma base de words (deslocado igualmente por clipStartSec);
  // com WrapStyle=2 não há quebra automática, então a linha de tradução é quebrada à mão
  // (com o limite convertido para o tamanho menor de fonte)
  if (options.translation) {
    const transUnits = Math.round(layout.maxLineUnits / 0.6);
    for (const line of options.translation) {
      if (!line.text.trim() || line.endSec <= line.startSec) continue;
      const start = Math.max(0, line.startSec - clipStartSec);
      const end = Math.max(start, line.endSec - clipStartSec);
      if (end <= start) continue;
      events.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Trans,,0,0,0,,${wrapTitle(line.text, transUnits)}`);
    }
  }

  const forcedBreaks = options.forcedBreaks ?? [];
  // Marcador de falante: um por clipe (que guarda "quem era o falante da linha anterior"); com um único falante ou desligado, não faz nada
  const speakerTag = createSpeakerLabeler(words, Boolean(options.speakerLabels));
  if (style === "pop" || style === "hormozi" || style === "minimal") {
    const maxUnits = captionMaxLineUnits(style, layout);
    // O minimalista dinâmico é igual ao keyword: primeiro as palavras-chave são unidas numa palavra só, e a quebra de bloco nunca parte a palavra destacada
    const chunkWords = style === "minimal" ? mergeKeywordWords(words, options.keywords ?? []) : words;
    const planned = options.readability ? planReadableCaptions(chunkWords, maxUnits, forcedBreaks, options.endSec) : undefined;
    const units = planned ? planned.map((line) => line.words) : groupWordsIntoLines(chunkWords, maxUnits, forcedBreaks);
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const start = unit[0].startSec - clipStartSec;
      const lastEnd = unit[unit.length - 1].endSec;
      const next = units[i + 1]?.[0].startSec;
      const end = (planned?.[i].endSec ?? (next !== undefined ? Math.min(next, lastEnd + CAPTION_HOLD_MAX_SEC) : lastEnd + 0.2)) - clipStartSec;
    // A marca de falante vem antes das etiquetas de efeito: os caracteres da marca não
    // participam da animação de entrada nem da de escala, e a sobrescrita de efeito do
    // texto que vem depois não é afetada
      const tag = speakerTag(unit);
      if (style === "hormozi") {
        // Letras grandes de impacto: bloco curto entrando de uma vez mais o karaokê acendendo palavra por palavra dentro dele; as palavras latinas vão para maiúsculas (a escrita ideográfica não é afetada)
        const caps = unit.map((w) => ({ ...w, text: w.text.toUpperCase() }));
        events.push(dialogue(start, end, tag + HORMOZI_INTRO + karaokeText(caps)));
      } else if (style === "minimal") {
        // Minimalista dinâmico: bloco curto com uma entrada leve e no máximo 1 destaque na cor da marca dentro dele (com prioridade para palavra-chave e número)
        events.push(dialogue(start, end, tag + MINIMAL_INTRO + minimalText(unit, options.keywords ?? [], highlightHex)));
      } else {
        // pop: entrada amortecida mais a troca de cor da palavra atual dentro do bloco (a cor de destaque da marca acendendo junto com a fala)
        events.push(dialogue(start, end, tag + POP_INTRO + popText(unit, unit[0].startSec, highlightHex)));
      }
    }
  } else {
    // keyword style: fuse keyword runs first so line breaks can't split them
    const lineWords = style === "keyword" ? mergeKeywordWords(words, options.keywords ?? []) : words;
    const planned = options.readability ? planReadableCaptions(lineWords, layout.maxLineUnits, forcedBreaks, options.endSec) : undefined;
    const lines = planned ? planned.map((line) => line.words) : groupWordsIntoLines(lineWords, layout.maxLineUnits, forcedBreaks).filter((l) => l.length > 0);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const start = line[0].startSec - clipStartSec;
      const lastEnd = line[line.length - 1].endSec;
      // Hold the line until the next one begins (anti-flicker), capped so a real
      // pause still clears it; the last line ends with its final word.
      const nextStart = lines[i + 1]?.[0].startSec;
      const end =
        (planned?.[i].endSec ?? (nextStart !== undefined ? Math.min(nextStart, lastEnd + CAPTION_HOLD_MAX_SEC) : lastEnd)) - clipStartSec;
      const text = style === "karaoke" ? karaokeText(line) : keywordText(line, options.keywords ?? [], highlightHex);
      events.push(dialogue(start, end, speakerTag(line) + text));
    }
  }

  return [...assHeader(style, layout, fontName, highlightHex), ...events, ""].join("\n");
}

/** Back-compat wrapper (karaoke style). */
export function buildKaraokeAss(
  words: TranscriptWord[],
  clipStartSec: number,
  layout: AssLayout,
  fontName: string = defaultFontName()
): string {
  return buildCaptionAss(words, clipStartSec, layout, "karaoke", { fontName });
}
