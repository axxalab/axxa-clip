/**
 * Locale registry + resolver.
 * Adding a language = one file in ./locales + one REGISTRY entry. Nothing else.
 * pt is the source of truth; missing keys in any locale fall back to pt.
 */
import { pt } from "./locales/pt";
import { en } from "./locales/en";

/** All installed locales. Extend here (es/fr/ja/…) — UI picks this up automatically. */
export const REGISTRY = {
  pt: { label: "Português (BR)", dict: pt },
  en: { label: "English", dict: en },
} as const;

export type Locale = keyof typeof REGISTRY;

/** pt defines the full key space; other locales may lag behind it. */
type Dict = { [ns: string]: { [key: string]: string } };

export const LOCALE_LIST = Object.keys(REGISTRY) as Locale[];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && value in REGISTRY;
}

/** Detect the initial locale: persisted choice first, then system language. */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem("hotclip-locale");
    if (isLocale(saved)) return saved;
  } catch {
    /* localStorage unavailable — fall through to system detection */
  }
  const sys = navigator.language?.toLowerCase() ?? "";
  for (const locale of LOCALE_LIST) {
    if (sys.startsWith(locale)) return locale;
  }
  return sys.startsWith("en") ? "en" : "pt";
}

/** Resolve namespace.key in the given locale; falls back to pt, then the key itself. */
export function translate(
  locale: Locale,
  namespace: string,
  key: string,
  params?: Record<string, string | number>
): string {
  const dict = REGISTRY[locale].dict as Dict;
  const fallback = REGISTRY.pt.dict as Dict;
  let text = dict[namespace]?.[key] ?? fallback[namespace]?.[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
