/**
 * Zona segura das legendas: as áreas que a interface do player vertical de
 * cada plataforma cobre (a barra de curtir/comentar/compartilhar à direita, a
 * faixa de texto e progresso embaixo, a área de status no topo). A bancada de
 * revisão sobrepõe essas áreas como uma máscara translúcida, e dá para ver de
 * relance quando a legenda ou o assunto principal encosta no limite — é o que
 * evita o vexame de publicar com "a legenda escondida atrás do botão de
 * curtir".
 * Todos os retângulos são expressos em porcentagem da imagem final 9:16 (de 0
 * a 1) e independem da resolução. Só dados e funções puras.
 */

/** Uma área de oclusão (retângulo em porcentagem relativa à imagem 9:16). */
export interface SafeZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlatformZones {
  id: string;
  /** Nome da plataforma (a interface em português e a em inglês pegam o que precisam). */
  name: { pt: string; en: string };
  zones: SafeZoneRect[];
}

// A base dos dados é 1080×1920, convertida para porcentagem. TikTok, Reels e
// Shorts vêm dos pixels exatos dos modelos de design (getkoro, postplanify,
// orsonlord); as plataformas chinesas não têm norma oficial, então os valores
// foram aproximados a partir de artigos com medições e do layout de mesma
// origem do TikTok (Douyin e Kuaishou com barra vertical à direita; WeChat
// Channels e RedNote com faixas horizontais em cima e embaixo, sem barra
// lateral; no Channels apenas a área central 6:7 fica livre). Na dúvida, o
// valor escolhido é o maior — melhor avisar demais do que deixar passar uma
// oclusão.
export const SAFE_ZONE_PLATFORMS: PlatformZones[] = [
  {
    id: "generic",
    name: { pt: "Vertical genérico", en: "Generic vertical" },
    // União das oclusões de todas as plataformas: 13% no topo + 25,2% embaixo + barra direita de 14,8% (de 38% a 88% na vertical)
    zones: [
      { x: 0, y: 0, w: 1, h: 0.13 },
      { x: 0, y: 0.748, w: 1, h: 0.252 },
      { x: 0.852, y: 0.38, w: 0.148, h: 0.5 },
    ],
  },
  {
    id: "douyin",
    name: { pt: "Douyin", en: "Douyin" },
    zones: [
      { x: 0, y: 0, w: 1, h: 0.078 },
      { x: 0, y: 0.83, w: 1, h: 0.17 },
      { x: 0.87, y: 0.4, w: 0.13, h: 0.45 },
    ],
  },
  {
    id: "kuaishou",
    name: { pt: "Kuaishou", en: "Kuaishou" },
    zones: [
      { x: 0, y: 0, w: 1, h: 0.078 },
      { x: 0, y: 0.844, w: 1, h: 0.156 },
      { x: 0.88, y: 0.4, w: 0.12, h: 0.45 },
    ],
  },
  {
    id: "bilibili",
    name: { pt: "Bilibili story", en: "Bilibili story" },
    // A barra direita é mais alta que a do Douyin (tem o botão de moeda); o chat que atravessa o terço superior não é controlável, e o aviso sobre isso está no texto da interface
    zones: [
      { x: 0, y: 0, w: 1, h: 0.08 },
      { x: 0, y: 0.8, w: 1, h: 0.2 },
      { x: 0.87, y: 0.45, w: 0.13, h: 0.43 },
    ],
  },
  {
    id: "channels",
    name: { pt: "WeChat Channels", en: "WeChat Channels" },
    // A interação fica em faixa horizontal embaixo, sem barra vertical à direita; só a área central 6:7 (de cerca de 11,5% a 77% em y) não é coberta
    zones: [
      { x: 0, y: 0, w: 1, h: 0.115 },
      { x: 0, y: 0.771, w: 1, h: 0.229 },
    ],
  },
  {
    id: "xiaohongshu",
    name: { pt: "RedNote", en: "RedNote" },
    zones: [
      { x: 0, y: 0, w: 1, h: 0.078 },
      { x: 0, y: 0.85, w: 1, h: 0.15 },
    ],
  },
  {
    id: "tiktok",
    name: { pt: "TikTok", en: "TikTok" },
    zones: [
      { x: 0, y: 0, w: 1, h: 0.068 },
      { x: 0, y: 0.748, w: 1, h: 0.252 },
      { x: 0.87, y: 0.4, w: 0.13, h: 0.45 },
    ],
  },
  {
    id: "reels",
    name: { pt: "Instagram Reels", en: "Instagram Reels" },
    zones: [
      { x: 0, y: 0, w: 1, h: 0.11 },
      { x: 0, y: 0.8, w: 1, h: 0.2 },
      { x: 0.889, y: 0.4, w: 0.111, h: 0.45 },
    ],
  },
  {
    id: "shorts",
    name: { pt: "YouTube Shorts", en: "YouTube Shorts" },
    zones: [
      { x: 0, y: 0, w: 1, h: 0.089 },
      { x: 0, y: 0.8, w: 1, h: 0.2 },
      { x: 0.89, y: 0.38, w: 0.11, h: 0.5 },
    ],
  },
];

/** Busca a plataforma pelo id; um id desconhecido volta para a primeira (a genérica). */
export function zonesFor(id: string): PlatformZones {
  return SAFE_ZONE_PLATFORMS.find((p) => p.id === id) ?? SAFE_ZONE_PLATFORMS[0];
}

/** Layout object-contain: a caixa em que o vídeo (de proporção ar) aparece dentro de um contêiner cw×ch. */
export function fitContain(cw: number, ch: number, ar: number): { x: number; y: number; w: number; h: number } {
  if (!(cw > 0) || !(ch > 0) || !(ar > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const w = Math.min(cw, ch * ar);
  const h = w / ar;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/**
 * Posição da janela de recorte central 9:16 dentro da caixa de exibição (se a
 * origem for mais larga que 9:16, as laterais são cortadas; se for mais
 * estreita, nada se perde).
 * Com o rastreio de rosto a janela se desloca na horizontal, e o que é desenhado
 * aqui é a posição central padrão — o texto de aviso deixa isso claro.
 */
export function cropRect9x16(box: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const targetAr = 9 / 16;
  const w = Math.min(box.w, box.h * targetAr);
  const h = w / targetAr > box.h ? box.h : w / targetAr;
  const ww = Math.min(w, h * targetAr);
  return { x: box.x + (box.w - ww) / 2, y: box.y + (box.h - h) / 2, w: ww, h };
}
