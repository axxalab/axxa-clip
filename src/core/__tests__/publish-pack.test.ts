/**
 * Pacote de publicação por plataforma: o critério da tabela de especificações, o filtro de recorte da capa, o
 * texto adaptado ao limite de cada plataforma e a gravação do pacote no disco.
 * Quem corta manda a mesma leva de vídeos para N plataformas, e cada uma tem a sua especificação — uma
 * adaptação errada (título além do limite, capa no enquadramento errado) só aparece na hora de publicar, e aí
 * o pacote foi feito à toa.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PLATFORM_SPECS, platformSpec, validPlatformIds } from "../../shared/platform-specs";
import { coverFilter, adaptPost, buildPublishPacks, PACK_DIR_NAME } from "../publish-pack";
import type { PublishCopy } from "../publish";

const copy: PublishCopy = {
  title: "ele jurou que o preço não ia baixar e caiu em três minutos", // passa do teto de 20 caracteres do RedNote
  hashtags: ["#cortedelive", "#vendas", "#deuerrado", "#momentohistorico", "#engracado", "#desmentido", "#sobrando"],
  description: "quanto mais ele prometeu antes, mais doeu depois.",
  cta: "já viu alguém se desmentir mais rápido? conta nos comentários",
};

describe("platform-specs", () => {
  it("a tabela de especificações está alinhada com as plataformas da zona segura: TikTok / Kwai / YouTube / Instagram / RedNote / Shorts / Reels", () => {
    const ids = PLATFORM_SPECS.map((p) => p.id);
    for (const id of ["douyin", "kuaishou", "bilibili", "channels", "xiaohongshu", "tiktok", "shorts", "reels"]) {
      expect(ids).toContain(id);
    }
  });

  it("os limites duros estão certos: 20 caracteres no título do RedNote, 80 no do YouTube e 100 no dos Shorts", () => {
    expect(platformSpec("xiaohongshu")!.titleMax).toBe(20);
    expect(platformSpec("bilibili")!.titleMax).toBe(80);
    expect(platformSpec("shorts")!.titleMax).toBe(100);
  });

  it("o enquadramento da capa: 3:4 no RedNote, 16:10 no YouTube e 9:16 nas plataformas verticais", () => {
    const xhs = platformSpec("xiaohongshu")!.cover;
    expect(xhs.w / xhs.h).toBeCloseTo(3 / 4, 3);
    const bili = platformSpec("bilibili")!.cover;
    expect(bili.w / bili.h).toBeCloseTo(16 / 10, 2);
    const dy = platformSpec("douyin")!.cover;
    expect(dy.w / dy.h).toBeCloseTo(9 / 16, 3);
  });

  it("validPlatformIds filtra o id desconhecido, remove repetidos e preserva a ordem", () => {
    expect(validPlatformIds(["xiaohongshu", "plataforma-inventada", "douyin", "xiaohongshu"])).toEqual(["xiaohongshu", "douyin"]);
    expect(validPlatformIds([])).toEqual([]);
  });
});

describe("coverFilter", () => {
  it("a expressão de recorte vale para qualquer tamanho de entrada e desloca para cima (sem cortar a cabeça de ninguém)", () => {
    const f = coverFilter(platformSpec("xiaohongshu")!);
    expect(f).toContain("min(iw,ih*");
    expect(f).toContain("(ih-oh)*0.33"); // deslocado 1/3 para cima, não centralizado
    expect(f).toContain("scale=1080:1440");
  });
});

describe("adaptPost", () => {
  it("RedNote: o título é cortado em 20 caracteres (por ponto de código) e marcado, e as hashtags são cortadas no teto", () => {
    const out = adaptPost("nome do trecho", copy, platformSpec("xiaohongshu")!);
    expect(Array.from(out.title)).toHaveLength(20);
    expect(out.titleTruncated).toBe(true);
    expect(out.hashtags.length).toBeLessThanOrEqual(platformSpec("xiaohongshu")!.tagsMax);
    expect(out.text).toContain(out.title);
    expect(out.text).toContain("conta nos comentários");
  });

  it("YouTube: o mesmo texto, dentro de 80 caracteres, não é cortado", () => {
    const out = adaptPost("nome do trecho", copy, platformSpec("bilibili")!);
    expect(out.titleTruncated).toBe(false);
    expect(out.title).toBe(copy.title);
  });

  it("o emoji não é partido no meio: o par de substituição conta como um caractere", () => {
    const emojiCopy = { ...copy, title: "😀".repeat(30) };
    const out = adaptPost("nome do trecho", emojiCopy, platformSpec("xiaohongshu")!);
    expect(Array.from(out.title)).toHaveLength(20);
    expect(out.title.includes("\uFFFD")).toBe(false);
  });

  it("sem texto de publicação, o título do trecho serve de reserva, e nenhum título sai vazio", () => {
    const out = adaptPost("titulo de reserva do trecho", undefined, platformSpec("douyin")!);
    expect(out.title).toBe("titulo de reserva do trecho");
    expect(out.hashtags).toEqual([]);
  });
});

describe("buildPublishPacks", () => {
  async function setup(): Promise<{ dir: string; mp4: string; jpg: string }> {
    const dir = await mkdtemp(join(tmpdir(), "hotclip-pack-"));
    const mp4 = join(dir, "01-trecho-de-teste.mp4");
    const jpg = join(dir, "01-trecho-de-teste.jpg");
    await writeFile(mp4, "fake-video");
    await writeFile(jpg, "fake-cover");
    return { dir, mp4, jpg };
  }

  it("uma pasta por plataforma: o vídeo por link físico + a capa + o texto + o manifest, o conjunto completo", async () => {
    const { dir, mp4, jpg } = await setup();
    const summaries = await buildPublishPacks(
      dir,
      [{ file: mp4, coverFile: jpg, title: "trecho de teste", publish: copy }],
      ["xiaohongshu", "douyin"],
      async (_src, dest) => {
        await writeFile(dest, "adapted-cover"); // simula o recorte do ffmpeg
        return true;
      }
    );
    expect(summaries).toHaveLength(2);
    const xhsDir = join(dir, PACK_DIR_NAME, "RedNote");
    const files = await readdir(xhsDir);
    expect(files).toContain("01-trecho-de-teste.mp4");
    expect(files).toContain("01-trecho-de-teste.jpg");
    expect(files).toContain("01-trecho-de-teste.post.txt");
    expect(files).toContain("manifest.json");
    // Link físico: os mesmos dados, sem ocupar o disco em dobro (o mesmo inode)
    const [a, b] = await Promise.all([stat(mp4), stat(join(xhsDir, "01-trecho-de-teste.mp4"))]);
    expect(a.ino).toBe(b.ino);
    // O manifest registra o corte: o título passa dos 20 caracteres do RedNote
    const manifest = JSON.parse(await readFile(join(xhsDir, "manifest.json"), "utf8"));
    expect(manifest.platform).toBe("xiaohongshu");
    expect(manifest.clips[0].titleTruncated).toBe(true);
    expect(summaries.find((s) => s.platform === "xiaohongshu")!.truncatedTitles).toBe(1);
  });

  it("uma falha no recorte da capa só deixa sem capa, e o vídeo e o texto vão para o lugar como sempre", async () => {
    const { dir, mp4, jpg } = await setup();
    const summaries = await buildPublishPacks(
      dir,
      [{ file: mp4, coverFile: jpg, title: "trecho de teste", publish: copy }],
      ["douyin"],
      async () => false // o recorte falha em tudo
    );
    expect(summaries).toHaveLength(1);
    const files = await readdir(join(dir, PACK_DIR_NAME, "Douyin"));
    expect(files).toContain("01-trecho-de-teste.mp4");
    expect(files).not.toContain("01-trecho-de-teste.jpg");
    const manifest = JSON.parse(await readFile(join(dir, PACK_DIR_NAME, "Douyin", "manifest.json"), "utf8"));
    expect(manifest.clips[0].cover).toBeNull();
  });

  it("o id de plataforma desconhecido é filtrado, e quando todos são desconhecidos nenhuma pasta é criada", async () => {
    const { dir, mp4 } = await setup();
    const summaries = await buildPublishPacks(dir, [{ file: mp4, title: "t" }], ["plataforma-que-nao-existe"], async () => true);
    expect(summaries).toEqual([]);
  });

  it("empacotar de novo (exportar outra vez) não quebra: o arquivo que já existe é substituído", async () => {
    const { dir, mp4, jpg } = await setup();
    const run = (): Promise<unknown> =>
      buildPublishPacks(dir, [{ file: mp4, coverFile: jpg, title: "trecho de teste", publish: copy }], ["douyin"], async (_s, d) => {
        await writeFile(d, "c");
        return true;
      });
    await run();
    await expect(run()).resolves.toBeTruthy();
  });
});
