/**
 * A store dos presets de estilo da marca (guardada no localStorage): vários presets nomeados + o que está
 * em uso.
 * O preset «padrão» = todos os valores embutidos (a saída fica igual byte a byte à das versões anteriores) e
 * não pode ser apagado.
 */
import { create } from "zustand";
import type { BrandStyle } from "../../../shared/api-types";

const STORAGE_KEY = "hotclip-brand";

export interface BrandPreset {
  id: string;
  name: string;
  style: BrandStyle;
}

/** O preset «padrão» embutido: sem nenhuma sobrescrita, a esteira usa o estilo que já estava no código. O nome é renderizado pelo i18n. */
export const DEFAULT_PRESET: BrandPreset = { id: "default", name: "", style: {} };

/** As cores de marca mais usadas, para escolha rápida (a paleta da interface). */
export const SWATCHES = ["#FF6E0D", "#FF3355", "#FFD400", "#22C55E", "#38BDF8", "#A855F7"];

interface Persisted {
  presets: BrandPreset[];
  activeId: string;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      if (Array.isArray(parsed.presets)) {
        const presets = parsed.presets.filter(
          (p): p is BrandPreset => Boolean(p && typeof p.id === "string" && typeof p.name === "string" && p.style)
        );
        const all = [DEFAULT_PRESET, ...presets.filter((p) => p.id !== "default")];
        const activeId = all.some((p) => p.id === parsed.activeId) ? (parsed.activeId as string) : "default";
        return { presets: all, activeId };
      }
    }
  } catch {
    /* falha na leitura volta ao padrão */
  }
  return { presets: [DEFAULT_PRESET], activeId: "default" };
}

function persist(state: Persisted): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ presets: state.presets.filter((p) => p.id !== "default"), activeId: state.activeId })
    );
  } catch {
    /* a persistência é feita na medida do possível */
  }
}

interface BrandState {
  presets: BrandPreset[];
  activeId: string;
  setActive: (id: string) => void;
  /** Atualiza o estilo do preset atual; editar o «padrão» cria uma bifurcação num preset novo, sozinho. */
  updateActiveStyle: (patch: Partial<BrandStyle>) => void;
  addPreset: (name: string) => void;
  removePreset: (id: string) => void;
  renameActive: (name: string) => void;
}

let seq = 0;
const newId = (): string => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

export const useBrandStore = create<BrandState>((set, get) => ({
  ...load(),
  setActive: (id) => {
    const s = { presets: get().presets, activeId: id };
    persist(s);
    set(s);
  },
  updateActiveStyle: (patch) => {
    let { presets, activeId } = get();
    // O «padrão» é uma âncora somente de leitura: a primeira mudança bifurca em «meu estilo», e o padrão sempre pode ser retomado
    if (activeId === "default") {
      const fork: BrandPreset = { id: newId(), name: "meu estilo", style: {} };
      presets = [...presets, fork];
      activeId = fork.id;
    }
    const next = presets.map((p) => {
      if (p.id !== activeId) return p;
      const style = { ...p.style, ...patch };
      // Passar undefined explicitamente quer dizer limpar aquele campo
      for (const k of Object.keys(patch) as (keyof BrandStyle)[]) {
        if (patch[k] === undefined) delete style[k];
      }
      return { ...p, style };
    });
    const s = { presets: next, activeId };
    persist(s);
    set(s);
  },
  addPreset: (name) => {
    const preset: BrandPreset = { id: newId(), name: name.trim() || "preset novo", style: {} };
    const s = { presets: [...get().presets, preset], activeId: preset.id };
    persist(s);
    set(s);
  },
  removePreset: (id) => {
    if (id === "default") return;
    const presets = get().presets.filter((p) => p.id !== id);
    const activeId = get().activeId === id ? "default" : get().activeId;
    const s = { presets, activeId };
    persist(s);
    set(s);
  },
  renameActive: (name) => {
    const { presets, activeId } = get();
    if (activeId === "default" || !name.trim()) return;
    const s = {
      presets: presets.map((p) => (p.id === activeId ? { ...p, name: name.trim() } : p)),
      activeId,
    };
    persist(s);
    set(s);
  },
}));

/** O estilo de marca que vale agora (para a exportação; o preset padrão devolve undefined = não sobrescreve nada). */
export function activeBrandStyle(state: Pick<BrandState, "presets" | "activeId">): BrandStyle | undefined {
  const preset = state.presets.find((p) => p.id === state.activeId);
  if (!preset || preset.id === "default") return undefined;
  return Object.keys(preset.style).length > 0 ? preset.style : undefined;
}
