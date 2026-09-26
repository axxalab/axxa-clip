import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSeriesPack, groupTopicSeries, SERIES_DIR_NAME, type SeriesClipInput } from "../series-pack";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
const fresh = async (): Promise<string> => (root = await mkdtemp(join(tmpdir(), "hotclip-series-")));
const clip = (title: string, keywords: string[], sourceStartSec: number, file = `/${title}.mp4`): SeriesClipInput => ({ file, title, keywords, sourceStartSec });

describe("agrupamento das séries temáticas", () => {
  it("usa a palavra-chave específica repetida, exclui a genérica e a que aparece uma vez só, e ordena pelo tempo de origem", () => {
    const groups = groupTopicSeries([
      clip("parte de tras", ["live", "economizar", "assinatura"], 30),
      clip("parte da frente", ["economizar", "ajuste"], 10),
      clip("parte solta", ["fotografia"], 20),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].topic).toBe("economizar");
    expect(groups[0].clips.map((item) => item.title)).toEqual(["parte da frente", "parte de tras"]);
  });

  it("põe cada trecho num único tema, o mais forte, e descarta o que sobra sozinho depois da distribuição", () => {
    const groups = groupTopicSeries([
      clip("A", ["produtividade", "edicao"], 1),
      clip("B", ["produtividade"], 2),
      clip("C", ["edicao"], 3),
    ]);
    expect(groups).toHaveLength(1);
    expect(["produtividade", "edicao"]).toContain(groups[0].topic);
    expect(groups[0].clips).toHaveLength(2);
    expect(groups[0].clips.map((item) => item.title)).toContain("A");
  });
});

describe("os arquivos do pacote de série", () => {
  it("cria os episódios em ordem, por link físico, com os manifestos", async () => {
    const dir = await fresh();
    const a = join(dir, "a.mp4");
    const b = join(dir, "b.mp4");
    await writeFile(a, "a");
    await writeFile(b, "b");
    const summary = await buildSeriesPack(dir, [clip("episodio dois", ["tutorial"], 20, b), clip("episodio um", ["tutorial"], 10, a)]);
    expect(summary).toMatchObject({ seriesCount: 1, clipCount: 2 });
    const manifest = JSON.parse(await readFile(join(dir, SERIES_DIR_NAME, "tutorial", "manifest.json"), "utf8"));
    expect(manifest.clips.map((item: { file: string }) => item.file)).toEqual(["01-a.mp4", "02-b.mp4"]);
    expect((await stat(a)).ino).toBe((await stat(join(dir, SERIES_DIR_NAME, "tutorial", "01-a.mp4"))).ino);
  });

  it("devolve null e não cria pasta quando nada forma série", async () => {
    const dir = await fresh();
    expect(await buildSeriesPack(dir, [clip("um so", ["unico"], 1)])).toBeNull();
    await expect(stat(join(dir, SERIES_DIR_NAME))).rejects.toThrow();
  });

  it("limpa o nome da pasta do tema", async () => {
    const dir = await fresh();
    const a = join(dir, "a.mp4");
    const b = join(dir, "b.mp4");
    await writeFile(a, "a");
    await writeFile(b, "b");
    const summary = await buildSeriesPack(dir, [clip("A", ["IA/edicao:*"], 1, a), clip("B", ["IA/edicao:*"], 2, b)]);
    expect(summary?.series[0].dir).toBe(join(dir, SERIES_DIR_NAME, "iaedicao"));
  });
});
