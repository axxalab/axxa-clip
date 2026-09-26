/**
 * Sinal de pico de expressão: o YuNet acha o rosto principal e o FER+ reconhece a expressão (dois modelos
 * ONNX MIT de poucos MB, que funcionam sem configuração nenhuma); nos quadros amostrados são achados os
 * instantes de pico de «gargalhada / susto / exaltação», que viram trechos e entram no julgamento do
 * estouro como sinal audiovisual — é a versão de graça do sinal visual de estouro: mesmo sem instalar o
 * Ollama, a IA «vê» o estouro de emoção.
 *
 * A estratégia de amostragem: passo de 2s dentro das janelas de pico de volume / de corte denso (é onde
 * mais provavelmente há expressão), e o que sobra de cota é espalhado por igual pelo vídeo inteiro. Tudo
 * falha em aberto: modelo que não baixa, nenhum rosto ou orçamento esgotado só significam ficar sem este
 * sinal, nunca derrubar a detecção. As funções puras (planejamento da amostragem / recorte do rosto em
 * tons de cinza / softmax / nota do pico) são testáveis, e o ffmpeg e a inferência ONNX são trocados por pontos de injeção.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { resolveFfmpegPath } from "./binaries";
import { analysisVideoFilter, type AnalysisVideoOptions } from "./analysis-video";
import { ffmpegVideoStreamSpecifier } from "./probe";
import { modelDir, ensureModel, EMOTION_MODEL } from "./models";
import { planSignalGuidedTimes, type MediaSignals, type TimeRange } from "./signals";
import { YunetDetector, pickMainFace, YUNET_INPUT, type FaceBox } from "./reframe/yunet";
import { visualPeakRanges } from "./highlight/vision";

const execFileAsync = promisify(execFile);

/** Teto de quadros amostrados no vídeo inteiro (a inferência em CPU leva algumas dezenas de ms por quadro, e 96 quadros mantêm o pior caso dentro de alguns minutos). */
export const EMOTION_MAX_FRAMES = 96;
/** O passo da amostragem dentro de uma janela de sinal (o pico de expressão dura pouco, e ali a amostragem precisa ser mais densa que no vídeo todo). */
export const EMOTION_WINDOW_STEP_SEC = 2;
/** A distância mínima entre dois quadros. */
export const EMOTION_MIN_SPACING_SEC = 3;
/** O limite de probabilidade do pico de expressão (a maior probabilidade softmax entre riso, susto e raiva). */
export const EMOTION_PEAK_PROB = 0.6;
/** O tamanho de entrada do FER+. */
export const FER_INPUT = 64;
/** Orçamento total: ao esgotar o tempo, encerra com o que já tem. */
const EMOTION_BUDGET_MS = 90_000;
/** Com menos quadros de rosto detectado que este número, a evidência é fraca e o sinal não sai. */
const MIN_FACE_FRAMES = 3;

/** A ordem das classes de saída do FER+ (oficial): 0=neutro 1=alegre 2=surpreso 3=triste 4=raivoso 5=enojado 6=com medo 7=desdenhoso */
const IDX_HAPPY = 1;
const IDX_SURPRISE = 2;
const IDX_ANGER = 4;

export interface EmotionStats {
  framesTotal: number;
  /** Quantos quadros tiveram rosto detectado e expressão pontuada. */
  facesScored: number;
  peakCount: number;
}

export interface EmotionOutcome {
  emotionPeaks: TimeRange[];
  stats: EmotionStats;
}

/**
 * Planeja os instantes de amostragem: o passo de 2s dentro das janelas de sinal vem primeiro, a grade
 * uniforme completa o resto, e a distância mínima é respeitada. Função pura.
 * (A lógica geral de planejamento está em signals.ts, compartilhada com a varredura de emoção da voz em janelas curtas.)
 */
export function planEmotionFrameTimes(
  durationSec: number,
  signals: MediaSignals | undefined,
  maxFrames = EMOTION_MAX_FRAMES,
  minSpacingSec = EMOTION_MIN_SPACING_SEC,
  windowStepSec = EMOTION_WINDOW_STEP_SEC
): number[] {
  return planSignalGuidedTimes(durationSec, signals, maxFrames, minSpacingSec, windowStepSec);
}

/**
 * Recorta a caixa do rosto de um quadro BGR de 640×640 com bordas, converte para tons de cinza e escala
 * por interpolação bilinear para 64×64.
 * A saída é o cinza cru de 0 a 255 (o pré-processamento oficial do FER+ não normaliza). Função pura.
 */
export function grayFaceTensor(bgr: Uint8Array, inputSize: number, box: FaceBox): Float32Array {
  const out = new Float32Array(FER_INPUT * FER_INPUT);
  // A caixa do rosto é esticada 15% para cada lado (os dados de treino do FER+ trazem folga em volta da cabeça) e depois aparada de volta para dentro do quadro
  const pad = 0.15;
  const bx = Math.max(0, box.x - box.w * pad);
  const by = Math.max(0, box.y - box.h * pad);
  const bw = Math.min(inputSize - bx, box.w * (1 + 2 * pad));
  const bh = Math.min(inputSize - by, box.h * (1 + 2 * pad));
  for (let oy = 0; oy < FER_INPUT; oy++) {
    for (let ox = 0; ox < FER_INPUT; ox++) {
      // As coordenadas de origem da amostragem bilinear
      const sx = bx + ((ox + 0.5) / FER_INPUT) * bw - 0.5;
      const sy = by + ((oy + 0.5) / FER_INPUT) * bh - 0.5;
      const x0 = Math.max(0, Math.min(inputSize - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(inputSize - 1, Math.floor(sy)));
      const x1 = Math.min(inputSize - 1, x0 + 1);
      const y1 = Math.min(inputSize - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));
      const gray = (px: number, py: number): number => {
        const i = (py * inputSize + px) * 3;
        // BGR → tons de cinza (BT.601)
        return 0.114 * bgr[i] + 0.587 * bgr[i + 1] + 0.299 * bgr[i + 2];
      };
      const top = gray(x0, y0) * (1 - fx) + gray(x1, y0) * fx;
      const bot = gray(x0, y1) * (1 - fx) + gray(x1, y1) * fx;
      out[oy * FER_INPUT + ox] = top * (1 - fy) + bot * fy;
    }
  }
  return out;
}

/** Softmax numericamente estável. Função pura. */
export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps: number[] = [];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max);
    exps.push(e);
    sum += e;
  }
  return exps.map((e) => e / sum);
}

/** A nota do pico de expressão: o maior valor entre as probabilidades de riso, susto e raiva (as três emoções de estouro de um corte). Função pura. */
export function emotionPeakScore(probs: number[]): number {
  return Math.max(probs[IDX_HAPPY] ?? 0, probs[IDX_SURPRISE] ?? 0, probs[IDX_ANGER] ?? 0);
}

/** A sessão de inferência do FER+ (com o mesmo carregamento preguiçoso do onnxruntime-node do YunetDetector). */
export class EmotionScorer {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private session: any = null;

  constructor(private modelsRoot: string) {}

  async init(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const o = require("onnxruntime-node");
    const path = join(modelDir(this.modelsRoot, EMOTION_MODEL), EMOTION_MODEL.singleFile ?? "model.onnx");
    this.session = await o.InferenceSession.create(path);
  }

  /** gray64: 64×64 em tons de cinza (0 a 255). Devolve as probabilidades softmax das 8 classes. */
  async score(gray64: Float32Array): Promise<number[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const o = require("onnxruntime-node");
    const tensor = new o.Tensor("float32", gray64, [1, 1, FER_INPUT, FER_INPUT]);
    const outputs = await this.session.run({ [this.session.inputNames[0]]: tensor });
    const logits = (outputs[this.session.outputNames[0]] as { data: Float32Array }).data;
    return softmax(logits);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Extrai um quadro BGR de 640×640 com bordas (o mesmo filtro do rastreio de rosto, preservando a proporção). */
export async function extractLetterboxedFrame(
  videoPath: string,
  tSec: number,
  analysis: AnalysisVideoOptions = {}
): Promise<Uint8Array | null> {
  try {
    const n = YUNET_INPUT;
    const { stdout } = await execFileAsync(
      resolveFfmpegPath(),
      [
        "-hide_banner", "-v", "error",
        "-ss", tSec.toFixed(2), "-i", videoPath, "-frames:v", "1",
        "-vf", analysisVideoFilter(
          `scale=${n}:${n}:force_original_aspect_ratio=decrease,pad=${n}:${n}:(ow-iw)/2:(oh-ih)/2:black`,
          analysis.color
        ),
        "-map", ffmpegVideoStreamSpecifier(analysis.videoStreamIndex),
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
      ],
      { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 }
    );
    return stdout.length === n * n * 3 ? new Uint8Array(stdout) : null;
  } catch {
    return null;
  }
}

export interface EmotionDeps {
  extractFrame: (videoPath: string, tSec: number, analysis?: AnalysisVideoOptions) => Promise<Uint8Array | null>;
  detectFaces: (bgr: Uint8Array) => Promise<FaceBox[]>;
  scoreEmotion: (gray64: Float32Array) => Promise<number[]>;
}

/** As dependências padrão: garante que os modelos estejam no lugar e inicializa as duas sessões de inferência (uma falha de download é lançada para cima → falha em aberto lá fora). */
async function defaultDeps(modelsRoot: string): Promise<EmotionDeps> {
  const { YUNET_MODEL } = await import("./models");
  await ensureModel(modelsRoot, YUNET_MODEL);
  await ensureModel(modelsRoot, EMOTION_MODEL);
  const detector = new YunetDetector(modelsRoot);
  await detector.init();
  const scorer = new EmotionScorer(modelsRoot);
  await scorer.init();
  return {
    extractFrame: extractLetterboxedFrame,
    detectFaces: (bgr) => detector.detect(bgr),
    scoreEmotion: (g) => scorer.score(g),
  };
}

/**
 * Colhe o sinal de pico de expressão. Falha em aberto:
 * - falha ao baixar/inicializar o modelo → null;
 * - falha ao extrair/detectar num quadro → aquele quadro é pulado;
 * - menos quadros com rosto detectado que MIN_FACE_FRAMES → null (material sem rosto naturalmente não tem este sinal);
 * - orçamento total estourado → encerra com o que já tem.
 */
export async function collectEmotionSignal(opts: {
  videoPath: string;
  durationSec: number;
  modelsRoot: string;
  signals?: MediaSignals;
  deps?: EmotionDeps;
  budgetMs?: number;
  analysis?: AnalysisVideoOptions;
}): Promise<EmotionOutcome | null> {
  const { videoPath, durationSec, modelsRoot, signals, budgetMs = EMOTION_BUDGET_MS } = opts;
  const times = planEmotionFrameTimes(durationSec, signals);
  if (times.length === 0) return null;
  let deps: EmotionDeps;
  try {
    deps = opts.deps ?? (await defaultDeps(modelsRoot));
  } catch {
    return null; // modelo indisponível: em silêncio, sem este sinal
  }
  const deadline = Date.now() + budgetMs;
  const scored: Array<{ t: number; energy: number }> = [];
  let prevMain: FaceBox | null = null;
  let facesScored = 0;
  for (const t of times) {
    if (Date.now() > deadline) break; // orçamento esgotado, encerra com o que já tem
    const bgr = await deps.extractFrame(videoPath, t, opts.analysis);
    if (!bgr) continue;
    try {
      const faces = await deps.detectFaces(bgr);
      const main = pickMainFace(faces, prevMain);
      prevMain = main;
      if (!main) continue;
      const probs = await deps.scoreEmotion(grayFaceTensor(bgr, YUNET_INPUT, main));
      facesScored++;
      // Probabilidade → energia de 0 a 10, reaproveitando a lógica de cercar trechos do sinal visual
      scored.push({ t, energy: emotionPeakScore(probs) * 10 });
    } catch {
      // Falha de um quadro: pula
    }
  }
  if (facesScored < MIN_FACE_FRAMES) return null;
  const emotionPeaks = visualPeakRanges(scored, durationSec, EMOTION_PEAK_PROB * 10);
  return {
    emotionPeaks,
    stats: { framesTotal: times.length, facesScored, peakCount: emotionPeaks.length },
  };
}
