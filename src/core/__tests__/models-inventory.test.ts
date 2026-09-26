/**
 * Mudança de pasta dos modelos (issue #3): é com isso que a pessoa move 1GB de modelos, e perder tudo
 * no caminho custa uma hora de download. Então o que fica pregado aqui não é «a mudança funciona», e sim
 * «quando a mudança não funciona, o original continua lá».
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import * as nodePath from "path";
import { join } from "path";
import { dirSize, isInside, MODEL_CATALOG, moveModelsDir } from "../models-inventory";
import { defaultModelsRoot, readAppSettings, resolveModelsRoot, writeAppSettings } from "../app-settings";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "hotclip-models-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function seedModels(root: string): Promise<void> {
  await mkdir(join(root, "sherpa-onnx-sense-voice"), { recursive: true });
  await writeFile(join(root, "sherpa-onnx-sense-voice", "model.onnx"), "x".repeat(2048));
  await mkdir(join(root, "yunet-face"), { recursive: true });
  await writeFile(join(root, "yunet-face", "face.onnx"), "y".repeat(1024));
}

describe("dirSize", () => {
  it("soma recursivamente os bytes dos arquivos das subpastas", async () => {
    await seedModels(base);
    expect(await dirSize(base)).toBe(3072);
  });

  it("pasta inexistente conta 0, sem lançar exceção (a página de configurações não deve quebrar inteira porque um caminho sumiu)", async () => {
    expect(await dirSize(join(base, "nope"))).toBe(0);
  });
});

describe("MODEL_CATALOG", () => {
  it("lists speech safety and optional 48 kHz dialogue enhancement with verified assets", () => {
    expect(MODEL_CATALOG.map((entry) => [entry.asset.id, entry.useKey])).toEqual(expect.arrayContaining([
      ["silero-vad-v6", "useSpeechSafety"],
      ["dpdfnet2-48khz-hr", "useSpeechEnhance"],
    ]));
    const speech = MODEL_CATALOG.find((entry) => entry.asset.id === "dpdfnet2-48khz-hr")?.asset;
    expect(speech).toMatchObject({
      approxBytes: 10_596_848,
      singleFile: "model.onnx",
      sha256: "0b399f8a58dc4d70d8cd97541f5c39869406145193b957d00a03b66070944928",
    });
  });
});

describe("isInside", () => {
  it("reconhece a subpasta e a própria pasta", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
  });

  it("a pasta irmã e a de cima não contam como dentro", () => {
    expect(isInside("/a/b", "/a/c")).toBe(false);
    expect(isInside("/a/b", "/a")).toBe(false);
  });

  // A semântica do Windows é reproduzida em qualquer plataforma por path.win32 — issue #4: alguém (com
  // acento no nome de usuário) quis mover os modelos do disco C para o E, e o relative() entre discos
  // devolve caminho absoluto, o que era julgado por engano como «o destino está dentro»
  describe("caminhos do Windows", () => {
    const w = nodePath.win32;

    it("destino em outro disco não conta como dentro (issue #4: mover de C para E era barrado por engano)", () => {
      expect(isInside("C:\\Users\\Conceição\\AppData\\Roaming\\hotclip\\models", "E:\\AI-tool\\hotclip\\models", w)).toBe(false);
      expect(isInside("C:\\models", "D:\\models", w)).toBe(false);
    });

    it("no mesmo disco, a subpasta e a própria pasta continuam contando como dentro", () => {
      expect(isInside("C:\\models", "C:\\models\\sub", w)).toBe(true);
      expect(isInside("C:\\models", "c:\\models", w)).toBe(true);
    });

    it("no mesmo disco, a pasta irmã, a de cima e a de prefixo igual não contam como dentro", () => {
      expect(isInside("C:\\models", "C:\\models2", w)).toBe(false);
      expect(isInside("C:\\a\\models", "C:\\a", w)).toBe(false);
    });
  });
});

describe("moveModelsDir", () => {
  it("mudança no mesmo disco: os arquivos vão inteiros para a pasta nova e a antiga fica vazia", async () => {
    const from = join(base, "old");
    const to = join(base, "new");
    await seedModels(from);

    const landed = await moveModelsDir(from, to);

    expect(landed).toBe(to);
    expect(await readFile(join(to, "sherpa-onnx-sense-voice", "model.onnx"), "utf8")).toBe("x".repeat(2048));
    expect(await dirSize(to)).toBe(3072);
    await expect(readdir(from)).rejects.toThrow(); // a pasta antiga não existe mais
  });

  it("com o destino igual à pasta atual, devolve na hora sem fazer nada", async () => {
    const dir = join(base, "same");
    await seedModels(dir);
    expect(await moveModelsDir(dir, dir)).toBe(dir);
    expect(await dirSize(dir)).toBe(3072);
  });

  it("recusa mover para dentro da própria subpasta (senão se copiaria em recursão)", async () => {
    const from = join(base, "models");
    await seedModels(from);
    await expect(moveModelsDir(from, join(from, "inner"))).rejects.toThrow(/dentro da pasta de modelos atual/);
    expect(await dirSize(from)).toBe(3072); // o original não foi tocado
  });

  it("recusa quando a pasta de destino não está vazia, para modelos de mesmo nome não se sobrescreverem", async () => {
    const from = join(base, "old");
    const to = join(base, "busy");
    await seedModels(from);
    await mkdir(to, { recursive: true });
    await writeFile(join(to, "someone-elses-file"), "keep me");

    await expect(moveModelsDir(from, to)).rejects.toThrow(/não está vazia/);
    expect(await dirSize(from)).toBe(3072); // o original continua lá
    expect(await readFile(join(to, "someone-elses-file"), "utf8")).toBe("keep me"); // o arquivo de outra pessoa não foi apagado
  });

  it("sem nenhum modelo baixado ainda: basta trocar o lugar, sem erro", async () => {
    const to = join(base, "fresh");
    expect(await moveModelsDir(join(base, "never-downloaded"), to)).toBe(to);
  });
});

describe("app-settings", () => {
  it("sem arquivo de configuração, volta para a pasta de modelos de fábrica", () => {
    expect(resolveModelsRoot(base)).toBe(defaultModelsRoot(base));
    expect(readAppSettings(base)).toEqual({});
  });

  it("depois de gravar uma pasta personalizada, é ela que vale", () => {
    writeAppSettings(base, { modelsDir: "/data/hotclip-models" });
    expect(resolveModelsRoot(base)).toBe("/data/hotclip-models");
  });

  it("limpar a pasta personalizada → volta para o lugar de fábrica", () => {
    writeAppSettings(base, { modelsDir: "/data/x" });
    writeAppSettings(base, { modelsDir: undefined });
    expect(resolveModelsRoot(base)).toBe(defaultModelsRoot(base));
  });

  it("configuração corrompida → volta para o padrão em vez de quebrar (uma configuração ruim não pode impedir a exportação)", async () => {
    await writeFile(join(base, "settings.json"), "{ not json");
    expect(resolveModelsRoot(base)).toBe(defaultModelsRoot(base));
  });

  it("caminho em branco conta como não configurado", async () => {
    await writeFile(join(base, "settings.json"), JSON.stringify({ modelsDir: "   " }));
    expect(resolveModelsRoot(base)).toBe(defaultModelsRoot(base));
  });
});
