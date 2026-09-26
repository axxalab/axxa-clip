/**
 * A linha de tempo da bancada: a régua + a tira de miniaturas + as curvas de volume, de movimento e de calor
 * do chat + os trechos candidatos + a cabeça de reprodução.
 * Das oito trilhas de sinal, as três curvas que mais «falam» são desenhadas aqui — os trechos candidatos caem
 * nos picos das curvas, e o «por que este trecho foi escolhido» deixa de ser um texto e passa a ser uma forma
 * que se vê de relance.
 *
 * Interação: um clique na trilha salta a reprodução; um clique num trecho candidato o põe em foco e salta para o início dele.
 * Os dados falham em aberto: a curva ou a miniatura que não existe simplesmente não é desenhada, e a linha de tempo em si funciona sempre.
 */
import { useEffect, useMemo, useState } from "react";
import { getApi } from "../../api/provider";
import { useT } from "../../i18n/store";
import type { HighlightCandidate, TimelineData } from "../../../../shared/api-types";

function formatTick(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Array da curva → o caminho de área em SVG (valores de 0 a 1, com a altura H do viewBox). */
function areaPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - v * height).toFixed(1)}`);
  return `M0,${height} L${pts.join(" ")} L${width},${height} Z`;
}

/** As marcas da régua: um intervalo redondo é escolhido conforme a duração (5min, 10min, …) e a posição segue a proporção real. Função pura. */
export function tickMarks(durationSec: number): Array<{ sec: number; frac: number }> {
  if (!(durationSec > 0)) return [];
  const steps = [30, 60, 300, 600, 1200, 1800, 3600];
  const step = steps.find((s) => durationSec / s <= 9) ?? 7200;
  const out: Array<{ sec: number; frac: number }> = [];
  for (let s = 0; s <= durationSec; s += step) out.push({ sec: s, frac: s / durationSec });
  return out;
}

export function Timeline({
  filePath,
  durationSec,
  candidates,
  focusedId,
  currentSec,
  onFocus,
  onSeek,
}: {
  filePath: string | null;
  durationSec: number;
  candidates: HighlightCandidate[] | null;
  focusedId: number | null;
  currentSec: number;
  onFocus: (id: number) => void;
  onSeek: (sec: number) => void;
}): React.JSX.Element {
  const t = useT("workbench");
  const [data, setData] = useState<TimelineData | null>(null);

  useEffect(() => {
    setData(null);
    if (!filePath || !(durationSec > 0)) return;
    let alive = true;
    void getApi()
      .timelineData(filePath, durationSec)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [filePath, durationSec]);

  const W = 1000;
  const H = 44;
  const loudPath = useMemo(() => (data ? areaPath(data.loudness, W, H) : ""), [data]);
  const motionPath = useMemo(() => (data ? areaPath(data.motion, W, H) : ""), [data]);
  const dmPath = useMemo(() => (data ? areaPath(data.danmaku, W, H) : ""), [data]);
  const ticks = useMemo(() => tickMarks(durationSec), [durationSec]);
  const frac = (sec: number): number => Math.min(1, Math.max(0, durationSec > 0 ? sec / durationSec : 0));

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * durationSec);
  };

  return (
    <div className="shrink-0 rounded-xl border border-line/60 bg-panel/60 px-2.5 pt-1.5 pb-2.5">
      {/* A régua: as marcas são posicionadas em absoluto pela proporção real do tempo (o space-between empurraria a última marca para 100% e mentiria) */}
      <div className="relative h-4 select-none">
        {ticks.map(({ sec, frac: f }) => (
          <span
            key={sec}
            style={{ left: `${f * 100}%` }}
            className="absolute -translate-x-1/2 font-mono text-[9px] text-mut/60 first:translate-x-0"
          >
            {formatTick(sec)}
          </span>
        ))}
      </div>
      <div className="relative h-[104px] cursor-pointer" onClick={seekFromEvent}>
        {/* A tira de miniaturas */}
        <div className="absolute inset-x-0 top-0 flex h-[46px] overflow-hidden rounded-md border border-line/50 bg-panel-2">
          {(data?.thumbs?.length ? data.thumbs : Array.from({ length: 8 }, () => "")).map((b64, i) => (
            <div
              key={i}
              className="min-w-0 flex-1 border-l border-black/50 bg-cover bg-center first:border-l-0"
              style={b64 ? { backgroundImage: `url(data:image/jpeg;base64,${b64})` } : undefined}
            />
          ))}
        </div>
        {/* As curvas de calor dos sinais: volume (laranja) + movimento (ciano) + chat (rosa) */}
        <svg
          className="absolute inset-x-0 top-[50px] h-[44px] w-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          {loudPath && <path d={loudPath} fill="rgba(255,154,61,0.24)" stroke="rgba(255,154,61,0.7)" strokeWidth="1" />}
          {motionPath && <path d={motionPath} fill="rgba(34,211,238,0.12)" stroke="rgba(34,211,238,0.72)" strokeWidth="1" />}
          {dmPath && <path d={dmPath} fill="rgba(244,114,182,0.18)" stroke="rgba(244,114,182,0.75)" strokeWidth="1" />}
        </svg>
        {/* Os trechos candidatos: os recortes brilhantes sobre os picos das curvas; o descartado fica um tom mais escuro e tracejado */}
        {(candidates ?? []).map((c) => {
          const left = frac(c.startSec) * 100;
          const width = Math.max(0.5, (frac(c.endSec) - frac(c.startSec)) * 100);
          const focused = c.id === focusedId;
          const dropped = c.gate === "drop";
          return (
            <button
              key={c.id}
              type="button"
              title={`${c.title} · ${Math.round(c.endSec - c.startSec)}s`}
              onClick={(e) => {
                e.stopPropagation();
                onFocus(c.id);
                onSeek(c.startSec);
              }}
              style={{ left: `${left}%`, width: `${width}%` }}
              className={`absolute top-[-2px] bottom-[-2px] rounded-md border transition-shadow ${
                dropped
                  ? "border-dashed border-red-400/30 bg-red-500/5 opacity-60"
                  : focused
                    ? "border-[1.5px] border-ember bg-ember/15 shadow-[0_0_14px_-2px_rgba(255,110,40,0.55)]"
                    : "border-ember/50 bg-ember/8 hover:border-ember"
              }`}
            >
              <span
                className={`absolute -top-0.5 left-0 -translate-y-full rounded px-1 text-[9px] font-extrabold ${
                  dropped ? "bg-red-400/50 text-ink" : focused ? "flame-gradient text-white" : "bg-ember/80 text-ink"
                }`}
              >
                {c.id}
              </span>
            </button>
          );
        })}
        {/* A cabeça de reprodução */}
        <div
          style={{ left: `${frac(currentSec) * 100}%` }}
          className="pointer-events-none absolute top-[-6px] bottom-0 w-[2px] bg-flame"
        >
          <div className="absolute -top-1 -left-[4px] h-2 w-2.5 bg-flame [clip-path:polygon(0_0,100%_0,50%_100%)]" />
        </div>
      </div>
      {/* A legenda das cores */}
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-mut/70">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[3px] bg-[rgba(255,154,61,0.7)]" />
          {t("legendLoud")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[3px] bg-[rgba(34,211,238,0.72)]" />
          {t("legendMotion")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[3px] bg-[rgba(244,114,182,0.7)]" />
          {t("legendDanmaku")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[3px] border border-ember/70" />
          {t("legendCandidate")}
        </span>
      </div>
    </div>
  );
}
