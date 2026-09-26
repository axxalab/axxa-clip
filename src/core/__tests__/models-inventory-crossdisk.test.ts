/**
 * Mudança entre discos (o cenário principal da issue #3 — o que a pessoa quer é justamente levar 1GB de
 * modelos para outro disco).
 * Entre discos o rename falha com EXDEV e o caminho vira «copiar → conferir → apagar o original». É por
 * aqui que os modelos mais correm risco de se perder, então o EXDEV é simulado num teste próprio: se a
 * cópia dá certo, o original tem mesmo de sair; se a cópia falha, o original não pode perder um byte e
 * não pode sobrar uma pasta de destino pela metade.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const renameMock = vi.fn();
const cpMock = vi.fn();

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    // Por padrão repassa para a implementação real, e cada teste troca por uma falha quando precisa
    rename: (...args: Parameters<typeof actual.rename>) => renameMock(...args),
    cp: (...args: Parameters<typeof actual.cp>) => cpMock(...args),
  };
});

const { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp: realCp } = await vi.importActual<
  typeof import("fs/promises")
>("fs/promises");
const { join } = await import("path");
const { tmpdir } = await import("os");
const { dirSize, moveModelsDir } = await import("../models-inventory");

let base: string;
const EXDEV = Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "hotclip-xdisk-"));
  renameMock.mockReset();
  cpMock.mockReset();
  // Entre discos: o rename sempre falha, e o cp faz a cópia de verdade
  renameMock.mockRejectedValue(EXDEV);
  cpMock.mockImplementation((...args: Parameters<typeof realCp>) => realCp(...args));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function seed(root: string): Promise<void> {
  await mkdir(join(root, "sense-voice"), { recursive: true });
  await writeFile(join(root, "sense-voice", "model.onnx"), "x".repeat(4096));
  await mkdir(join(root, "yunet"), { recursive: true });
  await writeFile(join(root, "yunet", "face.onnx"), "y".repeat(1024));
}

describe("moveModelsDir entre discos", () => {
  it("com o rename falhando, a cópia assume: os arquivos chegam inteiros e só então a pasta original sai", async () => {
    const from = join(base, "old");
    const to = join(base, "new");
    await seed(from);

    const landed = await moveModelsDir(from, to);

    expect(renameMock).toHaveBeenCalled(); // o rename foi tentado primeiro
    expect(cpMock).toHaveBeenCalled(); // e a cópia assumiu depois
    expect(landed).toBe(to);
    expect(await readFile(join(to, "sense-voice", "model.onnx"), "utf8")).toBe("x".repeat(4096));
    expect(await dirSize(to)).toBe(5120);
    await expect(readdir(from)).rejects.toThrow();
  });

  it("falha no meio da cópia: a pasta original não perde um byte e o destino pela metade é apagado", async () => {
    const from = join(base, "old");
    const to = join(base, "new");
    await seed(from);
    // A primeira subpasta copia bem e a segunda explode — simulando queda de energia ou disco cheio no meio
    let call = 0;
    cpMock.mockImplementation((...args: Parameters<typeof realCp>) => {
      call += 1;
      if (call > 1) return Promise.reject(new Error("ENOSPC: no space left on device"));
      return realCp(...args);
    });

    await expect(moveModelsDir(from, to)).rejects.toThrow(/a pasta original não foi alterada/);

    expect(await dirSize(from)).toBe(5120); // o original não perdeu um byte
    expect(await readFile(join(from, "yunet", "face.onnx"), "utf8")).toBe("y".repeat(1024));
    await expect(readdir(to)).rejects.toThrow(); // o destino pela metade foi apagado
  });

  it("a cópia com menos bytes que o original → a mudança não valeu, e o original fica", async () => {
    const from = join(base, "old");
    const to = join(base, "new");
    await seed(from);
    // A cópia «deu certo», mas só parte do conteúdo chegou (a falha de truncamento silencioso)
    cpMock.mockImplementation(async (src: string, dest: string) => {
      await mkdir(dest, { recursive: true });
      await writeFile(join(dest, "truncated.bin"), "z");
    });

    await expect(moveModelsDir(from, to)).rejects.toThrow(/a pasta original não foi alterada/);
    expect(await dirSize(from)).toBe(5120);
  });
});
