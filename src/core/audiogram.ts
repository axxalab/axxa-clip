import { withAtomicOutput } from "./atomic-output";
/**
 * Saída em audiograma: numa origem só de áudio (podcast, gravação), a imagem é sintetizada sozinha na
 * exportação — fundo escuro + a animação da onda na cor da marca (showwaves do ffmpeg) + a legenda, a
 * cartela de título e a marca d'água queimadas como sempre.
 * Uma capa estática é deslizada; é a onda em movimento com legenda que segura a pessoa no feed. O
 * Headliner e o Wavve sustentam produtos inteiros só com esta capacidade, e aqui ela vem embutida como a
 * imagem padrão de qualquer entrada só de áudio.
 *
 * O corte de um pedaço e o corte seco de vários passam pelo mesmo filter_complex: primeiro os pedaços de
 * áudio são cortados e colados, e só então a onda é gerada a partir do áudio final (por isso a onda fica
 * naturalmente em sincronia com o som depois do corte seco). A montagem dos parâmetros é testável, e a
 * execução do ffmpeg fica isolada em runAudiogram.
 */
import { escapeFilterPath, watermarkStages, metadataArgs, runFfmpeg, DENOISE_FILTER, edgeFadeFilters, muteRangeFilters, type WatermarkSpec } from "./cut";
import { isValidHex } from "./brand";

/** O fundo escuro (a mesma cor de fundo do «estúdio em brasa» do aplicativo). */
const BG_COLOR = "0x141110";
/** A cor padrão da onda = o laranja de chama. */
const DEFAULT_WAVE_COLOR = "0xFF6E0D";

export interface AudiogramSpec {
  width: number;
  height: number;
  /** A cor na forma do ffmpeg, 0xRRGGBB. */
  waveColor: string;
  bgColor: string;
  /** A altura da faixa da onda (sobreposta no centro). */
  waveHeight: number;
}

/** "#FF6E0D" → "0xFF6E0D"; entrada inválida volta para o laranja padrão. */
export function hexToFfmpegColor(hex?: string): string {
  return isValidHex(hex) ? `0x${hex!.slice(1).toUpperCase()}` : DEFAULT_WAVE_COLOR;
}

/** Vertical 1080×1920 / horizontal 1920×1080; a onda ocupa cerca de 1/4 da altura, longe da faixa da legenda embaixo. */
export function audiogramSpec(vertical: boolean, highlightHex?: string): AudiogramSpec {
  const width = vertical ? 1080 : 1920;
  const height = vertical ? 1920 : 1080;
  return {
    width,
    height,
    waveColor: hexToFfmpegColor(highlightHex),
    bgColor: BG_COLOR,
    waveHeight: vertical ? 480 : 280,
  };
}

export interface AudiogramOptions {
  spec: AudiogramSpec;
  subtitlePath?: string;
  fontsDir?: string;
  normalizeLoudness?: boolean;
  /** Redução de ruído básica (a mesma cadeia do caminho de vídeo, antes da normalização de volume). */
  denoise?: boolean;
  muteRanges?: Array<{ startSec: number; endSec: number }>;
  watermark?: WatermarkSpec;
  /** Metadados do contêiner (a sinalização implícita de conteúdo por IA, por exemplo). */
  metadata?: Record<string, string>;
  crf?: number;
  preset?: string;
}

/** O mesmo alvo de volume do cut.ts (o padrão social de -14 LUFS). */
const LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11";

/**
 * Monta os parâmetros do ffmpeg do audiograma. ranges está em segundos absolutos do áudio de origem (com
 * vários pedaços no corte seco); a busca rápida vai até o início do primeiro pedaço, e os instantes de
 * cada pedaço são expressos em relação a ele. Função pura.
 */
export function buildAudiogramArgs(
  inputPath: string,
  outputPath: string,
  ranges: Array<{ startSec: number; endSec: number }>,
  options: AudiogramOptions
): string[] {
  if (ranges.length === 0 || ranges.some((r) => !(r.endSec > r.startSec))) {
    throw new Error("audiogram requires at least one valid range");
  }
  const { spec } = options;
  const base = Math.max(0, ranges[0].startSec);
  const parts: string[] = [];

  // 1) Corte e colagem dos pedaços de áudio (em relação ao ponto da busca rápida)
  const segLabels: string[] = [];
  ranges.forEach((r, i) => {
    const from = Math.max(0, r.startSec - base);
    const to = Math.max(from, r.endSec - base);
    // 30ms de suavização nas duas pontas de cada pedaço (a mesma estratégia do caminho de vídeo): a emenda do corte seco não estala
    const fades = edgeFadeFilters(to - from);
    const fadeSuffix = fades.length > 0 ? `,${fades.join(",")}` : "";
    parts.push(`[0:a]atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS${fadeSuffix}[a${i}]`);
    segLabels.push(`[a${i}]`);
  });
  let audioLabel = "[a0]";
  if (ranges.length > 1) {
    parts.push(`${segLabels.join("")}concat=n=${ranges.length}:v=0:a=1[acat]`);
    audioLabel = "[acat]";
  }
  // 2a) Redução de ruído opcional (sobre o áudio inteiro já colado; primeiro tira o ruído e depois normaliza — o loudnorm precisa ver o áudio limpo)
  if (options.denoise) {
    parts.push(`${audioLabel}${DENOISE_FILTER}[adn]`);
    audioLabel = "[adn]";
  }
  // 2b) Normalização de volume opcional (sobre o áudio inteiro já colado, igual ao caminho de vídeo)
  if (options.normalizeLoudness) {
    parts.push(`${audioLabel}${LOUDNORM},aresample=48000[anorm]`);
    audioLabel = "[anorm]";
  }
  const mute = muteRangeFilters(options.muteRanges);
  if (mute.length > 0) {
    parts.push(`${audioLabel}${mute.join(",")}[amute]`);
    audioLabel = "[amute]";
  }
  // 3) Uma cópia sai como som e a outra vira a onda
  parts.push(`${audioLabel}asplit=2[aout][awave]`);
  parts.push(
    `[awave]showwaves=s=${spec.width}x${spec.waveHeight}:mode=cline:rate=30:colors=${spec.waveColor}[wv]`
  );
  // 4) Fundo escuro + a onda no centro; shortest=1 faz o fundo de duração infinita terminar junto com a onda
  parts.push(`color=c=${spec.bgColor}:size=${spec.width}x${spec.height}:rate=30[bg]`);
  parts.push(`[bg][wv]overlay=x=0:y=(H-h)/2:shortest=1[v0]`);
  // 5) Legenda e marca d'água (o mesmo material do caminho de vídeo)
  let videoLabel = "[v0]";
  if (options.subtitlePath) {
    const fonts = options.fontsDir ? `:fontsdir='${escapeFilterPath(options.fontsDir)}'` : "";
    parts.push(`${videoLabel}subtitles=filename='${escapeFilterPath(options.subtitlePath)}'${fonts}[v1]`);
    videoLabel = "[v1]";
  }
  if (options.watermark) {
    const s = watermarkStages(options.watermark);
    parts.push(`${s.source}[wm]`);
    parts.push(`${videoLabel}[wm]${s.overlay}[vout]`);
    videoLabel = "[vout]";
  }

  const crf = Number.isFinite(options.crf) ? String(options.crf) : "18";
  return [
    "-hide_banner", "-y",
    "-ss", base.toFixed(3), "-i", inputPath,
    "-filter_complex", parts.join(";"),
    "-map", videoLabel, "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", options.preset ?? "veryfast",
    "-crf", crf,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    ...metadataArgs(options.metadata),
    outputPath,
  ];
}

/** Executa a saída do audiograma (o mesmo estilo de embrulho do ffmpeg do cutClip). */
export async function runAudiogram(
  inputPath: string,
  outputPath: string,
  ranges: Array<{ startSec: number; endSec: number }>,
  options: AudiogramOptions,
  signal?: AbortSignal,
  onTimeSec?: (sec: number) => void
): Promise<void> {
  await withAtomicOutput(outputPath, async (temporaryPath) => {
    const args = buildAudiogramArgs(inputPath, temporaryPath, ranges, options);
    await runFfmpeg(args, { signal, onTimeSec });
  }, signal);
}
