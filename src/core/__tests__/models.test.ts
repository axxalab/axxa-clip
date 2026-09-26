import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { parseContentRange, candidateUrls, ensureModel, extractTarBz2, type ModelAsset } from "../models";

describe("parseContentRange", () => {
  it("lê o padrão bytes início-fim/total", () => {
    expect(parseContentRange("bytes 100-999/1000")).toEqual({ start: 100, total: 1000 });
  });

  it("inválido ou ausente devolve null", () => {
    expect(parseContentRange(null)).toBeNull();
    expect(parseContentRange("")).toBeNull();
    expect(parseContentRange("bytes */1000")).toBeNull();
  });
});

describe("candidateUrls", () => {
  it("o prefixo do espelho vem primeiro, as altUrls no meio e a URL principal por último", () => {
    const asset: ModelAsset = {
      id: "x",
      url: "https://github.com/a/b.tar.bz2",
      mirrors: ["https://m1/", "https://m2/"],
      altUrls: ["https://alt/b.tar.bz2"],
      extractedDir: "x",
      approxBytes: 1,
    };
    expect(candidateUrls(asset)).toEqual([
      "https://m1/https://github.com/a/b.tar.bz2",
      "https://m2/https://github.com/a/b.tar.bz2",
      "https://alt/b.tar.bz2",
      "https://github.com/a/b.tar.bz2",
    ]);
  });
});

// ---- Retomada do download: o fetch é substituído por um dublê, e um modelo singleFile percorre o ensureModel inteiro ----

const FULL = Buffer.from("0123456789abcdefghij"); // o «arquivo de modelo» de 20 bytes

function asset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    id: "test-model",
    url: "https://origin/model.onnx",
    mirrors: [],
    extractedDir: "test-model",
    approxBytes: FULL.length,
    singleFile: "model.onnx",
    ...overrides,
  };
}

/**
 * Um corpo de resposta que entrega os n primeiros bytes e cai (simulando o terminated no meio de um arquivo
 * grande do GitHub).
 * Precisa ser no modo pull: um enqueue+error síncrono faz a especificação descartar a fila não lida, e os
 * bytes não chegam.
 */
function brokenBody(bytes: Buffer): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new Uint8Array(bytes));
      } else {
        controller.error(new Error("terminated"));
      }
    },
  });
}

function fullBody(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

let root: string;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await rm(root, { recursive: true, force: true });
});

async function freshRoot(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "hotclip-models-"));
  return root;
}

describe("ensureModel: retomada do download", () => {
  it("um modelo cru só é instalado depois de conferir o SHA-256 de quem o publicou", async () => {
    const modelsRoot = await freshRoot();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(fullBody(FULL), { status: 200, headers: { "content-length": String(FULL.length) } })
    ));
    const a = asset({ sha256: createHash("sha256").update(FULL).digest("hex") });
    await ensureModel(modelsRoot, a);
    expect((await readFile(join(modelsRoot, a.extractedDir, "model.onnx"))).equals(FULL)).toBe(true);
  });

  it("recusa o modelo cru cujo SHA-256 não bate e não deixa arquivo instalado atrás", async () => {
    const modelsRoot = await freshRoot();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(fullBody(FULL), { status: 200, headers: { "content-length": String(FULL.length) } })
    ));
    const a = asset({ sha256: "0".repeat(64) });
    await expect(ensureModel(modelsRoot, a)).rejects.toThrow(/model download failed/);
    await expect(stat(join(modelsRoot, a.extractedDir, "model.onnx"))).rejects.toThrow();
  });

  it("depois da queda, a retomada usa Range e o arquivo final fica completo", async () => {
    const modelsRoot = await freshRoot();
    const cut = 8;
    const calls: Array<string | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const range = (init?.headers as Record<string, string> | undefined)?.Range;
        calls.push(range);
        if (!range) {
          // A primeira vez, inteira: entrega 8 bytes e cai
          return new Response(brokenBody(FULL.subarray(0, cut)), {
            status: 200,
            headers: { "content-length": String(FULL.length) },
          });
        }
        // A retomada: o ponto de partida é conferido e os bytes que faltam são completados
        expect(range).toBe(`bytes=${cut}-`);
        return new Response(fullBody(FULL.subarray(cut)), {
          status: 206,
          headers: {
            "content-range": `bytes ${cut}-${FULL.length - 1}/${FULL.length}`,
            "content-length": String(FULL.length - cut),
          },
        });
      })
    );

    const a = asset();
    await ensureModel(modelsRoot, a, undefined);
    const installed = await readFile(join(modelsRoot, a.extractedDir, "model.onnx"));
    expect(installed.equals(FULL)).toBe(true);
    expect(calls).toEqual([undefined, `bytes=${cut}-`]);
  });

  it("se o servidor não suporta Range (a retomada devolve 200), o download é refeito sobrescrevendo, sem empilhar e contaminar", async () => {
    const modelsRoot = await freshRoot();
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1) {
          return new Response(brokenBody(FULL.subarray(0, 5)), {
            status: 200,
            headers: { "content-length": String(FULL.length) },
          });
        }
        // O Range é ignorado e vem um 200 com tudo
        return new Response(fullBody(FULL), {
          status: 200,
          headers: { "content-length": String(FULL.length) },
        });
      })
    );

    const a = asset();
    await ensureModel(modelsRoot, a, undefined);
    const installed = await readFile(join(modelsRoot, a.extractedDir, "model.onnx"));
    expect(installed.equals(FULL)).toBe(true);
  });

  it("se o espelho mente sobre o ponto de retomada, o arquivo parcial é descartado e tudo recomeça", async () => {
    const modelsRoot = await freshRoot();
    let sawLie = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const range = (init?.headers as Record<string, string> | undefined)?.Range;
        if (!range) {
          if (sawLie) return new Response(fullBody(FULL), { status: 200, headers: { "content-length": String(FULL.length) } });
          return new Response(brokenBody(FULL.subarray(0, 5)), {
            status: 200,
            headers: { "content-length": String(FULL.length) },
          });
        }
        // Um 206, mas com o início do content-range fora de lugar: o arquivo parcial tem de ser descartado
        sawLie = true;
        return new Response(fullBody(FULL.subarray(2)), {
          status: 206,
          headers: { "content-range": `bytes 2-${FULL.length - 1}/${FULL.length}` },
        });
      })
    );

    const a = asset();
    await ensureModel(modelsRoot, a, undefined);
    const installed = await readFile(join(modelsRoot, a.extractedDir, "model.onnx"));
    expect(installed.equals(FULL)).toBe(true);
  });

  it("com os bytes já completos, um 416 conta como download concluído", async () => {
    const modelsRoot = await freshRoot();
    const a = asset();
    // O arquivo parcial já está completo (a queda da vez anterior foi no último instante)
    await writeFile(join(modelsRoot, `${a.id}.download.tar.bz2`), FULL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 416 }))
    );

    await ensureModel(modelsRoot, a, undefined);
    const installed = await stat(join(modelsRoot, a.extractedDir, "model.onnx"));
    expect(installed.size).toBe(FULL.length);
  });

  it("numa falha total o arquivo parcial fica, para a próxima retomada", async () => {
    const modelsRoot = await freshRoot();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(brokenBody(FULL.subarray(0, 4)), {
          status: 200,
          headers: { "content-length": String(FULL.length) },
        })
      )
    );

    const a = asset();
    await expect(ensureModel(modelsRoot, a, undefined)).rejects.toThrow(/model download failed/);
    const partial = await stat(join(modelsRoot, `${a.id}.download.tar.bz2`));
    expect(partial.size).toBeGreaterThan(0);
  });
});

// ---- Descompactação do tar.bz2: na issue #17, o tar embutido do Windows não suporta bzip2, e a reserva em JavaScript puro assume ----

const FIXTURE = join(__dirname, "fixtures", "fixture-model.tar.bz2");

function archiveAsset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    id: "fixture-model",
    url: "https://origin/fixture-model.tar.bz2",
    mirrors: [],
    extractedDir: "fixture-model",
    approxBytes: 650,
    ...overrides,
  };
}

describe("extractTarBz2: a reserva em JavaScript puro", () => {
  it("pulando o tar do sistema (systemTar=null), o pacote também é extraído", async () => {
    const dest = await freshRoot();
    const seen: Array<"download" | "extract" | undefined> = [];
    await extractTarBz2(FIXTURE, dest, (p) => seen.push(p.phase), null);
    const tokens = await readFile(join(dest, "fixture-model", "tokens.txt"), "utf8");
    expect(tokens).toBe("hello tokens\n");
    // Todo o caminho é a etapa de extract, com o progresso real em bytes
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === "extract")).toBe(true);
  });

  it("com o tar do sistema indisponível (o cenário do Windows sem bzip2), a descompactação em JavaScript assume sozinha", async () => {
    const dest = await freshRoot();
    await extractTarBz2(FIXTURE, dest, undefined, "hotclip-no-such-tar-binary");
    const onnx = await readFile(join(dest, "fixture-model", "model.int8.onnx"), "utf8");
    expect(onnx).toBe("fake onnx bytes");
  });
});

describe("ensureModel com um pacote, de ponta a ponta", () => {
  it("baixa o tar.bz2 → descompacta → aterrissa de forma atômica, e o pacote é limpo", async () => {
    const modelsRoot = await freshRoot();
    const bytes = await readFile(FIXTURE);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(fullBody(bytes), {
          status: 200,
          headers: { "content-length": String(bytes.length) },
        })
      )
    );

    const a = archiveAsset();
    const dir = await ensureModel(modelsRoot, a, undefined);
    const tokens = await readFile(join(dir, "tokens.txt"), "utf8");
    expect(tokens).toBe("hello tokens\n");
    // Nem o pacote nem a pasta de preparo ficam atrás
    await expect(stat(join(modelsRoot, `${a.id}.download.tar.bz2`))).rejects.toThrow();
    await expect(stat(join(modelsRoot, `${a.id}.extracting`))).rejects.toThrow();
  });

  it("pacote de fato corrompido: as duas descompactações falham → o pacote é apagado e o espelho é trocado, sem deixar uma pasta que passaria por instalada", async () => {
    const modelsRoot = await freshRoot();
    const garbage = Buffer.from("this is definitely not a bzip2 archive at all");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(fullBody(garbage), {
          status: 200,
          headers: { "content-length": String(garbage.length) },
        })
      )
    );

    const a = archiveAsset();
    await expect(ensureModel(modelsRoot, a, undefined)).rejects.toThrow();
    // O pacote corrompido foi apagado (na próxima vez o download começa do zero), e o extractedDir não foi contaminado por uma extração pela metade
    await expect(stat(join(modelsRoot, `${a.id}.download.tar.bz2`))).rejects.toThrow();
    await expect(stat(join(modelsRoot, a.extractedDir))).rejects.toThrow();
  });
});
