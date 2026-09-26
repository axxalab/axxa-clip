/**
 * Generic sherpa-onnx offline engine runner. Every local model tier
 * (SenseVoice / Paraformer / FireRedASR…) shares the same pipeline:
 * ensure models → extract 16k f32le samples → windowed decode with token timestamps →
 * optional punctuation restoration → sentence segmentation.
 * A tier is described by a spec; adding a model = adding a spec.
 */
import { join } from "path";
import {
  ensureModel,
  isModelInstalled,
  modelDir,
  PUNCT_MODEL,
  type ModelAsset,
} from "../models";
import { toAnsiSafeDir } from "../win-ansi-path";
import { joinWords } from "./segment";
import { applyPunctuation } from "./punctuate";
import type { Transcript, TranscribeEngine, TranscribeOptions, TranscriptWord } from "./types";

import { transcribeWindows } from "./windowed";

export interface SherpaResult {
  text: string;
  tokens?: string[];
  timestamps?: number[];
  lang?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let sherpa: any = null;
/** sherpa-onnx-node is a native addon — require lazily so importing core stays cheap. */
export function loadSherpa(): any {
  if (!sherpa) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sherpa = require("sherpa-onnx-node");
  }
  return sherpa;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * O marcador de início de palavra dos vocabulários de subpalavra: o SentencePiece usa U+2581 e
 * alguns pacotes (o Parakeet, entre eles) usam espaço comum. Um token SEM o marcador é continuação
 * da palavra anterior.
 */
const WORD_START = /^[ \u2581]/;

/**
 * Junta as subpalavras numa palavra só, quando o modelo é de vocabulário de subpalavra.
 *
 * Por que isto existe: um transducer BPE como o Parakeet devolve `[" B","om"," dia"," pesso","al","!"]`.
 * Tratar cada pedaço como palavra e depois juntar com espaço produzia «B om dia pesso al!» — texto
 * quebrado na legenda, na busca e no prompt. O tempo da palavra passa a ser o do primeiro pedaço, e o
 * fim continua sendo o começo da palavra seguinte.
 *
 * Os modelos de escrita ideográfica (SenseVoice, Paraformer, FireRedASR2) emitem um token por
 * caractere e nenhum deles carrega o marcador — por isso a junção só liga quando o marcador aparece,
 * em vez de colar a frase inteira numa palavra só.
 */
export function mergeSubwordTokens(tokens: string[], stamps: number[]): { tokens: string[]; stamps: number[] } {
  if (!tokens.some((x) => WORD_START.test(x ?? ""))) return { tokens, stamps };
  const outTokens: string[] = [];
  const outStamps: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const piece = tokens[i] ?? "";
    if (outTokens.length > 0 && !WORD_START.test(piece)) {
      outTokens[outTokens.length - 1] += piece;
      continue;
    }
    outTokens.push(piece.replace(WORD_START, ""));
    outStamps.push(stamps[i]);
  }
  return { tokens: outTokens, stamps: stamps.length === 0 ? [] : outStamps };
}

/**
 * Reparte os tokens por igual dentro da janela, quando o motor não deu marca de tempo alguma.
 * O peso de cada token é o tamanho do texto, de modo que uma palavra longa ocupe mais tempo que um
 * sinal de pontuação; o resultado é sempre marcado como estimado, nunca como nativo.
 */
function spreadTokens(tokens: string[], offsetSec: number, windowEndSec: number): TranscriptWord[] {
  const kept = tokens.map((x) => (x ?? "").trim()).filter(Boolean);
  if (kept.length === 0) return [];
  const span = Math.max(0, windowEndSec - offsetSec);
  const weights = kept.map((x) => Math.max(1, x.replace(/\s+/g, "").length));
  const total = weights.reduce((a, b) => a + b, 0);
  const words: TranscriptWord[] = [];
  let at = offsetSec;
  for (let i = 0; i < kept.length; i++) {
    const end = i === kept.length - 1 ? windowEndSec : at + (span * weights[i]) / total;
    words.push({ text: kept[i], startSec: at, endSec: Math.max(end, at), timingSource: "estimated" });
    at = end;
  }
  return words;
}

/**
 * Convert one window's sherpa result into timed words offset to absolute time.
 * Engines emit per-token start times; each token's end is the next token's
 * start (last token gets +0.3s tail).
 */
export function tokensToWords(result: SherpaResult, offsetSec: number, windowEndSec: number): TranscriptWord[] {
  const { tokens, stamps } = mergeSubwordTokens(result.tokens ?? [], result.timestamps ?? []);
  // Um modelo encoder-decoder (o Whisper) não devolve marca de tempo nenhuma. Sem isto, todos os tokens
  // cairiam no mesmo instante — o começo da janela —, e a legenda sairia empilhada. Espalhar por igual
  // dentro da janela é honesto (fica marcado como "estimated") e é a entrada de que o alinhamento precisa.
  if (stamps.length === 0 && tokens.length > 0) return spreadTokens(tokens, offsetSec, windowEndSec);
  const words: TranscriptWord[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const text = tokens[i];
    if (!text || !text.trim()) continue;
    const start = Math.min(windowEndSec, Math.max(offsetSec, offsetSec + (stamps[i] ?? 0)));
    const nextStamp = stamps[i + 1];
    const end = nextStamp !== undefined ? offsetSec + nextStamp : Math.min(start + 0.3, windowEndSec);
    words.push({
      text: text.trim(),
      startSec: start,
      endSec: Math.min(windowEndSec, Math.max(end, start)),
      timingSource: stamps[i] !== undefined ? "native" : "estimated",
    });
  }
  return words;
}

/**
 * O execution provider passado ao sherpa-onnx.
 *
 * Fica em "cpu" de propósito: os pacotes de sherpa-onnx publicados no npm (sherpa-onnx-win-x64,
 * -linux-x64, -darwin-*) embutem o onnxruntime só de CPU, então pedir "cuda" ali não acelera nada —
 * o runtime apenas avisa e volta para a CPU. Quem compilou o sherpa-onnx com SHERPA_ONNX_ENABLE_GPU=ON
 * e apontou o addon para essa build pode ligar a GPU com HOTCLIP_SHERPA_PROVIDER=cuda.
 */
export function sherpaProvider(): string {
  const value = (process.env.HOTCLIP_SHERPA_PROVIDER ?? "").trim().toLowerCase();
  return value === "cuda" || value === "directml" || value === "coreml" ? value : "cpu";
}

export interface SherpaEngineSpec {
  id: string;
  label: string;
  asset: ModelAsset;
  /**
   * sherpa OfflineRecognizer modelConfig for this tier (paths inside `dir`).
   * `options` chega junto porque o Whisper precisa da dica de idioma já na construção do
   * reconhecedor; os tiers que não dependem disso simplesmente ignoram o segundo parâmetro.
   */
  buildModelConfig(dir: string, options: TranscribeOptions): Record<string, unknown>;
  /**
   * O nome do arquivo de tokens dentro da pasta do modelo. Quase todo pacote usa "tokens.txt"; os do
   * Whisper trazem o nome do modelo no arquivo ("large-v3-tokens.txt"), e por isso isto é ajustável.
   */
  tokensFile?: string;
  /** Fixed language, or a reader that pulls it from the first decode result. */
  language: string | ((result: SherpaResult) => string | undefined);
  /** Restore punctuation via CT-Transformer (models that emit none). */
  punctuate?: boolean;
  numThreads?: number;
}

export class SherpaOfflineEngine implements TranscribeEngine {
  id: string;
  label: string;

  constructor(
    private spec: SherpaEngineSpec,
    private modelsRoot: string
  ) {
    this.id = spec.id;
    this.label = spec.label;
  }

  async isReady(): Promise<boolean> {
    return isModelInstalled(this.modelsRoot, this.spec.asset);
  }

  async transcribe(filePath: string, options: TranscribeOptions = {}): Promise<Transcript> {
    const { onProgress, signal } = options;
    const spec = this.spec;

    onProgress?.({ fraction: 0, stage: "downloading-model" });
    const download = (p: { downloadedBytes: number; totalBytes: number; phase?: "download" | "extract" }): void =>
      onProgress?.({
        fraction: 0,
        stage: p.phase === "extract" ? "extracting-model" : "downloading-model",
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
      });
    await ensureModel(this.modelsRoot, spec.asset, download, signal);
    if (spec.punctuate) await ensureModel(this.modelsRoot, PUNCT_MODEL, download, signal);


    const sh = loadSherpa();
    // O arquivo do modelo é aberto pela camada nativa (ANSI): no Windows, o caminho com acento vira primeiro o caminho curto 8.3 (issue #4)
    const dir = await toAnsiSafeDir(modelDir(this.modelsRoot, spec.asset));
    const recognizer = new sh.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        ...spec.buildModelConfig(dir, options),
        tokens: join(dir, spec.tokensFile ?? "tokens.txt"),
        numThreads: spec.numThreads ?? 2,
        provider: sherpaProvider(),
        debug: 0,
      },
    });
    const punct = spec.punctuate
      ? new sh.OfflinePunctuation({
          model: {
            ctTransformer: join(await toAnsiSafeDir(modelDir(this.modelsRoot, PUNCT_MODEL)), "model.int8.onnx"),
            numThreads: 1,
            provider: "cpu",
            debug: 0,
          },
        })
      : null;

    return transcribeWindows(filePath, this.id,
      JSON.stringify([this.id, spec.asset, spec.buildModelConfig("MODEL", options), spec.punctuate, "sherpa-1.13-v2"]), options,
      async (samples, startSec, endSec) => {
        signal?.throwIfAborted();
        const stream = recognizer.createStream();
        try {
          stream.acceptWaveform({ sampleRate: 16000, samples });
          recognizer.decode(stream);
          const result = recognizer.getResult(stream) as SherpaResult;
          let words = tokensToWords(result, startSec, endSec);
          if (punct && words.length > 0) words = applyPunctuation(words, punct.addPunct(joinWords(words)) as string);
          return { words, language: typeof spec.language === "string" ? spec.language : spec.language(result) };
        } finally {
          stream.free?.();
        }
      });
  }
}
