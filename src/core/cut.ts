/**
 * Corte do trecho: [início, fim] é extraído do vídeo de origem pelo ffmpeg.
 * `buildCutArgs` é função pura (testável); só `cutClip` executa de verdade.
 *
 * Dois modos:
 *  - "accurate" (o padrão): recodifica, com busca rápida na entrada e aparo na saída.
 *    As bordas ficam exatas no quadro — necessário para o trecho que começa pelo gancho, onde o
 *    primeiro segundo é o que importa. Com o x264 em veryfast, um trecho de 60s codifica em menos de ~10s.
 *  - "copy": cópia de fluxo. É quase instantâneo, mas os cortes encaixam em quadro-chave (o que pode
 *    errar segundos em gravação de live com quadro-chave escasso) — serve só para pré-visualizar.
 */
import { spawn } from "child_process";
import { withAtomicOutput } from "./atomic-output";
import { writeFile } from "fs/promises";
import { resolve } from "path";
import { resolveFfmpegPath } from "./binaries";
import { toFfmpegTime } from "./time";
import { buildZoomFilter } from "./autozoom";
import { colorOutputArgs, hdrToneMapFilter, type ColorRenderPlan } from "./color";
import { ffmpegAudioStreamSpecifier, ffmpegVideoStreamSpecifier } from "./probe";
import { videoEncoderArgs, type VideoEncoder } from "./video-encoder";
import { visualEnhanceFilter, type VisualEnhancePlan } from "./visual-enhance";

/**
 * Alvo de volume das redes (EBU R128): -14 LUFS integrado e teto de pico real de -1,5 dBTP — o nível
 * para o qual TikTok / Reels / Shorts normalizam a reprodução, de modo que um lote de trechos saia num
 * volume só, coerente e amigo das plataformas, em vez do nível cru da origem (quase sempre baixo demais).
 *
 * O loudnorm faz a análise interna a 192kHz e entregaria essa taxa ao codificador AAC (que para em 96kHz).
 * A taxa de saída é fixada pela opção de saída `-ar` (veja LOUDNORM_OUT_RATE) em vez de um aresample dentro
 * do grafo — a reamostragem do lado da saída negocia a disposição dos canais, e a de dentro do grafo não.
 */
export const LOUDNORM_FILTER = "loudnorm=I=-14:TP=-1.5:LRA=11";
/** A taxa de amostragem de saída, forçada junto do loudnorm para limitar a saída de 192kHz dele. */
export const LOUDNORM_OUT_RATE = "48000";
/**
 * Cadeia de redução de ruído básica: dois passa-altas de 80Hz (24dB/oct, que abafam o zumbido de 50Hz da
 * rede elétrica) + o afftdn, de subtração espectral (nr=24 é a faixa suave, para não criar artefato na voz
 * real, e tn=1 acompanha o piso de ruído ao longo do tempo). Medido na prática: -7,7dB de piso nos trechos
 * de silêncio e só -0,2dB nos de fala. Isto é redução de ruído básica de custo zero, não restauração por IA.
 * Vem sempre antes do loudnorm — primeiro tira o ruído, depois normaliza, senão a normalização levanta o piso junto.
 */
export const DENOISE_FILTER = "highpass=f=80,highpass=f=80,afftdn=nr=24:nf=-40:tn=1";

export function muteRangeFilters(ranges?: Array<{ startSec: number; endSec: number }>): string[] {
  return (ranges ?? [])
    .filter((range) => Number.isFinite(range.startSec) && range.endSec > range.startSec)
    .map((range) => `volume=enable='between(t,${Math.max(0, range.startSec).toFixed(3)},${range.endSec.toFixed(3)})':volume=0`);
}

/**
 * A duração da suavização do áudio na borda do corte: recodificando, a borda quase sempre cai num ponto
 * não nulo da onda e produz um «clique» audível; 30ms é curto o bastante para não se notar a suavização e
 * já basta para prender a borda perto do zero. No corte seco, no clímax na frente e no compilado cada
 * pedaço recebe o seu fade-out e fade-in nas pontas, e a emenda do corte seco sai naturalmente lisa.
 */
export const EDGE_FADE_SEC = 0.03;

/**
 * O filtro de fade-in/fade-out na borda do pedaço (função pura). Pedaço curto demais (≤4× a duração da
 * suavização) não recebe nada — a suavização comeria a energia do pedaço inteiro, o que seria mais audível
 * que o estalo.
 */
export function edgeFadeFilters(durationSec: number): string[] {
  if (!(durationSec > EDGE_FADE_SEC * 4)) return [];
  return [
    `afade=t=in:st=0:d=${EDGE_FADE_SEC}`,
    `afade=t=out:st=${(durationSec - EDGE_FADE_SEC).toFixed(3)}:d=${EDGE_FADE_SEC}`,
  ];
}

export type CutMode = "accurate" | "copy";

export interface CutOptions {
  mode?: CutMode;
  /**
   * Caminho interno da renderização inteligente: só o fluxo de vídeo H.264 é copiado, e o áudio continua
   * recebendo as suavizações/filtros normais e a codificação AAC. Quem chama precisa provar antes que os
   * quadros-chave estão alinhados; qualquer filtro que mexa em pixel desliga isso.
   */
  videoCopy?: boolean;
  /** O índice global de stream do ffprobe escolhido para a imagem de origem. */
  videoStreamIndex?: number;
  /** O índice global de stream do ffprobe escolhido para o áudio de origem. */
  audioStreamIndex?: number;
  /** O CRF do x264 no modo accurate (quanto menor, melhor); por padrão 18 (praticamente sem perda visível). */
  crf?: number;
  /** O preset do x264 no modo accurate; por padrão "veryfast". */
  preset?: string;
  /** O resultado da sondagem do codificador nesta execução. Falha de hardware tenta de novo em libx264 de forma transparente. */
  encoder?: VideoEncoder;
  /** Apara primeiro a moldura fixa de uma gravação de tela (em frações da altura). */
  uiCrop?: { topFrac: number; bottomFrac: number };
  /**
   * Reenquadramento com rastreio de rosto: o x do crop segue uma expressão linear por pedaços em t.
   * Substitui uiCrop+vertical (a geometria dos dois é dobrada dentro do plano).
   */
  trackPlan?: { cropXExpr: string; cropW: number; cropH: number; cropY: number };
  /** Reenquadra em 9:16 vertical (recorte pelo centro → 1080×1920). Exige recodificar. */
  vertical?: boolean;
  /**
   * Movimento automático de câmera: uma aproximação lenta é sobreposta ao vídeo vertical (veja autozoom.ts).
   * Exige a taxa de quadros da origem — sem fps, o zoompan reamostra o material para 25fps. Só funciona com todos os campos preenchidos.
   */
  autoZoom?: { durationSec: number; fps: number; emphasisAtSec?: number[] };
  /** Correção de imagem conservadora, medida na própria origem; um plano neutro ou pulado não acrescenta filtro. */
  visualEnhance?: VisualEnhancePlan | null;
  /** Uma origem HDR é mapeada em tom para uma saída SDR etiquetada antes de qualquer filtro geométrico ou de acabamento. */
  color?: ColorRenderPlan;
  /** Queima um arquivo de legenda karaokê .ass pelo libass. Exige recodificar. */
  subtitlePath?: string;
  /** A pasta com as fontes empacotadas para o libass (o fontsdir do filtro subtitles). */
  fontsDir?: string;
  /** Normaliza o áudio de saída no alvo social de -14 LUFS (loudnorm, EBU R128). */
  normalizeLoudness?: boolean;
  /** Redução de ruído básica: abafa o piso de ruído e o zumbido elétrico comuns em gravação de live (dois passa-altas + afftdn, antes do loudnorm). */
  denoise?: boolean;
  /** Intervalos relativos à saída do trecho cuja fala deve ser silenciada. */
  muteRanges?: Array<{ startSec: number; endSec: number }>;
  /** Marca d'água da marca: um PNG queimado num canto da imagem (acima da legenda). */
  watermark?: WatermarkSpec;
  /** Metadados do contêiner (a sinalização implícita de conteúdo por IA, por exemplo); o modo copy também os grava. */
  metadata?: Record<string, string>;
}

/** Os pares de parâmetro -metadata k=v (função pura, compartilhada por cut e audiogram). */
export function metadataArgs(metadata?: Record<string, string>): string[] {
  return Object.entries(metadata ?? {}).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]);
}

/** Lê o out_time_us/out_time_ms do bloco de saída de -progress do ffmpeg → os segundos já codificados. */
export function parseFfmpegProgress(chunk: string): number | null {
  // out_time_us está em microssegundos; o campo antigo out_time_ms, apesar do nome, também está em microssegundos (uma armadilha histórica do ffmpeg)
  const m = chunk.match(/out_time_us=(\d+)/) ?? chunk.match(/out_time_ms=(\d+)/);
  if (!m) return null;
  const us = Number(m[1]);
  return Number.isFinite(us) ? us / 1_000_000 : null;
}

/**
 * A execução do ffmpeg pela versão com spawn: -progress pipe:1 informa em fluxo os segundos já
 * codificados (o progresso real dentro do trecho), da stderr fica só a cauda (para localizar o erro), e
 * o AbortSignal mata o processo filho direto.
 * Os três caminhos de saída (cut, corte seco e audiogram) usam isto.
 */
export async function runFfmpeg(
  args: string[],
  opts: { signal?: AbortSignal; onTimeSec?: (sec: number) => void } = {}
): Promise<void> {
  opts.signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ["-progress", "pipe:1", "-nostats", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      signal: opts.signal,
    });
    let processError: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const forceStop = (): void => {
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      killTimer.unref();
    };
    opts.signal?.addEventListener("abort", forceStop, { once: true });
    let stderrTail = "";
    child.stderr.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });
    child.stdout.on("data", (d: Buffer) => {
      const sec = parseFfmpegProgress(d.toString());
      if (sec !== null) opts.onTimeSec?.(sec);
    });
    // O abort emite error antes do close. É preciso esperar o close antes de quem chama remover ou
    // publicar a saída (o que importa especialmente enquanto o Windows mantém o arquivo preso).
    child.on("error", (e) => { processError = e; });
    child.on("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", forceStop);
      if (opts.signal?.aborted) reject(opts.signal.reason ?? new Error("export cancelled"));
      else if (processError) reject(processError);
      else if (code === 0) resolve();
      else reject(new Error(stderrTail.split("\n").slice(-6).join("\n") || `ffmpeg exited ${code}`));
    });
  });
}

/** Os parâmetros da marca d'água (o widthPx é calculado por quem chama, a partir da largura de saída). */
export interface WatermarkSpec {
  path: string;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** De 0 a 1. */
  opacity: number;
  /** A largura de destino da escala (em pixels). */
  widthPx: number;
}

/** O espaçamento em pixels entre a marca d'água e a borda da imagem. */
const WM_MARGIN = 44;

/**
 * Os dois pedaços de filtro da marca d'água: source (a fonte movie lê o PNG + transparência + escala) e
 * overlay (posicionado pelo canto). Voltam separados, o que facilita a montagem pelos dois caminhos,
 * o -vf e o filter_complex.
 */
export function watermarkStages(wm: WatermarkSpec): { source: string; overlay: string } {
  const alpha = wm.opacity < 1 ? `,colorchannelmixer=aa=${wm.opacity.toFixed(3)}` : "";
  const pos = {
    "top-left": `${WM_MARGIN}:${WM_MARGIN}`,
    "top-right": `W-w-${WM_MARGIN}:${WM_MARGIN}`,
    "bottom-left": `${WM_MARGIN}:H-h-${WM_MARGIN}`,
    "bottom-right": `W-w-${WM_MARGIN}:H-h-${WM_MARGIN}`,
  }[wm.corner];
  return {
    source: `movie='${escapeFilterPath(wm.path)}',format=rgba${alpha},scale=${wm.widthPx}:-1`,
    overlay: `overlay=${pos}:format=auto`,
  };
}

/**
 * Junta a cadeia linear de -vf com a marca d'água na expressão final de -vf. Sem marca d'água, tudo
 * segue como está; com ela, a fonte movie abre uma segunda entrada dentro do próprio -vf (sobreposta
 * depois da legenda, de modo que o logotipo fique sempre na camada mais alta).
 */
export function composeVideoFilter(filters: string[], wm?: WatermarkSpec): string {
  if (!wm) return filters.join(",");
  const main = filters.length > 0 ? filters.join(",") : "copy";
  const s = watermarkStages(wm);
  return `${main}[main];${s.source}[wm];[main][wm]${s.overlay}`;
}

/**
 * O escape de caminho no grafo de filtros do ffmpeg para o filtro subtitles: barras normais em todo
 * lugar, o dois-pontos da unidade do Windows escapado e as aspas soltas protegidas.
 */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Monta a cadeia -vf do reenquadramento + da legenda queimada. Vazia = sem filtro. */
export function buildVideoFilters(options: CutOptions): string[] {
  const filters: string[] = [];
  const toneMap = options.color ? hdrToneMapFilter(options.color) : null;
  // A curva de transferência e as primárias do HDR precisam ser normalizadas enquanto os pixels ainda
  // representam a origem intocada. Geometria, zoom, acabamento de imagem e texto operam todos sobre o
  // sinal SDR resultante, o que evita que a sobreposição também seja mapeada em tom.
  if (toneMap) filters.push(toneMap);
  const enhance = visualEnhanceFilter(options.visualEnhance);
  // Movimento automático de câmera: o zoompan toma o lugar daquele passo de scale (ele mesmo entrega o tamanho de destino); devolvendo null, tudo segue como antes
  const zoom = options.autoZoom
    ? buildZoomFilter(options.autoZoom.durationSec, options.autoZoom.fps, 1080, 1920, {
        emphasisAtSec: options.autoZoom.emphasisAtSec,
      })
    : null;
  const toVertical = zoom ? [zoom, "setsar=1"] : ["scale=1080:1920:flags=lanczos", "setsar=1"];
  if (options.trackPlan) {
    const p = options.trackPlan;
    filters.push(`crop=w=${p.cropW}:h=${p.cropH}:x='${p.cropXExpr}':y=${p.cropY}`);
    filters.push(...toVertical);
    if (enhance) filters.push(enhance);
    if (options.subtitlePath) {
      const fonts = options.fontsDir ? `:fontsdir='${escapeFilterPath(options.fontsDir)}'` : "";
      filters.push(`subtitles=filename='${escapeFilterPath(options.subtitlePath)}'${fonts}`);
    }
    return filters;
  }
  const ui = options.uiCrop;
  if (ui && (ui.topFrac > 0 || ui.bottomFrac > 0)) {
    // apara a moldura fixa da gravação de tela ANTES de qualquer reenquadramento, mantendo as dimensões pares
    const keep = Math.max(0.2, 1 - ui.topFrac - ui.bottomFrac);
    filters.push(`crop=w=iw:h='floor(ih*${keep.toFixed(4)}/2)*2':x=0:y='floor(ih*${ui.topFrac.toFixed(4)}/2)*2'`);
  }
  if (options.vertical) {
    // Recorte pelo centro em exatamente 9:16 (pelo eixo que limitar) e depois o tamanho é normalizado.
    filters.push("crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)'", ...toVertical);
  }
  if (enhance) filters.push(enhance);
  if (options.subtitlePath) {
    const fonts = options.fontsDir ? `:fontsdir='${escapeFilterPath(options.fontsDir)}'` : "";
    filters.push(`subtitles=filename='${escapeFilterPath(options.subtitlePath)}'${fonts}`);
  }
  return filters;
}

/** Monta a lista de argumentos do ffmpeg de um corte. Pura — sem entrada nem saída. */
export function buildCutArgs(
  inputPath: string,
  outputPath: string,
  startSec: number,
  endSec: number,
  options: CutOptions = {}
): string[] {
  if (!(endSec > startSec)) {
    throw new Error(`invalid cut range: start=${startSec} end=${endSec}`);
  }
  const filters = buildVideoFilters(options);
  // Qualquer filtro de vídeo — ou de áudio (loudnorm/denoise) — obriga a recodificar,
  // então copy é promovido a accurate em silêncio.
  const mode =
    filters.length > 0 || options.watermark || options.normalizeLoudness || options.denoise
      ? "accurate"
      : (options.mode ?? "accurate");
  const start = Math.max(0, startSec);
  const duration = endSec - start;

  // Busca rápida: -ss ANTES de -i salta pelo índice de quadros-chave (instantâneo mesmo na terceira
  // hora de uma gravação); o decodificador então apara com precisão dentro do segmento. A busca na
  // entrada também zera o PTS para ~0, que é exatamente o que as marcas de tempo do karaokê ASS,
  // relativas ao trecho, pressupõem.
  const common = ["-hide_banner", "-y", "-ss", toFfmpegTime(start), "-i", inputPath, "-t", toFfmpegTime(duration)];
  const maps = [
    "-map", ffmpegVideoStreamSpecifier(options.videoStreamIndex),
    "-map", ffmpegAudioStreamSpecifier(options.audioStreamIndex, 0, true),
  ];

  if (mode === "copy") {
    return [...common, ...maps, "-c", "copy", "-avoid_negative_ts", "make_zero", ...metadataArgs(options.metadata), outputPath];
  }

  const crf = Number.isFinite(options.crf) ? String(options.crf) : "18";
  const preset = options.preset ?? "veryfast";
  const copyVideo = Boolean(options.videoCopy && filters.length === 0 && !options.watermark);
  // A cadeia de áudio tem ordem fixa: redução de ruído → normalização de volume (o loudnorm precisa ver o áudio já sem ruído)
  // → suavização das bordas (por último, para o ganho dinâmico do loudnorm não desfazer a suavização)
  const audioChain = [
    ...(options.denoise ? [DENOISE_FILTER] : []),
    ...(options.normalizeLoudness ? [LOUDNORM_FILTER] : []),
    ...muteRangeFilters(options.muteRanges),
    ...edgeFadeFilters(duration),
  ];
  return [
    ...common,
    ...maps,
    ...(filters.length > 0 || options.watermark ? ["-vf", composeVideoFilter(filters, options.watermark)] : []),
    ...(copyVideo
      ? ["-c:v", "copy"]
      : [...videoEncoderArgs(options.encoder ?? "libx264", Number(crf), preset), "-pix_fmt", "yuv420p"]),
    ...(options.color ? colorOutputArgs(options.color) : []),
    ...(audioChain.length > 0 ? ["-af", audioChain.join(",")] : []),
    ...(options.normalizeLoudness ? ["-ar", LOUDNORM_OUT_RATE] : []),
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    ...metadataArgs(options.metadata),
    outputPath,
  ];
}

/**
 * O construtor de argumentos do corte seco: de um trecho ficam só os `segments` (em tempo absoluto da
 * origem), emendados numa única passada de filter_complex — trim/atrim → concat → reenquadramento
 * opcional + legenda queimada. A busca rápida continua valendo: a busca é feita até o início do trecho
 * e o tempo dos pedaços é expresso em relação a esse ponto.
 */
export function buildJumpCutArgs(
  inputPath: string,
  outputPath: string,
  clipStartSec: number,
  segments: Array<{ startSec: number; endSec: number }>,
  options: CutOptions = {}
): string[] {
  if (segments.length === 0) throw new Error("jump cut requires at least one segment");
  const seek = Math.max(0, clipStartSec);
  const lastEnd = segments[segments.length - 1].endSec;
  const readDuration = lastEnd - seek + 0.5; // uma margem pequena além do fim

  const parts: string[] = [];
  const labels: string[] = [];
  const videoInput = ffmpegVideoStreamSpecifier(options.videoStreamIndex);
  const audioInput = ffmpegAudioStreamSpecifier(options.audioStreamIndex);
  segments.forEach((s, i) => {
    const a = Math.max(0, s.startSec - seek);
    const b = Math.max(a, s.endSec - seek);
    parts.push(`[${videoInput}]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    // 30ms de suavização nas duas pontas de cada pedaço: o fade-out de um encontra o fade-in do seguinte na emenda, e o estalo do corte seco desaparece
    const fades = edgeFadeFilters(b - a);
    const fadeSuffix = fades.length > 0 ? `,${fades.join(",")}` : "";
    parts.push(`[${audioInput}]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS${fadeSuffix}[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const post = buildVideoFilters(options);
  const wm = options.watermark;
  const concatOut = post.length > 0 || wm ? "[vc]" : "[vout]";
  // O áudio processado é o *já emendado* (a redução de ruído e o loudnorm precisam ver o fluxo final
  // concatenado, não cada pedaço) — concat → [araw] → cadeia → [aout].
  const audioChain = [
    ...(options.denoise ? [DENOISE_FILTER] : []),
    ...(options.normalizeLoudness ? [LOUDNORM_FILTER] : []),
    ...muteRangeFilters(options.muteRanges),
  ];
  const audioOut = audioChain.length > 0 ? "[araw]" : "[aout]";
  parts.push(`${labels.join("")}concat=n=${segments.length}:v=1:a=1${concatOut}${audioOut}`);
  if (wm) {
    // A marca d'água é sempre a última a ser sobreposta (acima da legenda): cadeia de pós-processamento → [vmain], fonte movie → [wm], e o overlay fecha
    const s = watermarkStages(wm);
    const mainLabel = post.length > 0 ? "[vmain]" : "[vc]";
    if (post.length > 0) parts.push(`[vc]${post.join(",")}[vmain]`);
    parts.push(`${s.source}[wm]`);
    parts.push(`${mainLabel}[wm]${s.overlay}[vout]`);
  } else if (post.length > 0) {
    parts.push(`[vc]${post.join(",")}[vout]`);
  }
  if (audioChain.length > 0) parts.push(`[araw]${audioChain.join(",")}[aout]`);

  const crf = Number.isFinite(options.crf) ? String(options.crf) : "18";
  const preset = options.preset ?? "veryfast";
  return [
    "-hide_banner", "-y",
    "-ss", toFfmpegTime(seek),
    "-i", inputPath,
    "-t", toFfmpegTime(readDuration),
    "-filter_complex", parts.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
    ...videoEncoderArgs(options.encoder ?? "libx264", Number(crf), preset),
    "-pix_fmt", "yuv420p",
    ...(options.color ? colorOutputArgs(options.color) : []),
    ...(options.normalizeLoudness ? ["-ar", LOUDNORM_OUT_RATE] : []),
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    ...metadataArgs(options.metadata),
    outputPath,
  ];
}

/** Executa um corte seco. Lança com a cauda da stderr do ffmpeg em caso de falha. */
export async function cutJumpClip(
  inputPath: string,
  outputPath: string,
  clipStartSec: number,
  segments: Array<{ startSec: number; endSec: number }>,
  options: CutOptions = {},
  signal?: AbortSignal,
  onTimeSec?: (sec: number) => void
): Promise<void> {
  await withAtomicOutput(outputPath, async (temporaryPath) => {
    const args = buildJumpCutArgs(inputPath, temporaryPath, clipStartSec, segments, options);
    try {
      await runFfmpeg(args, { signal, onTimeSec });
    } catch (e) {
      if (options.encoder && options.encoder !== "libx264" && !signal?.aborted) {
        await runFfmpeg(
          buildJumpCutArgs(inputPath, temporaryPath, clipStartSec, segments, { ...options, encoder: "libx264" }),
          { signal, onTimeSec }
        );
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      const tail = msg.split("\n").slice(-6).join("\n");
      throw new Error(`ffmpeg jump cut failed (${segments.length} segments): ${tail}`);
    }
  }, signal);
}

/** Executa um corte. Lança com a cauda da stderr do ffmpeg em caso de falha. */
export async function cutClip(
  inputPath: string,
  outputPath: string,
  startSec: number,
  endSec: number,
  options: CutOptions = {},
  signal?: AbortSignal,
  onTimeSec?: (sec: number) => void
): Promise<"copy" | "encode"> {
  return withAtomicOutput(outputPath, async (temporaryPath) => {
    const args = buildCutArgs(inputPath, temporaryPath, startSec, endSec, options);
    try {
      await runFfmpeg(args, { signal, onTimeSec });
      return options.videoCopy ? "copy" : "encode";
    } catch (e) {
      // A cópia inteligente do vídeo é só uma otimização. Peculiaridades de contêiner ou de fluxo de bits
      // podem recusar um fluxo que era elegível, então o caminho accurate, já comprovado, é tentado de novo
      // antes de cogitar a volta para o codificador de hardware.
      if (options.videoCopy && !signal?.aborted) {
        try {
          await runFfmpeg(
            buildCutArgs(inputPath, temporaryPath, startSec, endSec, { ...options, videoCopy: false }),
            { signal, onTimeSec }
          );
          return "encode";
        } catch (accurateError) {
          e = accurateError;
        }
      }
      if (options.encoder && options.encoder !== "libx264" && !signal?.aborted) {
        await runFfmpeg(
          buildCutArgs(inputPath, temporaryPath, startSec, endSec, { ...options, videoCopy: false, encoder: "libx264" }),
          { signal, onTimeSec }
        );
        return "encode";
      }
      const msg = e instanceof Error ? e.message : String(e);
      // Os erros do ffmpeg enterram a causa no fim da stderr — só a cauda é mostrada
      const tail = msg.split("\n").slice(-6).join("\n");
      throw new Error(`ffmpeg cut failed (${toFfmpegTime(startSec)}→${toFfmpegTime(endSec)}): ${tail}`);
    }
  }, signal);
}

/** O conteúdo do arquivo de lista do demuxer concat (a aspa simples no caminho é escapada conforme a sintaxe dele). */
export function buildConcatList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

/**
 * Os parâmetros da colagem: os pedaços exportados pela mesma esteira têm parâmetros de codificação
 * iguais, então a cópia de fluxo (-c copy) termina em segundos e sem perda nenhuma de qualidade; a
 * junção é por corte seco (a prática de sempre no compilado e no clímax na frente, já que transição
 * exigiria recodificar tudo).
 * metadata serve para completar os metadados de contêiner (como a sinalização implícita de conteúdo por IA) no resultado da colagem.
 */
export function buildConcatArgs(listPath: string, outputPath: string, metadata?: Record<string, string>): string[] {
  return ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", ...metadataArgs(metadata), outputPath];
}

/** Cola, na ordem, vários pedaços já exportados por cópia de fluxo. O arquivo de lista fica ao lado da saída e é apagado ao terminar. */
export async function concatClips(
  paths: string[],
  outputPath: string,
  signal?: AbortSignal,
  metadata?: Record<string, string>
): Promise<void> {
  if (paths.length < 2) throw new Error("concat requires at least two clips");
  await withAtomicOutput(outputPath, async (temporaryPath) => {
    const listPath = `${temporaryPath}.list.txt`;
    await writeFile(listPath, buildConcatList(paths.map((path) => resolve(path))), "utf8");
    await runFfmpeg(buildConcatArgs(listPath, temporaryPath, metadata), { signal });
  }, signal);
}
