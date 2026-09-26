/**
 * Trilha de picos de áudio por bloco — a camada de sinal embaixo das decisões do corte seco.
 * Um vão entre palavras, por si, não prova silêncio: risada, palmas, efeitos da trilha e sons de jogo não
 * trazem palavra nenhuma e precisam sobreviver ao corte (a percepção do auto-editor).
 * Os picos (o máximo de |amostra| por bloco) são baratos e, ao contrário do RMS, pegam os transientes curtos
 * que a média de volume borraria.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveFfmpegPath } from "./binaries";
import { ffmpegAudioStreamSpecifier } from "./probe";

const execFileAsync = promisify(execFile);

const SAMPLE_RATE = 16000;
/** Blocos de pico por segundo; fino o bastante para limitar qualquer região de folga de 0,12s. */
const BLOCKS_PER_SEC = 30;

export interface PeakTrack {
  /** O pico normalizado (de 0 a 1) de cada bloco. */
  values: Float32Array;
  /** O tempo absoluto de origem do primeiro bloco. */
  startSec: number;
  /** Os segundos de cada bloco. */
  hopSec: number;
}

/**
 * Dobra o PCM s16 intercalado no máximo de |amostra|/32768 por bloco. Um número fracionário de amostras por
 * bloco é tratado com acumulação do erro, de modo que as bordas dos blocos continuem alinhadas com o tempo
 * de relógio ao longo de uma entrada longa (sem deriva).
 */
export function peaksFromPcm(samples: Int16Array, samplesPerBlock: number): Float32Array {
  if (samples.length === 0 || samplesPerBlock <= 0) return new Float32Array(0);
  const blocks: number[] = [];
  let acc = 0;
  let i = 0;
  while (i < samples.length) {
    acc += samplesPerBlock;
    const end = Math.min(samples.length, Math.round(acc));
    let peak = 0;
    for (; i < end; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    blocks.push(peak / 32768);
    if (end === samples.length) break;
  }
  return Float32Array.from(blocks);
}

/** O maior pico dentro de [fromSec, toSec] (em tempo absoluto de origem); 0 quando está fora. */
export function peakInRange(track: PeakTrack, fromSec: number, toSec: number): number {
  const first = Math.max(0, Math.floor((fromSec - track.startSec) / track.hopSec));
  const last = Math.min(track.values.length - 1, Math.ceil((toSec - track.startSec) / track.hopSec));
  let peak = 0;
  for (let i = first; i <= last; i++) {
    if (track.values[i] > peak) peak = track.values[i];
  }
  return peak;
}

/** Um pico: um intervalo contínuo «bem alto» (o indicador acústico de risada, grito e palmas). */
export interface PeakEvent {
  /** O instante do bloco mais alto do evento (em tempo absoluto de origem, em segundos) — é ele que a marcação de efeito e a ênfase do movimento de câmera usam. */
  atSec: number;
  startSec: number;
  endSec: number;
  /** O pico do evento (de 0 a 1). */
  peak: number;
}

/** Blocos altos vizinhos com intervalo menor que este viram o mesmo evento (a respirada no meio de uma risada não deve partir o evento em dois). */
const EVENT_MERGE_GAP_SEC = 0.35;

/**
 * Extrai os «picos» da trilha: os blocos acima de floorRatio do pico mais alto da trilha inteira são
 * agrupados em intervalos, e os maxEvents primeiros voltam em ordem decrescente de pico. Se a trilha inteira
 * estiver quase em silêncio (o pico mais alto < minPeak), volta vazia — não há ponto alto de emoção nenhum. Função pura.
 *
 * O limite é relativo em vez de um dB absoluto: o material de origem não passou por normalização de volume, e
 * um limite absoluto deixaria passar tudo num material baixo e acertaria tudo num material alto; «em relação
 * ao momento mais alto deste vídeo» é que é um indicador estável de pico de emoção.
 */
export function findPeakEvents(
  track: PeakTrack,
  options: { floorRatio?: number; maxEvents?: number; minPeak?: number } = {}
): PeakEvent[] {
  const { floorRatio = 0.75, maxEvents = 6, minPeak = 0.1 } = options;
  let maxPeak = 0;
  for (const v of track.values) if (v > maxPeak) maxPeak = v;
  if (maxPeak < minPeak) return [];
  const floor = maxPeak * floorRatio;

  const events: PeakEvent[] = [];
  let cur: PeakEvent | null = null;
  for (let i = 0; i < track.values.length; i++) {
    const v = track.values[i];
    const t = track.startSec + i * track.hopSec;
    if (v >= floor) {
      if (cur && t - cur.endSec <= EVENT_MERGE_GAP_SEC) {
        cur.endSec = t + track.hopSec;
        if (v > cur.peak) {
          cur.peak = v;
          cur.atSec = t;
        }
      } else {
        if (cur) events.push(cur);
        cur = { atSec: t, startSec: t, endSec: t + track.hopSec, peak: v };
      }
    }
  }
  if (cur) events.push(cur);
  return events.sort((a, b) => b.peak - a.peak).slice(0, maxEvents);
}

/** Decodifica [startSec, endSec] em PCM mono de 16k e dobra numa trilha de picos. */
export async function extractPeaks(
  filePath: string,
  startSec: number,
  endSec: number,
  audioStreamIndex?: number
): Promise<PeakTrack> {
  const args = [
    "-hide_banner",
    "-ss",
    String(Math.max(0, startSec)),
    "-to",
    String(endSec),
    "-i",
    filePath,
    "-map",
    ffmpegAudioStreamSpecifier(audioStreamIndex),
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-f",
    "s16le",
    "-",
  ];
  const { stdout } = await execFileAsync(resolveFfmpegPath(), args, {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });
  const buf = stdout as unknown as Buffer;
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  return {
    values: peaksFromPcm(samples, SAMPLE_RATE / BLOCKS_PER_SEC),
    startSec: Math.max(0, startSec),
    hopSec: 1 / BLOCKS_PER_SEC,
  };
}
