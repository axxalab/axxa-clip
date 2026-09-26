/**
 * Perturbação controlada do modelo (a v0.14, do «conseguir publicar e sobreviver»): numa leva de vídeos, a
 * geometria da legenda recebe um tremor determinístico e pequeno a partir de uma semente formada por
 * «arquivo de origem + trecho» — o corpo da fonte ±4%, a linha de base da legenda ±1% da altura da imagem
 * e a margem horizontal de alguns pixels — para os vídeos que uma mesma conta (ou uma rede de contas)
 * produz em lote não compartilharem uma impressão digital de modelo idêntica pixel a pixel. O que a
 * detecção de produção em massa das plataformas de 2026 persegue é «o mesmo modelo, a mesma diagramação,
 * em grande quantidade», e a amplitude da perturbação é mantida de propósito na faixa em que nada muda
 * para quem assiste, com a linha de base tremida continuando dentro da zona segura da plataforma (a faixa
 * de legenda de 62 a 72%).
 *
 * Determinismo: a mesma semente dá sempre o mesmo conjunto de tremores — reexportar reproduz o resultado e
 * a verificação de qualidade fecha as contas; nada de Math.random (que não se reproduz e, além disso, é
 * proibido no ambiente de trabalho). Função pura, sem depender do Node.
 */

/** Hash FNV-1a de 32 bits: dobra a string da semente numa semente de PRNG. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: um PRNG com semente, pequeno e firme (devolve uma distribuição uniforme em [0,1)). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A amplitude do tremor do corpo da fonte: ±4% (na faixa de 78px dá uns ±3px, imperceptível). */
export const JITTER_FONT_SPAN = 0.04;
/** A amplitude do tremor da linha de base da legenda: ±1% da altura da imagem (numa altura de 1920 dá uns ±19px, sem sair da faixa segura de 62 a 72%). */
export const JITTER_BASELINE_FRAC = 0.01;
/** A amplitude do tremor da margem horizontal: ±8px (afeta só o espaço em branco, sem mexer na largura da quebra de linha). */
export const JITTER_MARGIN_H_PX = 8;

/** A superfície mínima de layout em que a perturbação age — o AssLayout do core a satisfaz por estrutura, e shared não passa a depender do core. */
export interface JitterableLayout {
  playResY: number;
  fontSize: number;
  marginV: number;
  marginH: number;
}

/**
 * Perturba um layout de legenda conforme a semente (corpo da fonte / linha de base / margem horizontal).
 * A mesma semente dá a mesma saída; um objeto novo é devolvido, sem alterar o que entrou.
 */
export function perturbLayout<T extends JitterableLayout>(layout: T, seedKey: string): T {
  const rand = mulberry32(fnv1a(seedKey));
  const fontScale = 1 + (rand() * 2 - 1) * JITTER_FONT_SPAN;
  const marginVShift = Math.round((rand() * 2 - 1) * JITTER_BASELINE_FRAC * layout.playResY);
  const marginHShift = Math.round((rand() * 2 - 1) * JITTER_MARGIN_H_PX);
  return {
    ...layout,
    fontSize: Math.max(12, Math.round(layout.fontSize * fontScale)),
    marginV: Math.max(0, layout.marginV + marginVShift),
    marginH: Math.max(20, layout.marginH + marginHShift),
  };
}
