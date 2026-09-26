import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPerformanceTemplate,
  clearPublishMetrics,
  correlatePerformanceEntries,
  loadPublishLedger,
  publishContentId,
  publishExperimentId,
  registerPublishItems,
  type RegisterPublishItem,
} from "../publish-ledger";
import type { PerformanceEntry } from "../../shared/api-types";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const freshDir = async (): Promise<string> => (root = await mkdtemp(join(tmpdir(), "hotclip-ledger-")));
const item = (over: Partial<RegisterPublishItem> = {}): RegisterPublishItem => ({
  filePath: "/exports/a.mp4",
  title: "tres passos para cortar a assinatura",
  platform: "douyin",
  durationSec: 31.25,
  keywords: ["economizar", "tutorial"],
  exportedAt: "2026-08-24T08:00:00.000Z",
  ...over,
});
const metric = (over: Partial<PerformanceEntry> = {}): PerformanceEntry => ({
  title: "tres passos para cortar a assinatura",
  platform: "douyin",
  views: 10_000,
  likes: 500,
  comments: 20,
  shares: 30,
  saves: 100,
  importedAt: "2026-08-25T08:00:00.000Z",
  ...over,
});

describe("livro-caixa do retorno de publicação", () => {
  it("gera ID de conteúdo determinístico e guarda os registros", async () => {
    const dir = await freshDir();
    expect(publishContentId(item())).toBe(publishContentId(item()));
    const saved = await registerPublishItems(dir, [item()]);
    expect(saved[0]).toMatchObject({ title: "tres passos para cortar a assinatura", platform: "douyin" });
    expect((await loadPublishLedger(dir))[0].contentId).toMatch(/^hc_[a-f0-9]{16}$/);
  });

  it("guarda a participação de um experimento de várias versões com um ID estável por plataforma", async () => {
    const dir = await freshDir();
    const identity = { sourcePath: "/source.mp4", platform: "douyin", exportedAt: item().exportedAt, candidateId: 7 };
    expect(publishExperimentId(identity)).toBe(publishExperimentId(identity));
    expect(publishExperimentId({ ...identity, platform: "bilibili" })).not.toBe(publishExperimentId(identity));
    const experimentId = publishExperimentId(identity);
    const [saved] = await registerPublishItems(dir, [item({
      experimentId,
      variantIndex: 1,
      variantTotal: 2,
      variantRole: "control",
      experimentDimensions: ["packaging", "opening"],
    })]);
    expect(saved).toMatchObject({ experimentId, variantIndex: 1, variantTotal: 2, variantRole: "control", experimentDimensions: ["packaging", "opening"] });
  });

  it("casa primeiro pelo ID estável e marca no livro que foi medido", async () => {
    const dir = await freshDir();
    const [registered] = await registerPublishItems(dir, [item()]);
    const result = await correlatePerformanceEntries(dir, [metric({ contentId: registered.contentId, title: "titulo que a plataforma mudou" })], "now");
    expect(result.summary).toEqual({ matched: 1, unmatched: 0, ambiguous: 0, unmatchedTitles: [], ambiguousTitles: [] });
    expect(result.entries[0]).toMatchObject({ contentId: registered.contentId, matchConfidence: "id" });
    expect((await loadPublishLedger(dir))[0].metricsImportedAt).toBe("now");
  });

  it("aceita um título exatamente igual e único, mas nunca adivinha entre repetidos", async () => {
    const dir = await freshDir();
    await registerPublishItems(dir, [
      item({ filePath: "/exports/a.mp4", platform: "unassigned" }),
      item({ filePath: "/exports/b.mp4", title: "nome repetido", platform: "douyin" }),
      item({ filePath: "/exports/c.mp4", title: "nome repetido", platform: "douyin" }),
    ]);
    const result = await correlatePerformanceEntries(dir, [
      metric(),
      metric({ title: "nome repetido" }),
      metric({ title: "nao achado" }),
      metric({ contentId: "hc_from_another_ledger" }),
    ]);
    expect(result.summary).toMatchObject({
      matched: 1,
      unmatched: 2,
      ambiguous: 1,
      unmatchedTitles: ["nao achado", "tres passos para cortar a assinatura"],
      ambiguousTitles: ["nome repetido"],
    });
    expect(result.entries.map((entry) => entry.matchConfidence)).toEqual(["title-platform", "ambiguous", "unmatched", "unmatched"]);
  });

  it("monta um CSV com BOM já preenchido e consegue zerar o estado medido sem apagar as exportações", async () => {
    const dir = await freshDir();
    const [registered] = await registerPublishItems(dir, [item({ title: "virgula, no titulo" })]);
    await correlatePerformanceEntries(dir, [metric({ contentId: registered.contentId })]);
    const csv = buildPerformanceTemplate(await loadPublishLedger(dir));
    expect(csv.startsWith("\uFEFFcontent_id,title,platform")).toBe(true);
    expect(csv).toContain("experiment_id,variant");
    expect(csv).toContain(registered.contentId);
    expect(csv).toContain('"virgula, no titulo"');
    await clearPublishMetrics(dir);
    expect(await loadPublishLedger(dir)).toMatchObject([{ contentId: registered.contentId }]);
    expect((await loadPublishLedger(dir))[0].metricsImportedAt).toBeUndefined();
  });
});
