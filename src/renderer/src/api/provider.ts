import { ASR_CATALOG } from "../../../shared/asr-catalog";
/**
 * Provedor de API: resolve qual implementação de HotClipApi está ativa.
 *
 * - Dentro do Electron, o script de preload expõe `window.hotclip` (apoiado em IPC).
 * - Num navegador comum (hoje a pré-visualização do design, amanhã a plataforma web) a
 *   saída é um mock, para a interface inteira continuar renderizável e testável sem Electron.
 */
import type {
  HotClipApi,
  MediaInfo,
  Transcript,
  TranscribeProgressEvent,
  HighlightCandidate,
  DetectHighlightsResult,
  ExportProgressEvent,
  WatchEvent,
  GlossaryEntry,
  PerformanceEntry,
  PerformanceSummary,
  UrlImportProgressEvent,
  SessionCheckpoint,
  AutomationTask,
  ProjectOpenResult,
  ProjectSummary,
} from "../../../shared/api-types";
import { applyGlossaryToTranscript, sanitizeGlossary } from "../../../shared/glossary";
import { parseSubtitleTranscript } from "../../../shared/subtitle-import";
import { clipDurationSec } from "../../../shared/pieces";

const MOCK_MEDIA: MediaInfo = {
  durationSec: 5427.4, // 1:30:27 — a duração típica de um episódio de podcast
  hasVideo: true,
  hasAudio: true,
  width: 1920,
  height: 1080,
  fps: 29.97,
  bitRate: 4_500_000,
  videoCodec: "h264",
  audioCodec: "aac",
};

const MOCK_SENTENCES = [
  "Oi, gente, bem-vindo à minha live.",
  "Hoje eu trouxe um papel toalha muito bom, três camadas e não rasga molhado.",
  "Muita gente me pergunta qual é a diferença entre esse e o de dez reais do mercado.",
  "A diferença é essa aqui: olha a velocidade de absorção, eu jogo meio copo de água e não passa nada.",
  "E vem a caixa fechada, sai por menos de três reais o pacote, pode comprar sem medo.",
  "Quem gostou clica no link aqui embaixo, quem pedir hoje leva a versão de bolso de brinde.",
];

function mockTranscript(): Transcript {
  let t = 4.2;
  const segments = MOCK_SENTENCES.map((text, i) => {
    const dur = 2.2 + text.length * 0.14;
    const pieces = text.split(" ");
    const words = pieces.map((piece, j) => ({
      text: piece,
      startSec: t + (dur * j) / pieces.length,
      endSec: t + (dur * (j + 1)) / pieces.length,
      // Uma frase com tempo estimado, sempre a mesma, para o QA no navegador exercitar a
      // interface de revisão dirigida; as outras palavras do mock imitam o ASR nativo.
      timingSource: i === 1 ? "edited" as const : "native" as const,
    }));
    const seg = { id: i + 1, startSec: t, endSec: t + dur, text, words };
    t += dur + 0.6;
    return seg;
  });
  return { language: "pt", segments, engine: "mock", durationSec: MOCK_MEDIA.durationSec };
}

type ProgressCb = (p: TranscribeProgressEvent) => void;
const progressListeners = new Set<ProgressCb>();
let mockSpeechCancelled = false;
let mockSpeechCompleted = 0;
let mockAlignmentCancelled = false;
const emit = (p: TranscribeProgressEvent): void => progressListeners.forEach((cb) => cb(p));
type ExportCb = (p: ExportProgressEvent) => void;
const exportListeners = new Set<ExportCb>();
const emitExport = (p: ExportProgressEvent): void => exportListeners.forEach((cb) => cb(p));
const urlImportListeners = new Set<(p: UrlImportProgressEvent) => void>();
const emitUrlImport = (p: UrlImportProgressEvent): void => urlImportListeners.forEach((cb) => cb(p));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// Demonstração do vigia de gravações: ao ligar, uma rodada de eventos sai conforme o roteiro
type WatchCb = (e: WatchEvent) => void;
const watchListeners = new Set<WatchCb>();
let watchRunning = false;
let watchDirDemo: string | null = null;
let webhookPortDemo: number | null = null;
const emitWatch = (e: Omit<WatchEvent, "at">): void => {
  if (watchRunning) watchListeners.forEach((cb) => cb({ ...e, at: Date.now() }));
};
let mockExportCancelled = false;
let mockUrlImportCancelled = false;
let mockSessionCheckpoint: SessionCheckpoint | null = null;
let mockActiveProjectId: string | null = null;
let mockProjectSerial = 0;
let mockProjects: Array<{ summary: ProjectSummary; checkpoint: SessionCheckpoint }> = [];
let mockAutomationTasks: AutomationTask[] = [
  { id: "demo-done", sourcePath: "/demo/entrevista-gravada.mp4", sourceName: "entrevista-gravada.mp4", sourceSize: 1_200_000_000, sourceMtimeMs: 1, trigger: "folder", status: "completed", stage: "exporting", attempts: 1, clips: 5, outDir: "/demo/entrevista-gravada-hotclip", createdAt: "2026-08-23T02:10:00Z", updatedAt: "2026-08-23T02:18:00Z" },
  { id: "demo-failed", sourcePath: "/demo/live-que-caiu.flv", sourceName: "live-que-caiu.flv", sourceSize: 420_000_000, sourceMtimeMs: 2, trigger: "webhook", status: "failed", stage: "transcribing", attempts: 1, error: "o fim do arquivo de mídia está incompleto", createdAt: "2026-08-22T12:00:00Z", updatedAt: "2026-08-22T12:01:00Z" },
];
let mockPerformanceEntries: PerformanceEntry[] = [
  { title: "três minutos para entender os erros de impulsionamento na live", hook: "quanto mais eu impulsiono, por que aparece menos gente?", platform: "youtube", views: 128_000, likes: 8_240, comments: 611, shares: 1_420, saves: 3_180, durationSec: 43, keywords: ["impulsionamento", "gestão de live"], importedAt: "2026-08-20T00:00:00Z" },
  { contentId: "hc_exp_control", title: "teste de absorção do papel toalha", hook: "o que acontece ao jogar meio copo de água", platform: "tiktok", views: 86_000, likes: 5_600, comments: 288, shares: 932, saves: 1_410, durationSec: 24, keywords: ["teste real", "casa"], publishedAt: "2026-08-21T08:00:00Z", importedAt: "2026-08-22T00:00:00Z" },
  { contentId: "hc_exp_challenger", title: "o papel toalha de três reais é absurdo", hook: "esquece o preço, olha esse meio copo de água", platform: "tiktok", views: 100_000, likes: 12_000, comments: 500, shares: 1_600, saves: 2_500, durationSec: 24, keywords: ["teste real", "casa"], publishedAt: "2026-08-21T09:00:00Z", importedAt: "2026-08-22T00:00:00Z" },
  { title: "trecho de conversa solta da live", platform: "youtube", views: 2_100, likes: 33, comments: 4, shares: 1, saves: 2, durationSec: 58, importedAt: "2026-08-22T00:00:00Z" },
  { title: "hoje eu vou apresentar para vocês", platform: "tiktok", views: 1_280, likes: 12, comments: 1, shares: 0, saves: 1, durationSec: 37, importedAt: "2026-08-22T00:00:00Z" },
];

function mockPerformanceSummary(): PerformanceSummary {
  const sorted = [...mockPerformanceEntries].sort((a, b) => {
    const score = (e: PerformanceEntry): number =>
      (e.likes + e.comments * 2 + e.shares * 3 + e.saves * 3) / (e.views + 200);
    return score(b) - score(a);
  });
  const half = Math.max(1, Math.floor(sorted.length / 2));
  const control = mockPerformanceEntries.find((entry) => entry.contentId === "hc_exp_control");
  const challenger = mockPerformanceEntries.find((entry) => entry.contentId === "hc_exp_challenger");
  const experimentMeasured = Boolean(control && challenger);
  return {
    total: sorted.length,
    platforms: [...new Set(sorted.map((e) => e.platform))].sort(),
    winners: sorted.slice(0, half),
    laggards: sorted.length >= 4 ? sorted.slice(half).reverse() : [],
    publishing: {
      total: 4,
      awaitingMetrics: experimentMeasured ? 1 : 3,
      measured: experimentMeasured ? 3 : 1,
      recent: [
        { contentId: "hc_exp_challenger", filePath: "/demo/papel-toalha-v2.mp4", title: "o papel toalha de três reais é absurdo", platform: "douyin", durationSec: 24, exportedAt: "2026-08-21T07:00:00Z", metricsImportedAt: experimentMeasured ? "2026-08-22T00:00:00Z" : undefined, experimentId: "hcx_demo", variantIndex: 2, variantTotal: 2, variantRole: "challenger", experimentDimensions: ["packaging"] },
        { contentId: "hc_exp_control", filePath: "/demo/papel-toalha-v1.mp4", title: "teste de absorção do papel toalha", platform: "douyin", durationSec: 24, exportedAt: "2026-08-21T07:00:00Z", metricsImportedAt: experimentMeasured ? "2026-08-22T00:00:00Z" : undefined, experimentId: "hcx_demo", variantIndex: 1, variantTotal: 2, variantRole: "control", experimentDimensions: ["packaging"] },
        { contentId: "hc_demo1", filePath: "/demo/como-economizar.mp4", title: "três passos para cortar a assinatura", platform: "tiktok", durationSec: 32, exportedAt: "2026-08-24T08:00:00Z" },
        { contentId: "hc_demo2", filePath: "/demo/dica-de-ajuste.mp4", title: "o ajuste que nove de dez pessoas erram", platform: "instagram", durationSec: 28, exportedAt: "2026-08-24T07:00:00Z", metricsImportedAt: "2026-08-24T09:00:00Z" },
      ],
    },
    experiments: {
      total: 1,
      ready: experimentMeasured ? 1 : 0,
      awaiting: experimentMeasured ? 0 : 1,
      insufficient: 0,
      recent: [{
        experimentId: "hcx_demo",
        platform: "douyin",
        dimensions: ["packaging"],
        variantTotal: 2,
        measuredVariants: experimentMeasured ? 2 : 0,
        status: experimentMeasured ? "directional" : "awaiting-metrics",
        createdAt: "2026-08-21T07:00:00Z",
        ...(experimentMeasured ? { leaderContentId: "hc_exp_challenger", relativeLiftPct: 64.8, absoluteLiftPoints: 9.95 } : {}),
        variants: [
          { contentId: "hc_exp_control", title: "teste de absorção do papel toalha", index: 1, role: "control", ...(control ? { views: control.views, weightedEngagementRate: 15.35, publishedAt: control.publishedAt } : {}) },
          { contentId: "hc_exp_challenger", title: "o papel toalha de três reais é absurdo", index: 2, role: "challenger", ...(challenger ? { views: challenger.views, weightedEngagementRate: 25.3, publishedAt: challenger.publishedAt } : {}) },
        ],
      }],
    },
  };
}
// Persistência do vocabulário na pré-visualização do navegador: o localStorage faz o papel do glossary.json do processo principal
const GLOSSARY_LS_KEY = "hotclip-glossary";
function mockGlossaryLoad(): GlossaryEntry[] {
  try {
    return sanitizeGlossary(JSON.parse(localStorage.getItem(GLOSSARY_LS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/** Mock do modo navegador: dados falsos determinísticos, com uma latência encenada realista. */
const browserMock: HotClipApi = {
  async selectMedia() {
    await sleep(300);
    return "/demo/minha-live-2026-07-04.mp4";
  },
  async importMediaUrl() {
    mockUrlImportCancelled = false;
    emitUrlImport({ stage: "resolving" });
    await sleep(350);
    for (let i = 1; i <= 5; i++) {
      if (mockUrlImportCancelled) throw new DOMException("Aborted", "AbortError");
      emitUrlImport({ stage: "downloading-media", fraction: i / 5, downloadedBytes: i * 20_000_000, totalBytes: 100_000_000, speedBytesPerSec: 8_000_000, etaSec: 5 - i });
      await sleep(220);
    }
    emitUrlImport({ stage: "merging" });
    await sleep(300);
    emitUrlImport({ stage: "done", fraction: 1 });
    return { filePath: "/demo/importado-da-web-entrevista.mp4" };
  },
  onUrlImportProgress(cb) {
    urlImportListeners.add(cb);
    return () => urlImportListeners.delete(cb);
  },
  cancelUrlImport() {
    mockUrlImportCancelled = true;
  },
  async projectWorkspaceGet() {
    const activeRecord = mockProjects.find((item) => item.summary.id === mockActiveProjectId);
    const active: ProjectOpenResult | null = activeRecord
      ? { project: structuredClone(activeRecord.summary), checkpoint: activeRecord.summary.status === "ready" ? structuredClone(activeRecord.checkpoint) : null }
      : null;
    return { projects: structuredClone(mockProjects.map((item) => item.summary)), activeProjectId: mockActiveProjectId, active };
  },
  async projectCreate(checkpoint, name) {
    const now = new Date().toISOString();
    const id = `demo-project-${++mockProjectSerial}`;
    const sourceName = checkpoint.file.path.split(/[\\/]/).pop() ?? checkpoint.file.path;
    const summary: ProjectSummary = {
      id,
      name: name?.trim() || sourceName.replace(/\.[^.]+$/, ""),
      sourcePath: checkpoint.file.path,
      sourceName,
      status: "ready",
      hasTranscript: checkpoint.transcript !== null,
      candidateCount: checkpoint.candidates?.length ?? 0,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    const saved = structuredClone(checkpoint);
    mockProjects.push({ summary, checkpoint: saved });
    mockActiveProjectId = id;
    return { project: structuredClone(summary), checkpoint: structuredClone(saved) };
  },
  async projectOpen(id) {
    const record = mockProjects.find((item) => item.summary.id === id);
    if (!record) return null;
    record.summary.lastOpenedAt = new Date().toISOString();
    mockActiveProjectId = id;
    return {
      project: structuredClone(record.summary),
      checkpoint: record.summary.status === "ready" ? structuredClone(record.checkpoint) : null,
    };
  },
  async projectSave(id, checkpoint) {
    const record = mockProjects.find((item) => item.summary.id === id);
    if (!record || record.summary.status !== "ready" || record.summary.sourcePath !== checkpoint.file.path) return false;
    record.checkpoint = structuredClone(checkpoint);
    record.summary.updatedAt = new Date().toISOString();
    record.summary.hasTranscript = checkpoint.transcript !== null;
    record.summary.candidateCount = checkpoint.candidates?.length ?? 0;
    return true;
  },
  async projectRename(id, name) {
    const record = mockProjects.find((item) => item.summary.id === id);
    if (!record) return null;
    record.summary.name = name.trim().replace(/\s+/g, " ").slice(0, 80) || record.summary.name;
    record.summary.updatedAt = new Date().toISOString();
    return structuredClone(record.summary);
  },
  async projectDelete(id) {
    const before = mockProjects.length;
    mockProjects = mockProjects.filter((item) => item.summary.id !== id);
    if (mockActiveProjectId === id) mockActiveProjectId = null;
    return mockProjects.length !== before;
  },
  async projectRelink(id, filePath) {
    const record = mockProjects.find((item) => item.summary.id === id);
    if (!record) return null;
    record.checkpoint = { ...record.checkpoint, file: { ...record.checkpoint.file, path: filePath }, savedAt: new Date().toISOString() };
    record.summary = {
      ...record.summary,
      sourcePath: filePath,
      sourceName: filePath.split(/[\\/]/).pop() ?? filePath,
      status: "ready",
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    mockActiveProjectId = id;
    return { project: structuredClone(record.summary), checkpoint: structuredClone(record.checkpoint) };
  },
  async projectClose() {
    mockActiveProjectId = null;
  },
  async sessionCheckpointGet() {
    return mockSessionCheckpoint ? structuredClone(mockSessionCheckpoint) : null;
  },
  async sessionCheckpointSave(checkpoint) {
    mockSessionCheckpoint = structuredClone(checkpoint);
    return true;
  },
  async sessionCheckpointClear() {
    mockSessionCheckpoint = null;
  },
  async automationTasksGet() {
    return structuredClone(mockAutomationTasks);
  },
  async automationTaskRetry(id) {
    const task = mockAutomationTasks.find((item) => item.id === id);
    if (!task || ["queued", "running", "completed"].includes(task.status)) return false;
    Object.assign(task, { status: "queued", stage: "queued", attempts: task.attempts + 1, error: undefined, updatedAt: new Date().toISOString() });
    return true;
  },
  async automationTaskCancel(id) {
    const task = mockAutomationTasks.find((item) => item.id === id);
    if (!task || !["queued", "running"].includes(task.status)) return false;
    task.status = "cancelled";
    task.updatedAt = new Date().toISOString();
    return true;
  },
  async automationTasksClear() {
    mockAutomationTasks = mockAutomationTasks.filter((task) => task.status === "queued" || task.status === "running");
  },
  async listAsrEngines() {
    await sleep(200);
    return ASR_CATALOG.map((facts) => ({ ...facts, installed: facts.id === "sensevoice" }));
  },
  async probeMedia() {
    await sleep(600);
    return { ...MOCK_MEDIA };
  },
  cancelTranscribe() { mockSpeechCancelled = true; },
  async checkLocalSpeech() { throw new Error("qwen:browser-preview-no-service"); },
  cancelAlignment() { mockAlignmentCancelled = true; },
  async previewAlignment(_file, transcript, request) {
    mockAlignmentCancelled = false;
    await sleep(900);
    if (mockAlignmentCancelled) throw new Error("speech:cancelled");
    const segments = transcript.segments.filter((s) => request.segmentIds.includes(s.id)).map((s) => ({ ...s, words: s.words.map((w) => ({ ...w, timingSource: "aligned" as const })) }));
    return { segments, skipped: [], alignedWords: segments.reduce((n, s) => n + s.words.length, 0), uncertainWords: 0 };
  },
  async transcribeMedia(_file, _engine, _key, options) {
    mockSpeechCancelled = false;
    if (options?.restart) mockSpeechCompleted = 0;
    const resumed = mockSpeechCompleted;
    const total = 170 * 1024 * 1024;
    for (let i = 1; i <= 4; i++) {
      emit({ fraction: 0, stage: "downloading-model", downloadedBytes: (total * i) / 4, totalBytes: total });
      await sleep(280);
      if (mockSpeechCancelled) throw new Error("speech:cancelled");
    }
    emit({ fraction: 0, stage: "decoding" });
    await sleep(500);
    for (let i = resumed + 1; i <= 8; i++) {
      if (mockSpeechCancelled) throw new Error("speech:cancelled");
      emit({ fraction: i / 8, stage: "transcribing", completedWindows: i, totalWindows: 8, resumedWindows: resumed });
      mockSpeechCompleted = i;
      await sleep(320);
    }
    emit({ fraction: 1, stage: "finalizing" });
    await sleep(250);
    if (mockSpeechCancelled) throw new Error("speech:cancelled");
    mockSpeechCompleted = 0;
    // Igual ao processo principal: o vocabulário de termos é aplicado antes de devolver a transcrição
    return applyGlossaryToTranscript(mockTranscript(), mockGlossaryLoad()).transcript;
  },
  async importSubtitle(_filePath, text, format) {
    return parseSubtitleTranscript(text, format, MOCK_MEDIA.durationSec);
  },
  onTranscribeProgress(cb) {
    progressListeners.add(cb);
    return () => progressListeners.delete(cb);
  },
  async exportClips(_filePath, clips, options) {
    mockExportCancelled = false;
    emitExport({ current: 0, total: clips.length, clipId: clips[0]?.id ?? 0, stage: "preparing", preparation: "media" });
    await sleep(700);
    if (mockExportCancelled) throw new Error("export cancelled");
    const results = [];
    for (let i = 0; i < clips.length; i++) {
      if (mockExportCancelled) throw new Error("export cancelled");
      // Demonstra o progresso real da codificação dentro de cada trecho
      for (let f = 0; f <= 1; f += 0.25) {
        emitExport({ current: i + 1, total: clips.length, clipId: clips[i].id, stage: "cutting", fraction: f });
        await sleep(220);
        if (mockExportCancelled) throw new Error("export cancelled");
      }
      if (mockExportCancelled) throw new Error("export cancelled");
      emitExport({ current: i + 1, total: clips.length, clipId: clips[i].id, stage: "done" });
      results.push({
        id: clips[i].id,
        title: clips[i].title,
        path: `/Movies/HotClip/minha-live-2026-07-04/0${i + 1}-${clips[i].title}.mp4`,
        sizeBytes: 8_400_000 + i * 1_700_000,
        durationSec: clipDurationSec(clips[i]),
      });
    }
    emitExport({ current: clips.length, total: clips.length, clipId: clips.at(-1)?.id ?? 0, stage: "finalizing" });
    await sleep(600);
    if (mockExportCancelled) throw new Error("export cancelled");
    // Igual ao processo principal: o compilado é colado por cópia de fluxo na ordem do tempo, com o carimbo de cada capítulo
    if (options?.compilation && results.length > 1) {
      results.push({
        id: 0,
        title: "Compilado dos melhores momentos",
        path: "/Movies/HotClip/minha-live-2026-07-04/00-compilado.mp4",
        sizeBytes: results.reduce((a, r) => a + r.sizeBytes, 0),
        durationSec: results.reduce((a, r) => a + r.durationSec, 0),
      });
    }
    // Vários enquadramentos: a versão horizontal original vai para a subpasta «horizontal/» (item de demonstração)
    if (options?.alsoLandscape && options?.vertical) {
      for (const r of results.filter((x) => x.id > 0)) {
        results.push({
          ...r,
          id: -r.id - 1,
          title: `${r.title} (horizontal)`,
          path: r.path.replace("/minha-live-2026-07-04/", "/minha-live-2026-07-04/horizontal/"),
        });
      }
    }
    return results;
  },
  onExportProgress(cb) {
    exportListeners.add(cb);
    return () => exportListeners.delete(cb);
  },
  cancelExport() {
    mockExportCancelled = true;
  },
  revealClip() {
    /* mock do navegador: não há nada para revelar */
  },
  // A pré-visualização do navegador não alcança arquivo local — a área de vídeo da mesa de revisão vira um aviso, e a linha de tempo continua funcionando
  mediaUrl: () => "",
  async selectImage() {
    await sleep(300);
    return "/demo/brand-logo.png"; // pré-visualização do navegador: um caminho falso volta para o fluxo da interface poder ser percorrido
  },
  async selectAudio() {
    await sleep(300);
    return "/demo/bgm.mp3"; // pré-visualização do navegador: um caminho falso volta para o fluxo da interface poder ser percorrido
  },
  // Trilha por IA: a pré-visualização do navegador simula o tempo de geração e devolve um caminho falso (a geração real passa pela nuvem Atlas)
  async generateBgm() {
    await sleep(1800);
    return "/demo/ai-bgm-auto-mock.mp3";
  },
  // A pré-visualização do navegador não alcança quadro local — a olhada rápida na imagem simplesmente não aparece
  async contactSheet() {
    return "";
  },
  // A pré-visualização do navegador não tem processo principal para fazer o pedido — uma lista de demonstração faz a interface de escolha de modelo funcionar
  async listLlmModels() {
    await sleep(400);
    return { ids: ["deepseek-v4-flash", "deepseek-v4-pro", "qwen-plus", "glm-4.7"], error: null };
  },
  // A pré-visualização do navegador não tem arquivo de preferências local — o registro é descartado em silêncio
  async recordReview() {},
  async performanceGet() {
    await sleep(180);
    return mockPerformanceSummary();
  },
  async performanceImport() {
    await sleep(700);
    const at = new Date().toISOString();
    mockPerformanceEntries = [
      ...mockPerformanceEntries,
      { title: "tutorial recém-importado, muito salvo", hook: "esse ajuste nove de dez pessoas erram", platform: "instagram", views: 45_000, likes: 3_600, comments: 190, shares: 740, saves: 2_900, durationSec: 31, keywords: ["tutorial", "ajuste"], importedAt: at },
    ];
    return { imported: 1, skipped: 0, total: mockPerformanceEntries.length, correlation: { matched: 1, unmatched: 0, ambiguous: 0, unmatchedTitles: [], ambiguousTitles: [] } };
  },
  async performanceTemplate() {
    await sleep(350);
    return { count: 2, path: "/demo/HotClip-dados-de-desempenho.csv" };
  },
  async performanceClear() {
    await sleep(250);
    mockPerformanceEntries = [];
  },
  async diagnosticsRun(llm, locale) {
    await sleep(450);
    return {
      generatedAt: new Date().toISOString(),
      missingCoreModels: 1,
      checks: [
        { id: "binary:ffmpeg", name: "ffmpeg", status: "ok" as const, detail: "ffmpeg 7.1 bundled" },
        { id: "binary:ffprobe", name: "ffprobe", status: "ok" as const, detail: "ffprobe 7.1 bundled" },
        { id: "model:sensevoice-2024-07-17", name: "SenseVoice", status: "warn" as const, detail: "não instalado (cerca de 1,1GB)", fix: "pode ser baixado antes, ou sozinho na primeira transcrição" },
        { id: "disk", name: "espaço em disco", status: "ok" as const, detail: "86,4GB livres" },
        { id: "llm", name: "endpoint de LLM", status: llm ? "ok" as const : "warn" as const, detail: llm ? `${llm.model} endpoint reachable` : "não configurado" },
        { id: "cache", name: "cache de transcrição", status: "ok" as const, detail: "248MB" },
        { id: "render-cache", name: "cache da renderização base", status: "ok" as const, detail: "386MB (a exportação repetida reaproveita direto; o limite automático é 1GB)" },
        { id: "evidence-index", name: locale === "en" ? "Multimodal evidence index" : "índice de evidências multimodais", status: "ok" as const, detail: locale === "en" ? "18MB (motion/shot/vision evidence reused across jobs; automatically limited to 64MB)" : "18MB (as evidências de movimento/corte/imagem são reaproveitadas entre tarefas; o limite automático é 64MB)" },
      ],
    };
  },
  async diagnosticsClearRenderCache(llm, locale) {
    await sleep(350);
    return {
      generatedAt: new Date().toISOString(),
      missingCoreModels: 1,
      checks: [
        { id: "binary:ffmpeg", name: "ffmpeg", status: "ok" as const, detail: "ffmpeg 7.1 bundled" },
        { id: "binary:ffprobe", name: "ffprobe", status: "ok" as const, detail: "ffprobe 7.1 bundled" },
        { id: "model:sensevoice-2024-07-17", name: "SenseVoice", status: "warn" as const, detail: "não instalado (cerca de 1,1GB)", fix: "pode ser baixado antes, ou sozinho na primeira transcrição" },
        { id: "disk", name: "espaço em disco", status: "ok" as const, detail: "86,8GB livres" },
        { id: "llm", name: "endpoint de LLM", status: llm ? "ok" as const : "warn" as const, detail: llm ? `${llm.model} endpoint reachable` : "não configurado" },
        { id: "cache", name: "cache de transcrição", status: "ok" as const, detail: "248MB" },
        { id: "render-cache", name: "cache da renderização base", status: "ok" as const, detail: "vazio (vai se formando depois das exportações)" },
        { id: "evidence-index", name: locale === "en" ? "Multimodal evidence index" : "índice de evidências multimodais", status: "ok" as const, detail: locale === "en" ? "18MB (motion/shot/vision evidence reused across jobs; automatically limited to 64MB)" : "18MB (as evidências de movimento/corte/imagem são reaproveitadas entre tarefas; o limite automático é 64MB)" },
      ],
    };
  },
  async diagnosticsClearEvidenceIndex(llm, locale) {
    await sleep(350);
    return {
      generatedAt: new Date().toISOString(),
      missingCoreModels: 1,
      checks: [
        { id: "binary:ffmpeg", name: "ffmpeg", status: "ok" as const, detail: "ffmpeg 7.1 bundled" },
        { id: "binary:ffprobe", name: "ffprobe", status: "ok" as const, detail: "ffprobe 7.1 bundled" },
        { id: "model:sensevoice-2024-07-17", name: "SenseVoice", status: "warn" as const, detail: "não instalado (cerca de 1,1GB)", fix: "pode ser baixado antes, ou sozinho na primeira transcrição" },
        { id: "disk", name: "espaço em disco", status: "ok" as const, detail: "86,8GB livres" },
        { id: "llm", name: "endpoint de LLM", status: llm ? "ok" as const : "warn" as const, detail: llm ? `${llm.model} endpoint reachable` : "não configurado" },
        { id: "cache", name: "cache de transcrição", status: "ok" as const, detail: "248MB" },
        { id: "render-cache", name: "cache da renderização base", status: "ok" as const, detail: "386MB (a exportação repetida reaproveita direto; o limite automático é 1GB)" },
        { id: "evidence-index", name: locale === "en" ? "Multimodal evidence index" : "índice de evidências multimodais", status: "ok" as const, detail: locale === "en" ? "Empty (builds as sources are analyzed)" : "vazio (vai se formando conforme o material é analisado)" },
      ],
    };
  },
  async diagnosticsPrepareModels(llm, locale) {
    await sleep(1200);
    return {
      generatedAt: new Date().toISOString(),
      missingCoreModels: 0,
      checks: [
        { id: "binary:ffmpeg", name: "ffmpeg", status: "ok" as const, detail: "ffmpeg 7.1 bundled" },
        { id: "binary:ffprobe", name: "ffprobe", status: "ok" as const, detail: "ffprobe 7.1 bundled" },
        { id: "model:sensevoice-2024-07-17", name: "SenseVoice", status: "ok" as const, detail: "instalado" },
        { id: "disk", name: "espaço em disco", status: "ok" as const, detail: "85,3GB livres" },
        { id: "llm", name: "endpoint de LLM", status: llm ? "ok" as const : "warn" as const, detail: llm ? `${llm.model} endpoint reachable` : "não configurado" },
        { id: "cache", name: "cache de transcrição", status: "ok" as const, detail: "248MB" },
        { id: "render-cache", name: "cache da renderização base", status: "ok" as const, detail: "386MB (a exportação repetida reaproveita direto; o limite automático é 1GB)" },
        { id: "evidence-index", name: locale === "en" ? "Multimodal evidence index" : "índice de evidências multimodais", status: "ok" as const, detail: locale === "en" ? "18MB (motion/shot/vision evidence reused across jobs; automatically limited to 64MB)" : "18MB (as evidências de movimento/corte/imagem são reaproveitadas entre tarefas; o limite automático é 64MB)" },
      ],
    };
  },
  onDiagnosticsProgress(cb) {
    const timer = window.setTimeout(() => cb({ modelId: "sensevoice-2024-07-17", current: 1, total: 1, phase: "download", fraction: 0.72 }), 300);
    return () => window.clearTimeout(timer);
  },
  diagnosticsCancelRepair() {},
  async getAudioPeaks(_filePath, startSec, endSec) {
    await sleep(250);
    const hopSec = 1 / 30;
    const n = Math.max(0, Math.floor((endSec - startSec) / hopSec));
    // Forma de onda falsa determinística: um envelope que alterna fala e pausa, para a pré-visualização do navegador mostrar como a linha de tempo se parece
    const values = Array.from({ length: n }, (_, i) => {
      const t = startSec + i * hopSec;
      const talking = (Math.sin(t * 0.9) + 1) / 2 > 0.25 ? 1 : 0.1;
      const syllable = 0.3 + 0.7 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.1));
      return Math.min(1, talking * syllable);
    });
    return { values, startSec, hopSec };
  },
  // Pré-visualização do navegador: curva falsa determinística — alguns picos gaussianos sobre um ruído de fundo, e a linha de tempo aparece inteira
  async timelineData(_filePath, durationSec) {
    await sleep(400);
    const bins = Math.min(720, Math.max(120, Math.round(durationSec / 5)));
    const peakAt = [0.14, 0.3, 0.42, 0.55, 0.68, 0.86];
    const curve = (amp: number[], noise: number, width: number): number[] =>
      Array.from({ length: bins }, (_, i) => {
        const x = i / bins;
        let v = 0;
        for (let p = 0; p < peakAt.length; p++) v += amp[p % amp.length] * Math.exp(-((x - peakAt[p]) ** 2) / (2 * width * width));
        v += noise * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
        return Math.min(1, v);
      });
    return {
      loudness: curve([0.7, 0.5, 0.6, 0.4, 0.65, 0.55], 0.18, 0.03),
      motion: curve([0.35, 0.88, 0.52, 0.76, 0.45, 0.82], 0.12, 0.02),
      danmaku: curve([0.95, 0.7, 0.4, 0.55, 0.6, 0.8], 0.06, 0.018),
      thumbs: [],
      binSec: durationSec / bins,
    };
  },
  async selectDir() {
    await sleep(300);
    return "/demo/pasta-de-gravacoes";
  },
  async defaultOutDir() {
    return "/Movies/HotClip";
  },
  // A pré-visualização do navegador não tem pasta de modelos de verdade: um inventário de forma realista faz a página de configurações continuar legível
  async modelsInfo() {
    await sleep(200);
    const root = "/Library/Application Support/hotclip/models";
    const demo = [
      ["sensevoice-2024-07-17", "useAsrFast", true, 940_000_000, 1_047_870_769],
      ["paraformer-zh-2023-09-14", "useAsrAccurate", false, 0, 251_658_240],
      ["fireredasr-aed-l", "useAsrDialect", false, 0, 545_259_520],
      ["punct-zh-en", "usePunct", true, 41_900_000, 44_040_192],
      ["segmentation-pyannote", "useDiarize", false, 0, 6_291_456],
      ["speaker-embedding-3dspeaker", "useDiarize", false, 0, 41_943_040],
      ["yunet-face", "useFace", true, 227_000, 236_544],
      ["emotion-ferplus", "useEmotion", false, 0, 35_651_584],
      ["transnetv2-onnx", "useShots", true, 31_250_929, 31_250_929],
      ["silero-vad-v6", "useSpeechSafety", true, 643_854, 643_854],
      ["dpdfnet2-48khz-hr", "useSpeechEnhance", false, 0, 10_596_848],
    ] as const;
    const entries = demo.map(([id, useKey, installed, bytes, approxBytes]) => ({ id, useKey, installed, bytes, approxBytes }));
    return { root, defaultRoot: root, totalBytes: entries.reduce((a, e) => a + e.bytes, 0), entries };
  },
  async moveModelsDir(dir) {
    await sleep(500);
    return dir;
  },
  openFolder() {
    /* mock do navegador: não há gerenciador de arquivos para abrir */
  },
  async watchStart(dir) {
    watchRunning = true;
    watchDirDemo = dir;
    // Roteiro da demonstração: uma gravação nova é descoberta → transcrição → busca dos estouros → corte pronto
    const file = "live-gravada-2026-07-10.flv";
    const path = `${dir}/${file}`;
    const script: Array<[Omit<WatchEvent, "at">, number]> = [
      [{ type: "found", file, path }, 1200],
      [{ type: "transcribing", file, path }, 2600],
      [{ type: "detecting", file, path }, 5200],
      [{ type: "exporting", file, path }, 7400],
      [{ type: "done", file, path, clips: 4, outDir: `${dir}/live-gravada-2026-07-10-hotclip` }, 9600],
    ];
    for (const [e, delay] of script) setTimeout(() => emitWatch(e), delay);
  },
  async watchStop() {
    watchRunning = false;
    watchDirDemo = null;
  },
  async watchStatus() {
    return { running: watchRunning, dir: watchDirDemo };
  },
  // A pré-visualização do navegador não sobe um endpoint HTTP de verdade, então o mesmo roteiro de demonstração é reaproveitado (o fluxo da interface roda inteiro)
  async webhookStart(dir, llm, outDir, port) {
    await this.watchStart(dir, llm, outDir);
    webhookPortDemo = port ?? 17650;
    return { port: webhookPortDemo, dir };
  },
  async webhookStop() {
    watchRunning = false;
    watchDirDemo = null;
    webhookPortDemo = null;
  },
  async webhookStatus() {
    return { running: watchRunning && webhookPortDemo !== null, port: webhookPortDemo, dir: watchDirDemo };
  },
  onWatchEvent(cb) {
    watchListeners.add(cb);
    return () => watchListeners.delete(cb);
  },
  async checkUpdate() {
    return null; // a pré-visualização do navegador não avisa de atualização
  },
  async glossaryGet() {
    await sleep(80);
    return mockGlossaryLoad();
  },
  async glossarySet(entries) {
    localStorage.setItem(GLOSSARY_LS_KEY, JSON.stringify(sanitizeGlossary(entries)));
  },
  openUrl(url) {
    window.open(url, "_blank", "noreferrer");
  },
  async detectHighlights(transcript, _llm, _filePath, diarize, prefilter, vision, _length, products, referencePath, _genre, _brief, scan): Promise<DetectHighlightsResult> {
    await sleep(1500);
    // Pré-visualização do navegador: se um vídeo de referência foi dado, um perfil de demonstração aparece
    const reference = referencePath
      ? { durationSec: 42, speechRate: 5.2, avgSentenceLen: 14, cutsPerMin: 18, hookLine: "Você acredita que foi a mesma pessoa que editou isso?", charUnits: false }
      : undefined;
    // Pré-visualização do navegador: com a triagem local ligada, uma estatística de funil aparece
    const funnel = prefilter
      ? { totalSegments: 220, keptSegments: 41, totalChars: 12800, keptChars: 2400 }
      : undefined;
    // Com o sinal visual ligado aparece uma estatística de amostragem de quadros; com a varredura completa, a ordem de grandeza da edição de varredura
    const visionStats = vision
      ? scan
        ? {
            framesTotal: 240,
            framesScored: 233,
            peakCount: 9,
            fullScan: true,
            notedMoments: 14,
            notes: [
              { t: 48, energy: 8, note: "close no teste de absorção do papel toalha", visibleText: ["três camadas", "R$ 2,90"] },
              { t: 126, energy: 7, note: "imagem da comparação de preço", visibleText: ["dez reais vs três reais"] },
            ],
          }
        : { framesTotal: 20, framesScored: 18, peakCount: 3 }
      : undefined;
    // O sinal de pico de expressão roda sozinho, sem configuração, e a pré-visualização do navegador sempre entrega a estatística de demonstração
    const emotionStats = { framesTotal: 96, facesScored: 74, peakCount: 2 };
    // Sinal do chat: demonstra o caso de «um XML de chat de mesmo nome foi achado ao lado da gravação»
    const danmakuStats = { count: 4213, peakCount: 5 };
    // Sinal de entonação: reaproveita os pesos da transcrição local, roda sem configuração, e a pré-visualização do navegador sempre entrega a estatística de demonstração
    const voiceStats = { windowsPlanned: 100, windowsScored: 96, emotionPeakCount: 3, eventPeakCount: 2 };
    const segs = transcript.segments;
    const pick = (from: number, to: number, id: number, title: string, hook: string, score: number, reason: string): HighlightCandidate => ({
      id,
      startSec: segs[from].startSec,
      endSec: segs[to].endSec,
      text: segs.slice(from, to + 1).map((s) => s.text).join(" "),
      title,
      hook,
      score,
      reason,
      boundary: id === 2 ? "anchored" : "exact",
      keywords: id === 2 ? ["dez reais", "diferença"] : ["velocidade de absorção", "meio copo de água"],
      scoreDims:
        id === 1
          ? { hook: 91, flow: 84, value: 88, trend: 72 }
          : id === 2
            ? { hook: 78, flow: 80, value: 74, trend: 66 }
            : { hook: 22, flow: 60, value: 30, trend: 40 },
      dimNotes:
        id === 1
          ? { hook: "abre com a demonstração do teste, e há impacto de imagem nos 3 primeiros segundos", flow: "começa na pergunta e fecha na conclusão, completo", value: "a conclusão de economia dá para usar na hora", trend: "comparar preço nunca sai de moda nas plataformas" }
          : undefined,
      teaser: id === 1 ? "e se cair meio copo de água?" : id === 2 ? "a verdade da diferença de 10 vezes" : "",
      // Demonstração da densidade de utilidade: conteúdo de comparação de preço (cheio de número) é marcado como «vale salvar»
      utility: id === 2 ? { score: 5, hits: ["dez reais", "três reais"] } : undefined,
      recommended: id === 1,
      reviewNote: id === 3 ? "a abertura é só um cumprimento, não há gancho nos 3 primeiros segundos e sozinho se entende pouco" : id === 2 ? "o final foi cortado numa vírgula; vale acertar o ponto de corte à mão" : "",
      visualEvidence: id === 1
        ? { score: 9, scene: "quem apresenta mostra de perto o teste de absorção do papel toalha", match: true, visibleText: ["três camadas", "R$ 2,90"] }
        : undefined,
      // As três faixas do portão de qualidade: 1=vale publicar, 2=precisa de olho humano (a camada de regras achou um defeito duro), 3=descartar
      gate: id === 1 ? "publish" : id === 2 ? "review" : "drop",
      gateNotes:
        id === 2
          ? ["o final não fecha (foi cortado numa vírgula)"]
          : id === 3
            ? ["a abertura é só um cumprimento, sozinha não informa nada e não vale publicar"]
            : undefined,
    });
    // Demonstração da colagem de vários pedaços: a frase da promessa e a frase que a desmente estão bem
    // longe uma da outra, e só juntas o trecho se sustenta — a pré-visualização do navegador precisa
    // percorrer toda a interface da colagem (a marca de colagem no cartão do candidato + a lista de pedaços na mesa de revisão)
    const stitched: HighlightCandidate = {
      id: 4,
      startSec: segs[1].startSec,
      endSec: segs[5].endSec,
      pieces: [
        { startSec: segs[1].startSec, endSec: segs[1].endSec },
        { startSec: segs[5].startSec, endSec: segs[5].endSec },
      ],
      text: `${segs[1].text} …… ${segs[5].text}`,
      title: "acabou de dizer que pode comprar sem medo e já manda fechar o pedido",
      hook: "hoje eu trouxe um papel toalha muito bom, três camadas e não rasga molhado",
      score: 88,
      reason: "o antes e o depois lado a lado: gancho de contradição é o que mais segura a pessoa",
      boundary: "anchored",
      keywords: ["não rasga molhado", "link da loja"],
      scoreDims: { hook: 86, flow: 70, value: 80, trend: 84 },
      dimNotes: {
        hook: "abre na frase da promessa e o contraste se arma na hora",
        flow: "trecho colado, com os dois pedaços conferidos: cada um está completo e nada foi tirado de contexto",
        value: "o contraste, por si, já é a informação",
        trend: "conteúdo que desmente vai bem nas plataformas há muito tempo",
      },
      teaser: "ele mesmo se desmentiu",
      recommended: true,
      reviewNote: "",
      gate: "publish",
    };
    const candidates = [
      pick(3, 4, 1, "meio copo de água e não passa nada? o teste está aqui", "olha a velocidade de absorção: eu jogo meio copo de água e não passa nada", 92, "gancho de demonstração forte + contraste de preço, com boa taxa de conclusão"),
      pick(1, 2, 2, "onde está a diferença entre o de dez e o de três reais", "muita gente me pergunta qual é a diferença entre esse e o de dez reais do mercado", 81, "abre com uma pergunta em suspense e acerta quem compara preço"),
      stitched,
      pick(0, 1, 3, "bem-vindo à live", "oi, gente, bem-vindo à minha live", 38, "só a abertura"),
    ];
    // Modo de apresentação de produto: igual ao processo principal — a palavra de produto encontrada entra nas keywords do candidato de forma determinística
    if (products && products.length > 0) {
      for (const c of candidates) {
        const hits = products.filter((p) => p.trim() && c.text.toLowerCase().includes(p.trim().toLowerCase()));
        const seen = new Set(c.keywords.map((k) => k.toLowerCase()));
        c.keywords = [...c.keywords, ...hits.filter((h) => !seen.has(h.toLowerCase()))];
      }
    }
    // Demonstração de vários falantes: a transcrição é rotulada alternando os trechos, para a
    // pré-visualização do navegador mostrar a legenda colorida por falante de ponta a ponta.
    if (diarize) {
      const labeled: Transcript = {
        ...transcript,
        segments: segs.map((s, i) => ({
          ...s,
          speaker: i % 2,
          words: (s.words ?? []).map((w) => ({ ...w, speaker: i % 2 })),
        })),
      };
      return { candidates, transcript: labeled, funnel, vision: visionStats, emotion: emotionStats, danmaku: danmakuStats, voice: voiceStats, reference };
    }
    return { candidates, funnel, vision: visionStats, emotion: emotionStats, danmaku: danmakuStats, voice: voiceStats, reference };
  },
};

/** Verdadeiro quando o código roda dentro do Electron, com a ponte de preload disponível. */
export function isElectron(): boolean {
  return typeof window !== "undefined" && "hotclip" in window && window.hotclip !== undefined;
}

export function getApi(): HotClipApi {
  if (isElectron()) {
    return window.hotclip as HotClipApi;
  }
  return browserMock;
}
