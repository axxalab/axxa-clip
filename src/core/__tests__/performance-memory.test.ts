import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  importPerformanceFile,
  clearPerformanceMemory,
  loadPerformanceMemory,
  metricNumber,
  normalizePerformanceRows,
  parseCsv,
  performanceExamples,
  performanceMemorySection,
  savePerformanceMemory,
  summarizePerformance,
  type PerformanceEntry,
} from "../performance-memory";
import { highlightSystemPrompt } from "../highlight/prompt";
import type { Transcript } from "../transcribe/types";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const freshDir = async (): Promise<string> => (root = await mkdtemp(join(tmpdir(), "hotclip-perf-")));
const entry = (title: string, views: number, likes: number): PerformanceEntry => ({
  title, platform: "youtube", views, likes, comments: 0, shares: 0, saves: 0,
  importedAt: "2026-08-24T00:00:00.000Z",
});

describe("importação das métricas de desempenho", () => {
  it("lê os números abreviados de cada idioma", () => {
    expect(metricNumber("12 mil")).toBe(12_000);
    expect(metricNumber("1,2 mi")).toBe(1_200_000);
    expect(metricNumber("3,456")).toBe(3_456);
    expect(metricNumber("7.8k")).toBe(7_800);
  });

  it("lê CSV com aspas e os nomes de coluna em português", () => {
    const rows = parseCsv('titulo,visualizacoes,curtidas,etiquetas\r\n"tem vírgula, no título também",12 mil,600,"eficiência;ferramenta"\r\n');
    const result = normalizePerformanceRows(rows, "youtube", "now");
    expect(result.skipped).toBe(0);
    expect(result.entries[0]).toMatchObject({ title: "tem vírgula, no título também", views: 12_000, likes: 600, keywords: ["eficiência", "ferramenta"] });
  });

  it("descarta as linhas sem título ou sem visualizações", () => {
    const out = normalizePerformanceRows([{ title: "", views: 10 }, { title: "sem visualizações", views: 0 }]);
    expect(out).toEqual({ entries: [], skipped: 2 });
  });

  it("importa JSON, funde por plataforma e id, e sobrevive a uma nova leitura", async () => {
    const dir = await freshDir();
    const file = join(dir, "youtube.json");
    await writeFile(file, JSON.stringify([{ id: "VID1", title: "primeira versão", views: 100, likes: 3 }]), "utf8");
    expect((await importPerformanceFile(dir, file)).imported).toBe(1);
    await writeFile(file, JSON.stringify([{ id: "VID1", title: "título atualizado", views: 200, likes: 20 }]), "utf8");
    const result = await importPerformanceFile(dir, file);
    expect(result.total).toBe(1);
    expect((await loadPerformanceMemory(dir))[0]).toMatchObject({ title: "título atualizado", views: 200 });
  });
});

describe("retorno de desempenho no prompt", () => {
  it("ordena pelos melhores resultados e inclui alto e baixo desempenho", async () => {
    const rows = [entry("clipe fraco", 10_000, 5), entry("clipe forte", 10_000, 900), entry("mediano 1", 1000, 20), entry("mediano 2", 2000, 30)];
    const examples = performanceExamples(rows);
    expect(examples.winners[0].title).toBe("clipe forte");
    expect(examples.laggards.map((e) => e.title)).toContain("clipe fraco");
    const prompt = performanceMemorySection(rows, true);
    expect(prompt).toContain("[Desempenho real das publicações]");
    expect(prompt).toContain("Exemplos de alto desempenho");
    expect(prompt).toContain("Exemplos de baixo desempenho");
    const dir = await freshDir();
    await savePerformanceMemory(dir, rows);
    expect(await loadPerformanceMemory(dir)).toHaveLength(4);
    expect(summarizePerformance(rows)).toMatchObject({
      total: 4,
      platforms: ["youtube"],
    });
    await clearPerformanceMemory(dir);
    expect(await loadPerformanceMemory(dir)).toEqual([]);
  });

  it("está ligado ao system prompt de busca de destaques", () => {
    const transcript: Transcript = {
      language: "pt",
      durationSec: 10,
      segments: [{ id: 1, startSec: 0, endSec: 10, text: "Esta é uma demonstração completa do produto." }],
    } as Transcript;
    const rows = [entry("demonstração que foi forte", 20_000, 1_000)];
    expect(highlightSystemPrompt(transcript, "standard", [], undefined, undefined, undefined, undefined, rows))
      .toContain("[Desempenho real das publicações]");
  });
});
