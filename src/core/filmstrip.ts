/**
 * A tira de miniaturas da linha de tempo: N quadros pequenos amostrados por igual em todo o material (JPEG
 * em base64), que a linha de tempo da bancada espalha atrás da forma de onda como o mapa de «que imagem tem
 * neste trecho». Cada quadro tem 200px de largura em q=6, e oito quadros somam uns 100KB, que o IPC leva de
 * uma vez. Falha em aberto: um quadro que falha vira string vazia, e a camada de renderização pula aquela célula.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveFfmpegPath } from "./binaries";
import { analysisVideoFilter, type AnalysisVideoOptions } from "./analysis-video";
import { ffmpegVideoStreamSpecifier } from "./probe";

const execFileAsync = promisify(execFile);

/** Os instantes da amostragem: 1% é cedido em cada ponta (o quadro da borda costuma ser tela preta ou meia transição) e o meio é espalhado por igual. Função pura. */
export function filmstripTimes(durationSec: number, count: number): number[] {
  if (!(durationSec > 0) || count < 1) return [];
  const pad = durationSec * 0.01;
  const usable = durationSec - pad * 2;
  return Array.from({ length: count }, (_, i) => pad + (usable * (i + 0.5)) / count);
}

/** Extrai um quadro de miniatura → JPEG em base64; na falha devolve string vazia. */
async function grabFrame(
  ffmpeg: string,
  filePath: string,
  atSec: number,
  analysis: AnalysisVideoOptions
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      ffmpeg,
      [
        "-hide_banner", "-ss", atSec.toFixed(2), "-i", filePath,
        "-frames:v", "1",
        "-vf", analysisVideoFilter("scale=200:-2", analysis.color),
        "-map", ffmpegVideoStreamSpecifier(analysis.videoStreamIndex),
        "-q:v", "6", "-f", "mjpeg", "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 }
    );
    return stdout.length > 0 ? stdout.toString("base64") : "";
  } catch {
    return "";
  }
}

/** A tira do material inteiro: count quadros por igual, devolvidos em ordem (um a um, correspondendo a filmstripTimes). */
export async function extractFilmstrip(
  filePath: string,
  durationSec: number,
  count = 8,
  analysis: AnalysisVideoOptions = {}
): Promise<string[]> {
  const ffmpeg = resolveFfmpegPath();
  const out: string[] = [];
  // A extração é em série: uma tarefa de um quadro com seek leva milissegundos, e a concorrência só faz um pisar no outro num disco mecânico
  for (const t of filmstripTimes(durationSec, count)) {
    out.push(await grabFrame(ffmpeg, filePath, t, analysis));
  }
  return out;
}
