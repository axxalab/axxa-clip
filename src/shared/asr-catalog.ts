/**
 * ASR engine catalog — the platform-neutral facts about every transcription
 * engine the app can offer. Display strings live in renderer i18n keyed by
 * `id`; runtime state (installed) is added by the backend when listing.
 */

export interface AsrEngineFacts {
  id: string;
  kind: "local" | "cloud";
  /** Languages the engine handles well. */
  langs: string[];
  /** Approximate one-time model download, MB (local engines only). */
  sizeMB?: number;
  /** Relative speed tier: 1 = slow … 3 = fast. */
  speed: 1 | 2 | 3;
  /** Relative accuracy tier: 1 = okay … 3 = best. */
  accuracy: 1 | 2 | 3;
  /** True when the user's media must leave the machine. */
  uploads: boolean;
  /** User-managed local service; quality tiers are not benchmark claims. */
  experimental?: boolean;
}

/**
 * Order = display order, recommendation first. It is NOT the default: the engine that runs when
 * nobody chose one lives in the renderer's asr-store and in the pipeline fallback, and it is still
 * SenseVoice — trocar isso baixaria 465MB na primeira execução de quem só queria transcrever.
 */
export const ASR_CATALOG: AsrEngineFacts[] = [
  {
    // A edição de português: é o único tier local treinado em pt, e por isso encabeça a lista.
    // A escolha guardada continua mandando — quem já usa outro motor não é trocado sem pedir.
    id: "parakeet",
    kind: "local",
    langs: ["pt", "en", "es", "fr", "de", "+20"],
    sizeMB: 465,
    speed: 2,
    accuracy: 3,
    uploads: false,
  },
  {
    id: "sensevoice",
    kind: "local",
    langs: ["zh", "yue", "en", "ja", "ko"],
    sizeMB: 170,
    speed: 3,
    accuracy: 1,
    uploads: false,
  },
  {
    id: "paraformer",
    kind: "local",
    langs: ["zh", "en"],
    sizeMB: 230,
    speed: 2,
    accuracy: 2,
    uploads: false,
  },
  {
    id: "fireredasr",
    kind: "local",
    langs: ["zh", "dialetos", "en"],
    sizeMB: 520,
    speed: 2,
    accuracy: 3,
    uploads: false,
  },
  {
    id: "whisper-turbo",
    kind: "local",
    langs: ["99 idiomas", "pt", "en"],
    sizeMB: 538,
    speed: 2,
    accuracy: 2,
    uploads: false,
  },
  {
    id: "whisper-large-v3",
    kind: "local",
    langs: ["99 idiomas", "pt", "en"],
    sizeMB: 1019,
    speed: 1,
    accuracy: 3,
    uploads: false,
  },
  {
    id: "qwen3", kind: "local", langs: ["30 languages"], speed: 1, accuracy: 3,
    uploads: false, experimental: true,
  },
  {
    id: "elevenlabs",
    kind: "cloud",
    langs: ["90+", "zh", "en"],
    speed: 3,
    accuracy: 3,
    uploads: true,
  },
];
