/**
 * Ciclo de retorno do desempenho das publicações: os dados reais de
 * visualização e engajamento são importados do CSV/JSON exportado pelas
 * plataformas, ficam guardados localmente e, na rodada seguinte de busca de
 * destaques, os exemplos fortes e fracos são injetados no prompt.
 * É o complemento do aprovar/descartar subjetivo do review-memory: lá se
 * responde "do que eu gosto", e aqui se responde "o que o público assistiu de
 * verdade".
 */
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import type { PerformanceEntry, PerformanceImportResult, PerformanceSummary } from "../shared/api-types";
import { correlatePerformanceEntries, type CorrelatedPerformance } from "./publish-ledger";

export type { PerformanceEntry, PerformanceImportResult, PerformanceSummary };

const MAX_ENTRIES = 500;
const MAX_PROMPT_EXAMPLES = 5;
const memoryPath = (userDataDir: string): string => join(userDataDir, "performance-memory.json");

// Cabeçalhos aceitos na importação. Cada campo lista os nomes usados nos
// painéis em português e os equivalentes em inglês, porque o mesmo arquivo pode
// vir de plataformas diferentes.
const FIELD_ALIASES = {
  contentId: ["content_id", "contentid", "hotclip_id", "id_do_conteudo", "id do conteúdo", "id do conteudo"],
  id: ["id", "video_id", "bvid", "aweme_id", "id_do_video", "id do vídeo", "id do video"],
  title: ["title", "name", "video_title", "titulo", "título", "titulo do video", "título do vídeo"],
  hook: ["hook", "opening_hook", "gancho", "gancho de abertura"],
  platform: ["platform", "source", "plataforma", "origem"],
  views: ["views", "view", "plays", "play", "visualizacoes", "visualizações", "exibicoes", "exibições", "reproducoes", "reproduções"],
  likes: ["likes", "like", "curtidas", "curtida"],
  comments: ["comments", "comment", "comentarios", "comentários"],
  shares: ["shares", "share", "compartilhamentos", "compartilhamento"],
  saves: ["saves", "save", "favorites", "favs", "salvos", "salvamentos", "favoritos"],
  durationSec: ["duration_sec", "duration", "duracao", "duração", "duracao_seg", "duração em segundos"],
  keywords: ["keywords", "tags", "palavras-chave", "palavras chave", "etiquetas"],
  publishedAt: ["published_at", "publish_time", "date", "data", "data de publicacao", "data de publicação", "publicado em"],
} as const;

type Row = Record<string, unknown>;

const normalizedRow = (row: Row): Map<string, unknown> =>
  new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));

function field(row: Map<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    const value = row.get(alias.toLowerCase());
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

/** Lê os formatos abreviados comuns nas exportações das plataformas: `7,8 mil`, `1,2 mi`, `3.456` e `7.8k`. */
export function metricNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : 0;
  // A vírgula é separador decimal em português e separador de milhar em
  // inglês: um número com vírgula e exatamente uma casa vira decimal (7,8 mil),
  // e nos demais casos a vírgula é apenas separador de milhar (3,456).
  let raw = String(value ?? "").trim().toLowerCase();
  raw = /^-?\d{1,3},\d(?!\d)/.test(raw) ? raw.replace(",", ".") : raw.replace(/,/g, "");
  if (!raw) return 0;
  const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*(mil|mi|mm|k|m|b)?/i);
  if (!m) return 0;
  const base = Math.max(0, Number(m[1]));
  const mul = { mil: 1_000, mi: 1_000_000, mm: 1_000_000, k: 1_000, m: 1_000_000, b: 1_000_000_000 }[m[2] ?? ""] ?? 1;
  return Math.round(base * mul);
}

/** Subconjunto da RFC4180: aceita aspas, vírgulas, CRLF e quebra de linha dentro das aspas. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  const headers = (rows.shift() ?? []).map((h, i) => (i === 0 ? h.replace(/^\uFEFF/, "") : h).trim());
  return rows.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}

function keywords(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[#,;|]/);
  const out = values.map((v) => String(v).trim()).filter(Boolean).slice(0, 12);
  return out.length > 0 ? out : undefined;
}

export function normalizePerformanceRows(rows: Row[], defaultPlatform = "unknown", now = new Date().toISOString()): {
  entries: PerformanceEntry[];
  skipped: number;
} {
  const entries: PerformanceEntry[] = [];
  let skipped = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      skipped++;
      continue;
    }
    const row = normalizedRow(raw);
    const title = String(field(row, FIELD_ALIASES.title) ?? "").trim();
    const views = metricNumber(field(row, FIELD_ALIASES.views));
    if (!title || views <= 0) {
      skipped++;
      continue;
    }
    const duration = metricNumber(field(row, FIELD_ALIASES.durationSec));
    entries.push({
      contentId: String(field(row, FIELD_ALIASES.contentId) ?? "").trim() || undefined,
      id: String(field(row, FIELD_ALIASES.id) ?? "").trim() || undefined,
      title: title.slice(0, 160),
      hook: String(field(row, FIELD_ALIASES.hook) ?? "").trim().slice(0, 200) || undefined,
      platform: String(field(row, FIELD_ALIASES.platform) ?? defaultPlatform).trim().slice(0, 40) || defaultPlatform,
      views,
      likes: metricNumber(field(row, FIELD_ALIASES.likes)),
      comments: metricNumber(field(row, FIELD_ALIASES.comments)),
      shares: metricNumber(field(row, FIELD_ALIASES.shares)),
      saves: metricNumber(field(row, FIELD_ALIASES.saves)),
      durationSec: duration > 0 ? duration : undefined,
      keywords: keywords(field(row, FIELD_ALIASES.keywords)),
      publishedAt: String(field(row, FIELD_ALIASES.publishedAt) ?? "").trim().slice(0, 40) || undefined,
      importedAt: now,
    });
  }
  return { entries, skipped };
}

export async function loadPerformanceMemory(userDataDir: string): Promise<PerformanceEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(memoryPath(userDataDir), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PerformanceEntry =>
        !!e && typeof (e as PerformanceEntry).title === "string" &&
        typeof (e as PerformanceEntry).platform === "string" &&
        Number.isFinite((e as PerformanceEntry).views) && (e as PerformanceEntry).views > 0
    );
  } catch {
    return [];
  }
}

const entryKey = (e: PerformanceEntry): string =>
  `${e.platform.toLowerCase()}\0${(e.id || e.contentId || e.title).trim().toLowerCase()}`;

export async function savePerformanceMemory(userDataDir: string, incoming: PerformanceEntry[]): Promise<PerformanceEntry[]> {
  const byKey = new Map<string, PerformanceEntry>();
  for (const entry of [...(await loadPerformanceMemory(userDataDir)), ...incoming]) byKey.set(entryKey(entry), entry);
  const all = [...byKey.values()].slice(-MAX_ENTRIES);
  const file = memoryPath(userDataDir);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
  await rename(tmp, file);
  return all;
}

export async function clearPerformanceMemory(userDataDir: string): Promise<void> {
  await rm(memoryPath(userDataDir), { force: true });
}

export async function importPerformanceFile(
  userDataDir: string,
  inputPath: string
): Promise<PerformanceImportResult & { entries: PerformanceEntry[] }> {
  const text = await readFile(inputPath, "utf8");
  const ext = extname(inputPath).toLowerCase();
  let rows: Row[];
  if (ext === ".csv") rows = parseCsv(text);
  else {
    const parsed = JSON.parse(text) as unknown;
    const value = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? ((parsed as { data?: unknown; items?: unknown; videos?: unknown }).data ??
          (parsed as { items?: unknown }).items ?? (parsed as { videos?: unknown }).videos)
        : null;
    if (!Array.isArray(value)) throw new Error("O JSON precisa ser um array, ou conter um array em data/items/videos");
    rows = value as Row[];
  }
  const defaultPlatform = basename(inputPath, ext).split(/[-_.]/)[0] || "unknown";
  const normalized = normalizePerformanceRows(rows, defaultPlatform);
  const correlated: CorrelatedPerformance = await correlatePerformanceEntries(userDataDir, normalized.entries);
  const entries = await savePerformanceMemory(userDataDir, correlated.entries);
  return {
    imported: normalized.entries.length,
    skipped: normalized.skipped,
    total: entries.length,
    correlation: correlated.summary,
    entries,
  };
}

/**
 * Nota de qualidade do engajamento: compartilhamento e salvamento pesam mais do
 * que as interações leves, e um a priori de 200 visualizações contém a inflação
 * das amostras pequenas; um termo logarítmico bem leve sobre as visualizações
 * evita premiar só a taxa de engajamento e ignorar o alcance real.
 */
export function performanceScore(e: PerformanceEntry): number {
  const weighted = e.likes + e.comments * 2 + e.shares * 3 + e.saves * 3;
  return (weighted / (e.views + 200)) * 1000 + Math.log10(e.views + 1) * 8;
}

export function performanceExamples(entries: PerformanceEntry[]): { winners: PerformanceEntry[]; laggards: PerformanceEntry[] } {
  const sorted = [...entries].sort((a, b) => performanceScore(b) - performanceScore(a));
  // Importações pequenas também precisam de contraste: a metade de baixo fica reservada para os de baixo desempenho.
  const winnerCount = Math.min(MAX_PROMPT_EXAMPLES, Math.max(1, Math.floor(sorted.length / 2)));
  const winners = sorted.slice(0, winnerCount);
  const winnerKeys = new Set(winners.map(entryKey));
  const laggards = sorted.length < 4
    ? []
    : [...sorted].reverse().filter((e) => !winnerKeys.has(entryKey(e))).slice(0, MAX_PROMPT_EXAMPLES);
  return { winners, laggards };
}

export function summarizePerformance(
  entries: PerformanceEntry[],
  publishing: PerformanceSummary["publishing"] = { total: 0, awaitingMetrics: 0, measured: 0, recent: [] },
  experiments: PerformanceSummary["experiments"] = { total: 0, ready: 0, awaiting: 0, insufficient: 0, recent: [] }
): PerformanceSummary {
  const { winners, laggards } = performanceExamples(entries);
  return {
    total: entries.length,
    platforms: [...new Set(entries.map((e) => e.platform))].sort(),
    winners,
    laggards,
    publishing,
    experiments,
  };
}

const compactMetric = (n: number, pt: boolean): string => {
  if (pt) {
    const br = (v: number): string => v.toFixed(1).replace(".", ",");
    return n >= 1_000_000 ? `${br(n / 1_000_000)} mi` : n >= 1_000 ? `${br(n / 1_000)} mil` : String(n);
  }
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
};

const exampleLine = (e: PerformanceEntry, pt: boolean): string => {
  const engagement = e.likes + e.comments + e.shares + e.saves;
  const rate = ((engagement / Math.max(1, e.views)) * 100).toFixed(2);
  const extra = [
    e.hook ? (pt ? `gancho "${e.hook}"` : `hook "${e.hook}"`) : "",
    e.durationSec ? `${Math.round(e.durationSec)}s` : "",
    e.keywords?.slice(0, 4).join(", ") ?? "",
  ]
    .filter(Boolean).join(", ");
  return pt
    ? `- [${e.platform}] "${e.title}" — ${compactMetric(e.views, true)} visualizações, ${rate}% de engajamento total${extra ? `, ${extra}` : ""}`
    : `- [${e.platform}] "${e.title}" ${compactMetric(e.views, false)} views, ${rate}% total engagement${extra ? `, ${extra}` : ""}`;
};

/** Só os poucos exemplos já agregados vão para o LLM; nada de cookie de conta, caminho de pasta ou outra informação sensível. */
export function performanceMemorySection(entries: PerformanceEntry[], pt: boolean): string {
  const { winners, laggards } = performanceExamples(entries);
  if (winners.length === 0) return "";
  if (pt) {
    let out = `\n\n[Desempenho real das publicações] (dados de plataforma importados na máquina do usuário. Generalize o padrão de tema, gancho e duração e trate isso como evidência de tendência, não como regra rígida; nunca copie os títulos antigos.)\nExemplos de alto desempenho (prefira parecidos):\n${winners.map((e) => exampleLine(e, true)).join("\n")}`;
    if (laggards.length > 0) out += `\nExemplos de baixo desempenho (cuidado com parecidos):\n${laggards.map((e) => exampleLine(e, true)).join("\n")}`;
    return out;
  }
  let out = `\n\n[Real post performance] (locally imported platform data. Generalize topic/hook/duration patterns as trend evidence, not hard rules; never copy old titles.)\nHigh performers (prefer similar):\n${winners.map((e) => exampleLine(e, false)).join("\n")}`;
  if (laggards.length > 0) out += `\nLow performers (be cautious with similar):\n${laggards.map((e) => exampleLine(e, false)).join("\n")}`;
  return out;
}

export function performanceReport(entries: PerformanceEntry[], pt = true): string {
  if (entries.length === 0) return pt ? "Ainda não há dados de desempenho das publicações." : "No post-performance data yet.";
  const { winners, laggards } = performanceExamples(entries);
  const platforms = [...new Set(entries.map((e) => e.platform))].join(", ");
  const lines = pt
    ? [`${entries.length} publicações aprendidas · Plataformas: ${platforms}`, "", "Alto desempenho:", ...winners.map((e) => exampleLine(e, true))]
    : [`Learned from ${entries.length} posts · Platforms: ${platforms}`, "", "High performers:", ...winners.map((e) => exampleLine(e, false))];
  if (laggards.length > 0) lines.push("", pt ? "Baixo desempenho:" : "Low performers:", ...laggards.map((e) => exampleLine(e, pt)));
  return lines.join("\n");
}
