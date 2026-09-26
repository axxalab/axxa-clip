import { runSpeechWorker } from "./run-speech-worker";
import { qwenHealth } from "../core/transcribe/qwen-local";
import type { SpeechRunOptions, AlignmentRequest, AlignmentPreview } from "../shared/api-types";
/**
 * Processo principal do Electron: ciclo de vida da janela + superfície de IPC.
 * Todo o trabalho pesado da esteira vive em src/core e é chamado daqui,
 * nunca direto da camada de renderização.
 */
import { app, shell, BrowserWindow, ipcMain, dialog, protocol } from "electron";
import { join } from "path";
import { basename, extname } from "path";
import { stat, readFile, writeFile, readdir } from "fs/promises";
import { createReadStream } from "fs";
import { randomUUID } from "crypto";
import { extractPeaks } from "@core/audio-peaks";
import { createClipAligner } from "@core/align";
import { resolveByteRange } from "@core/media-range";
import { sanitizeBrand } from "@core/brand";
import { probeMedia } from "@core/probe";
import { planColorRender } from "@core/color";
import { analysisVideoIdentity, type AnalysisVideoOptions } from "@core/analysis-video";
import { SenseVoiceEngine } from "@core/transcribe/sensevoice";
import { ParaformerEngine } from "@core/transcribe/paraformer";
import { FireRedEngine } from "@core/transcribe/firered";
import { ElevenLabsEngine } from "@core/transcribe/elevenlabs";
import { readTranscriptCache, writeTranscriptCache } from "@core/transcribe/cache";
import { importSubtitleText } from "@core/subtitle-import";
import { validateSubtitleInput } from "../shared/subtitle-import";
import { isModelInstalled, ensureModel, SENSEVOICE_MODEL, PARAFORMER_MODEL, FIRERED_MODEL, SEGMENTATION_MODEL, SPEAKER_EMBEDDING_MODEL } from "@core/models";
import { runDiarization, labelTranscript } from "@core/diarize";
import { ASR_CATALOG } from "../shared/asr-catalog";
import { detectHighlights, chatComplete } from "@core/highlight/detect";
import { listModels } from "@core/llm-models";
import { reviewCandidatesVision } from "@core/highlight/review-vision";
import { composeContactSheetJpeg } from "@core/contact-sheet";
import { collectEmotionSignal } from "@core/emotion";
import { collectClipSegments, translateSegments, clipTranslationLines } from "@core/translate";
import { generatePublishCopies } from "@core/publish";
import { generateVariantPlans, expandClipSpecs, VARIANT_TOTAL_MAX } from "@core/variants";
import { generateAiBgm } from "@core/bgm-ai";
import { validPlatformIds } from "../shared/platform-specs";
import { FolderWatcher, isVideoFile, isSeen, type SeenMap, type WatchedFile } from "@core/watch";
import { startWebhookServer, type WebhookServerHandle } from "@core/webhook";
import { collectDanmakuSignal, readDanmakuItems, danmakuHeatCurve } from "@core/danmaku";
import { loudnessCurve, motionCurve } from "@core/signals";
import { extractFilmstrip } from "@core/filmstrip";
import { collectVoiceEmotionSignal } from "@core/voice-emotion";
import { checkForUpdate } from "@core/update-check";
import { clipOutDir } from "@core/appenv";
import { defaultModelsRoot, readAppSettings, resolveModelsRoot, writeAppSettings } from "@core/app-settings";
import { inspectModels, moveModelsDir } from "@core/models-inventory";
import { loadGlossary, saveGlossary } from "@core/glossary-store";
import { loadReviewMemory, recordReview, type ReviewedCandidate } from "@core/review-memory";
import {
  clearPerformanceMemory,
  importPerformanceFile,
  loadPerformanceMemory,
  summarizePerformance,
} from "@core/performance-memory";
import { buildPerformanceTemplate, clearPublishMetrics, loadPublishLedger, publishExperimentId, registerPublishItems } from "@core/publish-ledger";
import { summarizeExperiments } from "@core/experiments";
import { importMediaUrl as downloadMediaUrl } from "@core/url-import";
import { clearSessionCheckpoint, readSessionCheckpoint, saveSessionCheckpoint } from "@core/session-checkpoint";
import {
  closeProject,
  createProject,
  deleteProject,
  openProject,
  projectWorkspace,
  relinkProject,
  renameProject,
  saveProject,
} from "@core/project-workspace";
import { loadAutomationTasks, normalizeAutomationTasks, saveAutomationTasks } from "@core/automation-history";
import { sanitizeSensitiveWords } from "@core/sensitive-words";
import { runDoctor } from "@core/doctor";
import { clearRenderCache } from "@core/render-cache";
import { clearEvidenceIndex, evidenceSourceId, fingerprintEvidenceSource } from "@core/evidence-index";
import { collectSignalsEvidence, collectVisionEvidence } from "@core/media-evidence";
import { applyGlossaryToTranscript } from "../shared/glossary";
import { tagTranscribeError } from "../shared/transcribe-errors";
import { autoClip, analyzeReferenceVideo } from "@core/pipeline";
import type { ReferenceProfile } from "@core/reference";
import { exportClips, sanitizeFilename } from "@core/export";
import { ExportTaskRunner, optionalExportStep } from "@core/export-task";
import { exportNeedsTranscript } from "../shared/export-transcript";
import { sliceWords } from "@core/subtitle";
import { wordsInPieces } from "../shared/pieces";
import { snapContextAround } from "@core/shots";
import { renderCaptionOverlay } from "./overlay-renderer";
import { QUALITY_CRF } from "../shared/api-types";
import type { Transcript, TranscriptWord, LlmConfig, HighlightCandidate, ExportOptions, VisionStats, EmotionStats, DanmakuStats, VoiceTagStats, WatchEvent, UpdateInfo, AutomationTask, AutomationTaskStage } from "../shared/api-types";

const VIDEO_EXTENSIONS = ["mp4", "mkv", "mov", "flv", "ts", "webm", "avi", "m4v"];
const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "flac"];

// ---- Protocolo de pré-visualização de mídia local (mesa de revisão) ----
// O <video> da camada de renderização lê o arquivo de origem em fluxo por hotclip-media://;
// o privilégio precisa ser registrado ANTES do app ready para haver fetch/fluxo/Range
// (arrastar a linha de tempo depende da resposta 206 em partes).
// [CORREÇÃO] standard/secure/bypassCSP completam o registro: só com stream+supportFetchAPI o
// scheme entra pelo caminho de "scheme não padrão" — a normalização da URL e a decisão de mesma
// origem se comportam de outro jeito, e a semântica de "distinguir a mídia pelo path" logo
// abaixo fica pouco confiável. standard faz o pathname ser lido em níveis como manda o padrão,
// secure dá contexto seguro e bypassCSP evita um segundo corte pelo CSP da página.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "hotclip-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

// Só passa o arquivo que teve probe bem-sucedido nesta sessão — o protocolo não lê caminho arbitrário
const allowedMedia = new Set<string>();

const MEDIA_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  ts: "video/mp2t",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
};

/**
 * hotclip-media://local/<view>/<encodeURIComponent(caminho)> → fluxo do arquivo com Range.
 *
 * [CORREÇÃO] O caminho ganhou um trecho `<view>` (main / crop / review). A primeira versão era
 * `hotclip-media://local/<encodeURIComponent(caminho)>?view=main`, mas:
 *   ① serveMedia só olha o pathname e a query era descartada inteira → as três views devolviam
 *      exatamente os mesmos bytes;
 *   ② o Chromium ignora a query ao decidir "é a mesma mídia?" → vários <video> continuavam
 *      dividindo um único buffer, um estragava todos e a URL não tocava mais nesta sessão.
 * Codificar a view no pathname é o que dá a cada consumidor uma mídia independente. A view só
 * distingue o recurso, não autoriza (a autorização segue olhando se o caminho está em allowedMedia).
 */
async function serveMedia(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname.replace(/^\//, "");
  // O primeiro trecho = view (aceitando a URL antiga de um trecho só, sem view), o resto = caminho real codificado
  const slash = pathname.indexOf("/");
  const encodedPath = slash === -1 ? pathname : pathname.slice(slash + 1);
  const filePath = decodeURIComponent(encodedPath);
  if (!allowedMedia.has(filePath)) return new Response("forbidden", { status: 403 });
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return new Response("not found", { status: 404 });
  }
  const range = resolveByteRange(request.headers.get("range"), size);
  if (!range) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const headers: Record<string, string> = {
    "Content-Type": MEDIA_MIME[extname(filePath).slice(1).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Content-Length": String(range.end - range.start + 1),
  };
  if (range.status === 206) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  // [CORREÇÃO] Readable.toWeb está fora: o evento error de um Readable do Node não vira
  // controller.error() no Web Stream, e o corpo da resposta é "truncado em silêncio" — o
  // Chromium então acusa PIPELINE_ERROR_READ (error.code=2). O fluxo feito à mão propaga o erro
  // explicitamente e destrói o descritor do arquivo quando o consumidor cancela.
  const nodeStream = createReadStream(filePath, { start: range.start, end: range.end });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(chunk as Uint8Array));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
  return new Response(body, { status: range.status, headers });
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "HotClip",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow.show());

  // Link externo abre no navegador do sistema, nunca dentro da casca do app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ---- IPC: importar e sondar o arquivo (passo 1 do assistente) ----

ipcMain.handle("hotclip:select-media", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Video / Audio", extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

let urlImportAbort: AbortController | null = null;

ipcMain.handle("hotclip:import-media-url", async (event, url: unknown) => {
  if (typeof url !== "string") throw new Error("import-media-url requires a URL");
  if (urlImportAbort) throw new Error("A URL import is already running");
  const controller = new AbortController();
  urlImportAbort = controller;
  try {
    return await downloadMediaUrl(url, {
      toolsDir: join(app.getPath("userData"), "tools", "yt-dlp"),
      destDir: join(app.getPath("videos"), "HotClip", "Imports"),
      signal: controller.signal,
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("hotclip:url-import-progress", progress);
      },
    });
  } finally {
    if (urlImportAbort === controller) urlImportAbort = null;
  }
});

ipcMain.on("hotclip:url-import-cancel", () => {
  urlImportAbort?.abort();
});

let projectPersistenceOps: Promise<void> = Promise.resolve();
function queueProjectPersistence<T>(operation: () => Promise<T>): Promise<T> {
  const result = projectPersistenceOps.then(operation, operation);
  projectPersistenceOps = result.then(() => undefined, () => undefined);
  return result;
}

ipcMain.handle("hotclip:project-workspace-get", () => queueProjectPersistence(async () => {
  const workspace = await projectWorkspace(app.getPath("userData"));
  if (workspace.active?.checkpoint) allowedMedia.add(workspace.active.checkpoint.file.path);
  return workspace;
}));
ipcMain.handle("hotclip:project-create", (_event, checkpoint: unknown, name?: string) =>
  queueProjectPersistence(async () => {
    const result = await createProject(app.getPath("userData"), checkpoint, name);
    if (result?.checkpoint) allowedMedia.add(result.checkpoint.file.path);
    return result;
  })
);
ipcMain.handle("hotclip:project-open", (_event, id: string) => queueProjectPersistence(async () => {
  const result = await openProject(app.getPath("userData"), id);
  if (result?.checkpoint) allowedMedia.add(result.checkpoint.file.path);
  return result;
}));
ipcMain.handle("hotclip:project-save", (_event, id: string, checkpoint: unknown) =>
  queueProjectPersistence(() => saveProject(app.getPath("userData"), id, checkpoint))
);
ipcMain.handle("hotclip:project-rename", (_event, id: string, name: string) =>
  queueProjectPersistence(() => renameProject(app.getPath("userData"), id, name))
);
ipcMain.handle("hotclip:project-delete", (_event, id: string) =>
  queueProjectPersistence(() => deleteProject(app.getPath("userData"), id))
);
ipcMain.handle("hotclip:project-relink", (_event, id: string, filePath: string) =>
  queueProjectPersistence(async () => {
    if (typeof filePath !== "string" || filePath.length === 0) return null;
    const info = await probeMedia(filePath);
    const result = await relinkProject(app.getPath("userData"), id, { path: filePath, ...info });
    if (result?.checkpoint) allowedMedia.add(result.checkpoint.file.path);
    return result;
  })
);
ipcMain.handle("hotclip:project-close", () =>
  queueProjectPersistence(() => closeProject(app.getPath("userData")))
);

ipcMain.handle("hotclip:session-checkpoint-get", () => queueProjectPersistence(async () => {
  const checkpoint = await readSessionCheckpoint(app.getPath("userData"));
  if (checkpoint) allowedMedia.add(checkpoint.file.path);
  return checkpoint;
}));
ipcMain.handle("hotclip:session-checkpoint-save", (_event, checkpoint: unknown) =>
  queueProjectPersistence(() => saveSessionCheckpoint(app.getPath("userData"), checkpoint))
);
ipcMain.handle("hotclip:session-checkpoint-clear", () =>
  queueProjectPersistence(() => clearSessionCheckpoint(app.getPath("userData")))
);

// ---- IPC: retorno do desempenho real da publicação (central de configurações) ----

ipcMain.handle("hotclip:performance-get", async () => {
  const userData = app.getPath("userData");
  const [entries, publishingItems] = await Promise.all([
    loadPerformanceMemory(userData),
    loadPublishLedger(userData),
  ]);
  const measured = publishingItems.filter((item) => item.metricsImportedAt).length;
  return summarizePerformance(entries, {
    total: publishingItems.length,
    measured,
    awaitingMetrics: publishingItems.length - measured,
    recent: publishingItems.slice(-8).reverse(),
  }, summarizeExperiments(publishingItems, entries));
});

ipcMain.handle("hotclip:performance-import", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Platform metrics", extensions: ["csv", "json"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const imported = await importPerformanceFile(app.getPath("userData"), result.filePaths[0]);
  return { imported: imported.imported, skipped: imported.skipped, total: imported.total, correlation: imported.correlation };
});

ipcMain.handle("hotclip:performance-template", async () => {
  const items = await loadPublishLedger(app.getPath("userData"));
  const pending = items.filter((item) => !item.metricsImportedAt);
  if (pending.length === 0) return null;
  const result = await dialog.showSaveDialog({
    defaultPath: join(app.getPath("documents"), "HotClip-dados-de-desempenho.csv"),
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, buildPerformanceTemplate(pending), "utf8");
  return { count: pending.length, path: result.filePath };
});

ipcMain.handle("hotclip:performance-clear", async () => {
  const userData = app.getPath("userData");
  await Promise.all([clearPerformanceMemory(userData), clearPublishMetrics(userData)]);
});

// ---- IPC: diagnóstico da máquina e reparo seguro ----

const diagnosticsConfig = (value: unknown): LlmConfig | null => {
  if (!value || typeof value !== "object") return null;
  const config = value as Partial<LlmConfig>;
  if (typeof config.baseUrl !== "string" || !config.baseUrl.trim() || typeof config.model !== "string" || !config.model.trim()) return null;
  return { baseUrl: config.baseUrl.trim(), model: config.model.trim(), apiKey: typeof config.apiKey === "string" ? config.apiKey : "" };
};

async function desktopDiagnostics(llm: LlmConfig | null, zh = true) {
  const report = await runDoctor({
    modelsRoot: modelsRoot(),
    cacheDir: transcriptCacheDir(),
    renderCacheDir: baseRenderCacheDir(),
    evidenceCacheDir: baseEvidenceCacheDir(),
    toolsDir: join(app.getPath("userData"), "tools", "yt-dlp"),
    llm,
    zh,
  });
  return { checks: report.checks, missingCoreModels: report.missingCoreModels.length, generatedAt: new Date().toISOString() };
}

ipcMain.handle("hotclip:diagnostics-run", (_event, llm: unknown, locale: unknown) => desktopDiagnostics(diagnosticsConfig(llm), locale !== "en"));
ipcMain.handle("hotclip:diagnostics-clear-render-cache", async (_event, llm: unknown, locale: unknown) => {
  await clearRenderCache(baseRenderCacheDir());
  return desktopDiagnostics(diagnosticsConfig(llm), locale !== "en");
});
ipcMain.handle("hotclip:diagnostics-clear-evidence-index", async (_event, llm: unknown, locale: unknown) => {
  signalsCache.clear();
  timelineCache.clear();
  await clearEvidenceIndex(baseEvidenceCacheDir());
  return desktopDiagnostics(diagnosticsConfig(llm), locale !== "en");
});

let diagnosticsRepairAbort: AbortController | null = null;
ipcMain.on("hotclip:diagnostics-repair-cancel", () => diagnosticsRepairAbort?.abort());
ipcMain.handle("hotclip:diagnostics-prepare-models", async (event, llm: unknown, locale: unknown) => {
  if (diagnosticsRepairAbort) throw new Error("model preparation is already running");
  const config = diagnosticsConfig(llm);
  const before = await runDoctor({
    modelsRoot: modelsRoot(),
    cacheDir: transcriptCacheDir(),
    renderCacheDir: baseRenderCacheDir(),
    evidenceCacheDir: baseEvidenceCacheDir(),
    toolsDir: join(app.getPath("userData"), "tools", "yt-dlp"),
    llm: config,
    zh: locale !== "en",
  });
  const controller = new AbortController();
  diagnosticsRepairAbort = controller;
  try {
    for (let index = 0; index < before.missingCoreModels.length; index++) {
      const asset = before.missingCoreModels[index];
      await ensureModel(modelsRoot(), asset, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("hotclip:diagnostics-progress", {
            modelId: asset.id,
            current: index + 1,
            total: before.missingCoreModels.length,
            phase: progress.phase,
            fraction: progress.totalBytes > 0 ? Math.min(1, progress.downloadedBytes / progress.totalBytes) : 0,
          });
        }
      }, controller.signal);
    }
    return await desktopDiagnostics(config, locale !== "en");
  } finally {
    diagnosticsRepairAbort = null;
  }
});

// Raiz de exportação de fábrica: ~/Vídeos/HotClip — quem está começando acha no gerenciador de arquivos (issue #3)
ipcMain.handle("hotclip:default-out-dir", async () => join(app.getPath("videos"), "HotClip"));

// ---- IPC: onde os modelos ficam (página de configurações) — 1GB de arquivos, o usuário tem direito de saber e decidir ----

ipcMain.handle("hotclip:models-info", async () =>
  inspectModels(modelsRoot(), defaultModelsRoot(app.getPath("userData")))
);

ipcMain.handle("hotclip:models-move", async (_event, dir: unknown) => {
  if (typeof dir !== "string" || !dir.trim()) throw new Error("move requires a directory");
  const userData = app.getPath("userData");
  const target = dir.trim();
  const landed = await moveModelsDir(modelsRoot(), target);
  // A configuração só é gravada depois da mudança: gravar antes aponta para uma pasta vazia e todo modelo é dado como «não instalado»
  const isDefault = landed === defaultModelsRoot(userData);
  writeAppSettings(userData, { ...readAppSettings(userData), modelsDir: isDefault ? undefined : landed });
  return landed;
});

// Abrir a pasta no gerenciador de arquivos (o «abrir pasta» das configurações); se não existir, silêncio, sem caixa de erro do sistema
ipcMain.on("hotclip:open-folder", (_event, dir: unknown) => {
  if (typeof dir === "string" && dir.trim()) void shell.openPath(dir);
});

// Escolha da pasta vigiada das gravações
ipcMain.handle("hotclip:select-dir", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Escolha do arquivo de trilha (desenho de som)
ipcMain.handle("hotclip:select-audio", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Audio", extensions: ["mp3", "m4a", "aac", "wav", "flac", "ogg"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Trilha instrumental livre de direitos gerada por IA (edição em nuvem, v0.14): música pura no estilo da categoria, guardada em userData
// para reuso; ao terminar, a camada de renderização põe o caminho em bgmPath e a mixagem de sempre entra em ação
ipcMain.handle("hotclip:generate-bgm", async (_event, config: unknown, genreId: unknown) => {
  const llm = (config ?? {}) as LlmConfig;
  return await generateAiBgm({
    genreId: typeof genreId === "string" && genreId.trim() ? genreId : undefined,
    baseUrl: typeof llm.baseUrl === "string" ? llm.baseUrl : "",
    apiKey: typeof llm.apiKey === "string" ? llm.apiKey : "",
    destDir: join(app.getPath("userData"), "ai-bgm"),
  });
});

// Escolha do logotipo da marca d'água (preset de marca)
ipcMain.handle("hotclip:select-image", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("hotclip:probe-media", async (_event, filePath: unknown) => {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("probe-media requires a file path");
  }
  const info = await probeMedia(filePath);
  allowedMedia.add(filePath); // só o arquivo com probe bem-sucedido pode ser lido pelo protocolo de pré-visualização
  return info;
});

// ---- IPC: forma de onda da mesa de revisão (picos de áudio da janela de contexto) ----

ipcMain.handle("hotclip:audio-peaks", async (_event, filePath: unknown, startSec: unknown, endSec: unknown) => {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("audio-peaks requires a file path");
  const from = typeof startSec === "number" && Number.isFinite(startSec) ? Math.max(0, startSec) : 0;
  const to = typeof endSec === "number" && Number.isFinite(endSec) ? endSec : 0;
  if (to <= from) throw new Error("audio-peaks requires a valid range");
  // Janela limitada a 10 minutos, para um intervalo gigante enviado por engano não estourar a memória
  const info = await probeMedia(filePath).catch(() => null);
  const track = await extractPeaks(filePath, from, Math.min(to, from + 600), info?.audioStreamIndex);
  return { values: Array.from(track.values), startSec: track.startSec, hopSec: track.hopSec };
});

// ---- IPC: dados da linha de tempo da bancada (curva de volume do material inteiro / calor do chat + tira de miniaturas) ----
// O volume reaproveita as amostras de ebur128 guardadas por warmSignals (colhidas em paralelo na transcrição, sem decodificar de novo);
// o chat vem do arquivo ao lado do vídeo; as miniaturas saem de 8 quadros, um a um. Cada trilha falha em aberto.

const timelineCache = new Map<string, Promise<import("../shared/api-types").TimelineData>>();

ipcMain.handle("hotclip:timeline-data", async (_event, filePath: unknown, durationSec: unknown) => {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("timeline-data requires a file path");
  const dur = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (dur <= 0) throw new Error("timeline-data requires a duration");
  const media = await probeMedia(filePath).catch(() => null);
  const analysis: AnalysisVideoOptions = media?.hasVideo
    ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) }
    : {};
  const sourceId = await fingerprintEvidenceSource(filePath).then(evidenceSourceId).catch(() => filePath);
  const key = `${sourceId}|${analysisVideoIdentity(analysis)}|${Math.round(dur)}`;
  let p = timelineCache.get(key);
  if (!p) {
    p = (async () => {
      const bins = Math.min(720, Math.max(120, Math.round(dur / 5)));
      const [signals, items, thumbs] = await Promise.all([
        warmSignals(filePath, analysis),
        readDanmakuItems(filePath).catch(() => null),
        extractFilmstrip(filePath, dur, 8, analysis).catch(() => [] as string[]),
      ]);
      return {
        loudness: signals?.loudnessSamples ? loudnessCurve(signals.loudnessSamples, dur, bins) : [],
        motion: signals?.motionSamples ? motionCurve(signals.motionSamples, dur, bins) : [],
        danmaku: items ? danmakuHeatCurve(items, dur, bins) : [],
        thumbs,
        binSec: dur / bins,
      };
    })();
    timelineCache.set(key, p);
    if (timelineCache.size > 4) {
      const first = timelineCache.keys().next().value;
      if (first !== undefined) timelineCache.delete(first);
    }
  }
  return p;
});

// ---- IPC: folha de contato dos candidatos (olhada rápida na imagem, a mesma colagem do VLM) ----

ipcMain.handle("hotclip:contact-sheet", async (_event, filePath: unknown, startSec: unknown, endSec: unknown) => {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("contact-sheet requires a file path");
  const from = typeof startSec === "number" && Number.isFinite(startSec) ? Math.max(0, startSec) : 0;
  const to = typeof endSec === "number" && Number.isFinite(endSec) ? endSec : 0;
  if (to <= from) throw new Error("contact-sheet requires a valid range");
  // 9 quadros bem distribuídos dentro do trecho, cedendo um pouco das pontas (o quadro da borda costuma ser meia transição)
  const span = to - from;
  const pad = Math.min(0.3, span / 10);
  const usable = span - pad * 2;
  const times = Array.from({ length: 9 }, (_, i) => from + pad + (usable * (i + 0.5)) / 9);
  const fontFile = app.isPackaged
    ? join(process.resourcesPath, "fonts", "SourceHanSansSC-Bold.otf")
    : join(app.getAppPath(), "resources", "fonts", "SourceHanSansSC-Bold.otf");
  const media = await probeMedia(filePath).catch(() => null);
  const analysis: AnalysisVideoOptions = media?.hasVideo
    ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) }
    : {};
  const b64 = await composeContactSheetJpeg(filePath, times, { fontFile, ...analysis }).catch(() => null);
  return b64 ? `data:image/jpeg;base64,${b64}` : "";
});

// ---- IPC: pedir a lista de modelos ao endpoint de LLM ----
// O id de um modelo vence quando o fornecedor troca de geração; um preset fixo dá 404 cedo ou tarde, então o usuário busca a lista real com um clique.
// listModels falha em aberto (devolve error em vez de lançar) e aqui a resposta é repassada como veio ao processo de renderização.

ipcMain.handle("hotclip:llm-models", async (_event, baseUrl: unknown, apiKey: unknown) => {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return { ids: [], error: "falta o base_url / missing base_url" };
  }
  return listModels(baseUrl.trim(), typeof apiKey === "string" ? apiKey : "");
});

// ---- IPC: retorno da revisão (o aceite/veto é gravado na exportação e vira preferência na detecção seguinte) ----

ipcMain.handle("hotclip:review-record", async (_event, video: unknown, kept: unknown, rejected: unknown) => {
  // Limpeza por lista de permissão: dos dados do processo de renderização só ficam os campos do arquivo de preferência, com tamanho limitado
  const clean = (list: unknown): ReviewedCandidate[] =>
    Array.isArray(list)
      ? list
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .slice(0, 24)
          .map((c) => ({
            title: String(c.title ?? "").slice(0, 80),
            hook: String(c.hook ?? "").slice(0, 120),
            score: Number.isFinite(Number(c.score)) ? Number(c.score) : 0,
            durationSec: Math.max(0, Math.round(Number(c.durationSec) || 0)),
            keywords: Array.isArray(c.keywords)
              ? c.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).slice(0, 5)
              : undefined,
          }))
          .filter((c) => c.title)
      : [];
  const k = clean(kept);
  const r = clean(rejected);
  if (k.length === 0 && r.length === 0) return;
  await recordReview(app.getPath("userData"), {
    at: new Date().toISOString(),
    video: typeof video === "string" ? basename(video) : "",
    kept: k,
    rejected: r,
  });
});

// ---- IPC: transcrição (passo 2 do assistente) ----
// A instância do motor é barata; o modelo é baixado uma única vez para userData.

// O usuário pode mudar onde os modelos ficam (configurações), então a configuração é lida a cada vez — depois da mudança, o download seguinte já vai para o lugar novo
const modelsRoot = (): string => resolveModelsRoot(app.getPath("userData"));
const transcriptCacheDir = (): string => join(app.getPath("userData"), "transcript-cache");
const baseRenderCacheDir = (): string => join(app.getPath("userData"), "render-cache");
const baseEvidenceCacheDir = (): string => join(app.getPath("userData"), "evidence-index");

/** id do catálogo → fábrica do motor + o modelo de que ele depende (para checar a instalação). */
const ASR_ENGINES = {
  sensevoice: { make: () => new SenseVoiceEngine(modelsRoot()), asset: SENSEVOICE_MODEL },
  paraformer: { make: () => new ParaformerEngine(modelsRoot()), asset: PARAFORMER_MODEL },
  fireredasr: { make: () => new FireRedEngine(modelsRoot()), asset: FIRERED_MODEL },
} as const;

ipcMain.handle("hotclip:list-asr-engines", async () => {
  return Promise.all(
    ASR_CATALOG.map(async (facts) => {
      const entry = ASR_ENGINES[facts.id as keyof typeof ASR_ENGINES];
      const installed = entry ? await isModelInstalled(modelsRoot(), entry.asset) : false;
      return { ...facts, installed };
    })
  );
});

let transcribing = false;
let transcriptionAbort: AbortController | null = null;
let alignmentAbort: AbortController | null = null;
app.on("before-quit", () => { transcriptionAbort?.abort(); alignmentAbort?.abort(); });
ipcMain.on("hotclip:transcribe-cancel", () => transcriptionAbort?.abort());
ipcMain.on("hotclip:alignment-cancel", () => alignmentAbort?.abort());
ipcMain.handle("hotclip:local-speech-check", (_event, url: string) => qwenHealth(url));
ipcMain.handle("hotclip:alignment-preview", async (_event, filePath: string, transcript: Transcript, request: AlignmentRequest) => {
  if (alignmentAbort || transcribing) throw new Error("speech:busy");
  if (typeof filePath !== "string" || !filePath) throw new Error("alignment:source-required");
  const abort = new AbortController();
  alignmentAbort = abort;
  try { return await runSpeechWorker<AlignmentPreview>({ kind: "align", filePath, transcript, request, modelsRoot: modelsRoot() }, abort.signal); }
  finally { if (alignmentAbort === abort) alignmentAbort = null; }
});

// A coleta de sinais de nível 0 é lenta em material longo (áudio inteiro + varredura do vídeo
// reduzido), então ela começa EM PARALELO com a transcrição — quando a pessoa chega na detecção
// de destaques as evidências já estão prontas.
const signalsCache = new Map<string, Promise<import("@core/signals").MediaSignals | undefined>>();

async function warmSignals(
  filePath: string,
  providedAnalysis?: AnalysisVideoOptions
): Promise<import("@core/signals").MediaSignals | undefined> {
  const media = providedAnalysis ? null : await probeMedia(filePath).catch(() => null);
  const analysis = providedAnalysis ?? (media?.hasVideo
    ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) }
    : {});
  const source = await fingerprintEvidenceSource(filePath).catch(() => null);
  const key = `${source ? evidenceSourceId(source) : filePath}|${analysisVideoIdentity(analysis)}`;
  let p = signalsCache.get(key);
  if (!p) {
    p = collectSignalsEvidence({
      videoPath: filePath,
      evidenceDir: baseEvidenceCacheDir(),
      source: source ?? undefined,
      analysis,
    }).catch(() => undefined);
    signalsCache.set(key, p);
    // Cache limitado: o material é uma string grande, mas a promessa é barata;
    // só os últimos arquivos ficam guardados
    if (signalsCache.size > 4) {
      const first = signalsCache.keys().next().value;
      if (first !== undefined) signalsCache.delete(first);
    }
  }
  return p;
}

ipcMain.handle("hotclip:import-subtitle", async (_event, filePath: unknown, text: unknown, format: unknown) => {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("subtitle import requires a source path");
  validateSubtitleInput(text, format);
  return importSubtitleText(filePath, text, format as "srt" | "vtt");
});

ipcMain.handle("hotclip:transcribe", async (event, filePath: unknown, engineId: unknown, apiKey: unknown, options: SpeechRunOptions = {}) => {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("transcribe requires a file path");
  }
  if (transcribing || alignmentAbort) throw new Error("another speech operation is already running");
  transcribing = true;
  const abort = new AbortController();
  transcriptionAbort = abort;
  void warmSignals(filePath); // roda junto com a transcrição
  try {
    const resolvedEngineId =
      engineId === "elevenlabs" || engineId === "qwen3"
        ? engineId
        : typeof engineId === "string" && engineId in ASR_ENGINES
          ? engineId
          : "sensevoice";
    // Cache persistente: mesmo arquivo (tamanho+mtime) + mesmo motor → o passo mais lento é
    // pulado por completo. O stat pode falhar (caminho incomum) — aí é só transcrever.
    let fileStat: { size: number; mtimeMs: number } | undefined;
    try {
      fileStat = await stat(filePath);
    } catch {
      fileStat = undefined;
    }
    // O cache guarda sempre o resultado cru do ASR, e o vocabulário é aplicado na volta — depois
    // de atualizar o vocabulário, basta reproduzir o mesmo material para a troca valer, sem rodar o ASR de novo
    const glossary = await loadGlossary(app.getPath("userData"));
    if (fileStat && !options.restart && resolvedEngineId !== "qwen3") {
      const cached = await readTranscriptCache(transcriptCacheDir(), filePath, fileStat, resolvedEngineId);
      if (cached) return applyGlossaryToTranscript(cached, glossary).transcript;
    }
    let result: Transcript;
    try {
      result = await runSpeechWorker<Transcript>({
        kind: "transcribe", filePath, engineId: resolvedEngineId, apiKey: typeof apiKey === "string" ? apiKey : "",
        modelsRoot: modelsRoot(), cacheDir: transcriptCacheDir(), options,
      }, abort.signal, (p) => {
        if (!event.sender.isDestroyed()) event.sender.send("hotclip:transcribe-progress", p);
      });
    } catch (e) {
      if (abort.signal.aborted) throw new Error("speech:cancelled");
      // Depois da falha vem mais uma sondagem, para separar «o material realmente não tem trilha de áudio»
      // de uma falha de download/descompactação/decodificação — senão a interface só dá um aviso genérico e a pessoa fica transcodificando à toa (issue #2)
      const raw = e instanceof Error ? e.message : String(e);
      const media = await probeMedia(filePath).catch(() => null);
      throw new Error(tagTranscribeError(raw, media));
    }
    if (fileStat && resolvedEngineId !== "qwen3" && result?.segments?.length) {
      void writeTranscriptCache(transcriptCacheDir(), filePath, fileStat, resolvedEngineId, result);
    }
    return applyGlossaryToTranscript(result, glossary).transcript;
  } finally {
    transcribing = false;
    if (transcriptionAbort === abort) transcriptionAbort = null;
  }
});

// ---- IPC: detecção de destaques (passo 2 do assistente, depois da transcrição) ----
// A chave do LLM vem das configurações da camada de renderização; ela serve só para esta
// chamada e nunca é gravada no processo principal.

ipcMain.handle(
  "hotclip:detect-highlights",
  async (_event, transcript: unknown, llm: unknown, filePath: unknown, diarize: unknown, prefilter: unknown, vision: unknown, length: unknown, products: unknown, referencePath: unknown, genre: unknown, brief: unknown, scan: unknown) => {
    let t = transcript as Transcript;
    const config = llm as LlmConfig;
    if (!t || !Array.isArray(t.segments)) throw new Error("detect-highlights requires a transcript");
    if (!config?.baseUrl || !config?.model) throw new Error("configure o LLM (baseUrl/model) nas configurações primeiro");
    // Perfil do vídeo de referência (opcional): entrada dada explicitamente pelo usuário; se a análise falhar,
    // segue como se não houvesse referência, mas o motivo da falha volta junto com o resultado para a interface — nada é descartado em silêncio
    let reference: ReferenceProfile | undefined;
    let referenceError: string | undefined;
    if (typeof referencePath === "string" && referencePath.trim()) {
      try {
        reference = await analyzeReferenceVideo(referencePath, {
          modelsRoot: modelsRoot(),
          cacheDir: transcriptCacheDir(),
          evidenceCacheDir: baseEvidenceCacheDir(),
          glossary: await loadGlossary(app.getPath("userData")),
        });
      } catch (e) {
        referenceError = e instanceof Error ? e.message : String(e);
      }
    }
    // Evidência audiovisual de nível 0 (picos de volume + densidade de cortes), com teto para um
    // material patológico nunca travar a detecção; a falha degrada para nenhuma evidência.
    let signals;
    if (typeof filePath === "string" && filePath.trim()) {
      // normalmente já está resolvido (aquecido durante a transcrição); o teto é para o caminho frio
      signals = await Promise.race([
        warmSignals(filePath),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), 120_000)),
      ]).catch(() => undefined);
    }
    // Atribuição de fala a vários participantes (opcional): rotula a transcrição para o LLM saber
    // quem diz o quê. Falha em aberto — um engasgo da diarização não pode travar a detecção.
    let labeled: Transcript | undefined;
    if (diarize === true && typeof filePath === "string" && filePath.trim()) {
      t = await diarizeTranscript(t, filePath).catch(() => t);
      labeled = t; // devolve a transcrição rotulada para a exportação poder colorir a legenda por falante
    }
    // Primeiro nível do funil (opcional): triagem por um modelo pequeno local; campo inválido simplesmente não liga a triagem
    const pf = prefilter as { baseUrl?: unknown; model?: unknown } | null | undefined;
    const localFilter =
      pf && typeof pf.baseUrl === "string" && pf.baseUrl.trim() && typeof pf.model === "string" && pf.model.trim()
        ? { baseUrl: pf.baseUrl, model: pf.model }
        : null;
    // Sinais da imagem (colhidos em paralelo, cada um falhando em aberto — na falha ou com evidência fraca volta a detecção só por texto):
    // - pico de expressão facial: YuNet+FER roda sem configuração nenhuma (se tem imagem, olha; o modelo pequeno é baixado na primeira vez);
    // - estouro visual: VL local por amostragem de quadros (opcional, exige um modelo de visão do Ollama configurado).
    let visionStats: VisionStats | undefined;
    // Endpoint de visão da revisão de imagem dos candidatos (a mesma configuração do canal de sinais; só recebe valor quando hasVideo)
    let reviewVisionCfg: { baseUrl: string; model: string; apiKey?: string } | null = null;
    let reviewAnalysis: AnalysisVideoOptions | undefined;
    let emotionStats: EmotionStats | undefined;
    let danmakuStats: DanmakuStats | undefined;
    let voiceStats: VoiceTagStats | undefined;
    let voicePending: Promise<Awaited<ReturnType<typeof collectVoiceEmotionSignal>>> = Promise.resolve(null);
    if (typeof filePath === "string" && filePath.trim()) {
      const media = await probeMedia(filePath).catch(() => null);
      // Calor do chat (sem configuração): o .xml de mesmo nome ao lado do vídeo (convenção do gravador) é descoberto sozinho, e serve até para áudio puro
      if (media && media.durationSec > 1) {
        const dm = await collectDanmakuSignal(filePath, media.durationSec);
        if (dm) {
          signals = { loudPeaks: [], cutDense: [], ...signals, danmakuPeaks: dm.danmakuPeaks };
          danmakuStats = dm.stats;
        }
        // Emoção da voz / risada e palmas (sem configuração, reaproveitando o SenseVoice já instalado): funciona também em material só de áudio,
        // e roda em paralelo com os sinais da imagem — só consome CPU na decodificação, sem disputar o ffmpeg
        voicePending = Promise.race([
          collectVoiceEmotionSignal({
            videoPath: filePath,
            durationSec: media.durationSec,
            modelsRoot: modelsRoot(),
            signals,
          }),
          new Promise<null>((r) => setTimeout(() => r(null), 120_000)),
        ]).catch(() => null);
      }
      if (media && media.hasVideo && media.durationSec > 1) {
        reviewAnalysis = { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) };
        const vc = vision as { baseUrl?: unknown; model?: unknown; apiKey?: unknown } | null | undefined;
        const visionCfg =
          vc && typeof vc.baseUrl === "string" && vc.baseUrl.trim() && typeof vc.model === "string" && vc.model.trim()
            ? { baseUrl: vc.baseUrl, model: vc.model, apiKey: typeof vc.apiKey === "string" && vc.apiKey.trim() ? vc.apiKey : undefined }
            : null;
        reviewVisionCfg = visionCfg;
        const [emotionOutcome, visionOutcome] = await Promise.all([
          Promise.race([
            collectEmotionSignal({
              videoPath: filePath,
              durationSec: media.durationSec,
              modelsRoot: modelsRoot(),
              signals,
              analysis: reviewAnalysis,
            }),
            new Promise<null>((r) => setTimeout(() => r(null), 120_000)),
          ]).catch(() => null),
          visionCfg
            ? collectVisionEvidence({
                videoPath: filePath,
                durationSec: media.durationSec,
                config: visionCfg,
                signals,
                // Edição de varredura completa (v0.13): só roda se o usuário ligar (é demorado; na nuvem é cobrado por uso)
                scan: scan === true,
                // Fonte da numeração dos nove quadros da folha de contato (a mesma fonte empacotada da legenda)
                fontFile: app.isPackaged
                  ? join(process.resourcesPath, "fonts", "SourceHanSansSC-Bold.otf")
                  : join(app.getAppPath(), "resources", "fonts", "SourceHanSansSC-Bold.otf"),
                evidenceDir: baseEvidenceCacheDir(),
                analysis: reviewAnalysis,
              }).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (emotionOutcome || visionOutcome) {
          signals = {
            loudPeaks: [],
            cutDense: [],
            ...signals,
            ...(visionOutcome ? { visualPeaks: visionOutcome.visualPeaks } : {}),
            // Linha do tempo da imagem (varredura completa): a descrição do que aparece volta como evidência da escolha
            ...(visionOutcome && visionOutcome.visualNotes.length > 0 ? { visualNotes: visionOutcome.visualNotes } : {}),
            ...(emotionOutcome ? { emotionPeaks: emotionOutcome.emotionPeaks } : {}),
          };
          visionStats = visionOutcome
            ? {
                ...visionOutcome.stats,
                ...(visionOutcome.visualNotes.length > 0 ? { notes: visionOutcome.visualNotes } : {}),
              }
            : undefined;
          emotionStats = emotionOutcome?.stats;
        }
      }
      const voiceOutcome = await voicePending;
      if (voiceOutcome && (voiceOutcome.voiceEmotionPeaks.length > 0 || voiceOutcome.audioEventPeaks.length > 0)) {
        signals = {
          loudPeaks: [],
          cutDense: [],
          ...signals,
          voiceEmotionPeaks: voiceOutcome.voiceEmotionPeaks,
          audioEventPeaks: voiceOutcome.audioEventPeaks,
        };
        voiceStats = voiceOutcome.stats;
      }
    }
    // Faixa de duração: valor inválido volta para a faixa padrão
    const clipLength =
      length === "short" || length === "long" || length === "standard" ? length : undefined;
    // Palavras do produto: limpeza por lista de permissão (array de strings, palavra de até 30 caracteres, no máximo 20)
    const productWords = Array.isArray(products)
      ? products.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim().slice(0, 30)).slice(0, 20)
      : [];
    // Retorno das preferências de revisão: exemplos de aceite/veto do histórico da máquina entram no prompt (memória vazia não muda nada)
    const reviewMemory = await loadReviewMemory(app.getPath("userData"));
    const performanceMemory = await loadPerformanceMemory(app.getPath("userData"));
    // Critérios da categoria: limpeza por lista de permissão (o id precisa ser string; o corte do texto personalizado fica com o core)
    const g = genre as { id?: unknown; custom?: unknown } | null | undefined;
    const genreArg =
      g && (typeof g.id === "string" || typeof g.custom === "string")
        ? {
            id: typeof g.id === "string" ? g.id : undefined,
            custom: typeof g.custom === "string" ? g.custom : undefined,
          }
        : undefined;
    // Pauta do usuário: limpeza por lista de permissão (dois textos livres; o corte fica com briefSection, no core)
    const b = brief as { focus?: unknown; exclude?: unknown } | null | undefined;
    const briefArg =
      b && ((typeof b.focus === "string" && b.focus.trim()) || (typeof b.exclude === "string" && b.exclude.trim()))
        ? {
            focus: typeof b.focus === "string" ? b.focus.trim() : undefined,
            exclude: typeof b.exclude === "string" ? b.exclude.trim() : undefined,
          }
        : undefined;
    const outcome = await detectHighlights(t, config, undefined, signals, localFilter, clipLength, productWords, reference, reviewMemory, genreArg, briefArg, performanceMemory);
    // Revisão da imagem dos candidatos (v0.12): uma folha de contato por candidato para o VL olhar a imagem, e a nota da imagem volta
    // para a ordenação, com o que se vê entrando em reason. Falha em aberto: na falha ou no tempo esgotado, o candidato original continua valendo.
    let candidates = outcome.candidates;
    if (reviewVisionCfg && candidates.length > 0 && typeof filePath === "string") {
      const reviewed = await reviewCandidatesVision({
        videoPath: filePath,
        candidates,
        config: reviewVisionCfg,
        fontFile: app.isPackaged
          ? join(process.resourcesPath, "fonts", "SourceHanSansSC-Bold.otf")
          : join(app.getAppPath(), "resources", "fonts", "SourceHanSansSC-Bold.otf"),
        analysis: reviewAnalysis,
      }).catch(() => null);
      if (reviewed) {
        candidates = reviewed.candidates;
        visionStats = {
          ...(visionStats ?? { framesTotal: 0, framesScored: 0, peakCount: 0 }),
          candidatesReviewed: reviewed.stats.reviewed,
          candidatesAdjusted: reviewed.stats.boosted + reviewed.stats.demoted,
        };
      }
    }
    return { candidates, transcript: labeled, funnel: outcome.funnel, vision: visionStats, emotion: emotionStats, danmaku: danmakuStats, voice: voiceStats, reference: reference ?? null, referenceError };
  }
);

/** Garante os modelos de diarização, roda e rotula a transcrição. Lança em caso de falha. */
async function diarizeTranscript(t: Transcript, filePath: string): Promise<Transcript> {
  const root = modelsRoot();
  await ensureModel(root, SEGMENTATION_MODEL);
  await ensureModel(root, SPEAKER_EMBEDDING_MODEL);
  const turns = await runDiarization(filePath, root);
  return labelTranscript(t, turns);
}

// ---- IPC: exportar os clipes escolhidos (passo 3 do assistente) ----
// A saída vai para <raiz de exportação>/<nome-do-material>/ — de fábrica ~/Movies/HotClip, e a interface permite mudar.

// Cancelar a exportação: uma exportação por vez, um controlador ativo; cancel mata o ffmpeg em execução
const exportTasks = new ExportTaskRunner();
ipcMain.on("hotclip:export-cancel", () => exportTasks.cancel());
app.on("before-quit", () => exportTasks.cancel());

/** O vocabulário que um candidato realmente usa: o trecho colado só pega as palavras dentro de cada pedaço, e o trecho único segue pelo intervalo. */
function clipWords(transcript: Transcript, c: HighlightCandidate): TranscriptWord[] {
  const words = sliceWords(transcript, c.startSec, c.endSec);
  return c.pieces && c.pieces.length > 1 ? wordsInPieces(words, c.pieces) : words;
}

ipcMain.handle("hotclip:export-clips", async (event, filePath: unknown, clips: unknown, options: unknown) => exportTasks.run(async (abortSignal) => {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("export requires a file path");
  const list = clips as HighlightCandidate[];
  if (!Array.isArray(list) || list.length === 0) throw new Error("no clips selected");
  const opts = (options ?? {}) as ExportOptions;
  const preparing = (preparation: "translation" | "publish" | "variants" | "media"): void => {
    abortSignal.throwIfAborted();
    if (!event.sender.isDestroyed()) event.sender.send("hotclip:export-progress", {
      current: 0, total: list.length, clipId: list[0].id, stage: "preparing", preparation,
    });
  };
  preparing("media");
  const style =
    opts.captionStyle && opts.captionStyle !== "none" && opts.transcript ? opts.captionStyle : undefined;
  const jumpCut = Boolean(opts.jumpCut && opts.transcript);
  const cleanFillers = Boolean(opts.cleanFillers && opts.transcript);
  const cutRetakes = Boolean(opts.cutRetakes && opts.transcript);
  const muteTerms = sanitizeSensitiveWords(opts.muteTerms);
  const needWords = Boolean(opts.transcript) && exportNeedsTranscript({ ...opts, captionStyle: style ?? "none", muteTerms });
  const sourceName = sanitizeFilename(basename(filePath, extname(filePath)), "video");
  const outDir = clipOutDir(opts.outDir, app.getPath("videos"), sourceName);
  // fonte de legenda empacotada: no pacote → resources/fonts, em desenvolvimento → resources/fonts do repositório
  const fontsDir = app.isPackaged
    ? join(process.resourcesPath, "fonts")
    : join(app.getAppPath(), "resources", "fonts");
  // Guarda da folga do encaixe no corte de câmera: o instante da palavra vizinha de fora do trecho (só existe com transcrição;
  // sem ela é undefined, e o encaixe cai no modo conservador de «confiar só nas palavras de dentro»)
  const allWords = opts.transcript
    ? opts.transcript.segments.flatMap((s) => s.words).sort((a, b) => a.startSec - b.startSec)
    : null;
  // Legenda bilíngue: antes de exportar, todas as frases inteiras cobertas pelos trechos escolhidos são traduzidas de uma vez
  // (falha em aberto — se a tradução falhar ou o endpoint cair, fica só sem trilha traduzida, nunca derrubando a exportação).
  let translations: Map<number, string> | null = null;
  let translatable: ReturnType<typeof collectClipSegments> = [];
  const tr = opts.translate;
  if (
    tr && typeof tr.targetLang === "string" && tr.targetLang.trim() &&
    tr.llm?.baseUrl && tr.llm?.model && opts.transcript
  ) {
    translatable = collectClipSegments(opts.transcript, list);
    preparing("translation");
    translations = await optionalExportStep(abortSignal, () => translateSegments(translatable, tr.targetLang, tr.llm, chatComplete, abortSignal));
  }
  // Texto de publicação (opcional): uma chamada de LLM gera título + hashtags + descrição para todos os trechos (falha em aberto).
  const zh = !(opts.transcript?.language ?? "zh").startsWith("en");
  // saveWorthy: o candidato que alcança a densidade de utilidade (v0.14) leva um texto de publicação voltado para salvar/buscar
  const copySources = list.map((c) => ({ id: c.id, title: c.title, hook: c.hook, text: c.text, keywords: c.keywords, saveWorthy: Boolean(c.utility) }));
  let publishCopies: Map<number, import("@core/publish").PublishCopy> | null = null;
  const pub = opts.publishCopy;
  if (pub?.llm?.baseUrl && pub.llm.model) {
    preparing("publish");
    publishCopies = await optionalExportStep(abortSignal, () => generatePublishCopies(copySources, zh, pub.llm, chatComplete, abortSignal));
  }
  // Várias versões de um trecho (opcional): uma chamada de LLM monta o plano de embalagem diferente para o lote inteiro (falha em aberto —
  // na falha fica só sem variação, e a versão original é exportada como sempre).
  let variantPlans: Map<number, import("@core/variants").VariantPackaging[]> | null = null;
  const varOpt = opts.variants;
  if (varOpt?.llm?.baseUrl && varOpt.llm.model && Number(varOpt.count) >= 2) {
    preparing("variants");
    variantPlans = await optionalExportStep(abortSignal, () => generateVariantPlans(
      copySources,
      Math.min(Number(varOpt.count), VARIANT_TOTAL_MAX),
      zh,
      varOpt.llm,
      chatComplete,
      abortSignal
    ));
  }
  preparing("media");
  // Corte preciso: só faz sentido quando a transcrição principal não é a edição Paraformer (o carimbo de tempo CIF dele já é
  // o melhor possível); o alinhador é reaproveitado pelo lote inteiro e o modelo só é baixado no primeiro uso (o que só acontece se o usuário ligar)
  const alignWords =
    opts.preciseAlign && needWords && opts.transcript && opts.transcript.engine !== "paraformer-local"
      ? createClipAligner(modelsRoot(), abortSignal)
      : undefined;
  const baseSpecs: import("@core/export").ExportClipSpec[] = list.map((c) => ({
      id: c.id,
      title: c.title,
      startSec: c.startSec,
      endSec: c.endSec,
      // Colagem de vários pedaços: a lista de pedaços segue como está, e o vão entre eles é tratado na exportação como intervalo de corte forçado
      pieces: Array.isArray(c.pieces) && c.pieces.length > 1 ? c.pieces : undefined,
      snapContext: allWords ? snapContextAround(allWords, c.startSec, c.endSec) : undefined,
      manualBounds: c.manualBounds === true,
      // O vocabulário do trecho colado só pega os pedaços que de fato entraram no corte — a palavra que cai num vão
      // não deve ir para a legenda nem participar da decisão de corte seco / regravação
      words: needWords ? clipWords(opts.transcript!, c) : undefined,
      // 1,5s de folga a mais: na exportação o encaixe no corte de câmera estica até 0,8s, e o aparo acontece no export
      translation: translations
        ? clipTranslationLines(translatable, translations, c.startSec - 1.5, c.endSec + 1.5)
        : undefined,
      publish: publishCopies?.get(c.id),
      keywords: c.keywords,
      meta: {
        hook: c.hook,
        score: c.score,
        reason: c.reason,
        text: c.text,
        recommended: c.recommended,
        reviewNote: c.reviewNote,
        visualEvidence: c.visualEvidence,
        scoreDims: c.scoreDims,
        teaser: c.teaser,
      },
    }));
  const exportSpecs = variantPlans
    ? expandClipSpecs(baseSpecs, variantPlans, Boolean(pub?.llm?.baseUrl && pub.llm.model), !opts.flashForward)
    : baseSpecs;
  const exported = await exportClips(
    filePath,
    // Várias versões: a variação clona o spec original (trocando título/frase de suspense/texto/pico da capa) e fica logo depois da original;
    // com o flash do estouro global desligado, a última versão troca também a estrutura de abertura (dimensão de diferença do flash-forward)
    exportSpecs,
    outDir,
    {
      vertical: Boolean(opts.vertical),
      captionStyle: style,
      jumpCut,
      // Manter o respiro (v0.14): o corte seco deixa um fôlego na emenda; só faz sentido com o corte seco ligado
      keepBreath: Boolean(opts.keepBreath),
      // Etiqueta de falante (v0.14): ligada por padrão — sem marcação de falante no vocabulário ela simplesmente não aparece
      speakerLabels: opts.speakerLabels !== false,
      // Perturbação controlada do modelo (v0.14): contra a impressão digital de produção em série; só tremula se for ligada explicitamente
      templateJitter: Boolean(opts.templateJitter),
      cleanFillers,
      cutRetakes,
      autoZoom: Boolean(opts.autoZoom),
      autoEnhance: Boolean(opts.autoEnhance),
      // Efeito sonoro / trilha / faixa da categoria: a camada de desenho de som (veja core/sound-design.ts e genre.ts)
      sfx: Boolean(opts.sfx),
      bgmPath: typeof opts.bgmPath === "string" && opts.bgmPath.trim() ? opts.bgmPath : undefined,
      genreId: typeof opts.genreId === "string" ? opts.genreId : undefined,
      trimUi: Boolean(opts.trimUi),
      titleCard: Boolean(opts.titleCard),
      openingHook: Boolean(opts.openingHook),
      normalizeLoudness: Boolean(opts.normalizeLoudness),
      // Correção: estas quatro chaves nunca chegavam à camada de exportação — clicar na interface não fazia nada, e a
      // semântica de falha em aberto escondia isso (redução de ruído / compilado / versão horizontal / clímax na frente eram chaves mortas no desktop)
      denoise: Boolean(opts.denoise),
      denoiseMode: opts.denoiseMode === "smart" ? "smart" : "basic",
      muteTerms: muteTerms.length > 0 ? muteTerms : undefined,
      compilation: Boolean(opts.compilation),
      coldOpen: Boolean(opts.coldOpen),
      alsoLandscape: Boolean(opts.alsoLandscape),
      // Flash do estouro (v0.12): a imagem do pico de emoção entra de 0,3 a 1s antes, como gancho visual
      flashForward: Boolean(opts.flashForward),
      // Corte preciso (v0.12): a segunda passada do Paraformer corrige o carimbo de tempo por palavra
      alignWords,
      faceTrack: true,
      snapToShots: true,
      brand: sanitizeBrand(opts.brand),
      // A faixa de qualidade só mexe no CRF; valor desconhecido volta para high, mantendo a qualidade padrão de sempre
      crf: QUALITY_CRF[opts.quality && opts.quality in QUALITY_CRF ? opts.quality : "high"],
      translateLang: translations ? opts.translate!.targetLang : undefined,
      subtitleFile: Boolean(opts.subtitleFile),
      timeline: Boolean(opts.timeline),
      // Rascunho do CapCut (v0.14): o corte da IA entra na linha de tempo do CapCut, o caminho popular de «corte bruto → acabamento»
      jianyingDraft: Boolean(opts.jianyingDraft),
      aigcLabel: Boolean(opts.aigcLabel),
      // Pacote de comprovação (v0.14): 3 minutos antes e depois do material original, copiados em fluxo para arquivo (exigência nova das análises de autorização)
      evidencePack: Boolean(opts.evidencePack),
      // Capa por IA em duas edições (v0.14): a Atlas Key da edição de LLM do usuário é repassada, e a camada de exportação decide se o endpoint está disponível
      aiCover:
        opts.aiCover?.llm?.baseUrl && opts.aiCover.llm.apiKey && (opts.aiCover.tier === "volume" || opts.aiCover.tier === "premium")
          ? { tier: opts.aiCover.tier, baseUrl: opts.aiCover.llm.baseUrl, apiKey: opts.aiCover.llm.apiKey, zh }
          : undefined,
      // Pacote de publicação por plataforma: id de plataforma desconhecido é simplesmente filtrado (nada de adivinhar), e lista vazia é o mesmo que desligado
      publishPack: Array.isArray(opts.publishPack) ? validPlatformIds(opts.publishPack.filter((p): p is string => typeof p === "string")) : undefined,
      seriesPack: Boolean(opts.seriesPack),
      modelsRoot: modelsRoot(),
      fontsDir,
      renderOverlay: renderCaptionOverlay,
      renderCacheDir: baseRenderCacheDir(),
      evidenceCacheDir: baseEvidenceCacheDir(),
    },
    (p) => {
      if (!event.sender.isDestroyed()) event.sender.send("hotclip:export-progress", p);
    },
    abortSignal
  );
  const platforms = Array.isArray(opts.publishPack)
    ? validPlatformIds(opts.publishPack.filter((p): p is string => typeof p === "string"))
    : [];
  const exportedAt = new Date().toISOString();
  const ledgerInputs = exported
    .filter((result) => result.id > 0)
    .flatMap((result) => {
      const spec = exportSpecs.find((candidate) => candidate.id === result.id);
      const rootId = spec ? (spec.variantOf ?? spec.id) : null;
      const group = rootId === null ? [] : exportSpecs.filter((candidate) => (candidate.variantOf ?? candidate.id) === rootId);
      const control = group.find((candidate) => candidate.id === rootId);
      const dimensions: Array<"packaging" | "opening"> = ["packaging"];
      if (group.some((candidate) => Boolean(candidate.flashForward) !== Boolean(control?.flashForward))) dimensions.push("opening");
      return (platforms.length > 0 ? platforms : ["unassigned"]).map((platform) => ({
        filePath: result.path,
        title: result.title,
        hook: spec?.meta?.hook,
        platform,
        durationSec: result.durationSec,
        keywords: spec?.keywords,
        exportedAt,
        ...(spec && rootId !== null && group.length > 1 ? {
          experimentId: publishExperimentId({ sourcePath: filePath, platform, exportedAt, candidateId: rootId }),
          variantIndex: spec.variant ?? 1,
          variantTotal: group.length,
          variantRole: spec.variantOf ? "challenger" as const : "control" as const,
          experimentDimensions: dimensions,
        } : {}),
      }));
    });
  await registerPublishItems(app.getPath("userData"), ledgerInputs).catch((error) => {
    console.error("publish ledger registration failed:", error);
  });
  return exported;
}));

// ---- Vigia de gravações: uma pasta é observada e, quando uma gravação nova termina de ser escrita, o corte sai sozinho de ponta a ponta ----
// A vigilância é por consulta periódica (fs.watch não é confiável em disco de rede / escrita em partes); o registro do que já foi processado é persistente, e reiniciar não corta de novo.

const WATCH_POLL_MS = 15_000;
let watchTimer: NodeJS.Timeout | null = null;
let watchDirPath: string | null = null;
let webhookHandle: WebhookServerHandle | null = null;
let webhookInfo: { port: number; dir: string } | null = null;
let webhookChain: Promise<void> = Promise.resolve();

const watchSeenPath = (): string => join(app.getPath("userData"), "watch-seen.json");

async function loadWatchSeen(): Promise<SeenMap> {
  try {
    return JSON.parse(await readFile(watchSeenPath(), "utf8")) as SeenMap;
  } catch {
    return {};
  }
}

let automationTasksCache: AutomationTask[] | null = null;
let automationHistoryOps: Promise<void> = Promise.resolve();
let automationChain: Promise<void> = Promise.resolve();
const automationControllers = new Map<string, AbortController>();

function withAutomationTasks<T>(operation: (tasks: AutomationTask[]) => T | Promise<T>): Promise<T> {
  const result = automationHistoryOps.then(async () => {
    if (!automationTasksCache) {
      automationTasksCache = await loadAutomationTasks(app.getPath("userData"), true);
      await saveAutomationTasks(app.getPath("userData"), automationTasksCache);
    }
    const value = await operation(automationTasksCache);
    automationTasksCache = normalizeAutomationTasks(automationTasksCache);
    await saveAutomationTasks(app.getPath("userData"), automationTasksCache);
    return value;
  });
  automationHistoryOps = result.then(() => undefined, () => undefined);
  return result;
}

async function patchAutomationTask(id: string, patch: Partial<AutomationTask>): Promise<AutomationTask | null> {
  return withAutomationTasks((tasks) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    return { ...task };
  });
}

async function readAutomationTasks(): Promise<AutomationTask[]> {
  return withAutomationTasks((tasks) => tasks.map((task) => ({ ...task })));
}

/**
 * O processamento completo de uma gravação (transcrever → achar os estouros → exportar), usado pela pasta vigiada e pelo webhook.
 * Toda origem entra na mesma fila persistente; o sucesso e a falha vão os dois para seen, e só o usuário pode pedir a repetição explicitamente.
 */
function makeRecordingProcessor(
  seen: SeenMap,
  config: LlmConfig,
  outDir: unknown,
  emit: (e: Omit<WatchEvent, "at">) => void,
  trigger: AutomationTask["trigger"]
): (f: WatchedFile, existingId?: string) => Promise<void> {
  const fontsDir = app.isPackaged
    ? join(process.resourcesPath, "fonts")
    : join(app.getAppPath(), "resources", "fonts");
  return async (f: WatchedFile, existingId?: string) => {
    const file = basename(f.path);
    const now = new Date().toISOString();
    const taskId = existingId ?? randomUUID();
    if (existingId) {
      await withAutomationTasks((tasks) => {
        const task = tasks.find((item) => item.id === taskId);
        if (!task) throw new Error("automation task not found");
        if (!["failed", "cancelled", "interrupted"].includes(task.status)) throw new Error("automation task is not retryable");
        Object.assign(task, {
          sourceSize: f.size,
          sourceMtimeMs: f.mtimeMs,
          trigger: "retry",
          status: "queued",
          stage: "queued",
          attempts: task.attempts + 1,
          clips: undefined,
          outDir: undefined,
          error: undefined,
          updatedAt: now,
        } satisfies Partial<AutomationTask>);
      });
    } else {
      await withAutomationTasks((tasks) => tasks.push({
        id: taskId,
        sourcePath: f.path,
        sourceName: file,
        sourceSize: f.size,
        sourceMtimeMs: f.mtimeMs,
        trigger,
        status: "queued",
        stage: "queued",
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      }));
    }
    emit({ type: "found", file, path: f.path, taskId });
    const markSeen = async (): Promise<void> => {
      seen[f.path] = { size: f.size, mtimeMs: f.mtimeMs };
      await writeFile(watchSeenPath(), JSON.stringify(seen), "utf8").catch(() => {});
    };

    const run = automationChain.then(async () => {
      const controller = new AbortController();
      automationControllers.set(taskId, controller);
      const claimed = await withAutomationTasks((tasks) => {
        const task = tasks.find((item) => item.id === taskId);
        if (!task || task.status !== "queued") return task?.status ?? null;
        Object.assign(task, { status: "running", stage: "transcribing", error: undefined, updatedAt: new Date().toISOString() });
        return "running" as const;
      });
      if (claimed !== "running") {
        automationControllers.delete(taskId);
        if (claimed === "cancelled") await markSeen();
        return;
      }
      try {
        const outcome = await autoClip(f.path, {
          outDir:
            typeof outDir === "string" && outDir.trim()
              ? join(outDir.trim(), sanitizeFilename(basename(f.path, extname(f.path)), "video"))
              : undefined,
          modelsRoot: modelsRoot(),
          cacheDir: transcriptCacheDir(),
          renderCacheDir: baseRenderCacheDir(),
          evidenceCacheDir: baseEvidenceCacheDir(),
          llm: config,
          fontsDir,
          glossary: await loadGlossary(app.getPath("userData")),
          reviewMemory: await loadReviewMemory(app.getPath("userData")),
          performanceMemory: await loadPerformanceMemory(app.getPath("userData")),
          onStage: (stage) => {
            void patchAutomationTask(taskId, { status: "running", stage: stage as AutomationTaskStage });
            emit({ type: stage, file, path: f.path, taskId });
          },
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        const exportedAt = new Date().toISOString();
        await registerPublishItems(
          app.getPath("userData"),
          outcome.exported.filter((clip) => clip.id > 0).map((clip) => {
            const candidate = outcome.candidates.find((item) => item.id === clip.id);
            return {
              filePath: clip.path,
              title: clip.title,
              hook: candidate?.hook,
              platform: "unassigned",
              durationSec: clip.durationSec,
              keywords: candidate?.keywords,
              exportedAt,
            };
          })
        ).catch((error) => console.error("automation publish ledger registration failed:", error));
        await patchAutomationTask(taskId, { status: "completed", clips: outcome.exported.length, outDir: outcome.outDir, error: undefined });
        emit({ type: "done", file, path: f.path, clips: outcome.exported.length, outDir: outcome.outDir, taskId });
      } catch (error) {
        const cancelled = controller.signal.aborted;
        const message = cancelled ? undefined : error instanceof Error ? error.message : String(error);
        await patchAutomationTask(taskId, { status: cancelled ? "cancelled" : "failed", error: message });
        if (!cancelled) emit({ type: "error", file, path: f.path, message, taskId });
      } finally {
        automationControllers.delete(taskId);
        await markSeen();
      }
    });
    automationChain = run.catch(() => {});
    await run;
  };
}

ipcMain.handle("hotclip:watch-start", async (event, dir: unknown, llm: unknown, outDir: unknown) => {
  if (typeof dir !== "string" || !dir.trim()) throw new Error("watch requires a directory");
  const config = llm as LlmConfig;
  if (!config?.baseUrl || !config?.model) throw new Error("configure o LLM (baseUrl/model) nas configurações primeiro");
  await webhookHandle?.close();
  webhookHandle = null;
  webhookInfo = null;
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  const seen = await loadWatchSeen();
  const emit = (e: Omit<WatchEvent, "at">): void => {
    if (!event.sender.isDestroyed()) event.sender.send("hotclip:watch-event", { ...e, at: Date.now() });
  };
  const process = makeRecordingProcessor(seen, config, outDir, emit, "folder");
  const watcher = new FolderWatcher({
    listDir: async () => {
      const names = await readdir(dir);
      const files: WatchedFile[] = [];
      for (const name of names.filter(isVideoFile)) {
        const p = join(dir, name);
        const s = await stat(p).catch(() => null);
        if (s?.isFile()) files.push({ path: p, size: s.size, mtimeMs: s.mtimeMs });
      }
      return files;
    },
    isSeen: (f) => isSeen(seen, f),
    onStable: process,
  });
  watchDirPath = dir;
  watchTimer = setInterval(() => void watcher.tick(), WATCH_POLL_MS);
  void watcher.tick();
});

ipcMain.handle("hotclip:watch-stop", async () => {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  watchDirPath = null;
});

ipcMain.handle("hotclip:watch-status", async () => ({ running: watchTimer !== null, dir: watchDirPath }));

ipcMain.handle("hotclip:automation-tasks-get", () => readAutomationTasks());

ipcMain.handle("hotclip:automation-task-cancel", async (_event, id: unknown) => {
  if (typeof id !== "string") return false;
  const cancelled = await withAutomationTasks((tasks) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || !["queued", "running"].includes(task.status)) return false;
    Object.assign(task, { status: "cancelled", error: undefined, updatedAt: new Date().toISOString() });
    return true;
  });
  if (cancelled) automationControllers.get(id)?.abort();
  return cancelled;
});

ipcMain.handle("hotclip:automation-tasks-clear", () => withAutomationTasks((tasks) => {
  const active = tasks.filter((task) => task.status === "queued" || task.status === "running");
  tasks.splice(0, tasks.length, ...active);
}));

ipcMain.handle("hotclip:automation-task-retry", async (event, id: unknown, llm: unknown, outDir: unknown) => {
  if (typeof id !== "string") return false;
  const config = llm as LlmConfig;
  if (!config?.baseUrl || !config?.model) throw new Error("configure o LLM (baseUrl/model) nas configurações primeiro");
  const task = (await readAutomationTasks()).find((item) => item.id === id);
  if (!task || ["queued", "running", "completed"].includes(task.status)) return false;
  const info = await stat(task.sourcePath).catch(() => null);
  if (!info?.isFile()) throw new Error("o arquivo de origem não existe ou não pode ser lido");
  const seen = await loadWatchSeen();
  const emit = (e: Omit<WatchEvent, "at">): void => {
    if (!event.sender.isDestroyed()) event.sender.send("hotclip:watch-event", { ...e, at: Date.now() });
  };
  const process = makeRecordingProcessor(seen, config, outDir, emit, "retry");
  void process({ path: task.sourcePath, size: info.size, mtimeMs: info.mtimeMs }, id).catch(() => {});
  return true;
});

// ---- Webhook de gravação: o aviso de fim de transmissão do gravador (recorder/blrec) já gera o corte (mais imediato que a consulta periódica) ----
// Só o laço local é atendido; o caminho que o aviso traz precisa estar dentro da pasta de gravações indicada pelo usuário (entrada externa não é confiável).
ipcMain.handle(
  "hotclip:webhook-start",
  async (event, dir: unknown, llm: unknown, outDir: unknown, port: unknown, token: unknown) => {
    if (typeof dir !== "string" || !dir.trim()) throw new Error("o webhook precisa de uma pasta de gravações");
    const config = llm as LlmConfig;
    if (!config?.baseUrl || !config?.model) throw new Error("configure o LLM (baseUrl/model) nas configurações primeiro");
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null;
    watchDirPath = null;
    const recDir = dir.trim();
    const s = await stat(recDir).catch(() => null);
    if (!s?.isDirectory()) throw new Error(`a pasta de gravações não existe: ${recDir}`);
    await webhookHandle?.close();
    webhookHandle = null;

    const seen = await loadWatchSeen();
    const emit = (e: Omit<WatchEvent, "at">): void => {
      if (!event.sender.isDestroyed()) event.sender.send("hotclip:watch-event", { ...e, at: Date.now() });
    };
    const process = makeRecordingProcessor(seen, config, outDir, emit, "webhook");
    const wanted = Number(port);
    webhookHandle = await startWebhookServer({
      port: Number.isFinite(wanted) && wanted > 0 && wanted < 65536 ? Math.round(wanted) : 17650,
      token: typeof token === "string" && token.trim() ? token.trim() : undefined,
      workDir: recDir,
      onLog: (message) => emit({ type: "error", file: "webhook", path: recDir, message }),
      onRecording: (e) => {
        // O aviso só diz "terminei de escrever"; se o arquivo é mesmo legível quem confere é este trecho, e o aviso repetido é barrado por seen
        webhookChain = webhookChain.then(async () => {
          const st = await stat(e.path).catch(() => null);
          if (!st?.isFile()) {
            emit({ type: "error", file: basename(e.path), path: e.path, message: "o arquivo apontado pelo aviso não existe ou não pode ser lido" });
            return;
          }
          const f: WatchedFile = { path: e.path, size: st.size, mtimeMs: st.mtimeMs };
          if (isSeen(seen, f)) return; // aviso repetido do mesmo arquivo (fim da escrita + fim do pós-processamento)
          await process(f);
        });
      },
    });
    webhookInfo = { port: webhookHandle.port, dir: recDir };
    return webhookInfo;
  }
);

ipcMain.handle("hotclip:webhook-stop", async () => {
  await webhookHandle?.close();
  webhookHandle = null;
  webhookInfo = null;
});

ipcMain.handle("hotclip:webhook-status", async () => ({
  running: webhookHandle !== null,
  port: webhookInfo?.port ?? null,
  dir: webhookInfo?.dir ?? null,
}));

// ---- Verificação de versão nova: a camada de renderização pergunta uma vez na inicialização, e a falha é silenciosa ----
let updateCache: UpdateInfo | null | undefined;
ipcMain.handle("hotclip:check-update", async () => {
  if (updateCache !== undefined) return updateCache;
  updateCache = await checkForUpdate(app.getVersion());
  return updateCache;
});

// ---- Vocabulário de termos: palavra errada → palavra certa, aplicado sozinho depois da transcrição (o desktop, o MCP e o vigia de gravações usam o mesmo) ----
ipcMain.handle("hotclip:glossary-get", async () => loadGlossary(app.getPath("userData")));
ipcMain.handle("hotclip:glossary-set", async (_event, entries: unknown) => {
  await saveGlossary(app.getPath("userData"), Array.isArray(entries) ? entries : []);
});

// Link externo só é liberado para o GitHub deste projeto (contra injeção de URL arbitrária no navegador do sistema)
ipcMain.on("hotclip:open-url", (_event, url: unknown) => {
  if (typeof url === "string" && url.startsWith("https://github.com/xixihhhh/hotclip")) {
    void shell.openExternal(url);
  }
});

ipcMain.on("hotclip:reveal", (_event, path: unknown) => {
  if (typeof path === "string" && path.trim()) shell.showItemInFolder(path);
});

app.whenReady().then(() => {
  protocol.handle("hotclip-media", serveMedia);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
