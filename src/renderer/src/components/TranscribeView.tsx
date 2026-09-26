import { LocalSpeechConnection } from "./LocalSpeechConnection";
/**
 * Passo 2 do assistente: a escolha do motor → o progresso da transcrição → a transcrição frase a frase.
 * A qualidade da transcrição condiciona tudo o que vem depois, então a escolha do motor é um passo
 * explícito e de primeira classe (velocidade vs precisão vs nuvem), lembrado por pessoa.
 */
import { useEffect, useRef, useState } from "react";
import {
  LuAudioLines,
  LuArrowLeft,
  LuCircleCheck,
  LuDownload,
  LuFlame,
  LuShieldCheck,
  LuGauge,
  LuTarget,
  LuCloudUpload,
  LuPencil,
  LuBookOpen,
  LuReplaceAll,
  LuX,
} from "react-icons/lu";
import { useT } from "../i18n/store";
import { getApi } from "../api/provider";
import { useAsrStore } from "../stores/asr-store";
import { editSegmentText } from "../../../shared/edit-transcript";
import { parseTranscribeError } from "../../../shared/transcribe-errors";
import { diffReplacement, applyGlossaryToTranscript, countGlossaryHits, upsertGlossaryEntry } from "../../../shared/glossary";
import { GlossaryModal } from "./GlossaryModal";
import { SubtitleImport } from "./SubtitleImport";
import type { Transcript, TranscribeProgressEvent, AsrEngineInfo, GlossaryEntry } from "../../../shared/api-types";

function formatClock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const STAGE_KEY: Record<TranscribeProgressEvent["stage"], string> = {
  preparing: "stagePreparing",
  "downloading-model": "stageDownloadingModel",
  "extracting-model": "stageExtractingModel",
  decoding: "stageDecoding",
  transcribing: "stageTranscribing",
  finalizing: "stageFinalizing",
};

/** id do catálogo → as chaves de i18n de nome e descrição (um id desconhecido cai no id cru). */
const ENGINE_TEXT: Record<string, { name: string; desc: string }> = {
  sensevoice: { name: "engineSensevoiceName", desc: "engineSensevoiceDesc" },
  paraformer: { name: "engineParaformerName", desc: "engineParaformerDesc" },
  qwen3: { name: "engineQwenName", desc: "engineQwenDesc" },
  fireredasr: { name: "engineFireredName", desc: "engineFireredDesc" },
  parakeet: { name: "engineParakeetName", desc: "engineParakeetDesc" },
  "whisper-turbo": { name: "engineWhisperTurboName", desc: "engineWhisperTurboDesc" },
  "whisper-large-v3": { name: "engineWhisperLargeName", desc: "engineWhisperLargeDesc" },
  elevenlabs: { name: "engineElevenlabsName", desc: "engineElevenlabsDesc" },
};

/** Os ids de Transcript.engine que os backends informam → o id do catálogo. */
function catalogIdOf(engineReported: string): string {
  return engineReported.replace(/-local$/, "");
}

export function TranscribeView({
  filePath,
  onBack,
  onDone,
  onEdited,
  onFindHighlights,
  cached,
  autoStart,
}: {
  filePath: string;
  onBack: () => void;
  onDone?: (t: Transcript) => void;
  /** O retorno depois da correção da transcrição (só atualiza o estado, sem avançar o assistente). */
  onEdited?: (t: Transcript) => void;
  onFindHighlights?: () => void;
  /** Uma transcrição já produzida (ao voltar de uma etapa posterior) — o trabalho é pulado. */
  cached?: Transcript | null;
  /** Modo de ponta a ponta: a escolha do motor é pulada e tudo começa com o motor lembrado. */
  autoStart?: boolean;
}): React.JSX.Element {
  const t = useT("transcribe");
  const { engineId, setEngineId, keys, setKey, localServiceUrl } = useAsrStore();
  const [engines, setEngines] = useState<AsrEngineInfo[] | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const generation = useRef(0);
  const runningRef = useRef(false);
  useEffect(() => () => { generation.current++; if (runningRef.current) getApi().cancelTranscribe(); }, []);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<TranscribeProgressEvent>({ fraction: 0, stage: "preparing" });
  const [transcript, setTranscript] = useState<Transcript | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  /** O detalhe original do erro: mostrado quando a causa não está clara, e é a única pista de diagnóstico quando a pessoa abre uma issue. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  /** Correção da transcrição: o id da frase que está sendo editada. */
  const [editingSeg, setEditingSeg] = useState<number | null>(null);
  /** A janela de gestão do vocabulário de termos. */
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  /** O candidato «errado → certo» recém-extraído: leva a oferecer a aplicação em todo o material e a entrada no vocabulário. */
  const [pending, setPending] = useState<{ entry: GlossaryEntry; count: number } | null>(null);

  // O erro de escrita do ASR é corrigido ali mesmo: o texto da frase é substituído e a linha de tempo por palavra
  // daquela frase é reconstruída pela largura dos caracteres.
  // Os dois setState são chamados no mesmo nível — nunca se atualiza o componente-mãe dentro de um updater (é ilegal durante a renderização).
  const commitSegEdit = (segId: number, value: string): void => {
    setEditingSeg(null);
    if (!transcript) return;
    const prevText = transcript.segments.find((s) => s.id === segId)?.text ?? "";
    const next = editSegmentText(transcript, segId, value);
    if (next !== transcript) {
      setTranscript(next);
      onEdited?.(next);
      // O ciclo da correção de termo: se esta mudança é um «termo errado → termo certo», surge a oferta de substituir em todo o material com um clique e de entrar no vocabulário
      const entry = diffReplacement(prevText, value);
      setPending(entry ? { entry, count: countGlossaryHits(next, [entry]) } : null);
    }
  };

  // Aplica em todo o material (marcando as frases alteradas) e guarda a entrada no vocabulário — na próxima transcrição ela já vale
  const confirmPending = (): void => {
    if (!pending || !transcript) return;
    const { transcript: fixed, replaced } = applyGlossaryToTranscript(transcript, [pending.entry]);
    if (replaced > 0) {
      setTranscript(fixed);
      onEdited?.(fixed);
    }
    const api = getApi();
    void api
      .glossaryGet()
      .then((list) => api.glossarySet(upsertGlossaryEntry(list, pending.entry)))
      .catch(() => {});
    setPending(null);
  };
  const unsubRef = useRef<(() => void) | null>(null);

  const autoStarted = useRef(false);

  useEffect(() => {
    if (cached) return;
    if (autoStart) {
      // O StrictMode pode montar, limpar e montar os effects. O início vem depois desse ciclo, para a limpeza
      // não deixar uma tarefa iniciada sozinha ocupada para sempre.
      const timer = setTimeout(() => {
        if (!autoStarted.current) { autoStarted.current = true; start(); }
      }, 0);
      void getApi().listAsrEngines().then(setEngines).catch(() => setEngines([]));
      return () => { clearTimeout(timer); unsubRef.current?.(); };
    }
    getApi()
      .listAsrEngines()
      .then(setEngines)
      .catch(() => setEngines([]));
    return () => unsubRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (restart = false): void => {
    if (runningRef.current) return;
    const request = ++generation.current;
    runningRef.current = true;
    setPaused(false); setCancelling(false);
    setRunning(true);
    setError(null);
    setErrorDetail(null);
    setProgress({ fraction: 0, stage: "preparing" });
    const api = getApi();
    unsubRef.current = api.onTranscribeProgress(setProgress);
    api
      .transcribeMedia(filePath, engineId, keys[engineId], { localServiceUrl, restart })
      .then((result) => {
        if (request !== generation.current) return;
        setTranscript(result);
        onDone?.(result);
      })
      .catch((e: unknown) => {
        if (request !== generation.current) return;
        if (/cancelled|AbortError/.test(String(e))) { setPaused(true); return; }
        // A causa real da falha é repassada: sem trilha de áudio ou download do modelo falhando geram o aviso certo, e o resto
        // vem com o detalhe original do erro — antes tudo dizia «confira a trilha de áudio», levando a pessoa a transcodificar sem parar (issue #2)
        const { kind, detail } = parseTranscribeError(e instanceof Error ? e.message : String(e));
        const msgKey =
          kind === "no-audio"
            ? "failedNoAudio"
            : kind === "model-download"
              ? "failedModelDownload"
              : kind === "model-load"
                ? "failedModelLoad"
                : "failed";
        setError(t(msgKey));
        setErrorDetail(kind !== "no-audio" && detail ? detail : null);
      })
      .finally(() => {
        if (request !== generation.current) return;
        runningRef.current = false;
        setCancelling(false);
        unsubRef.current?.();
        unsubRef.current = null;
        setRunning(false);
      });
  };

  const pct = Math.round(progress.fraction * 100);
  const isDownload = progress.stage === "downloading-model";
  // O download e a descompactação informam os dois os bytes reais — a barra os acompanha direto
  const isByteStage = isDownload || progress.stage === "extracting-model";
  const bytePct =
    isByteStage && progress.totalBytes ? Math.round(((progress.downloadedBytes ?? 0) / progress.totalBytes) * 100) : 0;
  const barPct = isByteStage ? bytePct : pct;
  const totalMB = progress.totalBytes ? Math.round(progress.totalBytes / (1024 * 1024)) : 0;

  const usedEngine = transcript ? ENGINE_TEXT[catalogIdOf(transcript.engine)] : null;

  return (
    <div className="rise-in flex w-full max-w-2xl flex-col items-center">
      {/* ---- engine picker ---- */}
      {!transcript && !running && !error && (
        <>
          <h1 className="text-center text-3xl font-extrabold tracking-tight">{t("enginePickTitle")}</h1>
          <p className="mt-3 max-w-lg text-center text-[14px] text-mut">{t("enginePickDesc")}</p>

          {paused && <p role="status" className="mt-3 text-sm text-amber-400">{t(engineId === "elevenlabs" ? "speechCloudCancelled" : "speechResumeHint")}</p>}
          <SubtitleImport filePath={filePath} onBusy={setImporting} onImported={(result) => {
            setTranscript(result);
            onDone?.(result);
          }} />

          <div className="mt-8 grid w-full gap-3">
            {(engines ?? []).map((e) => {
              const text = ENGINE_TEXT[e.id];
              const active = engineId === e.id;
              return (
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setEngineId(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") setEngineId(e.id);
                  }}
                  className={`card card-hover cursor-pointer rounded-2xl border p-5 text-left transition-colors ${
                    active ? "!border-ember/60 bg-ember/5" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[15px] font-bold">{text ? t(text.name) : e.id}</span>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        active ? "flame-gradient border-transparent" : "border-line"
                      }`}
                    >
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                  </div>
                  {text && <p className="mt-1 text-[12.5px] text-mut">{t(text.desc)}</p>}
                  {active && e.kind === "cloud" && (
                    <input
                      type="password"
                      value={keys[e.id] ?? ""}
                      onChange={(ev) => setKey(e.id, ev.target.value)}
                      onClick={(ev) => ev.stopPropagation()}
                      placeholder={t("cloudKeyPlaceholder")}
                      className="mt-3 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12px] outline-none focus:border-ember/60"
                    />
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                    <span className="chip flex items-center gap-1 rounded-md px-2 py-0.5">
                      {e.uploads ? <LuCloudUpload className="h-3 w-3" /> : <LuShieldCheck className="h-3 w-3 text-emerald-400" />}
                      {e.uploads ? t("badgeNeedsUpload") : t("badgeLocalPrivate")}
                    </span>
                    {!e.experimental && <span className="chip flex items-center gap-1 rounded-md px-2 py-0.5">
                      <LuGauge className="h-3 w-3" />
                      {"●".repeat(e.speed)}{"○".repeat(3 - e.speed)}
                    </span>}
                    {!e.experimental && <span className="chip flex items-center gap-1 rounded-md px-2 py-0.5">
                      <LuTarget className="h-3 w-3" />
                      {"●".repeat(e.accuracy)}{"○".repeat(3 - e.accuracy)}
                    </span>}
                    <span className="chip rounded-md px-2 py-0.5">{t("badgeLangs", { langs: e.langs.join("/") })}</span>
                    {e.kind === "local" && !e.experimental && (
                      <span className={`chip rounded-md px-2 py-0.5 ${e.installed ? "text-emerald-400" : ""}`}>
                        {e.installed ? t("badgeInstalled") : t("badgeDownload", { n: e.sizeMB ?? 0 })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {engineId === "qwen3" && <div className="mt-4 w-full"><LocalSpeechConnection /></div>}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2.5 text-sm text-mut transition-colors hover:border-mut hover:text-fg"
            >
              <LuArrowLeft className="h-4 w-4" />
              {t("back")}
            </button>
            <button
              type="button"
              onClick={() => start()}
              disabled={importing || (engines?.find((e) => e.id === engineId)?.kind === "cloud" && !keys[engineId])}
              className="btn-flame rounded-xl px-9 py-3 text-[14px] font-bold text-white disabled:opacity-40"
            >
              {t(paused && engineId !== "elevenlabs" ? "speechResume" : "engineStart")}
            </button>
            {paused && engineId !== "elevenlabs" && <button type="button" onClick={() => start(true)} className="text-xs text-mut underline">{t("speechRestart")}</button>}
          </div>
        </>
      )}

      {/* ---- progress ---- */}
      {running && !transcript && !error && (
        <>
          <h1 className="text-center text-3xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-lg text-center text-[14px] text-mut">{t("desc")}</p>

          <div className="card mt-9 w-full rounded-2xl p-6">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              {isByteStage ? (
                <LuDownload className="h-4 w-4 text-ember" />
              ) : (
                <LuAudioLines className="h-4 w-4 text-ember" />
              )}
              <span>{t(STAGE_KEY[progress.stage])}</span>
              <span className="ml-auto text-[13px] font-bold text-mut">{barPct}%</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-2">
              <div
                className="flame-gradient h-full rounded-full transition-[width] duration-300"
                style={{ width: `${Math.max(2, barPct)}%` }}
              />
            </div>
            {isDownload && (
              <p className="mt-3 text-xs text-mut">
                {totalMB > 0 ? t("downloadHint", { mb: totalMB }) : t("downloadHintGeneric")}
              </p>
            )}
            {progress.stage === "extracting-model" && <p className="mt-3 text-xs text-mut">{t("extractHint")}</p>}
            {progress.totalWindows !== undefined && <p className="mt-3 text-xs text-mut" role="status">{t("speechWindows", { done: progress.completedWindows ?? 0, total: progress.totalWindows, resumed: progress.resumedWindows ?? 0 })}</p>}
            <button type="button" disabled={cancelling} onClick={() => { setCancelling(true); getApi().cancelTranscribe(); }} className="mt-4 rounded border border-line px-3 py-2 text-sm disabled:opacity-40">{t(cancelling ? "speechCancelling" : "speechCancel")}</button>
          </div>
        </>
      )}

      {/* ---- error ---- */}
      {error && (
        <div className="card mt-6 w-full rounded-2xl p-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          {errorDetail && (
            <p className="mx-auto mt-2 max-w-lg font-mono text-[11px] leading-relaxed break-all text-mut">{errorDetail}</p>
          )}
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-sm text-mut transition-colors hover:border-mut hover:text-fg"
            >
              <LuArrowLeft className="h-4 w-4" />
              {t("back")}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setErrorDetail(null);
              }}
              className="btn-flame rounded-lg px-5 py-2 text-sm font-bold text-white"
            >
              {t(paused && engineId !== "elevenlabs" ? "speechResume" : "engineStart")}
            </button>
            {paused && engineId !== "elevenlabs" && <button type="button" onClick={() => start(true)} className="text-xs text-mut underline">{t("speechRestart")}</button>}
          </div>
        </div>
      )}

      {/* ---- result ---- */}
      {transcript && (
        <section className="w-full">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
                <LuCircleCheck className="h-6 w-6 text-emerald-400" />
                {t("resultTitle")}
              </h1>
              <p className="mt-1.5 text-[13px] text-mut">
                {t("resultCount", { n: transcript.segments.length, lang: transcript.language })} ·{" "}
                {transcript.engine.startsWith("subtitle-") ? t("subtitleImported") : usedEngine ? t(usedEngine.name) : t("engineLocal")}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setGlossaryOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-xs text-mut transition-colors hover:border-mut hover:text-fg"
              >
                <LuBookOpen className="h-3.5 w-3.5" />
                {t("glossaryBtn")}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-xs text-mut transition-colors hover:border-mut hover:text-fg"
              >
                <LuArrowLeft className="h-3.5 w-3.5" />
                {t("back")}
              </button>
              {onFindHighlights && (
                <button
                  type="button"
                  onClick={onFindHighlights}
                  className="btn-flame inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-[13px] font-bold text-white"
                >
                  <LuFlame className="h-4 w-4" />
                  {t("findHighlights")}
                </button>
              )}
            </div>
          </div>

          {/* O ciclo da correção de termo: corrige num lugar → substitui em todo o material + entra no vocabulário */}
          {pending && (
            <div className="card mt-4 flex flex-wrap items-center gap-3 rounded-xl border !border-ember/40 bg-ember/5 px-4 py-3">
              <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
                {pending.count > 0
                  ? t("applyAllMany", { wrong: pending.entry.wrong, right: pending.entry.right, n: pending.count })
                  : t("applyAllZero", { wrong: pending.entry.wrong, right: pending.entry.right })}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={confirmPending}
                  className="btn-flame inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-bold text-white"
                >
                  <LuReplaceAll className="h-3.5 w-3.5" />
                  {pending.count > 0 ? t("applyAllBtn") : t("applyAllZeroBtn")}
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-[12px] text-mut transition-colors hover:border-mut hover:text-fg"
                >
                  <LuX className="h-3.5 w-3.5" />
                  {t("applyAllIgnore")}
                </button>
              </div>
            </div>
          )}

          <div className="card mt-5 max-h-[46vh] overflow-y-auto rounded-2xl p-2">
            {transcript.segments.map((seg) => (
              <div
                key={seg.id}
                className="group/seg flex items-baseline gap-4 rounded-xl px-4 py-2.5 transition-colors hover:bg-panel-2"
              >
                <span className="shrink-0 font-mono text-[11px] text-ember/90">{formatClock(seg.startSec)}</span>
                {editingSeg === seg.id ? (
                  <input
                    autoFocus
                    defaultValue={seg.text}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingSeg(null);
                    }}
                    onBlur={(e) => commitSegEdit(seg.id, e.target.value)}
                    className="w-full rounded-lg border border-ember/60 bg-panel px-2 py-1 text-[14px] leading-relaxed outline-none"
                  />
                ) : (
                  <p className="flex min-w-0 items-baseline gap-1.5 text-[14px] leading-relaxed">
                    <span className="min-w-0">{seg.text}</span>
                    {seg.glossaryApplied && (
                      <span
                        title={t("glossaryFixedHint")}
                        className="chip shrink-0 rounded px-1.5 py-0.5 text-[9.5px] text-ember"
                      >
                        {t("glossaryFixedBadge")}
                      </span>
                    )}
                    <button
                      type="button"
                      title={t("editSegHint")}
                      onClick={() => setEditingSeg(seg.id)}
                      className="shrink-0 rounded p-0.5 text-mut opacity-0 transition-opacity group-hover/seg:opacity-100 hover:text-fg"
                    >
                      <LuPencil className="h-3 w-3" />
                    </button>
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {glossaryOpen && <GlossaryModal onClose={() => setGlossaryOpen(false)} />}
    </div>
  );
}
