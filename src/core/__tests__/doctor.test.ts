import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { runDoctor, dirSize } from "../doctor";

let root: string;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await rm(root, { recursive: true, force: true });
});

async function freshRoot(): Promise<{ modelsRoot: string; cacheDir: string }> {
  root = await mkdtemp(join(tmpdir(), "hotclip-doctor-"));
  const modelsRoot = join(root, "models");
  const cacheDir = join(root, "cache");
  await mkdir(modelsRoot, { recursive: true });
  return { modelsRoot, cacheDir };
}

// O teste unitário não aposta no ambiente de ffmpeg/ffprobe da máquina que roda a CI (no Linux o
// ffprobe já não subiu, e no Windows não existe nem /bin/echo): a resolução do caminho e a sondagem
// da versão recebem implementações falsas, sem tocar em processo real.
const fakeBins = { ffmpeg: () => "/fake/ffmpeg", ffprobe: () => "/fake/ffprobe" };
const fakeProbe = async (): Promise<string> => "fake version 1.0\n";

describe("dirSize", () => {
  it("soma recursiva, e o que não existe conta como 0", async () => {
    const { modelsRoot } = await freshRoot();
    await mkdir(join(modelsRoot, "a/b"), { recursive: true });
    await writeFile(join(modelsRoot, "a/x.bin"), Buffer.alloc(10));
    await writeFile(join(modelsRoot, "a/b/y.bin"), Buffer.alloc(5));
    expect(await dirSize(join(modelsRoot, "a"))).toBe(15);
    expect(await dirSize(join(modelsRoot, "nao-existe"))).toBe(0);
  });
});

describe("runDoctor", () => {
  it("ambiente vazio: os modelos principais aparecem como não instalados e entram em missingCoreModels, e LLM sem configuração é warn, não fail", async () => {
    const { modelsRoot, cacheDir } = await freshRoot();
    const report = await runDoctor({ modelsRoot, cacheDir, llm: null, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });

    // Os cinco modelos principais da esteira padrão estão todos faltando
    expect(report.missingCoreModels.map((a) => a.id)).toEqual([
      "sensevoice-2024-07-17",
      "yunet-2023mar",
      "emotion-ferplus-8",
      "transnetv2-onnx",
      "silero-vad-v6",
    ]);
    const sv = report.checks.find((c) => c.name.includes("SenseVoice"));
    expect(sv?.status).toBe("warn");
    expect(sv?.detail).toContain("não instalado");
    expect(sv?.fix).toContain("baixe agora");

    // Modelo opcional faltando não gera aviso
    const fireRed = report.checks.find((c) => c.name.includes("FireRed"));
    expect(fireRed?.status).toBe("ok");

    const llm = report.checks.find((c) => c.name === "Configuração do LLM");
    expect(llm?.status).toBe("warn");
    expect(llm?.fix).toContain("HOTCLIP_LLM_BASE_URL");

    // Com o binário disponível (o binário falso injetado), o resultado é ok
    expect(report.checks.find((c) => c.name === "ffmpeg")?.status).toBe("ok");
    expect(report.checks.find((c) => c.name === "ffprobe")?.status).toBe("ok");
  });

  it("falha ao resolver o binário dá fail e vem com sugestão de conserto", async () => {
    const { modelsRoot, cacheDir } = await freshRoot();
    const report = await runDoctor({
      modelsRoot,
      cacheDir,
      llm: null,
      resolveBinaries: {
        ffmpeg: () => "/bin/echo",
        ffprobe: () => {
          throw new Error("no binary for this platform");
        },
      },
    });
    const ffprobe = report.checks.find((c) => c.name === "ffprobe");
    expect(ffprobe?.status).toBe("fail");
    expect(ffprobe?.fix).toContain("reinstale o aplicativo");
  });

  it("modelo instalado mostra o tamanho; arquivo interrompido mostra o quanto falta retomar", async () => {
    const { modelsRoot, cacheDir } = await freshRoot();
    // YuNet instalado (na forma singleFile)
    await mkdir(join(modelsRoot, "yunet-2023mar"), { recursive: true });
    await writeFile(join(modelsRoot, "yunet-2023mar", "model.onnx"), Buffer.alloc(1024 * 1024));
    // SenseVoice com um arquivo de download interrompido
    await writeFile(join(modelsRoot, "sensevoice-2024-07-17.download.tar.bz2"), Buffer.alloc(2 * 1024 * 1024));

    const report = await runDoctor({ modelsRoot, cacheDir, llm: null, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    const yunet = report.checks.find((c) => c.name.includes("YuNet"));
    expect(yunet?.status).toBe("ok");
    expect(yunet?.detail).toContain("instalado");
    const sv = report.checks.find((c) => c.name.includes("SenseVoice"));
    expect(sv?.detail).toContain("serão retomados");
    expect(report.missingCoreModels.map((a) => a.id)).not.toContain("yunet-2023mar");
  });

  it("baixador ausente não gera aviso, e em cache a integridade é verificada", async () => {
    const { modelsRoot, cacheDir } = await freshRoot();
    const toolsDir = join(root, "tools");
    let report = await runDoctor({ modelsRoot, cacheDir, toolsDir, llm: null, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.id === "downloader")).toMatchObject({ status: "ok" });

    await mkdir(toolsDir, { recursive: true });
    const binary = join(toolsDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    const bytes = Buffer.from("verified-tool");
    await writeFile(binary, bytes);
    await writeFile(`${binary}.sha256`, `${createHash("sha256").update(bytes).digest("hex")}\n`);
    report = await runDoctor({ modelsRoot, cacheDir, toolsDir, llm: null, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.id === "downloader")).toMatchObject({ status: "ok", detail: expect.stringContaining("instalado e verificado") });

    await writeFile(`${binary}.sha256`, "bad");
    report = await runDoctor({ modelsRoot, cacheDir, toolsDir, llm: null, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.id === "downloader")).toMatchObject({ status: "warn", fix: expect.stringContaining("é apagado") });
  });

  it("o relatório do desktop em inglês não mistura texto em português", async () => {
    const { modelsRoot, cacheDir } = await freshRoot();
    const report = await runDoctor({ modelsRoot, cacheDir, llm: null, pt: false, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.id.startsWith("model:"))).toMatchObject({ name: expect.stringContaining("transcription"), detail: expect.stringContaining("Not installed") });
    expect(report.checks.find((c) => c.id === "llm")).toMatchObject({ name: "LLM configuration", fix: expect.stringContaining("AI model settings") });
    expect(report.checks.find((c) => c.id === "cache")?.detail).toContain("Empty");
  });

  it("a verificação opcional do cache de renderização mostra o espaço usado e aceita relatório em inglês", async () => {
    const { modelsRoot, cacheDir } = await freshRoot();
    const renderCacheDir = join(root, "render-cache");
    await mkdir(renderCacheDir, { recursive: true });
    await writeFile(join(renderCacheDir, "base.mp4"), Buffer.alloc(1024 * 1024));

    let report = await runDoctor({ modelsRoot, cacheDir, renderCacheDir, llm: null, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.id === "render-cache")).toMatchObject({ name: "Cache da renderização base", status: "ok", detail: expect.stringContaining("1MB") });

    report = await runDoctor({ modelsRoot, cacheDir, renderCacheDir, llm: null, pt: false, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.id === "render-cache")).toMatchObject({ name: "Render cache", detail: expect.stringContaining("limited to 1GB") });
  });

  it("o índice de evidências multimodais mostra o próprio espaço usado e o teto de 64MB", async () => {
    const { modelsRoot, cacheDir } = await freshRoot();
    const evidenceCacheDir = join(root, "evidence-index");
    await mkdir(evidenceCacheDir, { recursive: true });
    await writeFile(join(evidenceCacheDir, "signals.json"), Buffer.alloc(2 * 1024 * 1024));

    let report = await runDoctor({ modelsRoot, cacheDir, evidenceCacheDir, llm: null, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((check) => check.id === "evidence-index")).toMatchObject({
      name: "Índice de evidências multimodais",
      status: "ok",
      detail: expect.stringContaining("2MB"),
    });
    report = await runDoctor({ modelsRoot, cacheDir, evidenceCacheDir, llm: null, pt: false, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((check) => check.id === "evidence-index")).toMatchObject({
      name: "Multimodal evidence index",
      detail: expect.stringContaining("limited to 64MB"),
    });
  });

  it("endpoint de LLM: separa o sucesso, o erro de rota, o erro de credencial e o erro de rede", async () => {
    const { modelsRoot, cacheDir } = await freshRoot();
    const llm = { baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", model: "m" };

    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    let report = await runDoctor({ modelsRoot, cacheDir, llm, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.name === "Endpoint de LLM")?.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/models"), expect.objectContaining({ headers: { Authorization: "Bearer k" } }));

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    report = await runDoctor({ modelsRoot, cacheDir, llm, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.name === "Endpoint de LLM")).toMatchObject({ status: "warn", id: "llm" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    report = await runDoctor({ modelsRoot, cacheDir, llm, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    expect(report.checks.find((c) => c.name === "Endpoint de LLM")).toMatchObject({ status: "fail", id: "llm" });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    report = await runDoctor({ modelsRoot, cacheDir, llm, resolveBinaries: fakeBins, probeBinaryVersion: fakeProbe });
    const check = report.checks.find((c) => c.name === "Endpoint de LLM");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain("não foi possível alcançar");
  });
});
