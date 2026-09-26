/**
 * Folha de contato dos quadros candidatos: alguns instantes amostrados são montados num JPEG de nove
 * quadros (3×N), cada um com um número grande queimado no canto de cima — o VLM olha nove quadros de uma
 * vez e pontua em lote, o que reduz o número de chamadas numa ordem de grandeza; a mesma imagem também
 * pode ir para o disco para alguém passar o olho rápido.
 *
 * A montagem dos parâmetros e o agrupamento são funções puras (testáveis); só composeContactSheetJpeg roda
 * o ffmpeg de verdade: uma chamada só com várias entradas — cada instante é uma entrada com -ss para
 * localizar rápido, de cada uma sai um quadro que passa por scale+drawtext do número, e depois do concat o
 * tile monta a grade, com o image2pipe saindo direto sem arquivo temporário.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveFfmpegPath } from "./binaries";
import { escapeFilterPath } from "./cut";
import { analysisVideoFilter, type AnalysisVideoOptions } from "./analysis-video";
import { ffmpegVideoStreamSpecifier } from "./probe";

const execFileAsync = promisify(execFile);

/** O número de colunas da grade e a capacidade de uma folha cheia. */
export const SHEET_COLS = 3;
export const SHEET_CELLS = 9;

/** A largura de cada célula (px): 448, a mesma do julgamento quadro a quadro, então a folha inteira tem uns 1344 de largura, o que o VLM enxerga bem. */
const CELL_WIDTH = 448;

/** Agrupa o array de instantes pela capacidade de uma folha cheia (o último grupo pode ficar incompleto). */
export function chunkCells<T>(items: T[], size = SHEET_CELLS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface SheetOptions extends AnalysisVideoOptions {
  /** A fonte da numeração (sem ela, o número não é queimado — e aí o VLM só pode contar as células pela posição, então é melhor queimar sempre que possível). */
  fontFile?: string;
  cellWidth?: number;
}

/**
 * Os parâmetros completos de uma chamada do ffmpeg (função pura). As n entradas usam -ss para localizar e
 * tiram um quadro cada; o scale iguala a largura, o drawtext queima o número, e depois do concat, que forma
 * o fluxo de quadros, o tile monta a grade.
 * Com um quadro só, nada é montado em grade: ele apenas é escalado e numerado.
 */
export function buildSheetArgs(
  videoPath: string,
  times: number[],
  opts: SheetOptions = {}
): string[] {
  if (times.length === 0) throw new Error("contact sheet requires at least one time");
  const n = times.length;
  const w = opts.cellWidth ?? CELL_WIDTH;
  const inputs = times.flatMap((t) => ["-ss", Math.max(0, t).toFixed(2), "-i", videoPath]);
  const label = (i: number): string =>
    opts.fontFile
      ? `,drawtext=fontfile='${escapeFilterPath(opts.fontFile)}':text='${i + 1}':x=10:y=6:fontsize=${Math.round(w * 0.16)}:fontcolor=white:borderw=5:bordercolor=black`
      : "";
  // De cada entrada sai só o primeiro quadro (com o trim em 1 quadro já vem o EOF, e assim o concat não espera o fluxo inteiro)
  const cells = times.map((_t, i) => {
    const source = ffmpegVideoStreamSpecifier(opts.videoStreamIndex, i);
    const filters = analysisVideoFilter(
      [`trim=end_frame=1`, "setpts=PTS-STARTPTS", `scale=${w}:-2${label(i)}`],
      opts.color
    );
    return `[${source}]${filters}[f${i}]`;
  });
  const labels = times.map((_t, i) => `[f${i}]`).join("");
  const cols = Math.min(SHEET_COLS, n);
  const rows = Math.ceil(n / cols);
  // Um quadro só não vira grade; vários passam pelo concat → tile na grade (o que falta para encher é preenchido com fundo preto)
  const graph =
    n === 1
      ? [cells[0].replace("[f0]", "[sheet]")]
      : [...cells, `${labels}concat=n=${n}:v=1:a=0,tile=${cols}x${rows}:color=black[sheet]`];
  return [
    "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", graph.join(";"),
    "-map", "[sheet]",
    "-frames:v", "1",
    "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "5",
    "-",
  ];
}

/** Monta uma folha de contato e devolve o JPEG em base64; qualquer falha devolve null (falha em aberto). */
export async function composeContactSheetJpeg(
  videoPath: string,
  times: number[],
  opts: SheetOptions = {}
): Promise<string | null> {
  if (times.length === 0) return null;
  try {
    const { stdout } = await execFileAsync(resolveFfmpegPath(), buildSheetArgs(videoPath, times, opts), {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.length > 0 ? stdout.toString("base64") : null;
  } catch {
    return null;
  }
}
