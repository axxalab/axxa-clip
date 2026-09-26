/**
 * Detecção da borda entre cortes de câmera (TransNetV2 ONNX) + encaixe do ponto de corte: o início e
 * o fim do trecho caem numa troca de câmera de verdade, e o vídeo pronto não começa mais no meio de
 * um gesto ou de uma transição. O encaixe só acontece quando não machuca a fala (uma guarda na borda
 * das palavras, preferindo esticar para fora); se a detecção falhar, tudo volta a não encaixar nada —
 * a saída nunca fica pior. A lógica pura (decodificação / encaixe) é exportada à parte e testável, e
 * a execução do ffmpeg e do ONNX fica isolada em detectShotBoundaries.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { resolveFfmpegPath } from "./binaries";
import { analysisVideoFilter, type AnalysisVideoOptions } from "./analysis-video";
import { ffmpegVideoStreamSpecifier } from "./probe";
import { ensureModel, modelDir, TRANSNETV2_MODEL } from "./models";
import type { TranscriptWord } from "../shared/api-types";

const execFileAsync = promisify(execFile);

/** A taxa de quadros em que o TransNetV2 foi treinado — a amostragem é fixada nela, e só assim a conta de quadro → segundo se sustenta. */
export const TRANSNET_FPS = 25;
/** A resolução de entrada fixa do modelo (largura × altura). */
const FRAME_W = 48;
const FRAME_H = 27;
/** Janela deslizante de 100 quadros: 25 de cada lado servem só de contexto, e os 50 do meio dão a previsão válida. */
const WINDOW = 100;
const CONTEXT = 25;
const STRIDE = WINDOW - CONTEXT * 2;
const FRAME_BYTES = FRAME_W * FRAME_H * 3;
/** Limite de probabilidade de troca num quadro (a recomendação oficial é 0,5; na prática um corte seco dá ≈0,98 e uma imagem estável ≈0,001). */
export const SHOT_THRESHOLD = 0.5;

/* eslint-disable @typescript-eslint/no-explicit-any */
let ort: any = null;
function loadOrt(): any {
  if (!ort) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ort = require("onnxruntime-node");
  }
  return ort;
}

// O modelo de 31MB é carregado uma única vez por processo; na falha o cache é limpo e a chamada seguinte pode tentar de novo
let sessionPromise: Promise<any> | null = null;
function getSession(modelsRoot: string): Promise<any> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      await ensureModel(modelsRoot, TRANSNETV2_MODEL);
      const path = join(modelDir(modelsRoot, TRANSNETV2_MODEL), TRANSNETV2_MODEL.singleFile!);
      return loadOrt().InferenceSession.create(path);
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Probabilidade de troca quadro a quadro → o instante da borda (em segundos, contado do início da
 * sequência de quadros). Um trecho contínuo acima do limite é reduzido ao quadro de pico; esse quadro
 * é o último do corte antigo, e a borda fica entre ele e o seguinte = (pico+1)/fps. Função pura.
 */
export function decodeBoundaries(
  probs: ArrayLike<number>,
  fps = TRANSNET_FPS,
  threshold = SHOT_THRESHOLD
): number[] {
  const out: number[] = [];
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] < threshold) continue;
    let peak = i;
    while (i < probs.length && probs[i] >= threshold) {
      if (probs[i] > probs[peak]) peak = i;
      i++;
    }
    out.push((peak + 1) / fps);
  }
  return out;
}

/** O quanto o encaixe pode esticar para fora (o início vem antes / o fim vai depois). */
export const SNAP_MAX_OUT_SEC = 0.8;
/** O quanto o encaixe pode recolher para dentro — e ainda precisa passar pela guarda da borda das palavras. */
export const SNAP_MAX_IN_SEC = 0.35;
/** A folga de segurança mantida entre o ponto de corte e a palavra. */
const WORD_GUARD_SEC = 0.06;
/** Deslocamento menor que este não vale um novo corte (já estava na borda). */
const MIN_SNAP_DELTA_SEC = 0.05;
/** Depois do encaixe, o trecho não pode ficar mais curto que isto. */
const MIN_CLIP_SEC = 1;

export interface SnapContext {
  /** O início da primeira palavra de dentro do trecho — recolher o início não pode passar dela (ausente = recolher não é permitido). */
  firstWordStartSec?: number;
  /** O fim da última palavra de dentro do trecho — recolher o fim não pode passar dela (ausente = recolher não é permitido). */
  lastWordEndSec?: number;
  /**
   * O instante em que termina a palavra imediatamente anterior, fora do trecho: esticar o início não
   * pode passar dela (null = está confirmado que não há palavra fora, e esticar é livre; undefined =
   * desconhecido, e passa — no pior caso entram 0,8s de som final sem legenda).
   */
  prevWordEndSec?: number | null;
  /** O instante em que começa a palavra imediatamente seguinte, fora do trecho; mesma semântica. */
  nextWordStartSec?: number | null;
}

export interface SnapResult {
  startSec: number;
  endSec: number;
  /** O deslocamento real (em segundos; negativo = antecipou, positivo = atrasou); o lado que não encaixou fica em 0. */
  startDeltaSec: number;
  endDeltaSec: number;
  /** Pelo menos um dos lados encaixou de verdade. */
  snapped: boolean;
}

/** Acha em [lo, hi] a borda mais próxima de target que passa na validação; se não houver, null. Função pura. */
function nearestBoundary(
  boundaries: number[],
  target: number,
  lo: number,
  hi: number,
  allowed: (b: number) => boolean
): number | null {
  let best: number | null = null;
  for (const b of boundaries) {
    if (b < lo || b > hi || !allowed(b)) continue;
    if (best === null || Math.abs(b - target) < Math.abs(best - target)) best = b;
  }
  return best;
}

/**
 * Encaixa o início e o fim do trecho na borda de corte mais próxima. As regras:
 *  - esticar para fora (início antes / fim depois) ≤ SNAP_MAX_OUT_SEC, e sem passar pela palavra
 *    imediatamente vizinha de fora do trecho;
 *  - recolher para dentro ≤ SNAP_MAX_IN_SEC, e só com a primeira/última palavra de dentro conhecida e
 *    com a folga de segurança respeitada — nunca se corta fala;
 *  - se a duração depois do encaixe ficar abaixo de MIN_CLIP_SEC, o encaixe daquele lado é abandonado.
 * Função pura.
 */
export function snapClipToShots(
  startSec: number,
  endSec: number,
  boundaries: number[],
  ctx: SnapContext = {}
): SnapResult {
  const noSnap: SnapResult = { startSec, endSec, startDeltaSec: 0, endDeltaSec: 0, snapped: false };
  if (boundaries.length === 0 || !(endSec > startSec)) return noSnap;

  const startAllowed = (b: number): boolean => {
    if (b <= startSec) {
      // Esticando para fora: sem engolir a palavra da frase anterior
      return ctx.prevWordEndSec == null || b >= ctx.prevWordEndSec + WORD_GUARD_SEC;
    }
    // Recolhendo para dentro: a posição da primeira palavra precisa ser conhecida, e ela não pode ser cortada
    return ctx.firstWordStartSec !== undefined && b <= ctx.firstWordStartSec - WORD_GUARD_SEC;
  };
  const endAllowed = (b: number): boolean => {
    if (b >= endSec) {
      return ctx.nextWordStartSec == null || b <= ctx.nextWordStartSec - WORD_GUARD_SEC;
    }
    return ctx.lastWordEndSec !== undefined && b >= ctx.lastWordEndSec + WORD_GUARD_SEC;
  };

  let newStart = nearestBoundary(
    boundaries, startSec, startSec - SNAP_MAX_OUT_SEC, startSec + SNAP_MAX_IN_SEC, startAllowed
  );
  let newEnd = nearestBoundary(
    boundaries, endSec, endSec - SNAP_MAX_IN_SEC, endSec + SNAP_MAX_OUT_SEC, endAllowed
  );
  if (newStart !== null && Math.abs(newStart - startSec) < MIN_SNAP_DELTA_SEC) newStart = null;
  if (newEnd !== null && Math.abs(newEnd - endSec) < MIN_SNAP_DELTA_SEC) newEnd = null;

  // Guarda de duração: primeiro o encaixe do fim é abandonado, e se ainda não bastar, o do início
  const dur = () => (newEnd ?? endSec) - (newStart ?? startSec);
  if (dur() < MIN_CLIP_SEC) newEnd = null;
  if (dur() < MIN_CLIP_SEC) newStart = null;

  if (newStart === null && newEnd === null) return noSnap;
  return {
    startSec: newStart ?? startSec,
    endSec: newEnd ?? endSec,
    startDeltaSec: newStart === null ? 0 : newStart - startSec,
    endDeltaSec: newEnd === null ? 0 : newEnd - endSec,
    snapped: true,
  };
}

/**
 * Tira, da sequência completa de palavras (ordenada no tempo), o instante da palavra imediatamente
 * vizinha de fora do trecho, para a guarda do esticar. Sem palavra vizinha, devolve null (= está
 * confirmado que não há palavra fora, e esticar é seguro). Função pura.
 */
export function snapContextAround(
  words: Array<Pick<TranscriptWord, "startSec" | "endSec">>,
  startSec: number,
  endSec: number
): { prevWordEndSec: number | null; nextWordStartSec: number | null } {
  let prev: number | null = null;
  let next: number | null = null;
  for (const w of words) {
    if (w.endSec <= startSec) {
      if (prev === null || w.endSec > prev) prev = w.endSec;
    } else if (w.startSec >= endSec) {
      if (next === null || w.startSec < next) next = w.startSec;
      break; // as palavras estão ordenadas, e daqui para frente só ficam mais longe
    }
  }
  return { prevWordEndSec: prev, nextWordStartSec: next };
}

/**
 * Detecta as bordas de corte dentro da janela [startSec, endSec] e devolve o instante absoluto (em segundos).
 * A amostragem passa por um cano rawvideo do ffmpeg (RGB 48×27 a 25fps), a inferência usa a janela
 * deslizante de 100 quadros com passo de 50, e só a previsão dos 50 quadros do meio de cada janela é
 * aproveitada; as janelas das pontas repetem o primeiro/último quadro para completar o contexto.
 */
export async function detectShotBoundaries(
  inputPath: string,
  startSec: number,
  endSec: number,
  modelsRoot: string,
  signal?: AbortSignal,
  analysis: AnalysisVideoOptions = {}
): Promise<number[]> {
  signal?.throwIfAborted();
  const base = Math.max(0, startSec);
  const dur = endSec - base;
  if (!(dur > 0)) return [];

  const { stdout } = await execFileAsync(
    resolveFfmpegPath(),
    [
      "-hide_banner", "-v", "error",
      "-ss", String(base), "-i", inputPath, "-t", String(dur),
      "-vf", analysisVideoFilter(`fps=${TRANSNET_FPS},scale=${FRAME_W}:${FRAME_H}`, analysis.color),
      "-map", ffmpegVideoStreamSpecifier(analysis.videoStreamIndex),
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ],
    // 512MB ≈ o teto de quadros de umas 2,3 horas — a janela de um trecho fica muito abaixo disso, e isto é só uma rede de segurança
    { encoding: "buffer", maxBuffer: 512 * 1024 * 1024, signal }
  );
  const n = Math.floor(stdout.length / FRAME_BYTES);
  if (n < 2) return [];

  const session = await getSession(modelsRoot);
  const ortMod = loadOrt();
  const clamp = (i: number) => Math.min(n - 1, Math.max(0, i));
  const probs = new Float32Array(n);
  for (let winStart = 0; winStart < n; winStart += STRIDE) {
    signal?.throwIfAborted();
    const buf = new Float32Array(WINDOW * FRAME_BYTES);
    for (let k = 0; k < WINDOW; k++) {
      const src = clamp(winStart - CONTEXT + k) * FRAME_BYTES;
      for (let b = 0; b < FRAME_BYTES; b++) buf[k * FRAME_BYTES + b] = stdout[src + b];
    }
    const out = await session.run({
      input: new ortMod.Tensor("float32", buf, [1, WINDOW, FRAME_H, FRAME_W, 3]),
    });
    signal?.throwIfAborted();
    const p = out["534"].data as Float32Array;
    for (let k = CONTEXT; k < CONTEXT + STRIDE; k++) {
      const idx = winStart - CONTEXT + k;
      if (idx >= 0 && idx < n) probs[idx] = p[k];
    }
  }
  return decodeBoundaries(probs).map((t) => t + base);
}
