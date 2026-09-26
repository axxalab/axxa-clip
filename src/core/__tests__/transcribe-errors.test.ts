/**
 * O protocolo de atribuição de causa das falhas de transcrição (issue #2): a marca posta pelo processo
 * principal e a leitura da camada de renderização têm de ser exatamente inversas — a marca só atravessa o
 * IPC dentro da string da message, e se os dois lados deixarem de bater, a pessoa volta ao estado enganoso
 * de «toda falha pede para conferir a trilha de áudio».
 */
import { describe, expect, it } from "vitest";
import {
  ERR_TAG_MODEL_DOWNLOAD,
  ERR_TAG_MODEL_LOAD,
  ERR_TAG_NO_AUDIO,
  parseTranscribeError,
  stripIpcError,
  tagTranscribeError,
} from "../../shared/transcribe-errors";

describe("stripIpcError (a retirada geral do embrulho, issue #6)", () => {
  it("tira o prefixo de embrulho do IPC do Electron", () => {
    expect(stripIpcError("Error invoking remote method 'hotclip:detect-highlights': Error: não foi possível conectar ao serviço de LLM")).toBe(
      "não foi possível conectar ao serviço de LLM"
    );
  });

  it("mesmo sem o segundo prefixo Error:, a retirada funciona", () => {
    expect(stripIpcError("Error invoking remote method 'hotclip:x': boom")).toBe("boom");
  });

  it("um texto de erro solto volta como está", () => {
    expect(stripIpcError("fetch failed")).toBe("fetch failed");
  });
});

describe("tagTranscribeError", () => {
  it("material confirmado sem trilha de áudio → recebe a marca no-audio (mesmo que o texto do erro pareça outra falha)", () => {
    const tagged = tagTranscribeError("ffmpeg exited with code 1", { hasAudio: false });
    expect(tagged.startsWith(ERR_TAG_NO_AUDIO)).toBe(true);
    expect(tagged).toContain("ffmpeg exited with code 1");
  });

  it("com trilha de áudio, mas com o download do modelo falhando → recebe a marca model-download", () => {
    const raw = "model download failed after all mirrors (sensevoice-2024-07-17): HTTP 403";
    const tagged = tagTranscribeError(raw, { hasAudio: true });
    expect(tagged.startsWith(ERR_TAG_MODEL_DOWNLOAD)).toBe(true);
    expect(tagged).toContain(raw);
  });

  it("quando o probe também falha (media em null), não se arrisca a culpar a falta de trilha, e tudo fica como está", () => {
    expect(tagTranscribeError("some decode error", null)).toBe("some decode error");
  });

  it("com trilha de áudio e uma falha que não é de download do modelo, tudo fica como está", () => {
    expect(tagTranscribeError("boom", { hasAudio: true })).toBe("boom");
  });

  // issue #4: com o modelo instalado, a falha do sherpa ao criar o recognizer (caminho com acento no Windows,
  // modelo corrompido) só lança este texto fixo — a causa tem de virar model-load, e não voltar ao aviso genérico
  it("o sherpa recusa a configuração (o modelo não abre) → recebe a marca model-load", () => {
    const tagged = tagTranscribeError("Please check your config!", { hasAudio: true });
    expect(tagged.startsWith(ERR_TAG_MODEL_LOAD)).toBe(true);
    expect(tagged).toContain("Please check your config!");
  });

  it("material confirmado sem trilha de áudio tem precedência sobre a causa model-load", () => {
    const tagged = tagTranscribeError("Please check your config!", { hasAudio: false });
    expect(tagged.startsWith(ERR_TAG_NO_AUDIO)).toBe(true);
  });
});

describe("parseTranscribeError", () => {
  it("tira o prefixo de embrulho do IPC do Electron e reconhece a marca no-audio", () => {
    const raw = `Error invoking remote method 'hotclip:transcribe': Error: ${ERR_TAG_NO_AUDIO} ffmpeg exited with code 1`;
    expect(parseTranscribeError(raw)).toEqual({ kind: "no-audio", detail: "ffmpeg exited with code 1" });
  });

  it("reconhece a marca model-download e preserva o detalhe", () => {
    const raw = `Error invoking remote method 'hotclip:transcribe': Error: ${ERR_TAG_MODEL_DOWNLOAD} model download failed after all mirrors (sensevoice): HTTP 403`;
    const parsed = parseTranscribeError(raw);
    expect(parsed.kind).toBe("model-download");
    expect(parsed.detail).toContain("HTTP 403");
  });

  it("sem marca → generic, com o detalhe sendo a informação original já sem o embrulho", () => {
    const raw = "Error invoking remote method 'hotclip:transcribe': Error: ENOSPC: no space left on device";
    expect(parseTranscribeError(raw)).toEqual({ kind: "generic", detail: "ENOSPC: no space left on device" });
  });

  it("um texto de erro solto, sem o embrulho do IPC, também é lido", () => {
    expect(parseTranscribeError("plain failure")).toEqual({ kind: "generic", detail: "plain failure" });
  });

  it("é o inverso de tagTranscribeError: depois da ida e volta da marca, nem a causa nem o detalhe se perdem", () => {
    const tagged = tagTranscribeError("ffmpeg exited with code 1", { hasAudio: false });
    const parsed = parseTranscribeError(`Error invoking remote method 'hotclip:transcribe': Error: ${tagged}`);
    expect(parsed).toEqual({ kind: "no-audio", detail: "ffmpeg exited with code 1" });
  });

  it("ida e volta da marca model-load: a causa fica certa e o detalhe original é preservado (para abrir uma issue)", () => {
    const tagged = tagTranscribeError("Please check your config!", { hasAudio: true });
    const parsed = parseTranscribeError(`Error invoking remote method 'hotclip:transcribe': Error: ${tagged}`);
    expect(parsed).toEqual({ kind: "model-load", detail: "Please check your config!" });
  });
});
