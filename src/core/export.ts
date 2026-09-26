/**
 * Clip export orchestrator: cut every selected highlight out of the source
 * video into ready-to-post mp4s. Pure helpers (naming) + one effectful runner.
 * Optional render passes: 9:16 vertical reframe and burned-in karaoke captions.
 */
import { mkdir, stat, writeFile, rm, mkdtemp, rename } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join, basename } from "path";
import { resolveFfmpegPath } from "./binaries";

const execFileAsync = promisify(execFile);
import { cutClip, cutJumpClip, concatClips, type CutOptions } from "./cut";
import { planColdOpen, planFlashForward, FLASH_SKIP_NEAR_START_SEC } from "./coldopen";
import { computeJumpCut, BREATH_PAD_SEC } from "./gaps";
import { perturbLayout } from "../shared/perturb";
import { clampTranslationLines, remapTranslationLines, type TranslationLine } from "./translate";
import { postTextFile, type PublishCopy } from "./publish";
import { buildPublishPacks, coverFilter, type PackSummary } from "./publish-pack";
import { buildSeriesPack, type SeriesPackSummary } from "./series-pack";
import { buildSrt, srtLinesFromWords } from "./srt";
import { buildEdl, type EdlClip } from "./edl";
import { buildDraftContent, buildDraftMetaInfo } from "./jianying";
import { generateAiCover, type CoverTier } from "./cover-ai";
import { runAudiogram, audiogramSpec } from "./audiogram";
import { pickCoverTime } from "./cover";
import { proposeCoverTimes, selectQualityCoverTime, type CoverSelectionReceipt } from "./cover-quality";
import { findFillerWords, dropFillerWords, fillerCutSpans, type FillerHit } from "./fillers";
import { findRetakes, dropRetakeWords, retakeCutSpans, type RetakeHit } from "./retakes";
import {
  mergePieces,
  normalizePieces,
  pieceCutSpans,
  piecesDurationSec,
  planFromPieces,
  withinOnePiece,
  type ClipPiece,
} from "../shared/pieces";
import { extractPeaks, findPeakEvents } from "./audio-peaks";
import { genrePauseGapSec } from "./genre";
import {
  planSfxCues,
  ensureSfxAssets,
  applySoundDesign,
  hasSoundDesignWork,
  type SfxCue,
} from "./sound-design";
import { detectUiCrop, type UiCrop } from "./uicrop";
import { generateCropPlan, renderCropXExpr, mapToOutputTime, remapCropKeyframes } from "./reframe";
import type { AnalysisVideoOptions } from "./analysis-video";
import { snapClipToShots, SNAP_MAX_OUT_SEC } from "./shots";
import { collectSignalsEvidence, detectShotBoundariesEvidence, detectSpeechActivityEvidence } from "./media-evidence";
import {
  assessSpeechActivity,
  normalizeSpeechSpans,
  refineSpeechBoundaries,
  speechActivityRangeSupported,
  type SpeechActivitySpan,
} from "./speech-activity";
import { buildCaptionAss, VERTICAL_LAYOUT, HORIZONTAL_LAYOUT, type CaptionStyle } from "./subtitle";
import { lintSubtitleTimeline } from "./subtitle-quality";
import { buildOverlayPayload, isWebCaptionStyle, type OverlayRenderFn, type WebCaptionStyle } from "./caption-overlay/payload";
import { probeMedia } from "./probe";
import { runClipQa, maxVisualGapSec, missingHookPayoffs, summarizeSubjectCoverage, type ClipQaReport } from "./qa";
import { lintClipContent } from "./content-lint";
import { mapSensitiveRanges } from "./sensitive-words";
import { planRepair, applyRepair } from "./repair";
import { applyBrandToLayout } from "./brand";
import type { AlignmentQualityReport, SubtitleQualityReport, TranscriptWord, BrandStyle } from "../shared/api-types";
import type { WatermarkSpec } from "./cut";
import { transformScore, type TransformInputs, type TransformScore } from "../shared/transform-score";
import { buildLedgerCsv, type LedgerRow } from "./ledger";
import { resolveVideoEncoder } from "./video-encoder";
import {
  createRenderCacheKey,
  fingerprintRenderFile,
  hashRenderInput,
  invalidateRenderCache,
  restoreRenderCache,
  storeRenderCache,
  type FileFingerprint,
} from "./render-cache";
import { canCopyVideoStream, probeVideoKeyframes } from "./smart-render";
import { planVisualEnhancement, type VisualEnhancePlan, type VisualSignalSample } from "./visual-enhance";
import { isExecutableColorPlan, isHdrSource, planColorRender, type ColorRenderPlan } from "./color";
import {
  applySmartDenoiseWithFallback,
  type AudioEnhancementReceipt,
  type DenoiseMode,
} from "./speech-enhancement";
import { DPDFNET_SPEECH_ENHANCEMENT_MODEL } from "./models";

export interface ExportClipSpec {
  id: number;
  title: string;
  startSec: number;
  endSec: number;
  /**
   * A lista de trechos da costura (em ordem de tempo; só vale com 2 ou mais).
   * Informando ela, é ela que vale, e startSec/endSec passam a ser apenas as pontas
   * do intervalo — os espaços entre os trechos são removidos pela máquina de corte
   * seco, e legenda, tradução, capa e EDL se alinham sozinhos.
   */
  pieces?: ClipPiece[];
  /** Words the clip covers (absolute source time) — needed for caption burn-in. */
  words?: TranscriptWord[];
  /** Verbatim keywords to emphasize (keyword caption style). */
  keywords?: string[];
  /** O instante das palavras vizinhas que ficam fora do clipe (calculado na transcrição inteira e passado aqui) — é a proteção da expansão do encaixe na troca de plano. */
  snapContext?: { prevWordEndSec: number | null; nextWordStartSec: number | null };
  /** A pessoa definiu os pontos de corte à mão na bancada de revisão: o encaixe na troca de plano é pulado, e a máquina não mexe mais na decisão humana. */
  manualBounds?: boolean;
  /** As linhas de tradução das frases inteiras da legenda bilíngue (em tempo absoluto da origem, traduzidas de antemão pelo processo principal e passadas aqui). */
  translation?: TranslationLine[];
  /** Texto de publicação (gerado de antemão pelo processo principal e passado aqui), que vai para o .post.txt e para o clips.json. */
  publish?: PublishCopy;
  /** Várias versões: de qual original este clipe é uma versão (o id da especificação original); ausente na original. */
  variantOf?: number;
  /** Número da versão (a original é 1, e as versões começam em 2); ausente na original. */
  variant?: number;
  /** De qual pico de volume, em ordem decrescente, a capa é tirada (0 = o mais alto, igual ao histórico); é por aqui que a capa de cada versão fica num quadro diferente. */
  coverRank?: number;
  /**
   * A dimensão de diferença estrutural das várias versões: este clipe tem a
   * antecipação do pico forçada na abertura (em OU com a chave global).
   * A versão não troca só a embalagem — a última também tem outra estrutura de
   * abertura, levando a "diferença de verdade" da distribuição em várias contas um
   * passo adiante;
   * se a antecipação não sair (nenhum pico significativo em todo o material), o recuo
   * para a abertura comum é o fail-open que já existe.
   */
  flashForward?: boolean;
  /** Evidence-chain fields carried into clips.json for CMS/matrix pipelines. */
  meta?: {
    hook: string;
    score: number;
    reason: string;
    text: string;
    recommended: boolean;
    reviewNote: string;
    visualEvidence?: {
      score: number;
      scene: string;
      match: boolean;
      visibleText?: string[];
    };
    scoreDims?: { hook: number; flow: number; value: number; trend: number };
    teaser?: string;
  };
}

/** Quanto tempo o gancho de abertura (a chamada) fica na tela — é a janela dos 3 segundos de ouro. */
const OPENING_HOOK_SEC = 2.2;

/**
 * Intervalo máximo para extrair a trilha de picos. O intervalo de um clipe
 * costurado pode atravessar dezenas de minutos (os dois trechos de uma
 * "contradição" já são distantes por natureza), e decodificar tudo para extrair os
 * picos é lento e inútil — passando desse intervalo, a extração não acontece, e a
 * porta de silêncio do corte seco e a capa inteligente recuam cada uma pelo
 * caminho de fail-open que já existe (exatamente o mesmo ramo de "a extração
 * falhou").
 */
export const PEAK_SPAN_MAX_SEC = 300;

function peakSpanTooLong(clip: { startSec: number; endSec: number }): boolean {
  return clip.endSec - clip.startSec > PEAK_SPAN_MAX_SEC;
}

/**
 * Enquadramento por rosto num clipe costurado: a detecção roda trecho por trecho e
 * depois os quadros-chave são deslocados para a mesma base de tempo, "relativa ao
 * início do clipe", e o tamanho da janela de recorte é o do primeiro trecho que deu
 * certo (sendo a mesma origem, o cálculo de todos os trechos coincide
 * necessariamente).
 * Se todos falharem, devolve null → e a camada acima recorre ao recorte central, com
 * a mesma semântica do caminho de trecho único.
 */
async function cropPlanOverPieces(
  inputPath: string,
  pieces: ClipPiece[],
  clipStartSec: number,
  modelsRoot: string,
  uiCrop?: UiCrop,
  analysis?: AnalysisVideoOptions
): Promise<Awaited<ReturnType<typeof generateCropPlan>>> {
  let merged: Awaited<ReturnType<typeof generateCropPlan>> = null;
  for (const p of pieces) {
    const cp = await generateCropPlan(inputPath, p.startSec, p.endSec, modelsRoot, uiCrop, analysis).catch(() => null);
    if (!cp) continue;
    const shift = p.startSec - clipStartSec;
    const kfs = cp.keyframes.map((k) => ({ ...k, t: k.t + shift }));
    const coverageSamples = cp.coverageSamples.map((sample) => ({ ...sample, t: sample.t + shift }));
    if (!merged) merged = { ...cp, keyframes: kfs, coverageSamples };
    else {
      merged.keyframes.push(...kfs);
      merged.coverageSamples.push(...coverageSamples);
      merged.composition.totalShots += cp.composition.totalShots;
      merged.composition.lockedShots += cp.composition.lockedShots;
      merged.composition.groupLockedShots += cp.composition.groupLockedShots;
      merged.composition.trackedShots += cp.composition.trackedShots;
      merged.composition.recoveryShots += cp.composition.recoveryShots;
      merged.composition.centeredShots += cp.composition.centeredShots;
    }
  }
  return merged;
}

/**
 * Summarize a jump-cut/filler splice plan into the clips.json `edit` block.
 * Pure so the numbers (removed seconds, cut ratio) are unit-testable without
 * running ffmpeg. Returns null when nothing was spliced.
 */
export function summarizeEdit(
  origDurSec: number,
  plan: { segments: unknown[]; durationSec: number } | null
): ClipRenderOutcome["edit"] {
  if (!plan || origDurSec <= 0) return null;
  return {
    splices: plan.segments.length,
    keptSec: Number(plan.durationSec.toFixed(2)),
    removedSec: Number(Math.max(0, origDurSec - plan.durationSec).toFixed(2)),
    cutRatio: Number(Math.max(0, 1 - plan.durationSec / origDurSec).toFixed(3)),
  };
}

/**
 * Entradas da nota de transformação (v0.14, função pura): os itens de transformação
 * são mapeados a partir do comprovante de um clipe mais as opções de exportação —
 * usando, sempre que possível, "o que de fato aconteceu" (outcome) em vez de "a
 * chave estava ligada ou não" (options), porque um item que recuou não pode inflar
 * a nota.
 */
export function transformInputsFromRender(
  render: ClipRenderOutcome,
  opts: Pick<ExportRenderOptions, "titleCard" | "autoZoom" | "brand">
): TransformInputs {
  return {
    vertical: render.reframe === "face-track" || render.reframe === "center-crop",
    captions: render.captionsBurned,
    recut: (render.edit?.splices ?? 0) > 0 || render.fillersRemoved > 0 || render.retakesRemoved > 0,
    reopened: render.coldOpenSec !== null || render.flashForward,
    titleOverlay: Boolean(opts.titleCard) || render.openingHookBurned,
    autoZoom: Boolean(opts.autoZoom),
    bgm: render.bgmMixed,
    sfx: render.sfxCues > 0,
    stitched: render.stitchedPieces >= 2,
    translated: render.translatedLines > 0,
    watermark: Boolean(opts.brand?.watermark),
  };
}

/** What the pipeline actually did to one clip — surfaced in clips.json. */
export interface ClipRenderOutcome {
  /** Effective caption style burned in ("none" when captions were skipped). */
  captionStyle: string;
  /** False when a web-overlay pass failed and the clip shipped without word captions. */
  captionsBurned: boolean;
  /** "face-track" when the crop followed a face, "center-crop" on fallback, "none" for horizontal, "audiogram" for audio-only sources. */
  reframe: "face-track" | "center-crop" | "none" | "audiogram";
  /** Per-shot comfort-composition receipt when face-aware reframing ran. */
  reframeComposition?: {
    totalShots: number;
    lockedShots: number;
    groupLockedShots: number;
    trackedShots: number;
    recoveryShots: number;
    centeredShots: number;
  };
  /** Jump-cut / filler splice outcome; null when the clip was cut whole. */
  edit: { splices: number; keptSec: number; removedSec: number; cutRatio: number } | null;
  /** Number of filler/stutter words removed. */
  fillersRemoved: number;
  /** Quantas frases de tomada refeita foram cortadas (só pode ser diferente de 0 com "cortar repetições" ligado). */
  retakesRemoved: number;
  /** Quantidade de trechos da costura (0 significa que este clipe é um conteúdo contínuo). */
  stitchedPieces: number;
  /** True when audio was matched to the -14 LUFS social loudness target. */
  loudnessNormalized: boolean;
  /** True when basic or learned audio cleanup was requested. */
  denoised: boolean;
  /** Requested/applied audio cleanup tier; absent on legacy exports. */
  audioEnhancement?: AudioEnhancementReceipt;
  /** Clip-local measured picture correction; null when disabled. */
  visualEnhance?: VisualEnhancePlan | null;
  /** Source color evidence and the exact HDR→SDR decision; absent on legacy exports. */
  color?: ColorRenderPlan | null;
  /** Number of transcript-timed sensitive-language windows muted. */
  sensitiveMutes?: number;
  /** Duração do trecho curto da abertura fria (em segundos); null quando está desligada, quando o gancho não foi localizado ou quando a proteção pulou. */
  coldOpenSec: number | null;
  /** True significa que o trecho colocado na frente é a "antecipação do pico" (o gancho visual de 0,3 a 1s), e não a frase de gancho. */
  flashForward: boolean;
  /** True when the AI teaser was burned in as an opening hook. */
  openingHookBurned: boolean;
  /** Quantas linhas de tradução foram de fato queimadas na imagem; 0 quando o bilíngue está desligado ou a tradução falhou. */
  translatedLines: number;
  /** O deslocamento real do ponto de corte ao encaixar no limite de plano (em segundos); null quando não houve encaixe (ou a detecção falhou). */
  shotSnap: { startDeltaSec: number; endDeltaSec: number } | null;
  /** Local speech evidence used by automatic edges/jump cuts; absent on legacy exports. */
  speechActivity?: {
    mode: "vad" | "fallback";
    wordCoverage: number;
    spans: number;
    startDeltaSec: number;
    endDeltaSec: number;
    protectedGaps: number;
  };
  /** True significa que a lista de palavras foi corrigida por um segundo alinhamento com o Paraformer (pontos de corte precisos). */
  preciseAligned: boolean;
  /** Detailed final-candidate alignment receipt; absent on legacy exports, null when alignment did not run or failed open. */
  alignment?: AlignmentQualityReport | null;
  /** Deterministic subtitle lint; issue ranges use the final clip timeline before cold-open duplication. */
  subtitleQuality?: SubtitleQualityReport | null;
  /** Quantos efeitos sonoros de fato entraram no vídeo (0 = desligado, sem lugar para colocar, ou recuo por falha na mixagem). */
  sfxCues: number;
  /** True significa que a trilha de fundo foi mixada com sucesso (incluindo o abaixamento sob a voz). */
  bgmMixed: boolean;
  /** Base-render cache result for this clip. */
  renderCache?: "hit" | "miss" | "disabled";
  /** How the base video became available; cached keeps the receipt truthful when no encoder ran. */
  videoMode?: "copy" | "encode" | "cached";
  /** Final-render cover-frame selection evidence; absent on legacy exports. */
  coverSelection?: CoverSelectionReceipt;
}

export interface ExportRenderOptions {
  /** Center-crop reframe to 9:16 (1080×1920). */
  vertical?: boolean;
  /** Caption style to burn in (clips must carry `words`); omit for none. */
  captionStyle?: CaptionStyle | WebCaptionStyle;
  /** Injected web-overlay renderer (Electron main); required for web styles. */
  renderOverlay?: OverlayRenderFn;
  /** Splice out intra-clip silences (clips must carry `words`). */
  jumpCut?: boolean;
  /** Manter as respiradas: quando o corte seco remove pausas longas, cada emenda fica com cerca de 0,25s de ar, em vez de colar tudo sem folga. */
  keepBreath?: boolean;
  /** Marca de falante: em clipes com várias pessoas, a troca de falante coloca um "A:" colorido no começo da linha da legenda (só vale quando a lista de palavras traz a identificação). */
  speakerLabels?: boolean;
  /** Variação controlada do template: desloca levemente a geometria da legenda (tamanho da fonte e linha de base) conforme uma semente por clipe, para que exportações em lote não compartilhem a mesma impressão digital. */
  templateJitter?: boolean;
  /** Remove as hesitações ("é…", "ãh", "um", "uh") e as repetições de gagueira. */
  cleanFillers?: boolean;
  /** Cortar as tomadas refeitas: quando a mesma frase é dita duas vezes seguidas, só a última fica (veja retakes.ts). */
  cutRetakes?: boolean;
  /** Movimento automático de câmera: os clipes verticais recebem uma camada de aproximação e afastamento lentos (veja autozoom.ts). */
  autoZoom?: boolean;
  /** Acentos sonoros: whoosh na emenda da costura, ding no pico de emoção e pop no gancho de abertura (veja sound-design.ts). */
  sfx?: boolean;
  /** Caminho do arquivo de trilha: entra em laço cobrindo o material inteiro e é mixado depois do abaixamento automático sob a voz. */
  bgmPath?: string;
  /** Id do gênero da transmissão (core/genre.ts): define o nível do limite de silêncio do corte seco; ausente usa o nível padrão. */
  genreId?: string;
  /**
   * Pontos de corte precisos (injeção opcional; veja createClipAligner em align.ts):
   * os candidatos passam por uma segunda decodificação com o Paraformer para corrigir
   * a marcação por palavra; devolver null significa que não deu para casar (e a lista
   * de palavras original é mantida).
   */
  alignWords?: (
    filePath: string,
    clip: { startSec: number; endSec: number; pieces?: ClipPiece[]; words: TranscriptWord[] }
  ) => Promise<{ words: TranscriptWord[]; report: AlignmentQualityReport } | null>;
  /** Auto-detect & crop static screen-recording chrome (status bars, app UI). */
  trimUi?: boolean;
  /** Face-tracking vertical reframe (needs modelsRoot); falls back to center. */
  faceTrack?: boolean;
  /** Where AI models live (userData/models in the app). */
  modelsRoot?: string;
  /** Burn each clip's title into the top safe zone. */
  titleCard?: boolean;
  /** Queima a chamada da IA (a frase de suspense) em letras grandes como gancho de abertura sobre os primeiros segundos do clipe. */
  openingHook?: boolean;
  /** Bundled-font directory handed to libass so CJK renders identically everywhere. */
  fontsDir?: string;
  /** Match audio to the -14 LUFS social loudness target (EBU R128 loudnorm). */
  normalizeLoudness?: boolean;
  /** Redução de ruído básica: abaixa o ruído de fundo e o zumbido comuns em gravação de live (dois passa-altas mais afftdn, antes da normalização de volume). */
  denoise?: boolean;
  /** `smart` uses the optional 48 kHz local speech model and falls back to `basic`. */
  denoiseMode?: DenoiseMode;
  /** Conservative clip-local exposure, contrast and saturation correction. */
  autoEnhance?: boolean;
  /** User-controlled terms muted at transcript word timestamps. */
  muteTerms?: string[];
  /** Compilado dos melhores momentos: os clipes exportados são emendados em ordem de tempo, por cópia direta do fluxo, num único compilado (só é gerado com 2 ou mais). */
  compilation?: boolean;
  /** Abertura fria: a frase de gancho vira um trecho curto emendado no começo do clipe, e depois vem o vídeo inteiro (cold open). */
  coldOpen?: boolean;
  /**
   * Antecipação do pico (flash-forward): de 0,3 a 1s da imagem do pico emocional do
   * material aparece na abertura e depois volta — é a versão visual da abertura fria.
   * Com coldOpen ligado ao mesmo tempo, a antecipação tem prioridade, e se ela não
   * sair (nenhum pico significativo em todo o material), o recuo é a frase de gancho
   * na frente.
   */
  flashForward?: boolean;
  /** Duas proporções: além do vertical, sai também uma versão horizontal na proporção original (na subpasta `horizontal/`; o vertical vai para o TikTok e o horizontal para YouTube e Bilibili). */
  alsoLandscape?: boolean;
  /** Encaixa os pontos de corte no limite de plano (TransNetV2, exige modelsRoot); se a detecção falhar, o recuo silencioso é não encaixar. */
  snapToShots?: boolean;
  /** Predefinição de estilo da marca (cor de destaque, tamanho da fonte, posição, marca d'água); ausente usa o padrão interno, e a saída não muda. */
  brand?: BrandStyle;
  /** CRF do x264 (quanto menor, mais nítido e maior o arquivo); ausente usa 18 — mantendo a qualidade padrão histórica. */
  crf?: number;
  /** Idioma alvo da legenda bilíngue (para o comprovante; a tradução em si vem pelo ExportClipSpec.translation). */
  translateLang?: string;
  /** Coloca ao lado de cada clipe um arquivo .srt de mesmo nome (para subir a legenda na plataforma ou refinar depois). */
  subtitleFile?: boolean;
  /** Escreve um timeline.edl (CMX3600) na pasta de saída — os pontos de corte vão para o programa de edição, revinculando a origem para o acabamento. */
  timeline?: boolean;
  /** Rascunho do JianYing: uma pasta de rascunho por clipe (que basta copiar para o diretório de rascunhos do JianYing e abrir para refinar). */
  jianyingDraft?: boolean;
  /**
   * Capa por IA em dois níveis (v0.14): gera, a partir do título do clipe, uma capa
   * vertical de letras grandes, que passa a existir junto da capa tirada de um quadro.
   * volume = o nível econômico do Seedream / premium = o nível premium do Nano Banana
   * Pro; exige que o nível de LLM aponte para o Atlas e tenha chave (o parâmetro pt
   * controla o idioma do prompt); a falha é silenciosa e nunca derruba a exportação.
   */
  aiCover?: { tier: CoverTier; baseUrl: string; apiKey: string; pt?: boolean };
  /** Selo de conteúdo por IA: a sinalização explícita "Gerado por IA" no canto superior esquerdo mais a implícita nos metadados do contêiner (conforme as regras de rotulagem). */
  aigcLabel?: boolean;
  /** Pacote de evidências (v0.14): cada clipe copia da origem, sem recodificar, os 3 minutos antes e depois para "evidencias/" — é a guarda da gravação original que as novas regras de revisão de autorização exigem. */
  evidencePack?: boolean;
  /** Pacote por plataforma: organiza o material completo conforme as especificações de cada plataforma em `pacotes-publicacao/<plataforma>/` (veja publish-pack.ts). */
  publishPack?: string[];
  /** Pacote de série por tema: organiza os vídeos originais em pastas de série ordenadas, a partir das palavras-chave repetidas. */
  seriesPack?: boolean;
  /**
   * Verificação de qualidade do próprio vídeo (ligada por padrão): depois de
   * renderizar cada clipe, uma decodificação procura tela preta, silêncio longo,
   * desvio de volume e de duração, confere se o ponto de corte caiu no meio de uma
   * palavra e varre título, gancho, texto e legenda em busca de palavras proibidas
   * pelas plataformas;
   * o relatório entra no campo qa do clips.json. Um false explícito desliga (por
   * exemplo num lote enorme com pressa).
   */
  qa?: boolean;
  /**
   * Laço de correção da verificação (ligado junto com a qa, por padrão): os avisos
   * que dá para curar sozinho — recortar o silêncio e a tela preta do começo e do
   * fim, uma segunda normalização de volume — são corrigidos e reconferidos, e o
   * vídeo só é substituído quando os avisos de fato diminuem (o que fica auditável em
   * qa.repair).
   * Um false explícito só confere, sem corrigir.
   */
  qaRepair?: boolean;
  /** Shared bounded cache for exact base renders. Omit to disable. */
  renderCacheDir?: string;
  /** Cache budget override; defaults to a conservative 1GiB. */
  renderCacheMaxBytes?: number;
  /** Shared bounded cache for source-derived analysis evidence. Omit to disable. */
  evidenceCacheDir?: string;
}

export interface ExportedClip {
  id: number;
  title: string;
  path: string;
  /** Cover JPG next to the clip (frame from just after the hook). */
  coverPath?: string;
  sizeBytes: number;
  durationSec: number;
  /** True when an explicit PQ/HLG source was safely tone-mapped to SDR BT.709. */
  colorConverted?: boolean;
  /** HDR was detected but its input colour path was incomplete or unsupported. */
  colorConversionSkipped?: boolean;
  /** Source probing failed, so HDR colour safety could not be evaluated. */
  colorInspectionFailed?: boolean;
  /** Effective audio cleanup tier for completion/headless status. */
  audioEnhancement?: AudioEnhancementReceipt["applied"];
  /** Relatório da verificação de qualidade; null ou ausente quando a verificação está desligada ou falhou. */
  qa?: ClipQaReport | null;
}

export type { ExportProgressEvent } from "../shared/api-types";
import type { ExportProgressEvent } from "../shared/api-types";

/** Whitelist-sanitize: keep letters (all scripts incl. CJK), digits, space, dash, underscore. */
export function sanitizeFilename(name: string, fallback = "clip"): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N} \-_]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}

/** "01-titulo.mp4" — o índice preserva a ordem da linha do tempo mesmo depois da ordenação do sistema de arquivos. */
export function clipFilename(index: number, title: string): string {
  return `${String(index).padStart(2, "0")}-${sanitizeFilename(title)}.mp4`;
}

/** O instante dentro do arquivo de capítulos: o formato de capítulos do YouTube e do Bilibili (passando de uma hora, a casa de hora entra sozinha). */
function chapterClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * O texto com as marcações de tempo dos capítulos do compilado (o formato serve
 * tanto para os capítulos do YouTube quanto para a descrição do Bilibili, e é só
 * colar): uma linha "0:00 título" por clipe, com o instante sendo o começo dele
 * dentro do compilado (a duração acumulada).
 */
export function buildChapters(items: Array<{ title: string; durationSec: number }>): string {
  let t = 0;
  const lines = items.map((it) => {
    const line = `${chapterClock(t)} ${it.title}`;
    t += it.durationSec;
    return line;
  });
  return lines.join("\n") + "\n";
}

/** Cut all clips sequentially (ffmpeg saturates cores per encode anyway). */
export async function exportClips(
  inputPath: string,
  clips: ExportClipSpec[],
  outDir: string,
  options: ExportRenderOptions = {},
  onProgress?: (p: ExportProgressEvent) => void,
  signal?: AbortSignal
): Promise<ExportedClip[]> {
  signal?.throwIfAborted();
  onProgress?.({ current: 0, total: clips.length, clipId: clips[0]?.id ?? 0, stage: "preparing", preparation: "media" });
  await mkdir(outDir, { recursive: true });
  // ASS files live in a throwaway temp dir for the duration of the run.
  const needAss =
    Boolean(options.captionStyle) || Boolean(options.titleCard) || Boolean(options.openingHook) ||
    Boolean(options.aigcLabel) || clips.some((c) => (c.translation?.length ?? 0) > 0);
  const assDir = needAss ? await mkdtemp(join(tmpdir(), "hotclip-ass-")) : null;
  // Pasta dos arquivos de efeito sonoro: criada só na primeira vez que é preciso (mkdtemp mais três wav sintetizados pelo ffmpeg, de forma idempotente)
  let sfxDir: string | null = null;
  const ensureSfxDir = async (): Promise<string> => {
    if (!sfxDir) {
      sfxDir = await mkdtemp(join(tmpdir(), "hotclip-sfx-"));
      await ensureSfxAssets(sfxDir, signal);
    }
    return sfxDir;
  };
  try {
    // Predefinição da marca: o tamanho da fonte e a posição agem no layout, a cor de destaque vai para a construção da legenda, e a marca d'água entra na cadeia de filtros
    const baseLayout = applyBrandToLayout(options.vertical ? VERTICAL_LAYOUT : HORIZONTAL_LAYOUT, options.brand);
    const watermark: WatermarkSpec | undefined = options.brand?.watermark
      ? {
          path: options.brand.watermark.path,
          corner: options.brand.watermark.corner,
          opacity: options.brand.watermark.opacity,
          // A saída vertical é sempre de 1080 de largura, e o logo ocupa 16%; na saída horizontal a largura é a da origem (desconhecida), então o valor fixo é 300px
          widthPx: options.vertical ? Math.round(1080 * 0.16) : 300,
        }
      : undefined;

    // Origem só de áudio (podcast, gravação) segue o caminho da onda sonora: fundo
    // escuro mais onda na cor da marca compõem a imagem sozinhos, e as etapas
    // exclusivas de vídeo (remoção da interface de gravação de tela, enquadramento por
    // rosto, encaixe na troca de plano) são puladas por completo
    const srcInfo = await probeMedia(inputPath, signal).catch(() => {
      signal?.throwIfAborted();
      return null;
    });
    const sourceStreams = {
      videoStreamIndex: srcInfo?.videoStreamIndex,
      audioStreamIndex: srcInfo?.audioStreamIndex,
    };
    const colorInspectionFailed = srcInfo === null;
    const audioOnly = srcInfo ? !srcInfo.hasVideo : false;
    const color = srcInfo?.hasVideo ? planColorRender(srcInfo) : null;
    const hdrDetected = isHdrSource(color);
    const allowSdrVisualEnhance = !hdrDetected && !colorInspectionFailed;
    // SDR/unknown sources keep their existing pixel treatment. Stream indices
    // are still explicit so multi-track inputs cannot probe one picture and
    // render another; the cache identity below isolates those selections.
    const activeColor = isExecutableColorPlan(color) ? color : undefined;
    const sourceAnalysis: AnalysisVideoOptions = {
      videoStreamIndex: srcInfo?.videoStreamIndex,
      color,
    };
    // One encoder probe per process/run. The cut layer retries libx264 if the
    // advertised hardware encoder is unusable because of a missing device/driver.
    const videoEncoder = audioOnly ? "libx264" as const : await resolveVideoEncoder();
    // Cache identity is resolved once per export. If source/watermark metadata
    // cannot be read, caching simply disables itself and the normal render path
    // continues unchanged.
    let cacheSource: FileFingerprint | null = null;
    let cacheWatermark: FileFingerprint | null = null;
    if (options.renderCacheDir) {
      cacheSource = await fingerprintRenderFile(inputPath).catch(() => null);
      if (watermark) cacheWatermark = await fingerprintRenderFile(watermark.path).catch(() => null);
    }
    const renderCacheReady = Boolean(
      options.renderCacheDir && cacheSource && (!watermark || cacheWatermark)
    );
    let visualSamples: VisualSignalSample[] = [];
    if (options.autoEnhance && !audioOnly && allowSdrVisualEnhance) {
      const signals = await collectSignalsEvidence({
        videoPath: inputPath,
        evidenceDir: options.evidenceCacheDir,
        signal,
        source: cacheSource ?? undefined,
        analysis: sourceAnalysis,
      }).catch((error) => {
        if (signal?.aborted) throw error;
        return null;
      });
      visualSamples = signals?.visualSamples ?? [];
    }

    // Duas proporções: com "+horizontal" ligado, o total do progresso dobra (a segunda
    // passada, horizontal, roda recursivamente depois do laço principal).
    // Uma origem vertical não consegue produzir um 16:9 aproveitável, porque a proporção
    // original já é vertical — nesse caso a versão horizontal é simplesmente pulada.
    const alsoLandscape =
      Boolean(options.alsoLandscape && options.vertical) &&
      (srcInfo && srcInfo.hasVideo ? srcInfo.width >= srcInfo.height : !audioOnly);
    const totalUnits = clips.length * (alsoLandscape ? 2 : 1);

    // one UI-chrome detection pass for the whole source (bands don't move)
    let uiCrop: UiCrop | undefined;
    if (options.trimUi && clips.length > 0 && !audioOnly) {
      const spanEnd = Math.max(...clips.map((c) => c.endSec));
      uiCrop = await detectUiCrop(inputPath, spanEnd, srcInfo?.videoStreamIndex, color, signal).catch(() => {
        signal?.throwIfAborted();
        return undefined;
      });
      if (uiCrop && uiCrop.topFrac === 0 && uiCrop.bottomFrac === 0) uiCrop = undefined;
    }

    signal?.throwIfAborted();
    const results: ExportedClip[] = [];
    // "you decide what got cut": removed filler texts surface in clips.json
    const removedFillersByClip = new Map<number, string[]>();
    // Per-clip processing outcomes for clips.json — what the pipeline actually
    // did (and where it fell back), so "fully managed" stays inspectable.
    const renderByClip = new Map<number, ClipRenderOutcome>();
    // O ponto de corte real depois do encaixe (o sourceStart e o sourceEnd do clips.json precisam informar o valor verdadeiro)
    const snappedRange = new Map<number, { startSec: number; endSec: number }>();
    // A lista de trechos da costura já organizada (o clips.json informa os trechos que de fato entraram no corte)
    const piecesByClip = new Map<number, ClipPiece[]>();
    // Exportação da linha do tempo: o intervalo da origem que cada clipe de fato preserva (com corte seco, um clipe tem vários trechos)
    const edlClips: EdlClip[] = [];
    for (let i = 0; i < clips.length; i++) {
      let clip = clips[i];
      if (signal?.aborted) throw new Error("export cancelled");
      onProgress?.({ current: i + 1, total: totalUnits, clipId: clip.id, stage: "cutting" });

      // Variação controlada do template (v0.14): desloca levemente a geometria da
      // legenda conforme uma semente de "arquivo de origem + id do clipe", para que os
      // vídeos de um lote não compartilhem a mesma impressão digital de layout; a mesma
      // semente é reproduzível.
      const layout = options.templateJitter
        ? perturbLayout(baseLayout, `${basename(inputPath)}#${clip.id}`)
        : baseLayout;

      // Costura de vários trechos: a lista de trechos é definida aqui, e todas as
      // etapas seguintes passam a se guiar por ela.
      // A seleção manual (manualBounds) só funde sobreposições e não corta trechos — o
      // "no máximo 4 trechos, mínimo de 2 segundos" é a proteção da costura feita pela
      // IA, e nenhuma frase escolhida a dedo pela pessoa pode ser descartada em silêncio
      const pieces = clip.manualBounds ? mergePieces(clip.pieces ?? [], 0) : normalizePieces(clip.pieces ?? []);
      const stitched = pieces.length > 1;
      if (stitched) piecesByClip.set(clip.id, pieces);

      // Pontos de corte precisos (segundo alinhamento): a lista de palavras precisa ser
      // corrigida antes do encaixe na troca de plano, do corte seco e da legenda — todas
      // as etapas adiante consomem o tempo de clip.words. Falha ou taxa baixa de
      // correspondência voltam para a lista original.
      let preciseAligned = false;
      let alignment: AlignmentQualityReport | null = null;
      if (options.alignWords && clip.words && clip.words.length > 0) {
        const refined = await options
          .alignWords(inputPath, { startSec: clip.startSec, endSec: clip.endSec, pieces: clip.pieces, words: clip.words })
          .catch((e) => {
            if (signal?.aborted) throw e;
            console.error(`precise align failed for clip ${clip.id}, kept original words:`, e);
            return null;
          });
        if (refined && refined.words.length > 0) {
          clip = { ...clip, words: refined.words };
          preciseAligned = true;
          alignment = refined.report;
        }
      }

      // Speech-aware safety layer: the tiny local VAD corroborates ASR before
      // it may refine automatic outer edges or protect a nominally silent gap.
      // Any model/decode/cache failure, suspicious word coverage, long range,
      // manual outer bound, or stitched outer bound preserves historical cuts.
      let speechSpans: SpeechActivitySpan[] | undefined;
      let speechAnchorStart: number | undefined;
      let speechAnchorEnd: number | undefined;
      let speechActivity: ClipRenderOutcome["speechActivity"];
      if (options.jumpCut && options.modelsRoot && clip.words && clip.words.length > 0 && srcInfo?.hasAudio !== false) {
        const speechRanges = stitched
          ? pieces.map((piece) => ({ startSec: piece.startSec, endSec: piece.endSec }))
          : [{ startSec: Math.max(0, clip.startSec - 0.8), endSec: clip.endSec + 0.8 }];
        let detected: SpeechActivitySpan[] | null = null;
        if (speechRanges.length > 0 && speechRanges.every((range) => speechActivityRangeSupported(range.startSec, range.endSec))) {
          detected = [];
          for (const range of speechRanges) {
            const batch = await detectSpeechActivityEvidence({
              mediaPath: inputPath,
              startSec: range.startSec,
              endSec: range.endSec,
              modelsRoot: options.modelsRoot,
              audioStreamIndex: srcInfo?.audioStreamIndex,
              evidenceDir: options.evidenceCacheDir,
              signal,
              source: cacheSource ?? undefined,
            }).catch((error) => {
              if (signal?.aborted) throw error;
              return null;
            });
            if (batch === null) {
              detected = null;
              break;
            }
            detected.push(...batch);
          }
        }
        const normalized = detected ? normalizeSpeechSpans(detected) : [];
        const assessedWords = stitched
          ? clip.words.filter((word) => pieces.some((piece) => word.endSec > piece.startSec && word.startSec < piece.endSec))
          : clip.words;
        const assessment = assessSpeechActivity(normalized, assessedWords);
        speechActivity = {
          mode: assessment.usable ? "vad" : "fallback",
          wordCoverage: Number(assessment.wordCoverage.toFixed(3)),
          spans: normalized.length,
          startDeltaSec: 0,
          endDeltaSec: 0,
          protectedGaps: 0,
        };
        if (assessment.usable) {
          speechSpans = normalized;
          if (!clip.manualBounds && !stitched) {
            const refined = refineSpeechBoundaries(clip.startSec, clip.endSec, clip.words, normalized, clip.snapContext);
            speechAnchorStart = refined.anchorStartSec;
            speechAnchorEnd = refined.anchorEndSec;
            speechActivity.startDeltaSec = Number(refined.startDeltaSec.toFixed(3));
            speechActivity.endDeltaSec = Number(refined.endDeltaSec.toFixed(3));
            if (refined.startSec !== clip.startSec || refined.endSec !== clip.endSec) {
              clip = { ...clip, startSec: refined.startSec, endSec: refined.endSec };
              snappedRange.set(clip.id, { startSec: refined.startSec, endSec: refined.endSec });
            }
          }
        }
      }

      // Encaixe do ponto de corte: o início e o fim são encaixados no limite de plano
      // mais próximo (com proteção de limite de palavra; se a detecção falhar, o recuo é
      // não encaixar).
      // Isso precisa ser ajustado antes do corte seco, da legenda e do enquadramento —
      // todas as etapas adiante consomem clip.startSec e clip.endSec.
      // Um clipe costurado é pulado: os pontos de corte internos dele foram definidos
      // pelo "sentido", e encaixar no limite de plano torceria a relação de contraste.
      let shotSnap: ClipRenderOutcome["shotSnap"] = null;
      if (options.snapToShots && options.modelsRoot && !clip.manualBounds && !audioOnly && !stitched) {
        const pad = SNAP_MAX_OUT_SEC + 0.4;
        const boundaries = await detectShotBoundariesEvidence({
          videoPath: inputPath,
          startSec: clip.startSec - pad,
          endSec: clip.endSec + pad,
          modelsRoot: options.modelsRoot,
          evidenceDir: options.evidenceCacheDir,
          signal,
          source: cacheSource ?? undefined,
          analysis: sourceAnalysis,
        }).catch((error) => {
          if (signal?.aborted) throw error;
          return [] as number[];
        });
        const w = clip.words;
        const snap = snapClipToShots(clip.startSec, clip.endSec, boundaries, {
          firstWordStartSec: speechAnchorStart === undefined
            ? w?.[0]?.startSec
            : Math.min(w?.[0]?.startSec ?? speechAnchorStart, speechAnchorStart),
          lastWordEndSec: speechAnchorEnd === undefined
            ? (w && w.length > 0 ? w[w.length - 1].endSec : undefined)
            : Math.max(w && w.length > 0 ? w[w.length - 1].endSec : speechAnchorEnd, speechAnchorEnd),
          prevWordEndSec: clip.snapContext?.prevWordEndSec,
          nextWordStartSec: clip.snapContext?.nextWordStartSec,
        });
        if (snap.snapped) {
          clip = { ...clip, startSec: snap.startSec, endSec: snap.endSec };
          snappedRange.set(clip.id, { startSec: snap.startSec, endSec: snap.endSec });
          shotSnap = {
            startDeltaSec: Number(snap.startDeltaSec.toFixed(3)),
            endDeltaSec: Number(snap.endDeltaSec.toFixed(3)),
          };
        }
      }

      // Jump cut: plan kept segments + words remapped to the output timeline.
      // Peaks gate the cuts so wordless-but-loud moments (laughter, applause,
      // BGM stings) survive; peak extraction failure degrades to gap-only.
      // Filler cleanup rides the same splice machinery: hesitation sounds and
      // stutters become forced-cut spans (they are audible speech — neither
      // the gap rule nor the silence gate would remove them).
      // O espaço entre os trechos de um clipe costurado é justamente o intervalo de remoção obrigatória — a costura reaproveita inteiramente a máquina de corte seco, sem criar outra linha do tempo
      const stitchSpans = stitched ? pieceCutSpans(pieces, { exact: clip.manualBounds }) : [];
      let plan = null;
      let fillerHits: FillerHit[] = [];
      let retakeHits: RetakeHit[] = [];
      // A trilha de picos sobe de escopo: a porta de silêncio do corte seco usa, e a escolha do quadro da capa também (veja abaixo)
      let clipPeaks: Awaited<ReturnType<typeof extractPeaks>> | undefined;
      if ((options.jumpCut || options.cleanFillers || options.cutRetakes || stitched) && clip.words && clip.words.length > 0) {
        fillerHits = options.cleanFillers ? findFillerWords(clip.words) : [];
        // Tomada refeita: o julgamento acontece depois de tirar os vícios de linguagem (um "ãh" de deslize não deveria afetar a semelhança entre as duas falas)
        const deFilled = dropFillerWords(clip.words, fillerHits);
        retakeHits = options.cutRetakes ? findRetakes(deFilled) : [];
        const planWords = dropRetakeWords(deFilled, retakeHits);
        const peaks = options.jumpCut && !peakSpanTooLong(clip)
          ? await extractPeaks(inputPath, clip.startSec, clip.endSec, srcInfo?.audioStreamIndex).catch(() => undefined)
          : undefined;
        clipPeaks = peaks;
        // filler/retake-only mode with nothing found → leave the clip untouched
        if (options.jumpCut || stitched || fillerHits.length > 0 || retakeHits.length > 0) {
          // Proteção da emoção: a pausa de 1s antes e depois de um evento de pico (riso,
          // grito, aplauso) é efeito de programa, e cortar é proibido — a suspensão antes
          // de soltar a piada é o tempo da comédia, e a máquina não deveria "otimizar"
          // isso
          const protectedSpans = peaks
            ? findPeakEvents(peaks).map((e) => ({ startSec: e.startSec - 1.0, endSec: e.endSec + 1.0 }))
            : [];
          plan = computeJumpCut(planWords, clip.startSec, clip.endSec, {
            peaks,
            forceCutSpans: [...stitchSpans, ...fillerCutSpans(fillerHits), ...retakeCutSpans(retakeHits)].sort(
              (a, b) => a.startSec - b.startSec
            ),
            // O limite de silêncio muda por gênero: narração 0,4s, locução 0,6s, conversa 0,9s (genre.ts)
            gapThresholdSec: options.jumpCut ? genrePauseGapSec(options.genreId) : Infinity,
            protectedSpans,
            // Manter as respiradas: cada emenda deixa um pouco de ar no fim da frase, em vez de colar tudo sem folga
            breathPadSec: options.keepBreath ? BREATH_PAD_SEC : 0,
            speechSpans,
          });
          if (speechActivity && speechSpans) speechActivity.protectedGaps = plan.speechProtectedGaps ?? 0;
        }
      }
      // Clipe costurado mas sem lista de palavras (sem queimar legenda e sem corte seco): a própria lista de trechos já é o plano do vídeo final
      if (!plan && stitched) {
        plan = planFromPieces(pieces);
      }
      const baseSegments = plan?.segments ?? [{ startSec: clip.startSec, endSec: clip.endSec }];
      // Tier-0 luma thresholds currently describe the encoded signal domain;
      // they are not valid SDR measurements for a PQ/HLG source. Tone mapping
      // therefore owns HDR color conversion and adaptive finishing stays off.
      const visualEnhance = options.autoEnhance && allowSdrVisualEnhance
        ? planVisualEnhancement(visualSamples, baseSegments)
        : null;
      const captionWords = plan ? plan.words : clip.words;
      const captionShift = plan ? 0 : clip.startSec;

      const clipDuration = plan ? plan.durationSec : clip.endSec - clip.startSec;
      let subtitlePath: string | undefined;
      let subtitleHash: string | undefined;
      const wantCaptions = Boolean(options.captionStyle && captionWords && captionWords.length > 0);
      // Web styles render words in the overlay pass; ASS then only draws the
      // title card. ASS styles burn everything in one libass pass as before.
      const webStyle = isWebCaptionStyle(options.captionStyle) && wantCaptions && options.renderOverlay
        ? options.captionStyle
        : undefined;
      const assStyle: CaptionStyle = isWebCaptionStyle(options.captionStyle) ? "keyword" : (options.captionStyle ?? "keyword");
      const subtitleQuality = wantCaptions
        ? lintSubtitleTimeline(captionWords!, layout, assStyle, plan?.breaks, clip.keywords, { readability: true, endSec: captionShift + clipDuration })
        : null;
      // Gancho de abertura: a chamada da IA (a frase de suspense) é queimada em letras grandes no terço superior durante os
      // clip's first seconds — this is what the teaser was generated for.
      const teaser = clip.meta?.teaser?.trim();
      const openingHook = options.openingHook && teaser
        ? { text: teaser, durationSec: Math.min(OPENING_HOOK_SEC, clipDuration) }
        : undefined;
      // As linhas de tradução: primeiro entram no clipe final (o de depois do encaixe) e
      // só então, no corte seco, são mapeadas para a linha do tempo comprimida.
      // A base de tempo é a mesma de captionWords, e o buildCaptionAss usa o mesmo
      // captionShift para deslocar.
      let transLines = clip.translation && clip.translation.length > 0
        ? clampTranslationLines(clip.translation, clip.startSec, clip.endSec)
        : [];
      if (plan && transLines.length > 0) transLines = remapTranslationLines(transLines, plan.segments);
      if (assDir && needAss && ((wantCaptions && !webStyle) || options.titleCard || openingHook || transLines.length > 0 || options.aigcLabel)) {
        subtitlePath = join(assDir, `clip-${clip.id}.ass`);
        const ass = buildCaptionAss(
          wantCaptions && !webStyle ? captionWords! : [],
          captionShift,
          layout,
          assStyle,
          {
            readability: true,
            endSec: captionShift + clipDuration,
            keywords: clip.keywords,
            forcedBreaks: plan?.breaks,
            titleCard: options.titleCard ? { text: clip.title, durationSec: clipDuration } : undefined,
            openingHook,
            highlightHex: options.brand?.highlightColor,
            translation: transLines.length > 0 ? transLines : undefined,
            aigcBadge: options.aigcLabel ? { durationSec: clipDuration } : undefined,
            speakerLabels: options.speakerLabels,
          }
        );
        subtitleHash = hashRenderInput(ass);
        await writeFile(subtitlePath, ass, "utf8");
      }

      // Face-aware reframe: plan per clip; any failure falls back to center.
      let trackPlan;
      let reframeComposition: ClipRenderOutcome["reframeComposition"];
      let reframeCoverage: ClipQaReport["subjectCoverage"];
      if (options.vertical && options.faceTrack && options.modelsRoot && !audioOnly) {
        // Num clipe costurado, cada trecho recebe o seu próprio cálculo: o intervalo
        // inteiro pode ter dezenas de minutos, e rodar a detecção de rosto por todo esse
        // intervalo seria puro desperdício.
        // Os quadros-chave de cada trecho são relativos ao início dele, e todos são
        // deslocados para "relativo ao início do clipe" antes de passar pelo mesmo
        // remapeamento.
        const cp = stitched
          ? await cropPlanOverPieces(inputPath, pieces, clip.startSec, options.modelsRoot, uiCrop, sourceAnalysis)
          : await generateCropPlan(
              inputPath, clip.startSec, clip.endSec, options.modelsRoot, uiCrop, sourceAnalysis
            ).catch(() => null);
        if (cp) {
          let kfs = cp.keyframes;
          let coverageSamples = cp.coverageSamples;
          if (plan) {
            // jump cut: preserve retained motion without interpolating through removed gaps
            kfs = remapCropKeyframes(kfs, plan.segments, clip.startSec);
            coverageSamples = coverageSamples.filter(
              (sample) => mapToOutputTime(sample.t, plan.segments, clip.startSec) !== null
            );
          }
          if (kfs.length > 0) {
            reframeComposition = cp.composition;
            reframeCoverage = summarizeSubjectCoverage(coverageSamples);
            trackPlan = {
              cropXExpr: renderCropXExpr(kfs),
              cropW: cp.cropW,
              cropH: cp.cropH,
              cropY: cp.cropY,
            };
          }
        }
      }

      const outPath = join(outDir, clipFilename(i + 1, clip.title));
      // Web overlay may fail-open to the base clip (no word captions) — record it.
      let webRenderFailed = false;
      // Web captions: cut to a base file first, then composite words on top.
      const cutTarget = webStyle ? outPath.replace(/\.mp4$/, ".base.mp4") : outPath;
      // Progresso ao vivo dentro do clipe: os segundos que o ffmpeg já codificou → de 0 a 1 no clipe atual, informado com controle de frequência junto dos eventos de progresso
      let lastPct = -1;
      const onTimeSec = (sec: number): void => {
        const fraction = Math.max(0, Math.min(1, sec / Math.max(0.1, clipDuration)));
        const pct = Math.floor(fraction * 50); // controle de frequência com granularidade de 2%
        if (pct !== lastPct) {
          lastPct = pct;
          onProgress?.({ current: i + 1, total: totalUnits, clipId: clip.id, stage: "cutting", fraction });
        }
      };

      // Sinalização implícita de IA: o atributo do conteúdo, o serviço e o identificador do conteúdo são escritos nos metadados do contêiner (conforme as regras de rotulagem)
      const aigcMeta = options.aigcLabel
        ? { comment: `AIGC=true; Label=AI-assisted-editing; Tool=HotClip; ContentId=${basename(outPath)}` }
        : undefined;
      // Eventos de pico (na linha do tempo de saída): a ênfase do movimento de câmera e
      // os acentos sonoros compartilham a mesma lista — um pico de volume equivale a um
      // ponto alto de emoção, o mesmo indicador acústico da capa inteligente; no corte
      // seco, isso é mapeado para a linha do tempo comprimida. Falha na extração ou
      // intervalo de costura acima do limite viram "sem eventos", em fail-open.
      if ((options.autoZoom || options.sfx || options.flashForward || clip.flashForward) && !clipPeaks && !peakSpanTooLong(clip)) {
        clipPeaks = await extractPeaks(inputPath, clip.startSec, clip.endSec, srcInfo?.audioStreamIndex).catch(() => undefined);
      }
      // O par (tempo na origem, tempo na saída) é preservado: a ênfase do movimento de
      // câmera e os acentos sonoros usam o tempo de saída, e a antecipação do pico
      // precisa voltar à origem para dar aquele corte, usando o tempo da origem
      const peakEventPairs = clipPeaks
        ? findPeakEvents(clipPeaks)
            .map((e) => ({
              srcSec: e.atSec,
              outSec: plan ? mapToOutputTime(e.atSec, plan.segments, clip.startSec) : e.atSec - clip.startSec,
            }))
            .filter((p): p is { srcSec: number; outSec: number } => p.outSec !== null && p.outSec >= 0 && p.outSec <= clipDuration)
        : [];
      const peakEventsOut = peakEventPairs.map((p) => p.outSec);
      // Movimento automático de câmera: só faz sentido em imagem vertical (a onda sonora
      // e o material horizontal original não recebem);
      // sem saber a taxa de quadros, não é ligado — o zoompan reamostraria o material
      // para 25 quadros por segundo.
      // Os instantes de ênfase são os poucos eventos de pico mais fortes — "a aproximação
      // precisa estar amarrada a um evento real", e além do simples respiro a linguagem
      // de câmera tem que combinar com o conteúdo (o autozoom.ts já dava suporte a isso, e
      // aqui o sinal é ligado nele)
      const autoZoom =
        options.autoZoom && options.vertical && !audioOnly && srcInfo && srcInfo.fps > 0
          ? {
              durationSec: clipDuration,
              fps: srcInfo.fps,
              emphasisAtSec: peakEventsOut.slice(0, 4).sort((a, b) => a - b),
            }
          : undefined;
      const sensitiveMuteRanges =
        options.muteTerms && clip.words
          ? mapSensitiveRanges(clip.words, options.muteTerms, plan?.segments ?? [{ startSec: clip.startSec, endSec: clip.endSec }])
          : undefined;
      // Smart cleanup runs once over the fully assembled clip, immediately
      // before SFX/BGM. Defer both denoise and loudness to that post-pass so
      // inference sees the final edit and loudness is measured after it.
      const smartDenoise = Boolean(options.denoise && options.denoiseMode === "smart");
      const baseDenoise = smartDenoise ? false : options.denoise;
      const baseNormalizeLoudness = smartDenoise ? false : options.normalizeLoudness;
      const cutOptions: CutOptions = trackPlan
        ? { ...sourceStreams, trackPlan, autoZoom, visualEnhance, color: activeColor, subtitlePath, fontsDir: subtitlePath ? options.fontsDir : undefined, normalizeLoudness: baseNormalizeLoudness, denoise: baseDenoise, muteRanges: sensitiveMuteRanges, watermark, metadata: aigcMeta, crf: options.crf, encoder: videoEncoder }
        : {
            ...sourceStreams,
            uiCrop,
            vertical: options.vertical,
            autoZoom,
            visualEnhance,
            color: activeColor,
            subtitlePath,
            fontsDir: subtitlePath ? options.fontsDir : undefined,
            normalizeLoudness: baseNormalizeLoudness,
            denoise: baseDenoise,
            muteRanges: sensitiveMuteRanges,
            watermark,
            metadata: aigcMeta,
            crf: options.crf,
            encoder: videoEncoder,
          };
      const baseKind = audioOnly ? "audiogram" : baseSegments.length > 1 ? "jump-cut" : "cut";
      const cacheKey = renderCacheReady
        ? createRenderCacheKey({
            source: cacheSource,
            implementation: "export-base-v1",
            kind: baseKind,
            segments: baseSegments,
            options: {
              uiCrop,
              ...sourceStreams,
              vertical: options.vertical,
              autoZoom,
              visualEnhance,
              color: activeColor,
              trackPlan,
              subtitleSha256: subtitleHash,
              fontsDir: subtitlePath ? options.fontsDir : undefined,
              normalizeLoudness: baseNormalizeLoudness,
              denoise: baseDenoise,
              audioEnhancement: smartDenoise
                ? { requested: "smart", modelId: DPDFNET_SPEECH_ENHANCEMENT_MODEL.id }
                : undefined,
              muteRanges: sensitiveMuteRanges,
              watermark: watermark ? { ...watermark, file: cacheWatermark } : undefined,
              metadata: aigcMeta,
              crf: options.crf,
              encoder: videoEncoder,
              audiogram: audioOnly ? audiogramSpec(Boolean(options.vertical), options.brand?.highlightColor) : undefined,
            },
          })
        : null;
      let renderCache: ClipRenderOutcome["renderCache"] = renderCacheReady ? "miss" : "disabled";
      let videoMode: ClipRenderOutcome["videoMode"] = "encode";
      let cacheHit = false;
      if (cacheKey && options.renderCacheDir) {
        cacheHit = await restoreRenderCache(options.renderCacheDir, cacheKey, cutTarget);
        if (cacheHit) {
          const cachedInfo = await probeMedia(cutTarget).catch(() => null);
          if (!cachedInfo?.hasVideo || cachedInfo.durationSec <= 0) {
            cacheHit = false;
            await invalidateRenderCache(options.renderCacheDir, cacheKey);
            await rm(cutTarget, { force: true }).catch(() => undefined);
          }
        }
      }
      if (cacheHit) {
        renderCache = "hit";
        videoMode = "cached";
        onProgress?.({ current: i + 1, total: totalUnits, clipId: clip.id, stage: "cutting", fraction: 1 });
      } else {
        if (audioOnly) {
           // Onda sonora: fundo escuro mais onda na cor da marca compõem a imagem, igual para trecho único e corte seco (a onda é gerada a partir do áudio já editado)
          await runAudiogram(
            inputPath,
            cutTarget,
            baseSegments,
            {
               // É estritamente igual à escolha entre vertical e horizontal do layout ASS, porque só assim o playRes coincide
              spec: audiogramSpec(Boolean(options.vertical), options.brand?.highlightColor),
              subtitlePath,
              fontsDir: subtitlePath ? options.fontsDir : undefined,
              normalizeLoudness: baseNormalizeLoudness,
              denoise: baseDenoise,
              muteRanges: sensitiveMuteRanges,
              watermark,
              metadata: aigcMeta,
              crf: options.crf,
            },
            signal,
            onTimeSec
          );
        } else if (baseSegments.length > 1) {
          await cutJumpClip(inputPath, cutTarget, clip.startSec, baseSegments, cutOptions, signal, onTimeSec);
        } else {
          // Single kept segment: copy H.264 video only when its start is proven
          // keyframe-aligned and no pixel-changing filter is active.
          const range = baseSegments[0];
          // First use a synthetic aligned timestamp to check codec/filter
          // eligibility; only pay for ffprobe when the edit could actually copy.
          const copyCandidate = srcInfo
            ? canCopyVideoStream(srcInfo, range.startSec, cutOptions, [range.startSec])
            : false;
          const keyframes = copyCandidate
            ? await probeVideoKeyframes(inputPath, range.startSec, srcInfo?.videoStreamIndex).catch(() => [] as number[])
            : [];
          const videoCopy = copyCandidate && srcInfo
            ? canCopyVideoStream(srcInfo, range.startSec, cutOptions, keyframes)
            : false;
          videoMode = await cutClip(
            inputPath,
            cutTarget,
            range.startSec,
            range.endSec,
            { ...cutOptions, videoCopy },
            signal,
            onTimeSec
          );
        }
        if (cacheKey && options.renderCacheDir) {
          await storeRenderCache(
            options.renderCacheDir,
            cacheKey,
            cutTarget,
            options.renderCacheMaxBytes
          ).catch((error) => console.error(`render cache store failed for clip ${clip.id}:`, error));
        }
      }
      if (webStyle) {
        // Overlay geometry must match the base clip exactly, whatever the cut
        // pipeline produced (vertical 1080×1920 or source-sized horizontal).
        try {
          const info = await probeMedia(cutTarget, signal);
          const scale = info.height / layout.playResY;
          const overlayLayout = {
            ...layout,
            playResX: info.width,
            playResY: info.height,
            fontSize: Math.round(layout.fontSize * scale),
            marginV: Math.round(layout.marginV * scale),
            marginH: Math.round(layout.marginH * scale),
          };
          const relWords = captionWords!.map((w) => ({
            text: w.text,
            startSec: w.startSec - captionShift,
            endSec: w.endSec - captionShift,
            speaker: w.speaker, // keep per-word speaker so the overlay colors by talker
          }));
          const payload = buildOverlayPayload(relWords, overlayLayout, {
            readability: true,
            endSec: clipDuration,
            keywords: clip.keywords,
            forcedBreaks: plan?.breaks,
            highlightHex: options.brand?.highlightColor,
          });
          await options.renderOverlay!(cutTarget, outPath, payload, clipDuration, webStyle, {
            signal,
            color: activeColor,
            videoStreamIndex: info.videoStreamIndex,
            audioStreamIndex: info.audioStreamIndex,
          });
          await rm(cutTarget, { force: true });
        } catch (e) {
          if (signal?.aborted) {
            await rm(cutTarget, { force: true }).catch(() => {});
            throw e;
          }
          // fail-open: ship the base clip (title card intact, no word captions)
          webRenderFailed = true;
          await rm(outPath, { force: true }).catch(() => {});
          const { rename } = await import("fs/promises");
          await rename(cutTarget, outPath);
          console.error(`overlay pass failed for clip ${clip.id}, shipped base:`, e);
        }
      }
      // Abertura fria (cold open): a frase de gancho vira um trecho curto emendado antes
      // do vídeo — os 3 primeiros segundos decidem se a pessoa assiste até o fim, e
      // repetir no lugar original é prática corrente no mundo dos cortes de live; se
      // qualquer passo falhar, o recuo é o vídeo original, e este clipe nunca é derrubado
      let coldOpenSec: number | null = null;
      let coldOpenPlan: ReturnType<typeof planColdOpen> = null;
      // True quando o trecho curto é a "antecipação do pico" e não a frase de gancho (o comprovante precisa distinguir as duas formas de abertura)
      let flashForwardUsed = false;
      // O texto do gancho fica em meta.hook (o campo da cadeia de evidências) e não no topo — ler no lugar errado faria a abertura fria nunca disparar
      const coldOpenHook = clip.meta?.hook?.trim();
      if (!audioOnly && !webStyle && (options.flashForward || clip.flashForward || options.coldOpen)) {
        // A antecipação do pico tem prioridade: com as duas chaves ligadas, o gancho
        // visual é a diferenciação mais forte (só 0,04% dos cortes da internet têm um
        // gancho visual); se ela não sair (nenhum pico significativo em todo o material),
        // o recuo é a frase de gancho.
        // clip.flashForward é a dimensão de diferença estrutural das várias versões
        // (aquela versão específica liga a antecipação por conta própria)
        if (options.flashForward || clip.flashForward) {
          const farEnough = peakEventPairs
            .filter((p) => p.outSec >= FLASH_SKIP_NEAR_START_SEC)
            .map((p) => p.srcSec);
          coldOpenPlan = planFlashForward(
            farEnough,
            plan ? plan.segments : [{ startSec: clip.startSec, endSec: clip.endSec }]
          );
          flashForwardUsed = coldOpenPlan !== null;
        }
        if (!coldOpenPlan && options.coldOpen && coldOpenHook && clip.words && clip.words.length > 0) {
          coldOpenPlan = planColdOpen(clip.words, coldOpenHook, clip.startSec);
          // Clipe costurado: o trecho curto é um corte feito à parte na origem, e precisa
          // cair inteiro dentro de um dos trechos, senão o conteúdo do espaço que foi
          // removido voltaria para o vídeo final como gancho
          // (a antecipação do pico escolhe a janela entre os trechos preservados, então
          // atende a isso por natureza e não precisa de nova verificação)
          if (coldOpenPlan && stitched && !withinOnePiece(pieces, coldOpenPlan.startSec, coldOpenPlan.endSec)) {
            coldOpenPlan = null;
          }
        }
        const coPlan = coldOpenPlan;
        if (coPlan) {
          const miniPath = outPath.replace(/\.mp4$/, ".hook.mp4");
          const bodyPath = outPath.replace(/\.mp4$/, ".body.mp4");
          const miniDur = coPlan.endSec - coPlan.startSec;
          const ok = await (async (): Promise<boolean> => {
            // Legenda do trecho curto: a frase de gancho segue com o karaokê normalmente; a
            // frase de suspense, o título e o selo de IA são queimados nesses primeiros
            // segundos
            // (o gancho precisa ser legível na legenda — mais de 60% assiste no celular
            // sem som)
            let miniAssPath: string | undefined;
            if (assDir && needAss) {
              miniAssPath = join(assDir, `clip-${clip.id}-hook.ass`);
              const miniWords = wantCaptions
                ? clip.words!.filter((w) => w.startSec >= coPlan.startSec - 1e-3 && w.endSec <= coPlan.endSec + 1e-3)
                : [];
              const miniAss = buildCaptionAss(miniWords, coPlan.startSec, layout, assStyle, {
                keywords: clip.keywords,
                titleCard: options.titleCard ? { text: clip.title, durationSec: miniDur } : undefined,
                openingHook: openingHook ? { text: openingHook.text, durationSec: Math.min(OPENING_HOOK_SEC, miniDur) } : undefined,
                highlightHex: options.brand?.highlightColor,
                aigcBadge: options.aigcLabel ? { durationSec: miniDur } : undefined,
                speakerLabels: options.speakerLabels,
              });
              await writeFile(miniAssPath, miniAss, "utf8");
            }
            // Rastreio de rosto: o trecho curto calcula a própria janela de recorte (os keyframes já são relativos ao início do trecho), e em caso de falha o recuo é o recorte central
            let miniTrack;
            if (trackPlan && options.modelsRoot) {
              const cp = await generateCropPlan(inputPath, coPlan.startSec, coPlan.endSec, options.modelsRoot, uiCrop).catch(() => null);
              if (cp && cp.keyframes.length > 0) {
                miniTrack = { cropXExpr: renderCropXExpr(cp.keyframes), cropW: cp.cropW, cropH: cp.cropH, cropY: cp.cropY };
              }
            }
            const miniVisualEnhance = options.autoEnhance && allowSdrVisualEnhance
              ? planVisualEnhancement(visualSamples, [{ startSec: coPlan.startSec, endSec: coPlan.endSec }])
              : null;
            const miniCutOptions = miniTrack
              ? { ...sourceStreams, trackPlan: miniTrack, visualEnhance: miniVisualEnhance, color: activeColor, subtitlePath: miniAssPath, fontsDir: miniAssPath ? options.fontsDir : undefined, normalizeLoudness: baseNormalizeLoudness, denoise: baseDenoise, muteRanges: options.muteTerms && clip.words ? mapSensitiveRanges(clip.words, options.muteTerms, [{ startSec: coPlan.startSec, endSec: coPlan.endSec }]) : undefined, watermark, crf: options.crf, encoder: videoEncoder }
              : { ...sourceStreams, uiCrop, vertical: options.vertical, visualEnhance: miniVisualEnhance, color: activeColor, subtitlePath: miniAssPath, fontsDir: miniAssPath ? options.fontsDir : undefined, normalizeLoudness: baseNormalizeLoudness, denoise: baseDenoise, muteRanges: options.muteTerms && clip.words ? mapSensitiveRanges(clip.words, options.muteTerms, [{ startSec: coPlan.startSec, endSec: coPlan.endSec }]) : undefined, watermark, crf: options.crf, encoder: videoEncoder };
            await rename(outPath, bodyPath);
            await cutClip(inputPath, miniPath, coPlan.startSec, coPlan.endSec, miniCutOptions, signal);
            // Emenda em corte seco (prática corrente); a sinalização implícita de IA é acrescentada no contêiner final
            await concatClips([miniPath, bodyPath], outPath, signal, aigcMeta);
            await rm(miniPath, { force: true });
            await rm(bodyPath, { force: true });
            return true;
          })().catch(async (e) => {
            if (signal?.aborted) throw e;
            // Recuo: o vídeo principal é o produto final (o rename pode não ter acontecido ou já ter acontecido, e os dois casos são cobertos)
            await rename(bodyPath, outPath).catch(() => {});
            await rm(miniPath, { force: true }).catch(() => {});
            return false;
          });
          if (ok) coldOpenSec = miniDur;
        }
      }

      let audioEnhancement: AudioEnhancementReceipt | undefined;
      if (options.denoise) {
        audioEnhancement = smartDenoise
          ? await applySmartDenoiseWithFallback(
              outPath,
              options.modelsRoot,
              Boolean(options.normalizeLoudness),
              signal
            )
          : { requested: "basic", applied: "basic" };
      }

      // Desenho de som (acentos sonoros mais o abaixamento da trilha): depois de o vídeo
      // estar completamente montado, uma passada de pós-processamento de áudio
      // (com o fluxo de vídeo copiado, sem perda de qualidade), e a verificação de
      // qualidade confere a mixagem final normalmente depois disso. Em caso de falha, o
      // vídeo original é preservado — os efeitos sonoros são um acréscimo e nunca podem
      // derrubar a entrega.
      let sfxApplied: SfxCue[] = [];
      let bgmMixed = false;
      if (options.sfx || options.bgmPath) {
        const shift = coldOpenSec ?? 0;
        const soundDur = clipDuration + shift;
        // Emenda da costura (na linha do tempo de saída): o whoosh entra justamente onde o público inevitavelmente percebe o salto de conteúdo
        const stitchSeamsOut =
          stitched && plan
            ? pieces
                .slice(1)
                .map((p) => mapToOutputTime(p.startSec, plan.segments, clip.startSec))
                .filter((t): t is number => t !== null && t > 0.05)
            : [];
        const cues = options.sfx
          ? planSfxCues({
              durationSec: soundDur,
              seamsSec: [...stitchSeamsOut.map((t) => t + shift), ...(coldOpenSec ? [coldOpenSec] : [])],
              hookAtSec: openingHook ? 0.05 : null,
              peakEventsSec: peakEventsOut.map((t) => t + shift),
            })
          : [];
        if (hasSoundDesignWork({ cues, bgmPath: options.bgmPath })) {
          try {
            await applySoundDesign(
              outPath,
              {
                cues,
                sfxDir: cues.length > 0 ? await ensureSfxDir() : undefined,
                bgmPath: options.bgmPath,
                durationSec: soundDur,
                normalizeLoudness: options.normalizeLoudness,
              },
              signal
            );
            sfxApplied = cues;
            bgmMixed = Boolean(options.bgmPath);
          } catch (e) {
            if (signal?.aborted) throw e;
            console.error(`sound design failed for clip ${clip.id}, kept original:`, e);
          }
        }
      }

      const s = await stat(outPath);

      // Verificação de qualidade do próprio vídeo mais a checagem de palavras proibidas:
      // a decodificação procura tela preta, silêncio longo, desvio de volume e de duração,
      // confere se o ponto de corte caiu no meio de uma palavra e varre título, gancho,
      // texto e legenda em busca das palavras de risco nas plataformas —
      // o comprovante diz "o que a IA fez", e a verificação diz "se foi bem feito e se dá
      // para publicar direto".
      // Uma falha na verificação deixa o campo vazio em silêncio e nunca derruba a
      // exportação (a mesma semântica de reserva da capa e do SRT).
      let qaReport: ClipQaReport | null = null;
      // A duração que o laço de correção da verificação cortou do começo (o instante da capa e a linha do tempo do SRT precisam ser deslocados junto)
      let headTrimSec = 0;
      if (options.qa !== false) {
        const contentHits = lintClipContent({
          title: clip.title,
          hook: [clip.meta?.hook, clip.meta?.teaser].filter(Boolean).join("\n") || undefined,
          publish: clip.publish ?? null,
          captionText: clip.words?.map((w) => w.text).join(""),
        });
        // Conferência do desfecho do gancho: as entidades numéricas que o título, o gancho
        // e a frase de suspense prometem precisam aparecer de verdade na transcrição do
        // clipe — uma lacuna de informação não cumprida é título enganoso, o que derruba a
        // taxa de conclusão e o alcance da conta (pesquisa de 2026)
        const hookPayoffMissing =
          clip.words && clip.words.length > 0
            ? missingHookPayoffs(
                [clip.title, clip.meta?.hook, clip.meta?.teaser].filter(Boolean).join(" "),
                clip.words.map((w) => w.text).join("")
              )
            : null;
        // Avaliação de ritmo: legenda entrando bloco por bloco, movimento automático de
        // câmera e a própria onda sonora já são mudança visual contínua, e basta um deles
        // para a avaliação não acontecer; nos demais casos, o maior intervalo sem mudança
        // visual é calculado pelo plano de edição (emendas do corte seco, emendas da
        // costura, a junção da abertura fria), e passando de 5s a verificação emite aviso
        // (veja PACING_MAX_GAP_SEC em qa.ts)
        const pacingCovered = Boolean(autoZoom) || (wantCaptions && !webRenderFailed) || audioOnly;
        const pacingGapSec = pacingCovered
          ? null
          : maxVisualGapSec(
              [...(plan?.breaks ?? []).map((b) => b + (coldOpenSec ?? 0)), ...(coldOpenSec ? [coldOpenSec] : [])],
              clipDuration + (coldOpenSec ?? 0)
            );
        const qaOptsBase = {
          loudnessNormalized: Boolean(options.normalizeLoudness),
          words: clip.words,
          segments: plan ? plan.segments : [{ startSec: clip.startSec, endSec: clip.endSec }],
          contentHits,
          pacingGapSec,
          hookPayoffMissing,
          subjectCoverage: reframeCoverage,
          signal,
        };
        const expected = clipDuration + (coldOpenSec ?? 0);
        qaReport = await runClipQa(outPath, { ...qaOptsBase, expectedDurationSec: expected }).catch((e) => {
          if (signal?.aborted) throw e;
          return null;
        });
        // Laço de correção da verificação (uma rodada): os avisos que dá para curar
        // sozinho — silêncio e tela preta no começo e no fim (recortando as bordas) e
        // desvio de volume (com uma segunda normalização) — são corrigidos ali mesmo e
        // reconferidos, e o vídeo só é substituído quando os avisos diminuem; correção que
        // falha ou que não melhora nada preserva o vídeo original e registra a tentativa
        // (qa.repair).
        if (qaReport?.status === "warn" && options.qaRepair !== false) {
          const repairPlan = planRepair(qaReport, {
            normalizeLoudness: Boolean(options.normalizeLoudness),
            headTrimmable: coldOpenSec === null,
          });
          if (repairPlan) {
            const repairMedia = await probeMedia(outPath).catch(() => null);
            const outcome = await applyRepair(
              outPath,
              repairPlan,
              qaReport,
              (fixedPath) =>
                runClipQa(fixedPath, { ...qaOptsBase, expectedDurationSec: expected - repairPlan.trimmedSec }),
              signal,
              activeColor,
              repairMedia?.videoStreamIndex,
              repairMedia?.audioStreamIndex
            ).catch((e) => {
              if (signal?.aborted) throw e;
              return null;
            });
            if (outcome) {
              qaReport = outcome.report;
              if (outcome.applied) headTrimSec = repairPlan.trimStartSec;
            }
          }
        }
      }
      // O que passou pela correção com recorte de borda usa a duração medida, e o resto segue com a duração prevista pela esteira (o comportamento não muda)
      const finalDurationSec = qaReport?.repair?.applied ? qaReport.durationSec : clipDuration + (coldOpenSec ?? 0);

      // Cover: a frame just after the hook lands, pulled from the FINISHED
      // clip so captions/title plate are baked in — platform-upload ready.
      const coverPath = outPath.replace(/\.mp4$/, ".jpg");
      // Capa inteligente: o quadro de maior volume dentro do clipe (o pico equivale ao
      // ponto mais alto de emoção); sem corte seco, a trilha de picos é extraída uma vez
      // a mais, e em caso de falha o recuo é o quadro fixo de 0,8s
      if (!clipPeaks && !peakSpanTooLong(clip)) {
        clipPeaks = await extractPeaks(inputPath, clip.startSec, clip.endSec, srcInfo?.audioStreamIndex).catch(() => undefined);
      }
      // A abertura fria desloca a linha do tempo de saída inteira para frente, pela
      // duração do trecho curto, e o instante da capa é deslocado junto;
      // se a correção da verificação cortou o começo, o deslocamento é para trás, preso
      // dentro da duração real depois da correção
      const coverAtRaw =
        pickCoverTime(
          clipPeaks,
          plan ? plan.segments : [{ startSec: clip.startSec, endSec: clip.endSec }],
          clipDuration,
          clip.coverRank ?? 0 // a capa da versão pega o pico de volume seguinte, ficando num quadro diferente do da original
        ) + (coldOpenSec ?? 0) - headTrimSec;
      const clampCoverAt = (at: number): number =>
        Math.min(Math.max(0.2, at), Math.max(0.2, finalDurationSec - 0.2));
      const fallbackCoverAt = clampCoverAt(coverAtRaw);
      const coverCandidates = proposeCoverTimes(
        clipPeaks,
        plan ? plan.segments : [{ startSec: clip.startSec, endSec: clip.endSec }],
        clipDuration
      ).map((candidate) => ({
        ...candidate,
        atSec: clampCoverAt(candidate.atSec + (coldOpenSec ?? 0) - headTrimSec),
      })).filter((candidate, index, all) =>
        all.findIndex((item) => Math.abs(item.atSec - candidate.atSec) < 0.05) === index
      );
      const coverSelection = await selectQualityCoverTime({
        videoPath: outPath,
        candidates: coverCandidates,
        fallbackSec: fallbackCoverAt,
        rank: clip.coverRank ?? 0,
        signal,
      }).catch((error) => {
        if (signal?.aborted) throw error;
        return {
          selectedSec: Number(fallbackCoverAt.toFixed(3)),
          fallbackSec: Number(fallbackCoverAt.toFixed(3)),
          mode: "fallback" as const,
          candidatesEvaluated: 0,
          candidatesRejected: 0,
        };
      });
      const coverAt = coverSelection.selectedSec;
      const coverOk = await execFileAsync(
        resolveFfmpegPath(),
        ["-hide_banner", "-v", "error", "-ss", coverAt.toFixed(2), "-i", outPath, "-frames:v", "1", "-q:v", "2", "-y", coverPath],
        { maxBuffer: 8 * 1024 * 1024 }
      ).then(() => true, () => false);

      // Arquivo de legenda SRT: usa a mesma lista de palavras, as mesmas quebras de
      // linha e a mesma base de tempo da legenda queimada (depois do remapeamento do
      // corte seco), para subir a legenda nativa na plataforma e para refinar depois
      if (options.subtitleFile && wantCaptions) {
        // Depois da abertura fria, as palavras do vídeo principal deslocam para frente; se a correção da verificação cortou o começo, deslocam para trás
        const shift = (coldOpenSec ?? 0) - headTrimSec;
        let relWords = captionWords!.map((w) => ({
          text: w.text,
          startSec: w.startSec - captionShift + shift,
          endSec: w.endSec - captionShift + shift,
        }));
        // O trecho curto de gancho colocado na frente: as palavras são deslocadas para começar em 0 e ficam antes das do vídeo principal (igual à imagem do vídeo final)
        if (coldOpenSec && coldOpenPlan && clip.words) {
          const co = coldOpenPlan;
          const miniRel = clip.words
            .filter((w) => w.startSec >= co.startSec - 1e-3 && w.endSec <= co.endSec + 1e-3)
            .map((w) => ({ text: w.text, startSec: w.startSec - co.startSec, endSec: w.endSec - co.startSec }));
          relWords.unshift(...miniRel);
        }
        // Quando a correção da verificação cortou as bordas: as palavras cortadas do começo e do fim não aparecem mais na imagem, e o SRT as descarta junto
        const repaired = qaReport?.repair?.applied === true;
        if (repaired) {
          relWords = relWords.filter((w) => w.endSec > 0.05 && w.startSec < finalDurationSec - 0.05);
        }
        const relTrans = transLines
          .map((l) => ({
            startSec: l.startSec - captionShift + shift,
            endSec: l.endSec - captionShift + shift,
            text: l.text,
          }))
          .filter((l) => !repaired || (l.endSec > 0.05 && l.startSec < finalDurationSec - 0.05));
        // Os pontos de quebra de linha usam a mesma base das palavras: depois de o vídeo
        // principal ser deslocado, os instantes de quebra obrigatória do corte seco também
        // se deslocam;
        // na emenda da abertura fria a quebra é obrigatória (a linha do gancho não fica
        // junto da primeira frase do vídeo principal)
        const breaks = [...(shift > 0 ? [shift] : []), ...(plan?.breaks ?? []).map((b) => b + shift)];
        const srt = buildSrt(srtLinesFromWords(relWords, breaks, relTrans, { readability: true, endSec: finalDurationSec }));
        if (srt.trim()) {
          await writeFile(outPath.replace(/\.mp4$/, ".srt"), srt, "utf8").catch(() => {});
        }
      }

      // Texto de publicação: um .post.txt de mesmo nome ao lado do mp4 (título, hashtags e descrição, pronto para selecionar tudo e copiar)
      if (clip.publish) {
        await writeFile(outPath.replace(/\.mp4$/, ".post.txt"), postTextFile(clip.publish, Boolean(options.aigcLabel)), "utf8").catch(() => {});
      }

      results.push({
        id: clip.id,
        title: clip.title,
        path: outPath,
        coverPath: coverOk ? coverPath : undefined,
        sizeBytes: s.size,
        durationSec: finalDurationSec,
        colorConverted: Boolean(activeColor),
        colorConversionSkipped: Boolean(hdrDetected && !activeColor),
        colorInspectionFailed,
        audioEnhancement: audioEnhancement?.applied,
        qa: qaReport,
      });
      if (fillerHits.length > 0) {
        removedFillersByClip.set(clip.id, fillerHits.map((h) => h.text.trim()));
      }
      // As versões têm exatamente os mesmos pontos de corte da original, então o EDL registra só a original (repetir três vezes é ruído)
      if (!clip.variantOf) {
        edlClips.push({
          title: clip.title,
          segments: plan ? plan.segments : [{ startSec: clip.startSec, endSec: clip.endSec }],
        });
      }
      // A base do quanto foi cortado: num clipe costurado o cálculo é pela "soma dos
      // trechos" (aqueles dezenas de minutos do intervalo nunca deveriam entrar no vídeo
      // final, e usá-los como denominador produziria um número sem sentido, do tipo
      // "cortou 97%")
      const origDur = stitched ? piecesDurationSec(pieces) : clip.endSec - clip.startSec;
      renderByClip.set(clip.id, {
        captionStyle: wantCaptions ? (webStyle ?? assStyle) : "none",
        captionsBurned: wantCaptions && !webRenderFailed,
        reframe: audioOnly ? "audiogram" : options.vertical ? (trackPlan ? "face-track" : "center-crop") : "none",
        reframeComposition,
        edit: summarizeEdit(origDur, plan),
        fillersRemoved: fillerHits.length,
        retakesRemoved: retakeHits.length,
        stitchedPieces: stitched ? pieces.length : 0,
        loudnessNormalized: Boolean(options.normalizeLoudness),
        denoised: Boolean(options.denoise),
        audioEnhancement,
        visualEnhance,
        color,
        sensitiveMutes: sensitiveMuteRanges?.length ?? 0,
        coldOpenSec,
        flashForward: flashForwardUsed,
        openingHookBurned: Boolean(openingHook),
        translatedLines: transLines.length,
        shotSnap,
        speechActivity,
        preciseAligned,
        alignment,
        subtitleQuality,
        sfxCues: sfxApplied.length,
        bgmMixed,
        renderCache,
        videoMode,
        coverSelection,
      });
      onProgress?.({ current: i + 1, total: totalUnits, clipId: clip.id, stage: "done" });
    }

    signal?.throwIfAborted();
    onProgress?.({ current: clips.length, total: totalUnits, clipId: clips.at(-1)?.id ?? 0, stage: "finalizing" });

    // Compilado dos melhores momentos: como os parâmetros de codificação do lote são
    // iguais, a emenda por cópia direta do fluxo termina em segundos e sem perda de
    // qualidade;
    // a convenção do compilado é corte seco, sem transição; em caso de falha é pulado em
    // silêncio, e nunca derruba os clipes já exportados
    let compilationFile: string | null = null;
    // O compilado leva apenas as originais: uma versão é outra embalagem do mesmo conteúdo, e colocá-la no compilado seria tocar a mesma coisa três vezes
    const compResults = results.filter((r) => !clips.find((c) => c.id === r.id)?.variantOf);
    if (options.compilation && compResults.length > 1) {
      const compPath = join(outDir, "00-compilado.mp4");
      const totalSec = compResults.reduce((a, r) => a + r.durationSec, 0);
      const ok = await concatClips(compResults.map((r) => r.path), compPath, signal)
        .then(() => true)
        .catch((e) => {
          // Um cancelamento da pessoa precisa ser propagado (a mesma semântica dos clipes individuais), e as outras falhas ficam em silêncio
          if (signal?.aborted) throw e;
          return false;
        });
      if (ok) {
        const cs = await stat(compPath).catch(() => null);
        compilationFile = basename(compPath);
        // Marcações de tempo dos capítulos: dá para colar direto nos capítulos do YouTube e na descrição do Bilibili, e no Bilibili ainda serve para dividir em partes
        await writeFile(
          compPath.replace(/\.mp4$/, ".chapters.txt"),
          buildChapters(compResults.map((r) => ({ title: r.title, durationSec: r.durationSec }))),
          "utf8"
        ).catch(() => {});
        results.push({
          id: 0,
          title: "Compilado dos melhores momentos",
          path: compPath,
          sizeBytes: cs?.size ?? 0,
          durationSec: totalSec,
          colorConverted: Boolean(activeColor),
          colorConversionSkipped: Boolean(hdrDetected && !activeColor),
          colorInspectionFailed,
        });
      }
    }

    // Pacote de série por tema: leva apenas as originais, para que várias versões de um
    // mesmo clipe não sejam confundidas com episódios em sequência; a ordenação é pelo
    // tempo na origem.
    // Falha no agrupamento ou nos arquivos é fail-open, e não afeta os vídeos já
    // concluídos.
    let seriesSummary: SeriesPackSummary | null = null;
    if (options.seriesPack && compResults.length > 1) {
      seriesSummary = await buildSeriesPack(
        outDir,
        compResults.map((result) => {
          const spec = clips.find((clip) => clip.id === result.id);
          return {
            file: result.path,
            title: result.title,
            keywords: spec?.keywords,
            sourceStartSec: spec?.startSec,
          };
        })
      ).catch(() => null);
    }

    // EDL da linha do tempo: os pontos de corte (inclusive os cortes internos do corte seco) vão para o programa de edição, revinculando a origem para o acabamento; em caso de falha, a exportação não é derrubada
    if (options.timeline && edlClips.length > 0) {
      const fps = srcInfo && srcInfo.fps > 0 ? srcInfo.fps : 30;
      const edl = buildEdl({
        title: `${basename(inputPath)} - HotClip`,
        sourceName: basename(inputPath),
        fps,
        clips: edlClips,
      });
      await writeFile(join(outDir, "timeline.edl"), edl, "utf8").catch(() => {});
    }

    // Rascunho do JianYing: uma pasta de rascunho por clipe (com cada trecho do corte
    // seco), e basta copiar a pasta inteira para o diretório de rascunhos do JianYing
    // para abrir e refinar — é a versão do EDL para o editor mais popular do país. Uma
    // origem só de áudio não tem trilha de imagem, então o rascunho não faz sentido e é
    // pulado; a falha de um clipe fica em silêncio e nunca derruba a exportação.
    if (options.jianyingDraft && edlClips.length > 0 && srcInfo && srcInfo.hasVideo) {
      const draftsRoot = join(outDir, "rascunhos-jianying");
      const fps = srcInfo.fps > 0 ? Math.round(srcInfo.fps) : 30;
      for (let d = 0; d < edlClips.length; d++) {
        const ec = edlClips[d];
        try {
          const folder = join(draftsRoot, `${String(d + 1).padStart(2, "0")}-${sanitizeFilename(ec.title)}`);
          await mkdir(folder, { recursive: true });
          const content = buildDraftContent({
            sourcePath: inputPath,
            sourceName: basename(inputPath),
            sourceDurationSec: srcInfo.durationSec,
            width: srcInfo.width,
            height: srcInfo.height,
            fps,
            clip: ec,
          });
          await writeFile(join(folder, "draft_content.json"), JSON.stringify(content, null, 4), "utf8");
          await writeFile(join(folder, "draft_meta_info.json"), JSON.stringify(buildDraftMetaInfo(), null, 4), "utf8");
        } catch {
          /* fail-open: o rascunho é um produto adicional */
        }
      }
    }

    // Pacote por plataforma: uma pasta por plataforma, com o vídeo em link físico, a
    // capa recortada na proporção daquela plataforma e o texto adaptado aos limites dela,
    // pronto para pegar e publicar. Só os clipes em si são empacotados (o compilado é
    // outra história); é fail-open.
    let packSummaries: PackSummary[] = [];
    if (options.publishPack && options.publishPack.length > 0 && results.length > 0) {
      const packInputs = results
        .filter((r) => clips.some((c) => c.id === r.id))
        .map((r) => {
          const spec = clips.find((c) => c.id === r.id)!;
          return { file: r.path, coverFile: r.coverPath, title: r.title, publish: spec.publish };
        });
      packSummaries = await buildPublishPacks(outDir, packInputs, options.publishPack, async (src, dest, spec) => {
        // Adaptação da capa: recortada na proporção da plataforma (deslocada um terço para cima, preservando os rostos) e depois redimensionada para os pixels recomendados
        return execFileAsync(
          resolveFfmpegPath(),
          ["-hide_banner", "-v", "error", "-i", src, "-vf", coverFilter(spec), "-frames:v", "1", "-q:v", "2", "-y", dest],
          { maxBuffer: 8 * 1024 * 1024 }
        ).then(() => true, () => false);
      }, Boolean(options.aigcLabel)).catch(() => []);
    }

    // Pacote de evidências (opcional, v0.14): cada clipe guarda, por cópia direta do
    // fluxo, os 3 minutos da origem antes e depois — desde julho de 2026 a revisão de
    // autorização exige a guarda de pelo menos 3 minutos de gravação original antes e
    // depois do trecho. A cópia direta não recodifica e termina em segundos; a falha de
    // um clipe é pulada e nunca derruba a exportação.
    if (options.evidencePack && results.length > 0) {
      const evDir = join(outDir, "evidencias");
      await mkdir(evDir, { recursive: true }).catch(() => {});
      for (const r of results) {
        const range = snappedRange.get(r.id);
        const spec = clips.find((c) => c.id === r.id);
        const start = range?.startSec ?? spec?.startSec;
        const end = range?.endSec ?? spec?.endSec;
        if (start === undefined || end === undefined) continue;
        const dest = join(evDir, basename(r.path).replace(/\.mp4$/, "-3min-antes-e-depois.mp4"));
        await execFileAsync(
          resolveFfmpegPath(),
          [
            "-hide_banner", "-v", "error",
            "-ss", Math.max(0, start - 180).toFixed(2),
            "-to", (end + 180).toFixed(2),
            "-i", inputPath,
            "-c", "copy", "-y", dest,
          ],
          { maxBuffer: 8 * 1024 * 1024 }
        ).catch(() => {});
      }
    }

    // Capa por IA em dois níveis (v0.14): gerada só para as originais (a diferenciação
    // da capa das versões já tem o mecanismo dos picos de volume, e gerar versão por
    // versão dobraria o custo); o compilado (id 0) e a cópia horizontal (id negativo) não
    // geram. As imagens saem em paralelo, e a falha de uma fica em silêncio — a capa é um
    // bônus e nunca derruba a exportação.
    const aiCoverByClip = new Map<number, string>();
    if (options.aiCover && results.length > 0) {
      const ac = options.aiCover;
      await Promise.allSettled(
        results
          .filter((r) => r.id > 0 && !clips.find((c) => c.id === r.id)?.variantOf)
          .map(async (r) => {
            const spec = clips.find((c) => c.id === r.id);
            const outPath = r.path.replace(/\.mp4$/, ".capa-ia.jpg");
            const ok = await generateAiCover({
              tier: ac.tier,
              title: r.title,
              hook: spec?.meta?.hook,
              visualContext: spec?.meta?.visualEvidence?.scene,
              pt: ac.pt !== false,
              baseUrl: ac.baseUrl,
              apiKey: ac.apiKey,
              outPath,
              signal,
            }).catch((e) => {
              console.error(`ai cover failed for clip ${r.id}:`, e);
              return false;
            });
            if (ok) aiCoverByClip.set(r.id, outPath);
          })
      );
      if (signal?.aborted) throw new Error("export cancelled");
    }

    // clips.json: machine-readable evidence chain for CMS / matrix pipelines.
    const metadata = {
      source: inputPath,
      exportedAt: new Date().toISOString(),
      options: {
        vertical: Boolean(options.vertical),
        captionStyle: options.captionStyle ?? "none",
        jumpCut: Boolean(options.jumpCut),
        cleanFillers: Boolean(options.cleanFillers),
        cutRetakes: Boolean(options.cutRetakes),
        autoZoom: Boolean(options.autoZoom),
        sfx: Boolean(options.sfx),
        bgm: Boolean(options.bgmPath),
        trimUi: Boolean(options.trimUi),
        titleCard: Boolean(options.titleCard),
        openingHook: Boolean(options.openingHook),
        normalizeLoudness: Boolean(options.normalizeLoudness),
        denoise: Boolean(options.denoise),
        denoiseMode: options.denoise ? options.denoiseMode ?? "basic" : null,
        autoEnhance: Boolean(options.autoEnhance),
        coldOpen: Boolean(options.coldOpen),
        flashForward: Boolean(options.flashForward),
        compilation: compilationFile,
        snapToShots: Boolean(options.snapToShots),
        preciseAlign: Boolean(options.alignWords),
        // Comprovante da legenda bilíngue: o idioma alvo; quantas linhas cada clipe de fato queimou está em clips[].render.translatedLines
        translateLang: options.translateLang ?? null,
        subtitleFile: Boolean(options.subtitleFile),
        timeline: Boolean(options.timeline),
        aigcLabel: Boolean(options.aigcLabel),
        qa: options.qa !== false,
        qaRepair: options.qa !== false && options.qaRepair !== false,
        // Comprovante da predefinição da marca: qual cor, qual nível e qual marca d'água foram usados, para uma esteira de várias contas conferir a consistência da marca
        brand: options.brand
          ? {
              highlightColor: options.brand.highlightColor ?? null,
              fontScale: options.brand.fontScale ?? 1,
              captionPosition: options.brand.captionPosition ?? "standard",
              watermark: options.brand.watermark
                ? { corner: options.brand.watermark.corner, opacity: options.brand.watermark.opacity }
                : null,
            }
          : null,
        // Comprovante do pacote de publicação: para quais plataformas foi empacotado e quantos títulos foram cortados em cada uma
        publishPack:
          packSummaries.length > 0
            ? packSummaries.map((p) => ({ platform: p.platform, name: p.name, clipCount: p.clipCount, truncatedTitles: p.truncatedTitles }))
            : null,
        seriesPack: seriesSummary
          ? { seriesCount: seriesSummary.seriesCount, clipCount: seriesSummary.clipCount, topics: seriesSummary.series.map((item) => item.topic) }
          : null,
      },
      clips: results.map((r) => {
        const spec = clips.find((c) => c.id === r.id);
        const range = snappedRange.get(r.id);
        // Nota de transformação (v0.14): calculada pelos itens de transformação que de fato aconteceram; nota baixa significa perto de "um corte e publica"
        const render = renderByClip.get(r.id);
        const transform: TransformScore | null = render ? transformScore(transformInputsFromRender(render, options)) : null;
        return {
          file: basename(r.path),
          cover: r.coverPath ? basename(r.coverPath) : null,
          // Capa gerada por IA (os dois níveis da v0.14): existe junto da capa tirada de um quadro, e a pessoa escolhe qual usar
          aiCover: aiCoverByClip.has(r.id) ? basename(aiCoverByClip.get(r.id)!) : null,
          title: r.title,
          durationSec: Number(r.durationSec.toFixed(3)),
          colorConverted: Boolean(r.colorConverted),
          colorConversionSkipped: Boolean(r.colorConversionSkipped),
          colorInspectionFailed: Boolean(r.colorInspectionFailed),
          sourceStartSec: range?.startSec ?? spec?.startSec ?? null,
          sourceEndSec: range?.endSec ?? spec?.endSec ?? null,
          // A lista de trechos da costura (null num clipe de trecho único) — permite a uma esteira de várias contas conferir de quais pontos o vídeo foi montado
          sourcePieces:
            piecesByClip.get(r.id)?.map((p) => ({
              startSec: Number(p.startSec.toFixed(3)),
              endSec: Number(p.endSec.toFixed(3)),
            })) ?? null,
          keywords: spec?.keywords ?? [],
          // Várias versões: a versão registra de qual original ela é e que número tem (na original os dois campos são null)
          variantOf: spec?.variantOf ?? null,
          variant: spec?.variant ?? null,
          removedFillers: removedFillersByClip.get(r.id) ?? [],
          render: render ?? null,
          // Nota de transformação (0-100) e o nível: warn significa risco de ser julgado reupload (pelo critério da impressão digital visual do Reels ou da entropia de informação do Douyin)
          transform: transform ? { score: transform.score, level: transform.level } : null,
          // Relatório da verificação de qualidade: pass ou warn mais a lista de avisos (tela preta, silêncio, volume, duração, palavra partida)
          qa: r.qa ?? null,
          // Texto de publicação (título, hashtags, descrição), cujo mesmo conteúdo também fica no .post.txt ao lado do mp4
          publish: spec?.publish ?? null,
          ...(spec?.meta ?? {}),
        };
      }),
    };
    await writeFile(join(outDir, "clips.json"), JSON.stringify(metadata, null, 2), "utf8").catch(() => {});

    // Registro de distribuição (v0.14): um registro por clipe ligando "vídeo final ↔
    // intervalo da origem ↔ data da exportação" mais as colunas do lado da publicação em
    // branco, atendendo à exigência de "um registro de distribuição por vídeo" da revisão
    // de autorização de julho de 2026. Custa zero e fica sempre ligado.
    const ledgerRows: LedgerRow[] = results
      .filter((r) => r.id > 0) // o compilado (id 0) e a cópia horizontal (id negativo) não entram no registro
      .map((r) => {
        const spec = clips.find((c) => c.id === r.id);
        const range = snappedRange.get(r.id);
        const render = renderByClip.get(r.id);
        return {
          file: basename(r.path),
          title: r.title,
          durationSec: r.durationSec,
          source: inputPath,
          sourceStartSec: range?.startSec ?? spec?.startSec ?? null,
          sourceEndSec: range?.endSec ?? spec?.endSec ?? null,
          pieces: piecesByClip.get(r.id)?.length ?? 1,
          exportedAt: metadata.exportedAt,
          aigcLabel: Boolean(options.aigcLabel),
          transformScore: render ? transformScore(transformInputsFromRender(render, options)).score : null,
        };
      });
    if (ledgerRows.length > 0) {
      await writeFile(join(outDir, "registro-de-distribuicao.csv"), buildLedgerCsv(ledgerRows), "utf8").catch(() => {});
    }

    // Duas proporções: a esteira inteira roda de novo, recursivamente, com
    // vertical:false, para a subpasta `horizontal/` — assim o layout da legenda
    // horizontal, a capa e o comprovante saem todos corretos sozinhos; a falha é
    // silenciosa e nunca derruba a versão vertical já pronta.
    // Os eventos de progresso continuam os do laço principal (current deslocado em N, e
    // total seguindo os totalUnits já dobrados).
    if (alsoLandscape) {
      const subResults = await exportClips(
        inputPath,
        clips,
        join(outDir, "horizontal"),
        // A cartela de título e a frase de suspense em letras grandes são uma forma de
        // vídeo curto vertical, então a versão horizontal dispensa (o título vai para o
        // campo de título da plataforma);
        // a legenda segue o layout horizontal (menor, no rodapé), e a capa, o comprovante e
        // o SRT formam um conjunto próprio na subpasta
        // o publishPack é montado uma única vez, na pasta principal (a versão horizontal é
        // indicada na observação do manifesto do pacote)
        { ...options, vertical: false, alsoLandscape: false, faceTrack: false, compilation: false, timeline: false, titleCard: false, openingHook: false, publishPack: undefined, seriesPack: false },
        onProgress
          ? (p) => onProgress({ ...p, current: p.current + clips.length, total: totalUnits })
          : undefined,
        signal
      ).catch((e) => {
        if (signal?.aborted) throw e;
        return [] as ExportedClip[];
      });
      // A versão horizontal entra no resultado: o id fica negativo para não colidir com a versão vertical nem com o compilado (id 0)
      for (const r of subResults) {
        results.push({ ...r, id: -Math.abs(r.id) - 1, title: `${r.title} (horizontal)` });
      }
    }

    signal?.throwIfAborted();
    return results;
  } finally {
    if (assDir) await rm(assDir, { recursive: true, force: true }).catch(() => {});
    if (sfxDir) await rm(sfxDir, { recursive: true, force: true }).catch(() => {});
  }
}
