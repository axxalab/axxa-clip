/**
 * Pacote de série temática: os vídeos prontos da mesma sessão são agrupados em séries que dá para publicar
 * em sequência, usando as palavras-chave que os candidatos já têm.
 * Tudo local, determinístico e sem nenhuma chamada extra de modelo; o vídeo entra por link físico de
 * preferência, e entre discos a cópia assume.
 */
import { copyFile, link, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const SERIES_DIR_NAME = "series";

export interface SeriesClipInput {
  file: string;
  title: string;
  keywords?: string[];
  sourceStartSec?: number;
}

export interface TopicSeries {
  topic: string;
  dir: string;
  clips: Array<{ file: string; title: string; order: number }>;
}

export interface SeriesPackSummary {
  dir: string;
  seriesCount: number;
  clipCount: number;
  series: TopicSeries[];
}

const GENERIC = new Set([
  "video", "vídeo", "live", "trecho", "corte", "cortes", "momentos", "melhores", "conteúdo", "canal", "shorts", "clip", "highlight",
]);

function normalizedKeyword(value: string): string {
  return value.normalize("NFKC").replace(/^#+/, "").trim().toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 24);
}

function safeName(value: string, fallback: string): string {
  const clean = value.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return clean || fallback;
}

/**
 * Cada vídeo pronto entra numa única série principal, para o mesmo arquivo não se espalhar por vários
 * lugares. Uma palavra-chave só é candidata a virar série se aparecer em pelo menos dois materiais
 * originais; depois da distribuição, o tema que ficou com menos de dois episódios é descartado de novo.
 */
export function groupTopicSeries(clips: SeriesClipInput[]): Array<{ topic: string; clips: SeriesClipInput[] }> {
  const keywordsByClip = clips.map((clip) => [...new Set((clip.keywords ?? []).map(normalizedKeyword).filter((k) => k.length >= 2 && !GENERIC.has(k)))]);
  const frequency = new Map<string, number>();
  for (const keywords of keywordsByClip) for (const keyword of keywords) frequency.set(keyword, (frequency.get(keyword) ?? 0) + 1);

  const groups = new Map<string, SeriesClipInput[]>();
  clips.forEach((clip, index) => {
    const topic = keywordsByClip[index]
      .filter((keyword) => (frequency.get(keyword) ?? 0) >= 2)
      .sort((a, b) => (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0) || b.length - a.length || a.localeCompare(b))[0];
    if (topic) groups.set(topic, [...(groups.get(topic) ?? []), clip]);
  });

  return [...groups.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([topic, items]) => ({
      topic,
      clips: [...items].sort((a, b) => (a.sourceStartSec ?? Number.MAX_SAFE_INTEGER) - (b.sourceStartSec ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => b.clips.length - a.clips.length || a.topic.localeCompare(b.topic));
}

async function linkOrCopy(src: string, dest: string): Promise<void> {
  await rm(dest, { force: true }).catch(() => {});
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

/** Sem nenhum tema que forme grupo, nenhuma pasta vazia é criada; a falha de um item não atrapalha as outras séries. */
export async function buildSeriesPack(outDir: string, clips: SeriesClipInput[]): Promise<SeriesPackSummary | null> {
  const groups = groupTopicSeries(clips);
  if (groups.length === 0) return null;
  const root = join(outDir, SERIES_DIR_NAME);
  await mkdir(root, { recursive: true });
  const series: TopicSeries[] = [];
  const usedDirNames = new Set<string>();
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    let dirName = safeName(group.topic, `tema${groupIndex + 1}`);
    if (usedDirNames.has(dirName)) dirName = `${dirName}-${groupIndex + 1}`;
    usedDirNames.add(dirName);
    const dir = join(root, dirName);
    await mkdir(dir, { recursive: true });
    const rows: TopicSeries["clips"] = [];
    for (let index = 0; index < group.clips.length; index++) {
      const clip = group.clips[index];
      const target = `${String(index + 1).padStart(2, "0")}-${basename(clip.file)}`;
      try {
        await linkOrCopy(clip.file, join(dir, target));
        rows.push({ file: target, title: clip.title, order: index + 1 });
      } catch {
        // Um item ilegível ou uma cópia entre discos que falhou: um arquivo que não existe não entra na lista
      }
    }
    if (rows.length >= 2) {
      const item: TopicSeries = { topic: group.topic, dir, clips: rows };
      series.push(item);
      await writeFile(join(dir, "manifest.json"), JSON.stringify({ topic: group.topic, episodeCount: rows.length, clips: rows }, null, 2), "utf8").catch(() => {});
    }
  }
  if (series.length === 0) return null;
  const summary = { dir: root, seriesCount: series.length, clipCount: series.reduce((sum, item) => sum + item.clips.length, 0), series };
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), series: series.map((item) => ({ topic: item.topic, dir: basename(item.dir), clips: item.clips })) }, null, 2),
    "utf8"
  ).catch(() => {});
  return summary;
}
