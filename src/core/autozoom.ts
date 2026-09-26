/**
 * Movimento automático de câmera (Auto-Zoom): uma aproximação e um afastamento lentos são sobrepostos
 * ao vídeo vertical. Material de câmera fixa (alguém falando, uma live) fica com a imagem morta depois
 * de virar vertical, e a pessoa desliza para o vídeo seguinte em três segundos; na edição manual
 * alguém põe quadros-chave de aproximar e afastar para criar respiração — aqui isso é automático.
 *
 * A estratégia é «respirar», não aproximar sem parar: empurrar num sentido só o tempo todo aperta cada
 * vez mais o enquadramento na segunda metade e corta o topo da cabeça; aqui a imagem vai e volta entre
 * o padrão e a aproximação, num ciclo de uns 10 segundos. Havendo instantes de ênfase (estouro / pico
 * de volume), a aproximação chega ao máximo justo neles, e a linguagem de câmera casa com o conteúdo.
 *
 * Na geometria, quem faz isso é o zoompan do ffmpeg — o w/h do crop é avaliado uma única vez na
 * inicialização e não consegue escalar quadro a quadro, e o zoompan é o único filtro capaz de mudar o
 * plano a cada quadro. A expressão é compilada do mesmo jeito que o crop-x do rastreio de rosto (linear
 * por pedaços, com teto de quadros-chave para controlar a profundidade do aninhamento). Função pura e testável.
 */

/** O plano de referência (1 = sem escala, imagem inteira). */
export const ZOOM_BASE = 1.0;
/** O fator máximo da aproximação da respiração (acima de 1,1 o enquadramento é visivelmente cortado; contenção é melhor). */
export const ZOOM_BREATH = 1.06;
/** O fator de aproximação nos instantes de ênfase. */
export const ZOOM_EMPHASIS = 1.1;
/** Os segundos de um ciclo completo de respiração (aproximar + voltar). */
export const ZOOM_CYCLE_SEC = 10;
/** Trecho mais curto que esta duração não recebe movimento de câmera (o vídeo acabaria antes de a imagem chegar onde ia, e só pareceria tremido). */
export const ZOOM_MIN_CLIP_SEC = 4;
/** A antecipação da aproximação de ênfase: a câmera se move primeiro e o conteúdo chega depois — é assim que a sensação é de «acompanhou». */
const EMPHASIS_LEAD_SEC = 0.4;
/** Quanto tempo a aproximação de ênfase dura. */
const EMPHASIS_HOLD_SEC = 1.6;
/** Teto de quadros-chave da expressão (na mesma ordem de grandeza do renderCropXExpr, contra o aninhamento fundo demais). */
const MAX_ZOOM_KEYFRAMES = 24;

export interface ZoomKeyframe {
  /** O tempo relativo dentro do trecho (segundos). */
  t: number;
  /** O fator de escala (≥1). */
  z: number;
}

export interface AutoZoomOptions {
  /** Os instantes de ênfase (em segundos relativos ao trecho), que normalmente vêm do estouro / do pico de volume. */
  emphasisAtSec?: number[];
  breathZoom?: number;
  emphasisZoom?: number;
  cycleSec?: number;
}

/**
 * Planeja os quadros-chave de escala. Sem instantes de ênfase, é só o ritmo da respiração; com eles, a
 * região em volta de cada um é sobrescrita por aproximar-manter-voltar, e os quadros-chave de respiração
 * cobertos são descartados (para as duas curvas não brigarem). Função pura.
 */
export function planZoomKeyframes(durationSec: number, options: AutoZoomOptions = {}): ZoomKeyframe[] {
  if (!(durationSec >= ZOOM_MIN_CLIP_SEC)) return [];
  const breath = options.breathZoom ?? ZOOM_BREATH;
  const emphasis = options.emphasisZoom ?? ZOOM_EMPHASIS;
  const cycle = Math.max(2, options.cycleSec ?? ZOOM_CYCLE_SEC);

  // A respiração: 0 → meio ciclo aproximando até breath → ciclo completo de volta ao padrão, e assim por diante
  const breathing: ZoomKeyframe[] = [{ t: 0, z: ZOOM_BASE }];
  for (let t = cycle / 2; t < durationSec; t += cycle / 2) {
    const atPeak = Math.round((t / (cycle / 2))) % 2 === 1;
    breathing.push({ t, z: atPeak ? breath : ZOOM_BASE });
  }

  const emphases = (options.emphasisAtSec ?? [])
    .filter((t) => Number.isFinite(t) && t >= 0 && t < durationSec)
    .sort((a, b) => a - b);
  if (emphases.length === 0) return dedupe(breathing, durationSec);

  // Primeiro os instantes de ênfase são abertos em janelas e as que se sobrepõem são unidas; só depois os
  // quadros-chave são espalhados — fazer nessa ordem evita o espasmo de «a janela anterior acabou de voltar e a seguinte já puxa com força»
  const spans: Array<{ from: number; at: number; holdEnd: number; to: number }> = [];
  for (const at of emphases) {
    const from = Math.max(0, at - EMPHASIS_LEAD_SEC);
    const holdEnd = Math.min(durationSec, at + EMPHASIS_HOLD_SEC);
    const to = Math.min(durationSec, holdEnd + EMPHASIS_LEAD_SEC);
    const last = spans[spans.length - 1];
    if (last && from <= last.to) {
      // Estão perto: viram uma aproximação longa só, e o ponto de aproximação continua sendo a primeira ênfase (depois de chegar, a imagem se mantém)
      last.holdEnd = Math.max(last.holdEnd, holdEnd);
      last.to = Math.max(last.to, to);
      continue;
    }
    spans.push({ from, at, holdEnd, to });
  }
  const marks: ZoomKeyframe[] = [];
  for (const s of spans) {
    marks.push(
      { t: s.from, z: ZOOM_BASE },
      { t: s.at, z: emphasis },
      { t: s.holdEnd, z: emphasis },
      { t: s.to, z: ZOOM_BASE }
    );
  }
  // Os quadros-chave de respiração que caem dentro de uma janela de ênfase (inclusive nas pontas) são descartados, para não brigar com a curva da ênfase
  const kept = breathing.filter((k) => !spans.some((s) => k.t >= s.from && k.t <= s.to));
  return dedupe([...kept, ...marks].sort((a, b) => a.t - b.t), durationSec);
}

/** Tira os quadros-chave repetidos no mesmo instante e garante que o primeiro esteja em 0. */
function dedupe(kfs: ZoomKeyframe[], durationSec: number): ZoomKeyframe[] {
  const out: ZoomKeyframe[] = [];
  for (const k of kfs) {
    if (k.t > durationSec) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - k.t) < 1e-3) {
      last.z = Math.max(last.z, k.z); // no mesmo instante, vale o mais aproximado
      continue;
    }
    out.push({ t: k.t, z: k.z });
  }
  if (out.length > 0 && out[0].t > 0) out.unshift({ t: 0, z: ZOOM_BASE });
  return out;
}

/** Reamostragem uniforme (preservando as pontas), igual à do downsampleKeyframes. */
function downsample(kfs: ZoomKeyframe[], max: number): ZoomKeyframe[] {
  if (kfs.length <= max) return kfs;
  const out: ZoomKeyframe[] = [];
  for (let i = 0; i < max; i++) out.push(kfs[Math.round((i * (kfs.length - 1)) / (max - 1))]);
  return out;
}

/**
 * Os quadros-chave compilados na expressão z do zoompan (interpolação linear por pedaços, com in_time
 * como variável). Sem quadro-chave, devolve "1" (o mesmo que não escalar). Função pura.
 */
export function renderZoomExpr(keyframes: ZoomKeyframe[], maxKeyframes = MAX_ZOOM_KEYFRAMES): string {
  const kfs = downsample(keyframes, maxKeyframes).filter((k, i, arr) => i === 0 || k.t > arr[i - 1].t + 1e-4);
  if (kfs.length === 0) return "1";
  const fmt = (z: number): string => z.toFixed(4);
  if (kfs.length === 1) return fmt(kfs[0].z);
  let expr = fmt(kfs[kfs.length - 1].z);
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i];
    const b = kfs[i + 1];
    const dt = (b.t - a.t).toFixed(4);
    const seg = `${fmt(a.z)}+${(b.z - a.z).toFixed(4)}*(in_time-${a.t.toFixed(3)})/${dt}`;
    expr = `if(lt(in_time,${b.t.toFixed(3)}),${seg},${expr})`;
  }
  return expr;
}

/**
 * A cadeia completa do filtro zoompan: escala pelo centro e sai no tamanho de destino.
 * `fps` tem de receber a taxa de quadros da origem — o fps padrão do zoompan é 25, e sem passar nada o
 * material seria reamostrado para 25fps.
 * Devolver null quer dizer que este trecho não deve receber movimento de câmera (curto demais / sem
 * quadros-chave), e quem chama volta para o scale de antes.
 */
export function buildZoomFilter(
  durationSec: number,
  fps: number,
  outW: number,
  outH: number,
  options: AutoZoomOptions = {}
): string | null {
  const kfs = planZoomKeyframes(durationSec, options);
  if (kfs.length === 0) return null;
  if (!(fps > 0)) return null; // com a taxa de quadros desconhecida não se arrisca (o material seria reamostrado)
  const z = renderZoomExpr(kfs);
  // x/y pelo centro: o rastreio de rosto já pôs o assunto no centro da janela de recorte, e ampliar pelo centro não empurra o rosto para fora da imagem
  return (
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${outW}x${outH}:fps=${fps}`
  );
}
