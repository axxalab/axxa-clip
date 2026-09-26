/**
 * Mesa de revisão dos trechos candidatos: a pré-visualização real do vídeo + a linha de tempo com a forma de onda.
 * - As duas alças são arrastadas para ajustar o ponto de corte palavra a palavra (com encaixe automático na
 *   borda das palavras, e o vídeo acompanhando quadro a quadro durante o arrasto)
 * - O esticar por frase inteira reaproveita adjustCandidateBoundary; um clique devolve o ponto de corte original da IA
 * - Num candidato colado de vários pedaços: a trilha da forma de onda vira a lista de pedaços, e a reprodução
 *   salta de pedaço em pedaço na ordem (veja shared/pieces)
 * - A reprodução para exatamente no ponto de corte, e o «ver o final» toca só os últimos segundos para conferir o fecho
 * Na pré-visualização do navegador (mock) não há arquivo local → a área de vídeo vira um aviso, e a linha de tempo continua funcionando.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuPlay,
  LuPause,
  LuX,
  LuRotateCcw,
  LuCheck,
  LuSkipForward,
  LuFilm,
  LuChevronLeft,
  LuChevronRight,
  LuSmartphone,
} from "react-icons/lu";
import { useT, useLocaleStore } from "../i18n/store";
import { getApi } from "../api/provider";
import { adjustCandidateBoundary, piecesText } from "../../../shared/boundary";
import { contextWindow, wordsInWindow, snapToWordEdge, clampDrag, clipText } from "../../../shared/review";
import { piecesDurationSec } from "../../../shared/pieces";
import { SAFE_ZONE_PLATFORMS, zonesFor, fitContain, cropRect9x16 } from "../../../shared/safe-zones";
import type { Transcript, HighlightCandidate, AudioPeaks, ClipPiece } from "../../../shared/api-types";
import { ModalShell } from "./ui";

/** Ver o final: só estes últimos segundos são reproduzidos. */
const TAIL_PREVIEW_SEC = 2.5;
/** A persistência das preferências de zona segura (a chave + a plataforma escolhida). */
const SAFEZONE_LS_KEY = "hotclip-safezone";

function loadSafeZonePref(): { on: boolean; platform: string } {
  try {
    const p = JSON.parse(localStorage.getItem(SAFEZONE_LS_KEY) ?? "{}") as { on?: unknown; platform?: unknown };
    return { on: p.on === true, platform: typeof p.platform === "string" ? p.platform : SAFE_ZONE_PLATFORMS[0].id };
  } catch {
    return { on: false, platform: SAFE_ZONE_PLATFORMS[0].id };
  }
}

/** A máscara da área coberta pela plataforma: posicionada em porcentagem, pendurada na caixa-mãe que «representa a imagem 9:16», e transparente a todo evento. */
function SafeZoneMasks({ platformId }: { platformId: string }): React.JSX.Element {
  const p = zonesFor(platformId);
  return (
    <>
      {p.zones.map((z, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-[2px] border border-red-400/50 bg-red-500/20"
          style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}
        />
      ))}
    </>
  );
}
/** A tolerância do encaixe (em pixels) — convertida em segundos antes de ir para snapToWordEdge. */
const SNAP_TOLERANCE_PX = 8;

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ss = (s % 60).toFixed(1).padStart(4, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ClipReviewModal({
  clip,
  transcript,
  filePath,
  durationSec,
  onSave,
  onClose,
}: {
  clip: HighlightCandidate;
  transcript: Transcript;
  filePath?: string;
  /** A duração total do vídeo de origem, que define a borda direita da janela de contexto. */
  durationSec: number;
  onSave: (patch: { startSec: number; endSec: number; text: string; pieces?: ClipPiece[] }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT("highlights");
  const tc = useT("common");
  const [startSec, setStartSec] = useState(clip.startSec);
  const [endSec, setEndSec] = useState(clip.endSec);
  // Colagem de vários pedaços: este candidato é feito de pedaços bem distantes, e a mesa de revisão precisa deixar claro «quais pedaços e quanto foi saltado no meio»
  const [pieces, setPieces] = useState<ClipPiece[]>(clip.pieces ?? []);
  const stitched = pieces.length > 1;
  const [peaks, setPeaks] = useState<AudioPeaks | null>(null);
  // Olhada rápida na imagem: a folha de contato 3×3 (tirada uma vez, ao abrir, pelo ponto de corte original da IA; string vazia = sem suporte ou falha, e nada é mostrado)
  const [sheet, setSheet] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(clip.startSec);
  const [videoFailed, setVideoFailed] = useState(false);
  // [CORREÇÃO] O MediaError.code é registrado e aparece com honestidade no texto do lugar vazio.
  // 2 = MEDIA_ERR_NETWORK (a leitura do fluxo foi interrompida, um problema da camada de protocolo) e 4 = MEDIA_ERR_SRC_NOT_SUPPORTED.
  // Antes tudo dizia «este formato não dá para pré-visualizar», sem distinguir a causa, e uma falha de leitura
  // era reportada como formato não suportado — a pessoa ia transcodificar à toa.
  const [videoErrCode, setVideoErrCode] = useState(0);
  // Pré-visualização da zona segura: a chave e a plataforma escolhida são guardadas; a geometria da janela de recorte é calculada na hora, conforme o tamanho do contêiner e a proporção do vídeo
  const [safeZone, setSafeZone] = useState(loadSafeZonePref);
  const [videoAr, setVideoAr] = useState(16 / 9);
  const [contSize, setContSize] = useState({ w: 0, h: 0 });
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const locale = useLocaleStore((s) => s.locale);

  const setSafeZonePref = (patch: Partial<{ on: boolean; platform: string }>): void => {
    setSafeZone((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SAFEZONE_LS_KEY, JSON.stringify(next));
      } catch {
        /* a persistência é feita na medida do possível */
      }
      return next;
    });
  };

  // Acompanhamento do tamanho da caixa de vídeo (redimensionar a janela e carregar o vídeo pedem os dois um novo cálculo da janela de recorte)
  useEffect(() => {
    const el = videoBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setContSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // A janela é fixada pelo ponto de corte de quando abriu, e a forma de onda é tirada uma vez só; o esticar por frase pode passar da janela, e na exibição é aparado na borda
  const win = useMemo(
    () => contextWindow(clip.startSec, clip.endSec, durationSec),
    [clip.startSec, clip.endSec, durationSec]
  );
  const words = useMemo(() => wordsInWindow(transcript, win.winStartSec, win.winEndSec), [transcript, win]);
  const text = useMemo(
    () => (stitched ? piecesText(transcript, pieces) : clipText(transcript, startSec, endSec)),
    [transcript, stitched, pieces, startSec, endSec]
  );
  // [CORREÇÃO] A view passou para o 2º trecho do pathname (antes era `?view=review`). A query não entra na
  // decisão de mídia do Chromium, e o serveMedia do processo principal só olha o pathname, então a forma antiga não distinguia nada.
  const src = useMemo(() => (filePath ? getApi().mediaUrl(filePath, "review") : ""), [filePath]);
  // A duração do vídeo pronto: num trecho colado é a soma dos pedaços, não o intervalo total
  const outDurationSec = stitched ? piecesDurationSec(pieces) : endSec - startSec;
  const dirty =
    Math.abs(startSec - clip.startSec) > 1e-3 ||
    Math.abs(endSec - clip.endSec) > 1e-3 ||
    JSON.stringify(pieces) !== JSON.stringify(clip.pieces ?? []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  // O laço de reprodução lê o ponto de corte mais recente, para o fechamento não pegar um valor velho
  const boundsRef = useRef({ startSec, endSec });
  boundsRef.current = { startSec, endSec };
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;

  // ---- Forma de onda ----
  // Num trecho colado ela é pulada: o intervalo total pode ter dezenas de minutos, e a forma de onda desenhada
  // seria quase toda de conteúdo que nem entra no vídeo, o que engana e ainda decodificaria o áudio à toa
  useEffect(() => {
    if (!filePath || stitched) return;
    let alive = true;
    getApi()
      .getAudioPeaks(filePath, win.winStartSec, win.winEndSec)
      .then((p) => {
        if (alive) setPeaks(p);
      })
      .catch(() => {
        /* uma forma de onda que falha não é fatal — a linha de tempo vira uma trilha de cor sólida */
      });
    return () => {
      alive = false;
    };
  }, [filePath, win, stitched]);

  // ---- Olhada rápida na imagem (a folha de contato) ----
  // Tirada uma vez só, pelo ponto de corte de quando abriu (arrastar a alça não remonta nada — o ffmpeg não deve
  // ser estourado por um arrasto); uma falha não aparece, fica em silêncio.
  // Num trecho colado é pulada: amostrar 3×9 quadros por igual traria um monte de imagem que foi cortada, o que parece o vídeo pronto mas não é
  useEffect(() => {
    if (!filePath || stitched) return;
    let alive = true;
    getApi()
      .contactSheet(filePath, clip.startSec, clip.endSec)
      .then((url) => {
        if (alive) setSheet(url);
      })
      .catch(() => {
        /* uma olhada rápida que falha não é fatal */
      });
    return () => {
      alive = false;
    };
  }, [filePath, clip.startSec, clip.endSec, stitched]);

  const secToFrac = useCallback(
    (s: number) => Math.max(0, Math.min(1, (s - win.winStartSec) / (win.winEndSec - win.winStartSec))),
    [win]
  );

  // O desenho da forma de onda: dentro do intervalo escolhido na cor de chama, e fora dele escurecido
  const drawWave = useCallback((): void => {
    const canvas = canvasRef.current;
    const lane = laneRef.current;
    if (!canvas || !lane) return;
    const dpr = window.devicePixelRatio || 1;
    const w = lane.clientWidth;
    const h = lane.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!peaks || peaks.values.length === 0) return;
    const css = getComputedStyle(document.documentElement);
    const ember = css.getPropertyValue("--color-ember").trim() || "#ff9a3d";
    const dim = css.getPropertyValue("--color-mut").trim() || "#8f95a3";
    const winDur = win.winEndSec - win.winStartSec;
    for (let x = 0; x < w; x++) {
      const t0 = win.winStartSec + (x / w) * winDur;
      const t1 = win.winStartSec + ((x + 1) / w) * winDur;
      const i0 = Math.max(0, Math.floor((t0 - peaks.startSec) / peaks.hopSec));
      const i1 = Math.min(peaks.values.length - 1, Math.ceil((t1 - peaks.startSec) / peaks.hopSec));
      let peak = 0;
      for (let i = i0; i <= i1; i++) if (peaks.values[i] > peak) peak = peaks.values[i];
      const mid = (t0 + t1) / 2;
      const inRange = mid >= startSec && mid <= endSec;
      const barH = Math.max(1.5, peak * (h - 10));
      ctx.fillStyle = inRange ? ember : dim;
      ctx.globalAlpha = inRange ? 0.95 : 0.28;
      ctx.fillRect(x, (h - barH) / 2, 1, barH);
    }
    ctx.globalAlpha = 1;
  }, [peaks, startSec, endSec, win]);

  useEffect(() => {
    drawWave();
    window.addEventListener("resize", drawWave);
    return () => window.removeEventListener("resize", drawWave);
  }, [drawWave]);

  // ---- Controle de reprodução ----
  const stopLoop = useCallback((): void => cancelAnimationFrame(rafRef.current), []);

  const tick = useCallback((): void => {
    const v = videoRef.current;
    if (!v) return;
    setPlayheadSec(v.currentTime);
    const ps = piecesRef.current;
    if (ps.length > 1) {
      // Pré-visualização da colagem: ao chegar no fim de um pedaço, salta para o começo do seguinte, e depois do
      // último para — a ordem que a pessoa vê aqui é a ordem do vídeo pronto
      const i = ps.findIndex((p) => v.currentTime < p.endSec - 0.03);
      if (i < 0) {
        v.pause();
        return;
      }
      if (v.currentTime < ps[i].startSec - 0.05) v.currentTime = ps[i].startSec;
    } else if (v.currentTime >= boundsRef.current.endSec - 0.03) {
      // Para exatamente no ponto de corte: o que se revisa é justamente «no ponto, ele fecha ou não»
      v.pause();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const playFrom = useCallback(
    (at: number): void => {
      const v = videoRef.current;
      if (!v) return;
      // No Windows, quando o primeiro pedido de Range do protocolo próprio falha de vez em quando, o elemento video
      // é preservado e um novo carregamento é permitido. Antes o estado de falha descarregava o video, o botão ficava
      // cinza junto, e a pessoa só podia fechar a mesa de revisão e abrir de novo.
      if (videoFailed) {
        setVideoFailed(false);
        v.load();
      }
      v.currentTime = at;
      setPlayheadSec(at);
      void v
        .play()
        .then(() => {
          stopLoop();
          rafRef.current = requestAnimationFrame(tick);
        })
        .catch(() => {
          /* a reprodução foi recusada pelo navegador (raríssimo) — basta clicar no botão outra vez */
        });
    },
    [stopLoop, tick, videoFailed]
  );

  const seekTo = useCallback((at: number): void => {
    const v = videoRef.current;
    if (v) v.currentTime = at;
    setPlayheadSec(at);
  }, []);

  useEffect(() => stopLoop, [stopLoop]); // ao desmontar, o laço de reprodução é parado

  // Esc fecha (sem salvar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ---- Arrasto das alças ----
  const onHandleDown = useCallback(
    (edge: "start" | "end") =>
      (e: React.PointerEvent<HTMLDivElement>): void => {
        e.stopPropagation();
        const lane = laneRef.current;
        if (!lane) return;
        const rect = lane.getBoundingClientRect();
        const winDur = win.winEndSec - win.winStartSec;
        const secPerPx = winDur / rect.width;
        videoRef.current?.pause();

        const move = (ev: PointerEvent): void => {
          const raw = win.winStartSec + (ev.clientX - rect.left) * secPerPx;
          const snapped = snapToWordEdge(raw, words, edge, SNAP_TOLERANCE_PX * secPerPx);
          const other = edge === "start" ? boundsRef.current.endSec : boundsRef.current.startSec;
          const next = clampDrag(edge, snapped, other, win);
          if (edge === "start") setStartSec(next);
          else setEndSec(next);
          seekTo(next); // arrastar já mexe o quadro — a posição na mão é a posição na imagem
        };
        const up = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      },
    [win, words, seekTo]
  );

  // Um clique num espaço vazio da linha de tempo → a reprodução salta para ali
  const onLaneDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const lane = laneRef.current;
      if (!lane) return;
      const rect = lane.getBoundingClientRect();
      const at = win.winStartSec + ((e.clientX - rect.left) / rect.width) * (win.winEndSec - win.winStartSec);
      seekTo(Math.max(win.winStartSec, Math.min(win.winEndSec, at)));
    },
    [win, seekTo]
  );

  // ---- Esticar por frase inteira (reaproveitando a lógica de frases que já existe) ----
  const sentence = useCallback(
    (edge: "start" | "end", dir: 1 | -1): void => {
      // Num trecho colado só o início do primeiro pedaço e o fim do último se movem (os do meio a IA escolheu para o contraste)
      const adj = adjustCandidateBoundary(transcript, { startSec, endSec, pieces }, edge, dir);
      if (!adj) return;
      setStartSec(adj.startSec);
      setEndSec(adj.endSec);
      if (adj.pieces) setPieces(adj.pieces);
      // O «ver o final» tem de cair dentro do último pedaço, e não se subtrai do intervalo total (isso cairia no vão entre dois pedaços)
      const lastStart = adj.pieces?.[adj.pieces.length - 1].startSec ?? adj.startSec;
      seekTo(edge === "start" ? adj.startSec : Math.max(lastStart, adj.endSec - TAIL_PREVIEW_SEC));
    },
    [transcript, stitched, pieces, startSec, endSec, seekTo]
  );

  const reset = useCallback((): void => {
    setStartSec(clip.startSec);
    setEndSec(clip.endSec);
    setPieces(clip.pieces ?? []);
    seekTo(clip.startSec);
  }, [clip.startSec, clip.endSec, clip.pieces, seekTo]);

  const showVideo = src !== "" && !videoFailed;

  return (
    <ModalShell onClose={onClose}>
      <div
        className="card rise-in flex max-h-[92vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <LuFilm className="h-4.5 w-4.5 text-ember" />
              {t("reviewTitle")}
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-mut">{clip.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line p-1.5 text-mut transition-colors hover:border-mut hover:text-fg"
          >
            <LuX className="h-4 w-4" />
          </button>
        </div>

        {/* Pré-visualização do vídeo (posicionada em relativo para carregar a máscara da zona segura) */}
        <div ref={videoBoxRef} className="relative mt-4 overflow-hidden rounded-xl bg-black/60">
          {src !== "" && (
            <video
              ref={videoRef}
              src={src}
              playsInline
              className={`mx-auto max-h-[36vh] w-full object-contain ${videoFailed ? "hidden" : ""}`}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth > 0 && v.videoHeight > 0) setVideoAr(v.videoWidth / v.videoHeight);
                seekTo(boundsRef.current.startSec);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => {
                setPlaying(false);
                stopLoop();
              }}
              onCanPlay={() => setVideoFailed(false)}
              onError={(e) => {
                setPlaying(false);
                stopLoop();
                // [CORREÇÃO] O MediaError.code entra de passagem no texto do lugar vazio, para ficar claro se é falha de fluxo ou problema de formato
                setVideoErrCode(e.currentTarget.error?.code ?? 0);
                setVideoFailed(true);
              }}
            />
          )}
          {!showVideo && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <LuFilm className="h-6 w-6 text-mut" />
              <p className="max-w-md text-[12.5px] leading-relaxed text-mut">
                {src === ""
                  ? t("reviewBrowserStub")
                  : videoErrCode > 0
                    ? t("reviewNoVideoCode").replace("{code}", String(videoErrCode))
                    : t("reviewNoVideo")}
              </p>
              {/* A pré-visualização do navegador não tem imagem: uma caixa 9:16 de demonstração mantém a forma da máscara visível */}
              {safeZone.on && (
                <div
                  className="relative mx-auto mt-2 rounded-md border border-dashed border-fg/40 bg-panel-2"
                  style={{ aspectRatio: "9/16", height: "26vh" }}
                >
                  <SafeZoneMasks platformId={safeZone.platform} />
                </div>
              )}
            </div>
          )}
          {/* A máscara da zona segura: primeiro a janela de recorte 9:16 pelo centro (a área do vídeo vertical) e depois a área coberta pela plataforma */}
          {safeZone.on && showVideo && contSize.w > 0 && (() => {
            const box = cropRect9x16(fitContain(contSize.w, contSize.h, videoAr));
            return (
              <div
                className="pointer-events-none absolute border border-dashed border-fg/40"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              >
                <SafeZoneMasks platformId={safeZone.platform} />
              </div>
            );
          })()}
        </div>

        {/* Controle de reprodução + código de tempo */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={src === ""}
            onClick={() => (playing ? videoRef.current?.pause() : playFrom(stitched ? pieces[0].startSec : startSec))}
            className="btn-flame inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-40"
          >
            {playing ? <LuPause className="h-3.5 w-3.5" /> : <LuPlay className="h-3.5 w-3.5" />}
            {playing ? t("reviewPause") : t("reviewPlay")}
          </button>
          <button
            type="button"
            disabled={src === ""}
            title={t("reviewPlayEndHint")}
            onClick={() => {
              const last = stitched ? pieces[pieces.length - 1] : { startSec, endSec };
              playFrom(Math.max(last.startSec, last.endSec - TAIL_PREVIEW_SEC));
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[12.5px] font-semibold text-mut transition-colors hover:border-mut hover:text-fg disabled:opacity-40"
          >
            <LuSkipForward className="h-3.5 w-3.5" />
            {t("reviewPlayEnd")}
          </button>
          <button
            type="button"
            title={t("reviewSafeZoneHint")}
            onClick={() => setSafeZonePref({ on: !safeZone.on })}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${
              safeZone.on ? "border-ember/60 bg-ember/10 text-fg" : "border-line text-mut hover:border-mut hover:text-fg"
            }`}
          >
            <LuSmartphone className={`h-3.5 w-3.5 ${safeZone.on ? "text-ember" : ""}`} />
            {t("reviewSafeZone")}
          </button>
          {safeZone.on && (
            <select
              value={safeZone.platform}
              onChange={(e) => setSafeZonePref({ platform: e.target.value })}
              className="rounded-lg border border-line bg-panel-2 px-2 py-2 text-[11.5px] text-mut outline-none focus:border-ember/60"
            >
              {SAFE_ZONE_PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name[locale === "en" ? "en" : "pt"]}
                </option>
              ))}
            </select>
          )}
          <span className="chip ml-auto rounded-md px-2.5 py-1 font-mono text-[11.5px]">
            {formatClock(startSec)} → {formatClock(endSec)}
            <span className="ml-2 text-ember">{t("durationChip", { n: Math.round(outDurationSec) })}</span>
          </span>
        </div>

        {/* Num trecho colado: a lista de pedaços no lugar da linha de tempo com forma de onda — uma forma de onda
            de dezenas de minutos não significa nada, e o que a pessoa precisa conferir é «quais pedaços entraram,
            quanto foi saltado no meio e se, colado, continua querendo dizer a mesma coisa» */}
        {stitched && (
          <div className="mt-3 rounded-xl border border-ember/40 bg-ember/5 p-3">
            <div className="mb-2 text-[11.5px] font-semibold text-ember">
              {t("stitchedTitle", { n: pieces.length, sec: Math.round(outDurationSec) })}
            </div>
            <div className="flex flex-col gap-1.5">
              {pieces.map((p, i) => (
                <div key={`${p.startSec}-${i}`}>
                  {i > 0 && (
                    <div className="my-1 flex items-center gap-2 pl-1 text-[10.5px] text-mut/80">
                      <span className="h-px flex-1 border-t border-dashed border-line" />
                      {t("stitchedGap", { sec: Math.round(p.startSec - pieces[i - 1].endSec) })}
                      <span className="h-px flex-1 border-t border-dashed border-line" />
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={src === ""}
                    onClick={() => playFrom(p.startSec)}
                    className="flex w-full items-center gap-2 rounded-lg bg-panel-2 px-2.5 py-1.5 text-left transition-colors hover:bg-panel disabled:opacity-50"
                  >
                    <LuPlay className="h-3 w-3 shrink-0 text-ember" />
                    <span className="shrink-0 font-mono text-[11px] text-mut">
                      {formatClock(p.startSec)} → {formatClock(p.endSec)}
                    </span>
                    <span className="truncate text-[12px] text-fg/85">{piecesText(transcript, [p])}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linha de tempo: forma de onda + seleção + alças + cabeça de reprodução (num trecho colado não há linha de tempo contínua para desenhar) */}
        {!stitched && (
        <div
          ref={laneRef}
          onPointerDown={onLaneDown}
          className="relative mt-3 h-16 cursor-pointer touch-none overflow-hidden rounded-xl bg-panel-2"
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {/* Seleção */}
          <div
            className="pointer-events-none absolute inset-y-0 border-x-2 border-ember/80 bg-ember/10"
            style={{ left: `${secToFrac(startSec) * 100}%`, width: `${(secToFrac(endSec) - secToFrac(startSec)) * 100}%` }}
          />
          {/* Cabeça de reprodução */}
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-fg/90"
            style={{ left: `${secToFrac(playheadSec) * 100}%` }}
          />
          {/* Alças de início e fim */}
          {(["start", "end"] as const).map((edge) => (
            <div
              key={edge}
              onPointerDown={onHandleDown(edge)}
              className="absolute inset-y-0 flex w-5 -translate-x-1/2 cursor-ew-resize items-center justify-center"
              style={{ left: `${secToFrac(edge === "start" ? startSec : endSec) * 100}%` }}
            >
              <div className="h-9 w-1.5 rounded-full bg-ember shadow-md shadow-black/40" />
            </div>
          ))}
        </div>
        )}
        {!stitched && (
        <div className="mt-1 flex justify-between font-mono text-[10.5px] text-mut/80">
          <span>{formatClock(win.winStartSec)}</span>
          <span>{t("reviewDragHint")}</span>
          <span>{formatClock(win.winEndSec)}</span>
        </div>
        )}

        {/* Esticar por frase inteira */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
          {(
            [
              ["start", -1, LuChevronLeft, "nudgeStartBack"],
              ["start", 1, LuChevronRight, "nudgeStartFwd"],
              ["end", -1, LuChevronLeft, "nudgeEndBack"],
              ["end", 1, LuChevronRight, "nudgeEndFwd"],
            ] as const
          ).map(([edge, dir, Icon, key]) => (
            <button
              key={key}
              type="button"
              onClick={() => sentence(edge, dir)}
              className="chip inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors hover:text-fg"
            >
              <Icon className="h-3 w-3" />
              {t(key)}
            </button>
          ))}
        </div>

        {/* Olhada rápida na imagem: a folha de contato 3×3, que mostra o trecho inteiro de relance sem precisar dar play */}
        {sheet && (
          <div className="mt-3">
            <div className="mb-1 text-[10.5px] text-mut/80">{t("reviewSheet")}</div>
            <img src={sheet} alt={t("reviewSheet")} className="w-full rounded-xl border border-line" />
          </div>
        )}

        {/* O texto do intervalo atual (para conferir o que não se entendeu de ouvido) */}
        <div className="mt-3 max-h-24 overflow-y-auto rounded-xl bg-panel-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg/85">
          {text || <span className="text-mut">{t("reviewTextEmpty")}</span>}
        </div>

        {/* Ações do rodapé */}
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-dashed border-line pt-4">
          <button
            type="button"
            disabled={!dirty}
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[12.5px] font-semibold text-mut transition-colors hover:border-mut hover:text-fg disabled:opacity-40"
          >
            <LuRotateCcw className="h-3.5 w-3.5" />
            {t("reviewReset")}
          </button>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-4 py-2 text-[12.5px] font-semibold text-mut transition-colors hover:border-mut hover:text-fg"
            >
              {tc("cancel")}
            </button>
            <button
              type="button"
              onClick={() =>
                dirty ? onSave({ startSec, endSec, text, pieces: stitched ? pieces : undefined }) : onClose()
              }
              className="btn-flame inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-[13px] font-bold text-white"
            >
              <LuCheck className="h-4 w-4" />
              {t("reviewSave")}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
