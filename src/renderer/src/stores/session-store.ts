/**
 * Store da sessão: todo o estado de trabalho de uma sessão de edição (material / transcrição / candidatos /
 * estatística da detecção / exportação).
 * Antes isso morava nos useState de App.tsx e de HighlightsView — um passo para trás e os candidatos se
 * perdiam todos, e detectar de novo custava outra rodada de LLM. Na store, dá para trocar de vista à vontade
 * e o resultado continua lá.
 *
 * Os campos recuperáveis são salvos de forma atômica pelo processo principal, pela impressão do arquivo de
 * origem; o que é passageiro, como a tarefa em andamento e as janelas, não é recuperado.
 * As memórias de longo prazo, como as preferências de exportação, continuam cada uma na sua store
 * (render-prefs, llm, asr).
 */
import { create } from "zustand";
import type {
  MediaInfo,
  Transcript,
  HighlightCandidate,
  RenderToggles,
  FunnelStats,
  VisionStats,
  EmotionStats,
  DanmakuStats,
  VoiceTagStats,
  ReferenceInfo,
  SessionCheckpoint,
  SessionEditCommand,
  SessionEditHistory,
} from "../../../shared/api-types";
import { appendSessionEdit, compactSessionEditHistory, emptySessionEditHistory } from "../../../shared/session-edit-history";

export interface ProbedFile extends MediaInfo {
  path: string;
}

/** As estatísticas de cada trilha de sinal que voltam junto com o resultado da detecção (para exibição). */
export interface DetectStats {
  funnel: FunnelStats | null;
  vision: VisionStats | null;
  emotion: EmotionStats | null;
  danmaku: DanmakuStats | null;
  voice: VoiceTagStats | null;
  reference: ReferenceInfo | null;
  referenceError: string | null;
}

export const EMPTY_STATS: DetectStats = {
  funnel: null,
  vision: null,
  emotion: null,
  danmaku: null,
  voice: null,
  reference: null,
  referenceError: null,
};

interface SessionState {
  file: ProbedFile | null;
  transcript: Transcript | null;
  /** Modo de ponta a ponta: cada passo avança sozinho (o «tudo automático» do cartão de importação). */
  auto: boolean;
  /** A central de configurações (uma vista em tela cheia, sobre a bancada; alcançável a qualquer momento). */
  settingsOpen: boolean;

  candidates: HighlightCandidate[] | null;
  /** Os ids dos candidatos marcados para exportar. */
  selected: Set<number>;
  /** O id do candidato cujos detalhes a coluna da direita está mostrando (independente da marcação). */
  focusedId: number | null;
  detecting: boolean;
  detectError: string | null;
  stats: DetectStats;

  /** Os parâmetros de detecção (dentro da sessão): uma mudança só marca como sujo, e só o clique em «detectar de novo» a aplica — nada de rodar outra vez em silêncio. */
  diarize: boolean;
  referencePath: string | null;
  paramsDirty: boolean;

  exporting: { clips: HighlightCandidate[]; options: RenderToggles } | null;
  /** Só as edições humanas; os setters da IA e da transcrição estabelecem uma nova linha de base. */
  editHistory: SessionEditHistory;

  setFile: (file: ProbedFile | null) => void;
  setTranscript: (t: Transcript | null) => void;
  setAuto: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setCandidates: (c: HighlightCandidate[] | null) => void;
  patchCandidate: (id: number, patch: Partial<HighlightCandidate>) => void;
  addCandidate: (candidate: HighlightCandidate) => void;
  editTranscript: (transcript: Transcript) => void;
  setSelected: (ids: Set<number>) => void;
  toggleSelected: (id: number) => void;
  undoEdit: () => void;
  redoEdit: () => void;
  setFocusedId: (id: number | null) => void;
  setDetecting: (v: boolean) => void;
  setDetectError: (msg: string | null) => void;
  setStats: (s: DetectStats) => void;
  setDiarize: (v: boolean) => void;
  setReferencePath: (p: string | null) => void;
  markParamsDirty: (v: boolean) => void;
  setExporting: (v: { clips: HighlightCandidate[]; options: RenderToggles } | null) => void;
  /** Recupera os campos estáveis de um ponto de verificação já validado no disco e devolve tudo o que é passageiro ao estado ocioso. */
  restore: (checkpoint: SessionCheckpoint) => void;
  /** Trocar de material ou começar de novo: volta ao estado de importação e limpa todo o estado da sessão. */
  reset: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  file: null,
  transcript: null,
  auto: false,
  settingsOpen: false,
  candidates: null,
  selected: new Set<number>(),
  focusedId: null,
  detecting: false,
  detectError: null,
  stats: EMPTY_STATS,
  diarize: false,
  referencePath: null,
  paramsDirty: false,
  exporting: null,
  editHistory: emptySessionEditHistory(),

  setFile: (file) => set({ file }),
  setTranscript: (transcript) => set({ transcript, editHistory: emptySessionEditHistory() }),
  setAuto: (auto) => set({ auto }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCandidates: (candidates) => set({ candidates, editHistory: emptySessionEditHistory() }),
  patchCandidate: (id, patch) => {
    const state = get();
    const before = state.candidates?.find((candidate) => candidate.id === id);
    if (!before) return;
    const after = { ...before, ...patch };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    set({
      candidates: (state.candidates ?? []).map((candidate) => (candidate.id === id ? after : candidate)),
      editHistory: appendSessionEdit(state.editHistory, { kind: "candidate-update", candidateId: id, before, after }),
    });
  },
  addCandidate: (candidate) => {
    const state = get();
    if (state.candidates?.some((item) => item.id === candidate.id)) return;
    const beforeSelected = [...state.selected];
    const afterSelected = [...new Set([...beforeSelected, candidate.id])];
    const command: SessionEditCommand = {
      kind: "candidate-add",
      candidate,
      beforeSelected,
      afterSelected,
      beforeFocusedId: state.focusedId,
      afterFocusedId: candidate.id,
    };
    set({
      candidates: [...(state.candidates ?? []), candidate].sort((a, b) => a.startSec - b.startSec),
      selected: new Set(afterSelected),
      focusedId: candidate.id,
      editHistory: appendSessionEdit(state.editHistory, command),
    });
  },
  editTranscript: (transcript) => {
    const state = get();
    if (!state.transcript) return;
    const previous = new Map(state.transcript.segments.map((segment) => [segment.id, segment]));
    const changes = transcript.segments.flatMap((after) => {
      const before = previous.get(after.id);
      return before && JSON.stringify(before) !== JSON.stringify(after) ? [{ segmentId: after.id, before, after }] : [];
    });
    if (changes.length === 0) return;
    set({ transcript, editHistory: appendSessionEdit(state.editHistory, { kind: "transcript-update", changes }) });
  },
  setSelected: (selected) => set({ selected }),
  toggleSelected: (id) => {
    const state = get();
    const next = new Set(state.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({
      selected: next,
      editHistory: appendSessionEdit(state.editHistory, { kind: "selection", before: [...state.selected], after: [...next] }),
    });
  },
  undoEdit: () => set((state) => replayHistory(state, "undo")),
  redoEdit: () => set((state) => replayHistory(state, "redo")),
  setFocusedId: (focusedId) => set({ focusedId }),
  setDetecting: (detecting) => set({ detecting }),
  setDetectError: (detectError) => set({ detectError }),
  setStats: (stats) => set({ stats }),
  setDiarize: (diarize) => set({ diarize }),
  setReferencePath: (referencePath) => set({ referencePath }),
  markParamsDirty: (paramsDirty) => set({ paramsDirty }),
  setExporting: (exporting) => set({ exporting }),
  restore: (checkpoint) => {
    const ids = new Set((checkpoint.candidates ?? []).map((candidate) => candidate.id));
    set({
      file: checkpoint.file,
      transcript: checkpoint.transcript,
      auto: false,
      settingsOpen: false,
      candidates: checkpoint.candidates,
      selected: new Set(checkpoint.selected.filter((id) => ids.has(id))),
      focusedId: checkpoint.focusedId !== null && ids.has(checkpoint.focusedId) ? checkpoint.focusedId : null,
      detecting: false,
      detectError: null,
      stats: checkpoint.stats,
      diarize: checkpoint.diarize,
      referencePath: checkpoint.referencePath,
      paramsDirty: checkpoint.paramsDirty,
      exporting: null,
      editHistory: checkpoint.editHistory ? compactSessionEditHistory(checkpoint.editHistory) : emptySessionEditHistory(),
    });
  },
  reset: () =>
    set({
      file: null,
      transcript: null,
      auto: false,
      candidates: null,
      selected: new Set<number>(),
      focusedId: null,
      detecting: false,
      detectError: null,
      stats: EMPTY_STATS,
      diarize: false,
      referencePath: null,
      paramsDirty: false,
      exporting: null,
      editHistory: emptySessionEditHistory(),
    }),
}));

type ReplayableState = Pick<SessionState, "candidates" | "selected" | "focusedId" | "transcript" | "editHistory">;

function selectionForCandidates(ids: number[], candidates: HighlightCandidate[] | null): Set<number> {
  const live = new Set((candidates ?? []).map((candidate) => candidate.id));
  return new Set(ids.filter((id) => live.has(id)));
}

function applyEditCommand(state: ReplayableState, command: SessionEditCommand, direction: "undo" | "redo"): Partial<ReplayableState> {
  const previous = direction === "undo";
  if (command.kind === "selection") {
    return { selected: selectionForCandidates(previous ? command.before : command.after, state.candidates) };
  }
  if (command.kind === "candidate-update") {
    const candidate = previous ? command.before : command.after;
    return { candidates: (state.candidates ?? []).map((item) => (item.id === command.candidateId ? candidate : item)) };
  }
  if (command.kind === "candidate-add") {
    if (previous) {
      const candidates = (state.candidates ?? []).filter((item) => item.id !== command.candidate.id);
      return {
        candidates,
        selected: selectionForCandidates(command.beforeSelected, candidates),
        focusedId: command.beforeFocusedId,
      };
    }
    const candidates = [...(state.candidates ?? []).filter((item) => item.id !== command.candidate.id), command.candidate].sort((a, b) => a.startSec - b.startSec);
    return {
      candidates,
      selected: selectionForCandidates(command.afterSelected, candidates),
      focusedId: command.afterFocusedId,
    };
  }
  if (!state.transcript) return {};
  const replacements = new Map(command.changes.map((change) => [change.segmentId, previous ? change.before : change.after]));
  return {
    transcript: {
      ...state.transcript,
      segments: state.transcript.segments.map((segment) => replacements.get(segment.id) ?? segment),
    },
  };
}

function replayHistory(state: SessionState, direction: "undo" | "redo"): Partial<SessionState> {
  const source = direction === "undo" ? state.editHistory.undo : state.editHistory.redo;
  const command = source[source.length - 1];
  if (!command) return {};
  const undo = state.editHistory.undo.slice();
  const redo = state.editHistory.redo.slice();
  if (direction === "undo") {
    undo.pop();
    redo.push(command);
  } else {
    redo.pop();
    undo.push(command);
  }
  return { ...applyEditCommand(state, command, direction), editHistory: compactSessionEditHistory({ undo, redo }) };
}

/** Projeta o estado do Zustand no contrato de persistência estável e seguro para JSON. */
export function sessionCheckpointFromState(state: SessionState = useSession.getState()): SessionCheckpoint | null {
  if (!state.file) return null;
  return {
    file: state.file,
    transcript: state.transcript,
    candidates: state.candidates,
    selected: [...state.selected],
    focusedId: state.focusedId,
    stats: state.stats,
    diarize: state.diarize,
    referencePath: state.referencePath,
    paramsDirty: state.paramsDirty,
    ...(state.editHistory.undo.length + state.editHistory.redo.length > 0 ? { editHistory: state.editHistory } : {}),
    savedAt: new Date().toISOString(),
  };
}

/** Monta o primeiro documento estável de um material recém-sondado, antes de ele entrar na store ativa. */
export function initialSessionCheckpoint(file: ProbedFile): SessionCheckpoint {
  return {
    file,
    transcript: null,
    candidates: null,
    selected: [],
    focusedId: null,
    stats: EMPTY_STATS,
    diarize: false,
    referencePath: null,
    paramsDirty: false,
    savedAt: new Date().toISOString(),
  };
}
