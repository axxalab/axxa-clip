/**
 * Conjuntos de exportação: um retrato nomeado de um grupo de chaves de exportação. Antes, as 33 chaves
 * tinham de ser clicadas uma a uma a cada novo tipo de material — o conjunto faz combinações como «kit
 * completo de vendas» ou «mínimo e rápido» trocarem com um clique; a combinação atual da pessoa também pode
 * ser salva como um conjunto dela. Aplicar um conjunto = escrever em lote em render-prefs.
 *
 * O retrato cobre só as chaves de «como o vídeo sai», e não toca nos parâmetros de detecção (a categoria e a
 * pauta ficam do lado da sessão) nem nas preferências de caminho (outDir e bgmPath acompanham o material e a
 * máquina, e não devem ser sobrescritas por um conjunto).
 */
import { create } from "zustand";
import { RENDER_PREF_DEFAULTS, type RenderPrefs } from "./render-prefs-store";

const STORAGE_KEY = "hotclip-schemes";

/** Os campos que entram no retrato do conjunto (uma lista de permissão; uma chave nova não entra por padrão, e quem quiser a acrescenta explicitamente). */
export const SCHEME_KEYS = [
  "vertical", "alsoLandscape", "trimUi", "titleCard", "autoZoom", "autoEnhance",
  "jumpCut", "keepBreath", "cleanFillers", "cutRetakes", "preciseAlign",
  "openingHook", "coldOpen", "flashForward",
  "normalizeLoudness", "denoise", "denoiseMode", "muteSensitive", "sfx",
  "captionStyle", "speakerLabels", "translate", "subtitleFile",
  "publishCopy", "aiCover", "aigcLabel", "evidencePack", "publishPack", "packPlatforms", "seriesPack",
  "jianyingDraft", "timeline", "compilation",
  "variants", "templateJitter",
] as const satisfies readonly (keyof RenderPrefs)[];

export type SchemeSnapshot = Pick<RenderPrefs, (typeof SCHEME_KEYS)[number]>;

export interface Scheme {
  id: string;
  name: string;
  /** Um conjunto embutido não pode ser apagado nem sobrescrito. */
  builtin?: boolean;
  prefs: SchemeSnapshot;
}

function snap(overrides: Partial<SchemeSnapshot> = {}): SchemeSnapshot {
  const out = {} as Record<string, unknown>;
  for (const k of SCHEME_KEYS) out[k] = RENDER_PREF_DEFAULTS[k];
  return { ...(out as SchemeSnapshot), ...overrides };
}

/** As três faixas embutidas: o padrão de fábrica / o kit de vendas com tudo ligado / só o mais rápido possível. */
export const BUILTIN_SCHEMES: Scheme[] = [
  { id: "default", name: "Padrão", builtin: true, prefs: snap() },
  {
    id: "selling",
    name: "Kit completo de vendas",
    builtin: true,
    prefs: snap({
      publishCopy: true,
      publishPack: true,
      seriesPack: true,
      aigcLabel: true,
      evidencePack: true,
      variants: 2,
      templateJitter: true,
      coldOpen: true,
      subtitleFile: true,
    }),
  },
  {
    id: "minimal",
    name: "Mínimo e rápido",
    builtin: true,
    prefs: snap({
      titleCard: false,
      openingHook: false,
      cleanFillers: false,
      normalizeLoudness: false,
      trimUi: false,
      captionStyle: "none",
    }),
  },
];

/** Tira do conjunto de preferências atual o retrato do conjunto. Função pura. */
export function snapshotOf(prefs: RenderPrefs): SchemeSnapshot {
  const out = {} as Record<string, unknown>;
  for (const k of SCHEME_KEYS) out[k] = prefs[k];
  return out as SchemeSnapshot;
}

/** Se as preferências atuais batem com um conjunto (usado para destacar «qual conjunto está em uso agora»). Função pura. */
export function matchesScheme(prefs: RenderPrefs, scheme: Scheme): boolean {
  return SCHEME_KEYS.every((k) => JSON.stringify(prefs[k]) === JSON.stringify(scheme.prefs[k]));
}

function loadUserSchemes(): Scheme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .filter((s) => typeof s.id === "string" && typeof s.name === "string" && !!s.prefs && typeof s.prefs === "object")
      .map((s) => ({ id: s.id as string, name: (s.name as string).slice(0, 20), prefs: snap(s.prefs as Partial<SchemeSnapshot>) }));
  } catch {
    return [];
  }
}

interface SchemeState {
  userSchemes: Scheme[];
  saveCurrent: (name: string, prefs: RenderPrefs) => void;
  remove: (id: string) => void;
}

export const useSchemes = create<SchemeState>((set, get) => ({
  userSchemes: loadUserSchemes(),
  saveCurrent: (name, prefs) => {
    const scheme: Scheme = { id: `user-${Date.now()}`, name: name.slice(0, 20) || "meu conjunto", prefs: snapshotOf(prefs) };
    const userSchemes = [...get().userSchemes, scheme].slice(-8); // teto de 8, o primeiro a entrar é o primeiro a sair
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userSchemes));
    } catch {
      /* a persistência é feita na medida do possível */
    }
    set({ userSchemes });
  },
  remove: (id) => {
    const userSchemes = get().userSchemes.filter((s) => s.id !== id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userSchemes));
    } catch {
      /* a persistência é feita na medida do possível */
    }
    set({ userSchemes });
  },
}));
