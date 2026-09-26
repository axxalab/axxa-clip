/**
 * A lógica pura do preset de marca: a conversão de cor hex → ASS, a aplicação das faixas de corpo de fonte
 * e de posição ao layout da legenda, e a limpeza dos parâmetros. A pessoa configura uma vez, e a legenda
 * ASS, a legenda em balão e a marca d'água de cada trecho reaproveitam tudo.
 */
import type { AssLayout } from "./subtitle";
import { FONT_SCALE_CHOICES, type BrandStyle } from "../shared/api-types";

/** A cor de destaque padrão: o laranja de chama (a mesma que já estava fixa no código, então sem configuração a saída não muda). */
export const DEFAULT_HIGHLIGHT_HEX = "#FF6E0D";

export { FONT_SCALE_CHOICES } from "../shared/api-types";

/** As três faixas de posição da legenda → o fator sobre o marginV de referência (no vertical, 560 → 420/560/700, e no horizontal na mesma proporção). */
const POSITION_FACTOR = { low: 0.75, standard: 1, high: 1.25 } as const;

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Se "#RRGGBB" é uma cor válida. */
export function isValidHex(hex: unknown): hex is string {
  return typeof hex === "string" && HEX_RE.test(hex);
}

/**
 * "#RRGGBB" → a cor da folha de estilos do ASS, "&HAABBGGRR" (atenção à ordem BGR).
 * Entrada inválida devolve null, e quem chama volta para a cor padrão.
 */
export function hexToAssColor(hex: string, alphaHex = "00"): string | null {
  const m = HEX_RE.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

/** "#RRGGBB" → a forma de sobrescrita dentro da linha do ASS, "&HBBGGRR&" (para o \c, sem o byte de alfa). */
export function hexToAssInline(hex: string): string | null {
  const m = HEX_RE.exec(hex);
  if (!m) return null;
  return `&H${m[1].slice(4, 6)}${m[1].slice(2, 4)}${m[1].slice(0, 2)}&`.toUpperCase();
}

/** Clareia misturando com branco (a segunda parada do gradiente da legenda em balão). frac=0 é a cor original e 1 é branco puro. */
export function lightenHex(hex: string, frac: number): string {
  const m = HEX_RE.exec(hex);
  if (!m) return hex;
  const mix = (c: number): string =>
    Math.round(c + (255 - c) * Math.max(0, Math.min(1, frac)))
      .toString(16)
      .padStart(2, "0");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return `#${mix(r)}${mix(g)}${mix(b)}`.toUpperCase();
}

/**
 * Aplica as faixas de corpo de fonte e de posição da marca ao layout de referência. Quando o corpo da fonte
 * aumenta, as unidades de largura que cabem em cada linha diminuem na mesma proporção (senão a quebra de
 * linha transbordaria a zona segura); a faixa de posição move apenas o marginV.
 */
export function applyBrandToLayout(layout: AssLayout, brand?: BrandStyle): AssLayout {
  if (!brand) return layout;
  const scale = clampFontScale(brand.fontScale);
  const posFactor = POSITION_FACTOR[brand.captionPosition ?? "standard"] ?? 1;
  if (scale === 1 && posFactor === 1) return layout;
  return {
    ...layout,
    fontSize: Math.round(layout.fontSize * scale),
    maxLineUnits: Math.max(6, Math.round(layout.maxLineUnits / scale)),
    marginV: Math.round(layout.marginV * posFactor),
  };
}

function clampFontScale(scale: number | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return 1;
  return Math.max(0.6, Math.min(1.6, scale));
}

/**
 * Limpeza na fronteira do IPC: os campos inválidos são descartados, e voltam os parâmetros de marca que dá
 * para passar pela esteira sem medo.
 * Quando todos os campos são inválidos ou ausentes, devolve undefined (a esteira usa o padrão de sempre, e a
 * saída fica igual byte a byte).
 */
export function sanitizeBrand(raw: unknown): BrandStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  const out: BrandStyle = {};
  if (isValidHex(b.highlightColor)) {
    out.highlightColor = b.highlightColor.startsWith("#") ? b.highlightColor : `#${b.highlightColor}`;
  }
  if (typeof b.fontScale === "number" && Number.isFinite(b.fontScale)) {
    out.fontScale = clampFontScale(b.fontScale);
  }
  if (b.captionPosition === "low" || b.captionPosition === "standard" || b.captionPosition === "high") {
    out.captionPosition = b.captionPosition;
  }
  const wm = b.watermark as Record<string, unknown> | undefined;
  if (wm && typeof wm === "object" && typeof wm.path === "string" && wm.path.trim()) {
    const corner =
      wm.corner === "top-left" || wm.corner === "bottom-left" || wm.corner === "bottom-right"
        ? wm.corner
        : "top-right";
    const opacity =
      typeof wm.opacity === "number" && Number.isFinite(wm.opacity)
        ? Math.max(0.05, Math.min(1, wm.opacity))
        : 0.85;
    out.watermark = { path: wm.path, corner, opacity };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
