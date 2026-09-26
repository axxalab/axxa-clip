/**
 * A área de pré-visualização: a imagem de origem em 16:9 + a pré-visualização do recorte vertical 9:16 pelo
 * centro (no cartão com o contorno brilhante do cartaz).
 * Uma ferramenta de vídeo finalmente mostra o vídeo — clicar num candidato ou na linha de tempo leva a imagem
 * até ali.
 * O cartão vertical é um segundo elemento <video> com recorte central por CSS, em sincronia aproximada com a
 * imagem principal (o enquadramento real que segue o rosto acontece na camada de exportação, e aqui é a
 * pré-visualização intuitiva de «o vertical vai ficar mais ou menos assim»).
 */
import { useEffect, useRef, useState } from "react";
import { LuPlay, LuPause, LuSkipBack, LuSkipForward } from "react-icons/lu";
import { getApi } from "../../api/provider";
import { useT } from "../../i18n/store";

export interface PreviewTransportCommand {
  id: number;
  action: "toggle" | "back5" | "forward5" | "audition";
  startSec?: number;
  endSec?: number;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function PreviewPane({
  filePath,
  durationSec,
  seekSec,
  onTime,
  onPrevCandidate,
  onNextCandidate,
  transportCommand,
  compact = false,
}: {
  filePath: string | null;
  durationSec: number;
  /** O instante que alguém de fora pediu para saltar (vem de um clique na linha de tempo ou num candidato; NaN = nenhum pedido). */
  seekSec: number;
  onTime: (sec: number) => void;
  onPrevCandidate: () => void;
  onNextCandidate: () => void;
  transportCommand?: PreviewTransportCommand | null;
  compact?: boolean;
}): React.JSX.Element {
  const t = useT("workbench");
  const mainRef = useRef<HTMLVideoElement>(null);
  const auditionEnd = useRef<number | null>(null);
  const cropRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  // [CORREÇÃO] O identificador que distingue as duas views precisa entrar no pathname, e não na query.
  // Antes era `${srcBase}?view=main` / `${srcBase}?view=crop`, mas o Chromium ignora a query ao decidir «é a
  // mesma mídia?» e o serveMedia do processo principal só olha o pathname — os dois <video> eram, na prática, o
  // mesmo recurso, dividiam o mesmo buffer de mídia, um estragava e os dois estragavam juntos, e aquela URL não
  // tocava mais nesta sessão. Agora a view é o 2º trecho do pathname.
  const src = filePath ? getApi().mediaUrl(filePath, "main") : "";
  const cropSrc = filePath ? getApi().mediaUrl(filePath, "crop") : "";
  // [CORREÇÃO] Quando a leitura do fluxo da imagem principal falha, o MediaError.code é registrado, e o texto do
  // lugar vazio diz com honestidade que a «leitura foi interrompida» em vez do genérico «não dá para
  // pré-visualizar neste ambiente» — o genérico faz a pessoa achar que é o ambiente ou o formato que não serve.
  // 2 = MEDIA_ERR_NETWORK (a leitura do fluxo foi interrompida, na camada de protocolo) e 4 = MEDIA_ERR_SRC_NOT_SUPPORTED.
  const [mainErrCode, setMainErrCode] = useState(0);

  // O pedido de seek que vem de fora (clique na linha de tempo, foco num candidato)
  useEffect(() => {
    const v = mainRef.current;
    if (!v || !Number.isFinite(seekSec)) return;
    auditionEnd.current = null;
    v.currentTime = seekSec;
  }, [seekSec]);

  // O cartão do recorte vertical fica em sincronia aproximada com a imagem principal: só é corrigido quando a deriva passa de 0,3s, para não tremer
  const syncCrop = (): void => {
    const m = mainRef.current;
    const c = cropRef.current;
    if (!m || !c) return;
    if (Math.abs(c.currentTime - m.currentTime) > 0.3) c.currentTime = m.currentTime;
    if (m.paused !== c.paused) {
      if (m.paused) c.pause();
      else void c.play().catch(() => {});
    }
  };

  const togglePlay = (): void => {
    const v = mainRef.current;
    if (!v) return;
    auditionEnd.current = null;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  useEffect(() => {
    const video = mainRef.current;
    if (!video || !transportCommand) return;
    auditionEnd.current = null;
    if (transportCommand.action === "audition" && Number.isFinite(transportCommand.startSec) && Number.isFinite(transportCommand.endSec)) {
      video.currentTime = Math.max(0, transportCommand.startSec!);
      auditionEnd.current = Math.min(durationSec, transportCommand.endSec!);
      void video.play().catch(() => { auditionEnd.current = null; });
      return;
    }
    if (transportCommand.action === "toggle") {
      if (video.paused) void video.play().catch(() => {});
      else video.pause();
      return;
    }
    const delta = transportCommand.action === "back5" ? -5 : 5;
    video.currentTime = Math.max(0, Math.min(durationSec, video.currentTime + delta));
  }, [durationSec, transportCommand]);

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className={`flex gap-2.5 ${compact ? "h-[132px]" : "h-[236px]"}`}>
        {/* A imagem de origem */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-line/60 bg-black">
          {/* [CORREÇÃO] Quando a leitura do fluxo falha, não basta deixar o <video> no lugar (ele já está preto e
              não se cura): é preciso trocá-lo explicitamente por um bloco de espera e mostrar o MediaError.code. */}
          {src && mainErrCode === 0 ? (
            <video
              ref={mainRef}
              src={src}
              className="h-full w-full object-contain"
              onClick={togglePlay}
              onPlay={() => {
                setPlaying(true);
                syncCrop();
              }}
              onPause={() => {
                setPlaying(false);
                syncCrop();
              }}
              onTimeUpdate={(e) => {
                const sec = (e.target as HTMLVideoElement).currentTime;
                if (auditionEnd.current !== null && sec >= auditionEnd.current) { mainRef.current?.pause(); auditionEnd.current = null; }
                setNow(sec);
                onTime(sec);
                syncCrop();
              }}
              onCanPlay={() => setMainErrCode(0)}
              onError={(e) => {
                setPlaying(false);
                setMainErrCode(e.currentTarget.error?.code ?? 0);
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-mut">
              {mainErrCode > 0 ? t("previewReadFailed").replace("{code}", String(mainErrCode)) : t("noPreview")}
            </div>
          )}
          <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] text-fg/70">
            {t("sourcePreview")}
          </span>
        </div>
        {/* Recorte vertical 9:16 pelo centro: o contorno brilhante (a linguagem dos cartões de corte do cartaz principal) */}
        <div className="relative w-[133px] shrink-0 overflow-hidden rounded-xl border-[1.5px] border-ember/60 bg-black shadow-[0_0_22px_-6px_rgba(255,100,40,0.5)]">
          {src ? (
            <video ref={cropRef} src={cropSrc} muted className="h-full w-full object-cover" />
          ) : (
            <div className="h-full bg-gradient-to-b from-panel-2 to-panel" />
          )}
          <span className="pointer-events-none absolute right-0 bottom-1.5 left-0 text-center text-[9px] text-fg/50">
            {t("verticalPreview")}
          </span>
        </div>
      </div>
      {/* A fita de tempo */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onPrevCandidate}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-mut transition-colors hover:border-mut hover:text-fg"
        >
          <LuSkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!src}
          className="flame-gradient flex h-8 w-8 items-center justify-center rounded-lg text-white disabled:opacity-40"
        >
          {playing ? <LuPause className="h-4 w-4" /> : <LuPlay className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onNextCandidate}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-mut transition-colors hover:border-mut hover:text-fg"
        >
          <LuSkipForward className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono text-[12px] tabular-nums">
          {formatClock(now)} <span className="text-mut/50">/ {formatClock(durationSec)}</span>
        </span>
      </div>
    </div>
  );
}
