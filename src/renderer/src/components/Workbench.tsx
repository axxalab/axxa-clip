/**
 * A bancada: o layout de três colunas em que o material fica sempre presente. Na coluna da esquerda o
 * material e o vigia de gravações, no centro «a pré-visualização + a linha de tempo + a tabela de candidatos
 * ou a transcrição», na da direita o Inspector (detalhes e parâmetros de detecção), e embaixo a barra de exportação.
 * O assistente de três passos foi aposentado — voltar já não perde resultado, e dá para retornar a qualquer etapa.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { LuFileVideo, LuAudioLines, LuFolderSearch, LuKeyRound, LuRedo2, LuSparkles, LuTextSelect, LuUndo2 } from "react-icons/lu";
import { useT } from "../i18n/store";
import { getApi, isElectron } from "../api/provider";
import { useSession } from "../stores/session-store";
import { useLlmStore, isLlmReady } from "../stores/llm-store";
import { useRenderPrefs } from "../stores/render-prefs-store";
import { useBrandStore } from "../stores/brand-store";
import { useDetection } from "./workbench/useDetection";
import { buildRenderToggles } from "./workbench/export-options";
import { PreviewPane, type PreviewTransportCommand } from "./workbench/PreviewPane";
import { Timeline } from "./workbench/Timeline";
import { CandidateTable } from "./workbench/CandidateTable";
import { TranscriptPanel } from "./workbench/TranscriptPanel";
import { Inspector } from "./workbench/Inspector";
import { ExportBar } from "./workbench/ExportBar";
import { ExportPanel } from "./workbench/ExportPanel";
import { TranscribeView } from "./TranscribeView";
import { ExportView } from "./ExportView";
import { ClipReviewModal } from "./ClipReviewModal";
import { TranscriptPickModal } from "./TranscriptPickModal";
import { BrandStyleModal } from "./BrandStyleModal";
import { WatchFolderModal } from "./WatchFolderModal";
import { clipDurationSec } from "../../../shared/pieces";
import { resolveWorkbenchShortcut } from "../keyboard-shortcuts";
import type { ClipPiece, HighlightCandidate, ReviewedCandidate, SessionEditCommand } from "../../../shared/api-types";

function formatDuration(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function displayName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

function historyLabel(command: SessionEditCommand | undefined, t: (key: string) => string): string {
  if (!command) return "";
  if (command.kind === "selection") return t(command.after.length > command.before.length ? "editSelect" : "editDeselect");
  if (command.kind === "candidate-add") return t("editAddClip");
  if (command.kind === "transcript-update") return t("editTranscript");
  if (command.before.title !== command.after.title || command.before.hook !== command.after.hook) return t("editCopy");
  if (command.before.startSec !== command.after.startSec || command.before.endSec !== command.after.endSec ||
      JSON.stringify(command.before.pieces) !== JSON.stringify(command.after.pieces)) return t("editBounds");
  return t("editCandidate");
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select, button, a, [role='button'], [role='switch'], [contenteditable='true']");
}

/** Coluna da esquerda: o cartão do material atual + o estado do vigia de gravações (sempre presente, e não mais «escolheu o arquivo e sumiu»). */
function LeftRail({ onOpenWatch }: { onOpenWatch: () => void }): React.JSX.Element {
  const t = useT("workbench");
  const { file, stats, transcript } = useSession();
  const [watchOn, setWatchOn] = useState(false);
  useEffect(() => {
    void getApi()
      .watchStatus()
      .then((s) => setWatchOn(s.running))
      .catch(() => {});
  }, []);

  return (
    <div className="flex w-[196px] shrink-0 flex-col gap-3 border-r border-line/70 bg-panel/40 p-3">
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] font-bold tracking-[1.5px] text-mut/60">{t("currentFile")}</div>
        {file && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-ember/30 bg-panel-2/60 p-2.5">
            <div className="flex items-center gap-2">
              {file.hasVideo ? <LuFileVideo className="h-4 w-4 shrink-0 text-ember" /> : <LuAudioLines className="h-4 w-4 shrink-0 text-ember" />}
              <span className="font-mono text-[10px] text-mut tabular-nums">{formatDuration(file.durationSec)}</span>
            </div>
            <p className="text-[11.5px] leading-snug font-semibold break-all" title={file.path}>
              {displayName(file.path)}
            </p>
            <div className="flex flex-wrap gap-1">
              {transcript && <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] text-mut">{t("cachedTranscript")}</span>}
              {stats.danmaku && (
                <span className="rounded-full border border-pink-400/40 px-1.5 py-0.5 text-[9px] text-pink-400">
                  {t("danmakuFound", { n: stats.danmaku.count })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex-1" />
      {/* A entrada sempre presente do vigia de gravações */}
      <button
        type="button"
        onClick={onOpenWatch}
        title={t("watchOpenHint")}
        className="flex flex-col gap-1 rounded-xl border border-line/70 bg-panel-2/40 p-2.5 text-left transition-colors hover:border-mut"
      >
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${watchOn ? "bg-emerald-400" : "bg-mut/40"}`} />
          <span className="text-[11px] font-bold">{t("watchTitle")}</span>
          <span className="flex-1" />
          <LuFolderSearch className="h-3.5 w-3.5 text-mut" />
        </span>
        <span className="text-[10px] leading-relaxed text-mut/70">{watchOn ? t("watchRunning") : t("watchIdle")}</span>
      </button>
    </div>
  );
}

/** A linha de estatística dos sinais da etapa de detecção (mostrada no cabeçalho da aba de candidatos quando a detecção termina). */
function StatsLine(): React.JSX.Element | null {
  const th = useT("highlights");
  const { stats } = useSession();
  const bits: Array<{ key: string; cls: string; text: string }> = [];
  if (stats.funnel)
    bits.push({
      key: "funnel",
      cls: "text-emerald-400/90",
      text: th("funnelSaved", {
        total: (stats.funnel.totalChars / 1000).toFixed(1),
        kept: (stats.funnel.keptChars / 1000).toFixed(1),
        pct: Math.round((1 - stats.funnel.keptChars / Math.max(1, stats.funnel.totalChars)) * 100),
      }),
    });
  if (stats.vision)
    bits.push({
      key: "vision",
      cls: "text-sky-400/90",
      text: stats.vision.fullScan
        ? th("visionScanFull", { frames: stats.vision.framesScored, peaks: stats.vision.peakCount, notes: stats.vision.notedMoments ?? 0 })
        : th("visionScanned", { frames: stats.vision.framesScored, peaks: stats.vision.peakCount }),
    });
  if (stats.emotion && stats.emotion.peakCount > 0)
    bits.push({ key: "emotion", cls: "text-amber-300/90", text: th("emotionScanned", { faces: stats.emotion.facesScored, peaks: stats.emotion.peakCount }) });
  if (stats.danmaku && stats.danmaku.peakCount > 0)
    bits.push({ key: "danmaku", cls: "text-pink-400/90", text: th("danmakuScanned", { count: stats.danmaku.count, peaks: stats.danmaku.peakCount }) });
  if (stats.voice && stats.voice.emotionPeakCount + stats.voice.eventPeakCount > 0)
    bits.push({
      key: "voice",
      cls: "text-teal-300/90",
      text: th("voiceScanned", { windows: stats.voice.windowsScored, emo: stats.voice.emotionPeakCount, evt: stats.voice.eventPeakCount }),
    });
  if (stats.referenceError) bits.push({ key: "refErr", cls: "text-amber-400/90", text: th("refFailed", { msg: stats.referenceError }) });
  if (bits.length === 0) return null;
  return (
    <p className="truncate text-[10px]" title={bits.map((b) => b.text).join("\n")}>
      {bits.map((b, i) => (
        <span key={b.key} className={b.cls}>
          {i > 0 && <span className="text-mut/40"> · </span>}
          {b.text}
        </span>
      ))}
    </p>
  );
}

export function Workbench({ onCloseProject }: { onCloseProject: () => void }): React.JSX.Element {
  const t = useT("workbench");
  const th = useT("highlights");
  const session = useSession();
  const { file, transcript, auto, candidates, detecting, detectError, selected, focusedId, exporting, stats } = session;
  const { config } = useLlmStore();
  const { prefs } = useRenderPrefs();
  const brandState = useBrandStore();
  const { run } = useDetection();

  const [tab, setTab] = useState<"candidates" | "transcript">("candidates");
  const [seekSec, setSeekSec] = useState(Number.NaN);
  const [currentSec, setCurrentSec] = useState(0);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [showPick, setShowPick] = useState(false);
  const [pickInitialIds, setPickInitialIds] = useState<number[]>([]);
  const [showBrand, setShowBrand] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [defaultOutDir, setDefaultOutDir] = useState("");
  const [showTranscriptTimeline, setShowTranscriptTimeline] = useState(false);
  const [transportCommand, setTransportCommand] = useState<PreviewTransportCommand | null>(null);
  const currentSecRef = useRef(0);
  useEffect(() => {
    void getApi().defaultOutDir().then(setDefaultOutDir).catch(() => {});
  }, []);

  const llmReady = !isElectron() || isLlmReady(config);
  const atlasReady = /atlascloud\.ai/i.test(config.baseUrl ?? "") && Boolean(config.apiKey);
  const durationSec = transcript?.durationSec || file?.durationSec || 0;

  const seek = useCallback((sec: number): void => {
    // Cada vez o valor recebe um tremor mínimo, e assim dois cliques no mesmo instante também disparam o effect
    setSeekSec(sec + Math.random() * 1e-6);
  }, []);

  // A detecção automática da primeira vez: transcrição pronta + LLM disponível + nenhum candidato ainda → uma rodada é feita (uma vez por transcrição)
  const detectedFor = useRef<unknown>(null);
  useEffect(() => {
    if (!transcript || candidates !== null || detecting || !llmReady) return;
    // Importar uma legenda já revisada abre primeiro a transcrição. A análise da IA é um passo seguinte,
    // explícito: escolher um arquivo de legenda não pode gastar cota de LLM.
    if (transcript.engine.startsWith("subtitle-") && !auto) return;
    if (detectedFor.current === transcript) return;
    detectedFor.current = transcript;
    void run();
  }, [transcript, candidates, detecting, llmReady, auto, run]);

  // Modo de ponta a ponta: assim que os candidatos aparecem, tudo o que é «vale publicar» é exportado conforme as preferências atuais
  const autoExported = useRef(false);
  useEffect(() => {
    if (!auto || autoExported.current || !candidates) return;
    const publishable = candidates.filter((c) => c.recommended && (c.gate === undefined || c.gate === "publish"));
    if (publishable.length === 0) return;
    autoExported.current = true;
    session.setExporting({
      clips: publishable,
      options: buildRenderToggles({ prefs, config, brandState, diarize: session.diarize, transcript, atlasReady }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, candidates]);

  // Trocar o candidato em foco: a pré-visualização salta para o início dele
  const focusCandidate = useCallback(
    (id: number): void => {
      session.setFocusedId(id);
      const c = useSession.getState().candidates?.find((x) => x.id === id);
      if (c) seek(c.startSec);
    },
    [session, seek]
  );

  const stepCandidate = useCallback(
    (dir: 1 | -1): void => {
      const s = useSession.getState();
      const list = (s.candidates ?? []).filter((c) => c.gate !== "drop");
      if (list.length === 0) return;
      const idx = list.findIndex((c) => c.id === s.focusedId);
      const next = list[(idx + dir + list.length) % list.length];
      s.setFocusedId(next.id);
      seek(next.startSec);
    },
    [seek]
  );

  // Vídeo a partir da escolha no texto: o candidato manual entra no mesmo fluxo de candidatos
  const addManualClip = useCallback(
    (pieces: ClipPiece[], text: string, title: string): void => {
      const s = useSession.getState();
      const id = (s.candidates ?? []).reduce((m, c) => Math.max(m, c.id), 0) + 1;
      const cand: HighlightCandidate = {
        id,
        startSec: pieces[0].startSec,
        endSec: pieces[pieces.length - 1].endSec,
        pieces: pieces.length > 1 ? pieces : undefined,
        text,
        title,
        hook: "",
        score: 0,
        reason: "",
        boundary: "segment",
        keywords: [],
        recommended: true,
        reviewNote: "",
        manualBounds: true,
      };
      s.addCandidate(cand);
      setShowPick(false);
      setTab("candidates");
    },
    []
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const action = resolveWorkbenchShortcut({
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        editable: isEditableTarget(event.target),
        modalOpen: exporting !== null || document.querySelector("[data-hotclip-modal='true'], [role='dialog']") !== null,
      });
      if (!action) return;
      event.preventDefault();
      const state = useSession.getState();
      if (action === "undo") return state.undoEdit();
      if (action === "redo") return state.redoEdit();
      if (action === "previous-candidate") return stepCandidate(-1);
      if (action === "next-candidate") return stepCandidate(1);
      if (action === "toggle-play" || action === "back-5" || action === "forward-5") {
        const transportAction = action === "toggle-play" ? "toggle" : action === "back-5" ? "back5" : "forward5";
        setTransportCommand((previous) => ({ id: (previous?.id ?? 0) + 1, action: transportAction }));
        return;
      }
      const focused = state.candidates?.find((candidate) => candidate.id === state.focusedId);
      if (!focused || (focused.pieces && focused.pieces.length > 1)) return;
      const at = Math.max(0, Math.min(durationSec, currentSecRef.current));
      if (action === "set-in" && at < focused.endSec - 0.1) {
        state.patchCandidate(focused.id, { startSec: at, boundary: "segment", manualBounds: true });
      }
      if (action === "set-out" && at > focused.startSec + 0.1) {
        state.patchCandidate(focused.id, { endSec: at, boundary: "segment", manualBounds: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [durationSec, exporting, stepCandidate]);

  const startExport = useCallback((): void => {
    const s = useSession.getState();
    const picked = (s.candidates ?? []).filter((c) => s.selected.has(c.id));
    if (picked.length === 0 || !s.transcript) return;
    // Retorno da revisão: o aceite e o veto desta sessão vão para o arquivo de preferências local (na medida do possível; uma falha não impede a exportação)
    const summarize = (list: HighlightCandidate[]): ReviewedCandidate[] =>
      list.map((c) => ({ title: c.title, hook: c.hook, score: c.score, durationSec: Math.round(clipDurationSec(c)), keywords: c.keywords.slice(0, 5) }));
    void getApi()
      .recordReview(s.file?.path ?? "", summarize(picked), summarize((s.candidates ?? []).filter((c) => !s.selected.has(c.id))))
      .catch(() => {});
    s.setExporting({
      clips: picked,
      options: buildRenderToggles({ prefs, config, brandState, diarize: s.diarize, transcript: s.transcript, atlasReady }),
    });
  }, [prefs, config, brandState, atlasReady]);

  if (!file) return <></>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <LeftRail onOpenWatch={() => setShowWatch(true)} />

        {/* Centro */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
          {!transcript ? (
            // Ainda não há transcrição: o fluxo de transcrição (escolha do motor, progresso, erro) mora na área central
            <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-6">
              <TranscribeView
                filePath={file.path}
                cached={null}
                autoStart={auto}
                onBack={onCloseProject}
                onDone={(tr) => {
                  if (tr.engine.startsWith("subtitle-")) setTab("transcript");
                  session.setTranscript(tr);
                }}
                onEdited={(tr) => session.setTranscript(tr)}
              />
            </div>
          ) : (
            <>
              <PreviewPane
                filePath={file.path}
                durationSec={durationSec}
                seekSec={seekSec}
                onTime={(sec) => {
                  currentSecRef.current = sec;
                  setCurrentSec(sec);
                }}
                onPrevCandidate={() => stepCandidate(-1)}
                onNextCandidate={() => stepCandidate(1)}
                compact={tab === "transcript"}
                transportCommand={transportCommand}
              />
              {(tab !== "transcript" || showTranscriptTimeline) && <Timeline
                filePath={file.path}
                durationSec={durationSec}
                candidates={candidates}
                focusedId={focusedId}
                currentSec={currentSec}
                onFocus={focusCandidate}
                onSeek={seek}
              />}
              {/* Abas de candidatos / transcrição */}
              <div className="flex shrink-0 items-center gap-1.5">
                {(
                  [
                    ["candidates", t("tabCandidates")],
                    ["transcript", t("tabTranscript")],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-colors ${
                      tab === key ? "bg-ember/12 text-ember" : "text-mut hover:text-fg"
                    }`}
                  >
                    {label}
                    {key === "candidates" && candidates && <span className="ml-1.5 font-mono text-[10px] tabular-nums">{candidates.length}</span>}
                  </button>
                ))}
                {tab === "transcript" && <button type="button" aria-pressed={showTranscriptTimeline} onClick={() => setShowTranscriptTimeline((v) => !v)} className="rounded border border-line px-2 py-1.5 text-xs text-mut">{t("toggleTranscriptTimeline")}</button>}
                <div className="min-w-0 flex-1 px-2">
                  <StatsLine />
                </div>
                <div className="flex shrink-0 items-center gap-1" title={t("shortcutHint")}>
                  {(() => {
                    const command = session.editHistory.undo[session.editHistory.undo.length - 1];
                    const label = command ? `${t("undo")}: ${historyLabel(command, t)}` : t("nothingToUndo");
                    return (
                      <button
                        type="button"
                        disabled={!command}
                        title={`${label} · ⌘/Ctrl+Z`}
                        aria-label={label}
                        onClick={() => session.undoEdit()}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-mut transition-colors hover:border-mut hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <LuUndo2 className="h-3.5 w-3.5" />
                      </button>
                    );
                  })()}
                  {(() => {
                    const command = session.editHistory.redo[session.editHistory.redo.length - 1];
                    const label = command ? `${t("redo")}: ${historyLabel(command, t)}` : t("nothingToRedo");
                    return (
                      <button
                        type="button"
                        disabled={!command}
                        title={`${label} · ⇧⌘/Ctrl+Y`}
                        aria-label={label}
                        onClick={() => session.redoEdit()}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-mut transition-colors hover:border-mut hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <LuRedo2 className="h-3.5 w-3.5" />
                      </button>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  title={th("pickHint")}
                  onClick={() => { setPickInitialIds([]); setShowPick(true); }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap text-mut transition-colors hover:border-mut hover:text-fg"
                >
                  <LuTextSelect className="h-3 w-3" />
                  {th("pickButton")}
                </button>
              </div>
              {tab === "transcript" ? (
                <TranscriptPanel transcript={transcript} visualNotes={stats.vision?.notes} onSeek={seek} onPick={(ids) => { setPickInitialIds(ids); setShowPick(true); }} onAudition={(startSec, endSec) => setTransportCommand((previous) => ({ id: (previous?.id ?? 0) + 1, action: "audition", startSec, endSec }))} />
              ) : !llmReady ? (
                // LLM sem configuração: aponta o caminho da central de configurações (a configuração em si foi para lá)
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line/70 p-6 text-center">
                  <LuKeyRound className="h-6 w-6 text-ember" />
                  <p className="max-w-md text-[12.5px] leading-relaxed text-mut">{t("llmNeeded")}</p>
                  <button
                    type="button"
                    onClick={() => session.setSettingsOpen(true)}
                    className="btn-flame rounded-lg px-5 py-2 text-[12.5px] font-bold text-white"
                  >
                    {t("goSettings")}
                  </button>
                </div>
              ) : detecting ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-line/60 bg-panel/60">
                  <LuSparkles className="h-6 w-6 animate-pulse text-ember" />
                  <p className="shimmer text-[12.5px] font-semibold">{t("detectingNow")}</p>
                </div>
              ) : detectError ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-line/60 bg-panel/60 p-6">
                  <p className="max-w-lg text-center text-[12px] break-all whitespace-pre-line text-red-400">{th("failed", { msg: detectError })}</p>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => session.setSettingsOpen(true)}
                      className="rounded-lg border border-line px-3.5 py-1.5 text-[12px] text-mut transition-colors hover:border-mut hover:text-fg"
                    >
                      {th("llmTitle")}
                    </button>
                    <button type="button" onClick={() => void run()} className="btn-flame rounded-lg px-4 py-1.5 text-[12px] font-bold text-white">
                      {th("retry")}
                    </button>
                  </div>
                </div>
              ) : candidates && candidates.length > 0 ? (
                <CandidateTable
                  candidates={candidates}
                  selected={selected}
                  focusedId={focusedId}
                  onFocus={focusCandidate}
                  onToggle={(id) => session.toggleSelected(id)}
                />
              ) : candidates ? (
                <p className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-line/60 bg-panel/60 p-6 text-center text-[12px] text-mut">
                  {th("empty")}
                </p>
              ) : (
                <div className="min-h-0 flex-1" />
              )}
            </>
          )}
        </div>

        {transcript && tab !== "transcript" && <Inspector transcript={transcript} onRedetect={() => void run()} onOpenReview={setReviewId} />}
      </div>

      {transcript && candidates && candidates.length > 0 && (
        <ExportBar defaultOutDir={defaultOutDir} onExport={startExport} onOpenPanel={() => setShowExportPanel(true)} />
      )}

      {/* ---- Exportação em andamento: a camada sobre o centro (os candidatos ficam na store, e ao terminar tudo volta) ---- */}
      {exporting && transcript && (
        <div className="absolute inset-0 z-40 flex flex-col items-center overflow-y-auto bg-ink/95 pt-[10vh] backdrop-blur-sm">
          <ExportView
            filePath={file.path}
            clips={exporting.clips}
            options={exporting.options}
            transcript={transcript}
            onBack={() => {
              session.setAuto(false);
              session.setExporting(null);
            }}
            onRestart={onCloseProject}
          />
        </div>
      )}

      {/* ---- Janelas ---- */}
      {showExportPanel && (
        <ExportPanel diarize={session.diarize} atlasReady={atlasReady} onClose={() => setShowExportPanel(false)} onOpenBrand={() => setShowBrand(true)} />
      )}
      {showBrand && <BrandStyleModal onClose={() => setShowBrand(false)} />}
      {showWatch && <WatchFolderModal onClose={() => setShowWatch(false)} />}
      {showPick && transcript && <TranscriptPickModal transcript={transcript} initialSegmentIds={pickInitialIds} onAdd={addManualClip} onClose={() => setShowPick(false)} />}
      {(() => {
        const reviewing = reviewId !== null ? candidates?.find((c) => c.id === reviewId) : undefined;
        if (!reviewing || !transcript) return null;
        return (
          <ClipReviewModal
            // Reconstruído pelo id do candidato: ao trocar de candidato, o estado do ponto de corte precisa ser inicializado de novo
            key={reviewing.id}
            clip={reviewing}
            transcript={transcript}
            filePath={file.path}
            durationSec={transcript.durationSec}
            onClose={() => setReviewId(null)}
            onSave={(patch) => {
              session.patchCandidate(reviewing.id, { ...patch, boundary: "segment", manualBounds: true });
              setReviewId(null);
            }}
          />
        );
      })()}
    </div>
  );
}
