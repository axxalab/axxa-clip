/**
 * Escolha inteligente do quadro de capa: a capa deixou de ser «os 0,8 segundos fixos do começo» e passou
 * a ser «o quadro de maior volume dentro do trecho» — o pico de volume normalmente é a piada, o grito ou o
 * ponto mais alto de emoção, justo o quadro que merece ser a vitrine; um instante fixo cai muitas vezes
 * num quadro de transição ou com o olho fechado. Capa com expressão de surpresa ou exaltação tem de 20 a
 * 30% mais cliques (medição do mercado), e o volume é o sinal de graça que serve de indicador indireto disso.
 *
 * A entrada é a trilha de picos em tempo de origem e os intervalos preservados do trecho (vários, no corte
 * seco), e a saída é o instante da capa no «tempo de saída do vídeo pronto». Função pura, sem depender do ffmpeg.
 */
import type { PeakTrack } from "./audio-peaks";
import type { KeptSegment } from "./gaps";

/** Os segundos evitados nas pontas do vídeo pronto (a transição e o fade costumam ficar aí). */
const EDGE_GUARD_SEC = 0.4;

/** O comportamento antigo: um quadro fixo pouco depois de onde o gancho cai (a reserva para quando não há dados de pico). */
export function fallbackCoverTime(durationSec: number): number {
  return Math.min(0.8, Math.max(0, durationSec - 0.1));
}

/** A distância mínima entre os picos de posições diferentes: perto demais é o mesmo clímax, e trocar de quadro não diferencia nada. */
const PEAK_MIN_GAP_SEC = 1.5;

/**
 * Acha, dentro dos intervalos preservados, o instante de volume na posição rank+1 (rank 0 = o mais alto, o
 * mesmo do comportamento de sempre) e o mapeia para a linha de tempo de saída. As capas das várias versões
 * de um trecho usam o rank para pegar picos de emoção diferentes.
 * Sem picos suficientes, vale o último disponível; sem nenhum pico confiável (sem trilha, tudo em silêncio
 * ou duração curta demais), volta ao quadro fixo.
 */
export function pickCoverTime(
  peaks: PeakTrack | undefined,
  ranges: KeptSegment[],
  durationSec: number,
  rank = 0
): number {
  const fallback = fallbackCoverTime(durationSec);
  if (!peaks || peaks.values.length === 0 || durationSec <= EDGE_GUARD_SEC * 2 || ranges.length === 0) {
    return fallback;
  }
  // Junta todos os pontos amostrados que caem nos intervalos preservados e fora das pontas (tempo de saída, valor do pico)
  const candidates: Array<{ out: number; peak: number }> = [];
  let outOffset = 0;
  for (const seg of ranges) {
    for (let i = 0; i < peaks.values.length; i++) {
      const t = peaks.startSec + i * peaks.hopSec; // tempo de origem
      if (t < seg.startSec || t >= seg.endSec) continue;
      const out = outOffset + (t - seg.startSec); // tempo de saída
      if (out < EDGE_GUARD_SEC || out > durationSec - EDGE_GUARD_SEC) continue;
      candidates.push({ out, peak: peaks.values[i] });
    }
    outOffset += seg.endSec - seg.startSec;
  }
  // Só o instante «alto o bastante» conta como pico: abaixo da metade do pico máximo é trecho de transição, e
  // usar aquilo como capa de variação já não é ponto alto de emoção; material quase todo em silêncio (<0,05) mantém o comportamento antigo do quadro fixo
  const maxPeak = candidates.reduce((m, c) => Math.max(m, c.peak), 0);
  const floor = Math.max(0.05, maxPeak * 0.5);
  const strong = candidates.filter((c) => c.peak >= floor);
  // Os picos são escolhidos de forma gulosa, do mais alto para o mais baixo, sem ficarem vizinhos: o 1º colocado é o argmax de sempre, e o comportamento não muda
  strong.sort((a, b) => b.peak - a.peak);
  const picked: Array<{ out: number; peak: number }> = [];
  for (const c of strong) {
    if (picked.some((p) => Math.abs(p.out - c.out) < PEAK_MIN_GAP_SEC)) continue;
    picked.push(c);
    if (picked.length > rank) break;
  }
  // Sem picos suficientes, vale o último pico de verdade (melhor repetir que usar o piso de ruído como capa)
  const chosen = picked[Math.min(rank, picked.length - 1)];
  return chosen ? chosen.out : fallback;
}
