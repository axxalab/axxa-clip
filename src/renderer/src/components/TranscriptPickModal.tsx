/**
 * Janela de escolha de trechos pelo texto (editar vídeo escrevendo): a transcrição inteira é aberta, um
 * clique marca ou desmarca a frase, e o que foi escolhido vira vídeo direto.
 * - As frases não vizinhas são coladas sozinhas (reaproveitando a máquina de pieces: corte seco, legenda,
 *   EDL e verificação de qualidade ficam todos alinhados)
 * - Com a conversa de várias pessoas (diarize) ligada, dá para filtrar por falante — «só o que a convidada
 *   disse» se escolhe num relance
 * - A busca na fala localiza aquela frase da memória; o conjunto marcado não se perde ao filtrar
 * Só interface: as regras do vídeo (união de pedaços, teto) estão todas em shared/pick.ts, num código só para os dois lados.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LuTextSelect, LuX, LuSearch, LuCheck, LuPlus, LuEraser } from "react-icons/lu";
import { useT } from "../i18n/store";
import { selectionToPieces, pickVerdict, MANUAL_MAX_PIECES } from "../../../shared/pick";
import { piecesText } from "../../../shared/boundary";
import { piecesDurationSec } from "../../../shared/pieces";
import type { Transcript, ClipPiece } from "../../../shared/api-types";
import { ModalShell } from "./ui";
import { indexTranscript, searchTranscript } from "../../../shared/transcript-search";
import { VirtualTranscriptList } from "./workbench/VirtualTranscriptList";

/** As cores do selo de falante: alternadas pelo id do falante, sem relação com a pessoa, só para distinguir. */
const SPK_COLORS = [
  "text-sky-400 border-sky-400/40",
  "text-emerald-400 border-emerald-400/40",
  "text-amber-300 border-amber-300/40",
  "text-pink-400 border-pink-400/40",
  "text-violet-400 border-violet-400/40",
  "text-teal-300 border-teal-300/40",
];

function fmtTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function TranscriptPickModal({
  transcript,
  initialSegmentIds = [],
  onAdd,
  onClose,
}: {
  transcript: Transcript;
  initialSegmentIds?: readonly number[];
  /** Vídeo a partir da escolha: a lista de pedaços (na ordem do tempo) + o texto coberto + o título padrão. */
  onAdd: (pieces: ClipPiece[], text: string, title: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT("highlights");
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(transcript.segments.filter((segment) => initialSegmentIds.includes(segment.id)).map((segment) => segment.id)));
  const [query, setQuery] = useState("");
  const [focusedSentence, setFocusedSentence] = useState<number | null>(null);
  /** null = todos os falantes. */
  const [speakerFilter, setSpeakerFilter] = useState<number | null>(null);

  // A lista de falantes: filtrar só vale a partir de 2 pessoas (com uma só não faz sentido)
  const speakers = useMemo(() => {
    const ids = new Set<number>();
    for (const s of transcript.segments) if (s.speaker !== undefined) ids.add(s.speaker);
    return [...ids].sort((a, b) => a - b);
  }, [transcript]);

  const searchIndex = useMemo(() => indexTranscript(transcript.segments), [transcript.segments]);
  const matched = useMemo(() => query.trim() ? new Set(searchTranscript(searchIndex, query).flatMap((hit) => hit.segmentIds)) : null, [searchIndex, query]);
  const visible = useMemo(() => transcript.segments.filter(
    (seg) =>
      (speakerFilter === null || seg.speaker === speakerFilter) &&
      (!matched || matched.has(seg.id))
  ), [transcript.segments, speakerFilter, matched]);

  const pieces = useMemo(() => selectionToPieces(transcript.segments, selected), [transcript, selected]);
  const durationSec = piecesDurationSec(pieces);
  const verdict = pickVerdict(pieces, durationSec);

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const add = (): void => {
    if (verdict !== "ok") return;
    // O título padrão sai do começo da primeira frase (o título pode ser mudado a qualquer momento no cartão do candidato)
    const first = transcript.segments.find((seg) => selected.has(seg.id));
    const title = (first?.text ?? "").trim().slice(0, 24) || t("pickButton");
    onAdd(pieces, piecesText(transcript, pieces), title);
  };

  // Vazio ou normal, a estatística sempre aparece; quando algo é inválido, o motivo entra no lugar da estatística (e o botão fica desabilitado junto)
  const problem =
    verdict === "tooShort" ? t("pickTooShort")
    : verdict === "tooLong" ? t("pickTooLong")
    : verdict === "tooMany" ? t("pickTooMany", { max: MANUAL_MAX_PIECES })
    : null;

  return (
    <ModalShell onClose={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card flex h-[min(86vh,760px)] w-full max-w-2xl flex-col rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']")];
          const first = controls[0], last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <LuTextSelect className="h-5 w-5 text-ember" />
              {t("pickTitle")}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-mut">{t("pickDesc")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("pickClose")}
            className="shrink-0 rounded-lg p-1.5 text-mut transition-colors hover:bg-white/5 hover:text-fg"
          >
            <LuX className="h-4 w-4" />
          </button>
        </div>

        {/* Busca + filtro de falante */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <LuSearch className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-mut" />
            <input
              value={query}
              maxLength={500}
              aria-label={t("pickSearch")}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("pickSearch")}
              className="w-full rounded-lg border border-line bg-panel-2 py-2 pr-3 pl-8 text-xs outline-none transition-colors focus:border-ember/60"
            />
          </div>
          {speakers.length >= 2 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSpeakerFilter(null)}
                className={`chip rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                  speakerFilter === null ? "border-ember/60 bg-ember/10 text-fg" : "text-mut hover:text-fg"
                }`}
              >
                {t("pickAllSpeakers")}
              </button>
              {speakers.map((id) => (
                <button
                  key={id}
                  type="button"
                  title={t("pickSpeakerHint", { n: id + 1 })}
                  onClick={() => setSpeakerFilter((prev) => (prev === id ? null : id))}
                  className={`chip rounded-md border px-2 py-1 text-[11px] font-bold transition-colors ${
                    SPK_COLORS[id % SPK_COLORS.length]
                  } ${speakerFilter === id ? "bg-ember/10" : "opacity-70 hover:opacity-100"}`}
                >
                  S{id + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* A transcrição: um clique marca ou desmarca a frase */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          {visible.length === 0 && (
            <p className="py-8 text-center text-sm text-mut">{t("pickNoMatch")}</p>
          )}
          <VirtualTranscriptList segments={visible} targetId={query.trim() ? visible[0]?.id : initialSegmentIds[0]} targetKey={`${query}:${speakerFilter}`} pinnedId={focusedSentence} label={t("pickTitle")}>
          {(seg) => {
            const on = selected.has(seg.id);
            return (
              <button
                key={seg.id}
                type="button"
                aria-pressed={on}
                onFocus={() => setFocusedSentence(seg.id)}
                onBlur={() => setFocusedSentence(null)}
                onClick={() => toggle(seg.id)}
                className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                  on ? "border-ember/50 bg-ember/10" : "border-transparent hover:bg-white/5"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    on ? "flame-gradient border-transparent text-white" : "border-line text-transparent"
                  }`}
                >
                  <LuCheck className="h-3 w-3" />
                </span>
                <span className="mt-0.5 shrink-0 font-mono text-[10.5px] text-mut">{fmtTime(seg.startSec)}</span>
                {seg.speaker !== undefined && speakers.length >= 2 && (
                  <span
                    className={`mt-0.5 shrink-0 rounded border px-1 font-mono text-[10px] font-bold ${
                      SPK_COLORS[seg.speaker % SPK_COLORS.length]
                    }`}
                  >
                    S{seg.speaker + 1}
                  </span>
                )}
                <span className={`min-w-0 text-[13px] leading-relaxed ${on ? "text-fg" : "text-fg/80"}`}>
                  {seg.text}
                </span>
              </button>
            );
          }}
          </VirtualTranscriptList>
        </div>

        {/* Estado + ações */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-line pt-3">
          <span className={`text-[12px] font-semibold ${problem ? "text-amber-400" : "text-mut"}`}>
            {problem ?? t("pickStat", { sents: selected.size, pieces: pieces.length, sec: Math.round(durationSec) })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-mut transition-colors hover:border-mut hover:text-fg disabled:opacity-40"
            >
              <LuEraser className="h-3.5 w-3.5" />
              {t("pickClear")}
            </button>
            <button
              type="button"
              disabled={verdict !== "ok"}
              onClick={add}
              className="btn-flame inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              <LuPlus className="h-3.5 w-3.5" />
              {t("pickAdd")}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
