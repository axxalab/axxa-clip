import { describe, it, expect } from "vitest";
import { parseCliArgs } from "../index";

describe("parseCliArgs (leitura dos parâmetros da CLI)", () => {
  it("aceita uma trilha de legenda explícita em todo comando que consome transcrição", () => {
    for (const command of ["transcribe", "highlights", "clip"]) {
      expect(parseCliArgs([command, "--subtitles", "/v/original.srt", "/v/source.mp4", "--json"]))
        .toMatchObject({ videoPath: "/v/source.mp4", subtitlePath: "/v/original.srt", json: true });
    }
    expect(() => parseCliArgs(["clip", "/v/source.mp4", "--subtitles"])).toThrow(/SRT/);
    expect(() => parseCliArgs(["clip", "/v/source.mp4", "--subtitles", "--json"])).toThrow(/SRT/);
    expect(() => parseCliArgs(["doctor", "--subtitles", "/v/original.srt"])).toThrow(/serve só para/);
  });
  it("clip todo no padrão: vertical e legenda ligados, e o caminho do vídeo é o primeiro parâmetro que não é opção", () => {
    const a = parseCliArgs(["clip", "/v/live-gravada.mp4"]);
    expect(a).toMatchObject({
      command: "clip",
      videoPath: "/v/live-gravada.mp4",
      vertical: true,
      captions: true,
      autoEnhance: false,
      json: false,
    });
  });

  it("--auto-enhance é explícito e vem desligado por padrão", () => {
    expect(parseCliArgs(["clip", "/v/a.mp4"]).autoEnhance).toBe(false);
    expect(parseCliArgs(["clip", "/v/a.mp4", "--auto-enhance"]).autoEnhance).toBe(true);
    expect(parseCliArgs(["clip", "/v/a.mp4", "--denoise"]).denoiseMode).toBe("basic");
    expect(parseCliArgs(["clip", "/v/a.mp4", "--smart-denoise"]).denoiseMode).toBe("smart");
  });

  it("chaves e opções com valor: --no-vertical / --no-captions / --max-clips / --out / --json", () => {
    const a = parseCliArgs(["clip", "/v/a.mp4", "--no-vertical", "--no-captions", "--max-clips", "3", "--out", "/tmp/o", "--json"]);
    expect(a.vertical).toBe(false);
    expect(a.captions).toBe(false);
    expect(a.maxClips).toBe(3);
    expect(a.outDir).toBe("/tmp/o");
    expect(a.json).toBe(true);
  });

  it("--max-clips é preso entre 1 e 12 (a mesma restrição do MCP)", () => {
    expect(parseCliArgs(["clip", "/v/a.mp4", "--max-clips", "99"]).maxClips).toBe(12);
    expect(parseCliArgs(["clip", "/v/a.mp4", "--max-clips", "0"]).maxClips).toBe(1);
  });

  it("a ordem das opções não importa: elas podem vir antes do caminho", () => {
    const a = parseCliArgs(["highlights", "--max-clips", "5", "/v/a.mp4"]);
    expect(a.videoPath).toBe("/v/a.mp4");
    expect(a.maxClips).toBe(5);
  });

  it("--reference é lido com valor; sem valor, lança erro", () => {
    const a = parseCliArgs(["highlights", "/v/a.mp4", "--reference", "/v/referencia-que-viralizou.mp4"]);
    expect(a.referencePath).toBe("/v/referencia-que-viralizou.mp4");
    expect(parseCliArgs(["clip", "/v/a.mp4"]).referencePath).toBeUndefined();
    expect(() => parseCliArgs(["clip", "/v/a.mp4", "--reference"])).toThrow(/caminho de um vídeo de referência/);
  });

  it("doctor não precisa de caminho de vídeo, e --download é opcional", () => {
    expect(parseCliArgs(["doctor"])).toMatchObject({ command: "doctor", download: false });
    expect(parseCliArgs(["doctor", "--download"]).download).toBe(true);
  });

  it("retorno de desempenho da publicação: o import precisa de arquivo, e o report não precisa de caminho", () => {
    expect(parseCliArgs(["feedback", "/data/tiktok.csv"])).toMatchObject({
      command: "feedback",
      videoPath: "/data/tiktok.csv",
    });
    expect(parseCliArgs(["feedback-report", "--json"])).toMatchObject({
      command: "feedback-report",
      videoPath: "",
      json: true,
    });
    expect(() => parseCliArgs(["feedback"])).toThrow(/arquivo de dados/);
  });

  it("sem comando / sem caminho / opção desconhecida / número inválido → erro com o texto de uso", () => {
    expect(() => parseCliArgs([])).toThrow(/Uso:/);
    expect(() => parseCliArgs(["clip"])).toThrow(/falta o caminho do vídeo/);
    expect(() => parseCliArgs(["clip", "/v/a.mp4", "--wat"])).toThrow(/opção desconhecida/);
    expect(() => parseCliArgs(["clip", "/v/a.mp4", "--max-clips", "abc"])).toThrow(/precisa de um número/);
  });

  it("-h / --help → mostra o texto de uso", () => {
    expect(() => parseCliArgs(["--help"])).toThrow(/pnpm cli clip/);
  });
});


describe("opções do motor de fala local", () => {
  it("lê o serviço opcional e o reinício explícito", () => {
    expect(parseCliArgs(["transcribe", "source.mp4", "--engine", "qwen3", "--asr-url", "http://127.0.0.1:8766", "--restart-transcription"])).toMatchObject({ engineId: "qwen3", localServiceUrl: "http://127.0.0.1:8766", restart: true });
  });
  it("recusa motor não suportado e URL de serviço remoto", () => {
    expect(() => parseCliArgs(["transcribe", "source.mp4", "--engine", "unknown"])).toThrow();
    expect(() => parseCliArgs(["transcribe", "source.mp4", "--asr-url", "https://example.com"])).toThrow();
  });
});
