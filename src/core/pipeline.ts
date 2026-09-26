import { QwenLocalEngine } from "./transcribe/qwen-local";
import { ParaformerEngine } from "./transcribe/paraformer";
import { FireRedEngine } from "./transcribe/firered";
import { ParakeetEngine } from "./transcribe/parakeet";
import { WhisperLargeV3Engine, WhisperTurboEngine } from "./transcribe/whisper";
import type { SpeechRunOptions } from "../shared/api-types";
/**
 * A esteira comum do corte automático (sem depender de interface): transcrição (com cache) → coleta de
 * sinais → o LLM acha os estouros → exportação dos trechos recomendados. O servidor MCP e o vigia de
 * gravações (a pasta vigiada) usam este mesmo caminho, e o resultado é igual ao do «tudo automático» do desktop.
 */
import { join, dirname, basename, extname } from "path";
import { stat } from "fs/promises";
import type { GlossaryEntry, LlmConfig, Transcript, HighlightCandidate } from "../shared/api-types";
import { applyGlossaryToTranscript } from "../shared/glossary";
import { SenseVoiceEngine } from "./transcribe/sensevoice";
import { importSubtitleFile } from "./subtitle-import";
import { readTranscriptCache, writeTranscriptCache } from "./transcribe/cache";
import { detectHighlights } from "./highlight/detect";
import { collectSignalsEvidence, detectShotBoundariesEvidence } from "./media-evidence";
import { buildReferenceProfile, type ReferenceProfile } from "./reference";
import type { ReviewRecord } from "./review-memory";
import type { PerformanceEntry } from "./performance-memory";
import { collectEmotionSignal } from "./emotion";
import { collectDanmakuSignal } from "./danmaku";
import { collectVoiceEmotionSignal } from "./voice-emotion";
import { exportClips, sanitizeFilename, type ExportedClip } from "./export";
import { sliceWords } from "./subtitle";
import { wordsInPieces } from "../shared/pieces";
import { probeMedia } from "./probe";
import { planColorRender } from "./color";
import type { AnalysisVideoOptions } from "./analysis-video";

export interface AutoClipConfig {
  modelsRoot: string;
  cacheDir: string;
  /** Uma transcrição explícita em UTF-8 SRT/WebVTT deste material; dispensa o ASR e o cache. */
  subtitlePath?: string;
  asr?: SpeechRunOptions & { engineId?: string };
  /** O cache limitado e reaproveitável da renderização base; sem ele, desligado. */
  renderCacheDir?: string;
  /** As evidências reaproveitáveis e limitadas da análise do material; sem elas, desligado. */
  evidenceCacheDir?: string;
  llm: LlmConfig;
  /** A pasta de saída; por padrão `<nome>-hotclip/` ao lado do vídeo de origem. */
  outDir?: string;
  /** A pasta de fontes da legenda (para a queima ficar igual em qualquer máquina). */
  fontsDir?: string;
  /** O vocabulário de termos (aplicado sozinho depois da transcrição; a legenda, a busca de estouros e o texto usam todos a versão corrigida). */
  glossary?: GlossaryEntry[];
  maxClips?: number;
  vertical?: boolean;
  captions?: boolean;
  /** Correção de imagem local por signalstats, ligada por escolha; material neutro não é tocado. */
  autoEnhance?: boolean;
  /** Limpeza de áudio opcional para exportações sem ninguém olhando; ausente significa sem mudança. */
  denoiseMode?: "basic" | "smart";
  /** O perfil do vídeo de referência (o que analyzeReferenceVideo produz); a escolha dos trechos se aproxima do ritmo dele. */
  reference?: ReferenceProfile;
  /** A memória de revisão desta máquina (os exemplos de aceite e veto acumulados na mesa de revisão do desktop); a escolha dos trechos se aproxima do gosto da pessoa. */
  reviewMemory?: ReviewRecord[];
  /** A memória de desempenho real das publicações (importada de CSV/JSON); a escolha dos trechos se aproxima do que o público já validou. */
  performanceMemory?: PerformanceEntry[];
  onStage?: (stage: "transcribing" | "detecting" | "exporting") => void;
  signal?: AbortSignal;
}

export interface AutoClipResult {
  outDir: string;
  transcript: Transcript;
  candidates: HighlightCandidate[];
  /** Os trechos que a revisão da IA recomendou publicar e que foram exportados com sucesso. */
  exported: ExportedClip[];
}

/**
 * Transcrição local (SenseVoice, com cache; o modelo é baixado sozinho na primeira vez). O cache guarda
 * sempre o resultado cru do ASR, e o vocabulário é aplicado na leitura — depois de atualizar o
 * vocabulário, basta reproduzir o mesmo material para a troca valer, sem rodar o ASR de novo.
 */
export async function transcribeCached(
  videoPath: string,
  modelsRoot: string,
  cacheDir: string,
  glossary?: GlossaryEntry[],
  signal?: AbortSignal,
  subtitlePath?: string,
  asr: SpeechRunOptions & { engineId?: string } = {}
): Promise<Transcript> {
  signal?.throwIfAborted();
  // O texto dado pela pessoa manda, inclusive quando algo falha. Nunca se troca esse texto pelo do ASR em
  // silêncio, nem se roda a correção de vocabulário do ASR sobre uma legenda que já foi revisada.
  if (subtitlePath !== undefined) return importSubtitleFile(videoPath, subtitlePath, signal);
  const s = await stat(videoPath).catch(() => null);
  if (!s || !s.isFile()) throw new Error(`o arquivo não existe ou não pode ser lido: ${videoPath}`);
  const fileStat = { size: s.size, mtimeMs: s.mtimeMs };
  const applied = (t: Transcript): Transcript => applyGlossaryToTranscript(t, glossary ?? []).transcript;
  const engineId = asr.engineId ?? "sensevoice";
  if (!["sensevoice", "paraformer", "fireredasr", "parakeet", "whisper-turbo", "whisper-large-v3", "qwen3"].includes(engineId)) throw new Error("Unknown local ASR engine");
  const cached = !asr.restart && engineId !== "qwen3" ? await readTranscriptCache(cacheDir, videoPath, fileStat, engineId) : undefined;
  if (cached) return applied(cached);
  const engine = engineId === "qwen3" ? new QwenLocalEngine(asr.localServiceUrl)
    : engineId === "paraformer" ? new ParaformerEngine(modelsRoot)
    : engineId === "fireredasr" ? new FireRedEngine(modelsRoot)
    : engineId === "parakeet" ? new ParakeetEngine(modelsRoot)
    : engineId === "whisper-turbo" ? new WhisperTurboEngine(modelsRoot)
    : engineId === "whisper-large-v3" ? new WhisperLargeV3Engine(modelsRoot)
    : new SenseVoiceEngine(modelsRoot);
  const t = await engine.transcribe(videoPath, { ...asr, signal, cacheDir });
  if (engineId !== "qwen3") await writeTranscriptCache(cacheDir, videoPath, fileStat, engineId, t).catch(() => {});
  return applied(t);
}

/**
 * Analisa o vídeo de referência → perfil de estilo: transcrição local (com cache) + detecção de cortes
 * de câmera no vídeo inteiro.
 * Uma falha na transcrição é lançada para cima (é entrada dada explicitamente pela pessoa, e descartar em
 * silêncio é armadilha); uma falha na detecção de cortes só deixa aquela dimensão em null.
 */
export async function analyzeReferenceVideo(
  refPath: string,
  cfg: Pick<AutoClipConfig, "modelsRoot" | "cacheDir" | "evidenceCacheDir" | "glossary" | "signal">
): Promise<ReferenceProfile> {
  const transcript = await transcribeCached(refPath, cfg.modelsRoot, cfg.cacheDir, cfg.glossary, cfg.signal);
  const durationSec =
    transcript.durationSec > 0
      ? transcript.durationSec
      : transcript.segments[transcript.segments.length - 1]?.endSec ?? 0;
  const media = await probeMedia(refPath).catch(() => null);
  const analysis: AnalysisVideoOptions = media?.hasVideo
    ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) }
    : {};
  const boundaries = await detectShotBoundariesEvidence({
    videoPath: refPath,
    startSec: 0,
    endSec: durationSec,
    modelsRoot: cfg.modelsRoot,
    evidenceDir: cfg.evidenceCacheDir,
    signal: cfg.signal,
    analysis,
  }).catch(() => null);
  return buildReferenceProfile(transcript, boundaries);
}

/** Acha os estouros (com a mesma cadeia de evidências do desktop: volume/cortes + pico de expressão, tudo falhando em aberto). */
export async function detectForPipeline(
  videoPath: string,
  transcript: Transcript,
  cfg: Pick<AutoClipConfig, "modelsRoot" | "evidenceCacheDir" | "llm" | "maxClips" | "reference" | "reviewMemory" | "performanceMemory" | "signal">
): Promise<HighlightCandidate[]> {
  if (transcript.segments.length === 0) throw new Error("a transcrição saiu vazia (o material pode não ter voz)");
  const media = await probeMedia(videoPath).catch(() => null);
  const analysis: AnalysisVideoOptions = media?.hasVideo
    ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) }
    : {};
  const signals = await collectSignalsEvidence({
    videoPath,
    evidenceDir: cfg.evidenceCacheDir,
    signal: cfg.signal,
    analysis,
  }).catch((error) => {
    if (cfg.signal?.aborted) throw error;
    return undefined;
  });
  // Calor do chat (sem configuração): o .xml de mesmo nome que o gravador deixa ao lado da gravação é
  // descoberto sozinho — é a evidência principal no cenário do vigia de gravações. Como só lê um arquivo,
  // vem antes da coleta cara: o pico do chat (o voto que o público dá a cada segundo) precisa guiar o
  // orçamento de amostragem da expressão e da emoção da voz, já que a risada e a expressão devem ser
  // procuradas justamente onde o público foi à loucura
  const danmaku = await collectDanmakuSignal(videoPath, transcript.durationSec);
  const guided = danmaku
    ? { loudPeaks: [], cutDense: [], ...signals, danmakuPeaks: danmaku.danmakuPeaks }
    : signals;
  const emotion = await collectEmotionSignal({
    videoPath,
    durationSec: transcript.durationSec,
    modelsRoot: cfg.modelsRoot,
    signals: guided,
    analysis,
  }).catch(() => null);
  // Emoção da voz / risada e palmas (sem configuração, reaproveitando os pesos do SenseVoice já instalado): a metade da evidência que a transcrição não mostra
  const voice = await collectVoiceEmotionSignal({
    videoPath,
    durationSec: transcript.durationSec,
    modelsRoot: cfg.modelsRoot,
    signals: guided,
  }).catch(() => null);
  const merged =
    emotion || voice
      ? {
          loudPeaks: [],
          cutDense: [],
          ...guided,
          ...(emotion ? { emotionPeaks: emotion.emotionPeaks } : {}),
          ...(voice
            ? { voiceEmotionPeaks: voice.voiceEmotionPeaks, audioEventPeaks: voice.audioEventPeaks }
            : {}),
        }
      : guided;
  const outcome = await detectHighlights(
    transcript, cfg.llm, cfg.signal, merged,
    undefined, undefined, undefined, cfg.reference, cfg.reviewMemory,
    undefined, undefined, cfg.performanceMemory
  );
  const max = Math.max(1, Math.min(12, Math.round(cfg.maxClips ?? 6)));
  return outcome.candidates.slice(0, max);
}

/** Tudo de ponta a ponta: transcrição → busca dos estouros → exportação dos recomendados (vertical, legenda, corte seco e volume vêm ligados por padrão). */
export async function autoClip(videoPath: string, cfg: AutoClipConfig): Promise<AutoClipResult> {
  cfg.signal?.throwIfAborted();
  cfg.onStage?.("transcribing");
  const transcript = await transcribeCached(videoPath, cfg.modelsRoot, cfg.cacheDir, cfg.glossary, cfg.signal, cfg.subtitlePath, cfg.asr);
  cfg.signal?.throwIfAborted();
  cfg.onStage?.("detecting");
  const candidates = await detectForPipeline(videoPath, transcript, cfg);
  cfg.signal?.throwIfAborted();
  // Sem ninguém olhando, só a faixa «vale publicar» sai: o que o portão de qualidade mandou para revisão humana ou descartou não foi visto por ninguém e não pode ser publicado sozinho
  // (gate ausente = o candidato de sinal / a revisão não rodaram, e aí vale a semântica antiga de recommended)
  const publishable = candidates.filter((c) => c.recommended && (c.gate === undefined || c.gate === "publish"));
  const outDir =
    cfg.outDir ?? join(dirname(videoPath), `${sanitizeFilename(basename(videoPath, extname(videoPath)), "video")}-hotclip`);
  if (publishable.length === 0) return { outDir, transcript, candidates, exported: [] };
  cfg.onStage?.("exporting");
  const vertical = cfg.vertical !== false;
  const captions = cfg.captions !== false;
  const exported = await exportClips(
    videoPath,
    publishable.map((c) => ({
      id: c.id,
      title: c.title,
      startSec: c.startSec,
      endSec: c.endSec,
      // Colagem de vários pedaços: a lista de pedaços segue junto, e do vocabulário só entram os pedaços que de fato foram cortados para dentro
      pieces: c.pieces && c.pieces.length > 1 ? c.pieces : undefined,
      words: captions
        ? c.pieces && c.pieces.length > 1
          ? wordsInPieces(sliceWords(transcript, c.startSec, c.endSec), c.pieces)
          : sliceWords(transcript, c.startSec, c.endSec)
        : undefined,
      keywords: c.keywords,
      meta: {
        hook: c.hook,
        score: c.score,
        reason: c.reason,
        text: c.text,
        recommended: c.recommended,
        reviewNote: c.reviewNote,
        visualEvidence: c.visualEvidence,
      },
    })),
    outDir,
    {
      vertical,
      captionStyle: captions ? "keyword" : undefined,
      jumpCut: true,
      cleanFillers: true,
      titleCard: true,
      normalizeLoudness: true,
      autoEnhance: Boolean(cfg.autoEnhance),
      denoise: Boolean(cfg.denoiseMode),
      denoiseMode: cfg.denoiseMode,
      faceTrack: vertical,
      snapToShots: true,
      modelsRoot: cfg.modelsRoot,
      fontsDir: cfg.fontsDir,
      renderCacheDir: cfg.renderCacheDir,
      evidenceCacheDir: cfg.evidenceCacheDir,
    },
    undefined,
    cfg.signal
  );
  return { outDir, transcript, candidates, exported };
}
