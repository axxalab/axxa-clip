/**
 * Local ASR, edição de maior cobertura: Whisper (OpenAI, MIT) pelo sherpa-onnx.
 *
 * Serve ao material que troca de idioma no meio ou que tem sotaque difícil: são 99 idiomas, e a
 * detecção automática de idioma é do próprio modelo.
 *
 * A ressalva que precisa ficar à vista: o Whisper é encoder-decoder e o sherpa-onnx não devolve
 * marca de tempo por token nenhuma para ele. O tempo das palavras sai repartido dentro da janela e
 * marcado como `estimated` — bom o bastante para escolher o trecho e gerar SRT, mas não para a
 * legenda karaokê. Para isso, ou se usa o Parakeet, ou se passa o resultado pela «calibração de
 * tempo», que realinha palavra a palavra.
 */
import { join } from "path";
import { cpus } from "os";
import { WHISPER_LARGE_V3_MODEL, WHISPER_TURBO_MODEL, type ModelAsset } from "../models";
import { SherpaOfflineEngine } from "./sherpa-offline";

/**
 * Os pacotes de Whisper do sherpa-onnx nomeiam os arquivos com o nome do modelo na frente
 * (`large-v3-encoder.int8.onnx`, `turbo-tokens.txt`), e não com o `tokens.txt` de sempre.
 * O prefixo é a pasta extraída sem o `sherpa-onnx-whisper-`.
 */
export function whisperPrefix(asset: ModelAsset): string {
  return asset.extractedDir.replace(/^sherpa-onnx-whisper-/, "");
}

/** O código de idioma que o Whisper aceita; "auto" e vazio viram detecção pelo próprio modelo. */
export function whisperLanguage(language: string | undefined): string {
  const value = (language ?? "").trim().toLowerCase();
  if (!value || value === "auto") return "";
  return value.split(/[-_]/)[0];
}

export class WhisperEngine extends SherpaOfflineEngine {
  constructor(modelsRoot: string, asset: ModelAsset, id: string, label: string) {
    const prefix = whisperPrefix(asset);
    super(
      {
        id,
        label,
        asset,
        tokensFile: `${prefix}-tokens.txt`,
        buildModelConfig: (dir, options) => ({
          whisper: {
            encoder: join(dir, `${prefix}-encoder.int8.onnx`),
            decoder: join(dir, `${prefix}-decoder.int8.onnx`),
            language: whisperLanguage(options.language),
            task: "transcribe",
            // -1 deixa o sherpa-onnx escolher o preenchimento de cauda conforme o modelo
            tailPaddings: -1,
          },
        }),
        // O Whisper já devolve texto pontuado; passar de novo pelo CT-Transformer só estragaria
        language: (result) => result.lang?.replace(/[<|>]/g, ""),
        numThreads: Math.min(8, Math.max(2, cpus().length - 2)),
      },
      modelsRoot
    );
  }
}

export class WhisperLargeV3Engine extends WhisperEngine {
  constructor(modelsRoot: string) {
    super(modelsRoot, WHISPER_LARGE_V3_MODEL, "whisper-large-v3-local", "Whisper large-v3 (local · 99 idiomas)");
  }
}

export class WhisperTurboEngine extends WhisperEngine {
  constructor(modelsRoot: string) {
    super(modelsRoot, WHISPER_TURBO_MODEL, "whisper-turbo-local", "Whisper large-v3-turbo (local · 99 idiomas · mais rápido)");
  }
}
