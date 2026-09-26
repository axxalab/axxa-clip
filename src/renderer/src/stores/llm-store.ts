/**
 * As configurações de conexão com o LLM (guardadas no localStorage).
 * Presets: Atlas Cloud (o padrão recomendado), Ollama local e personalizado.
 */
import { create } from "zustand";
import type { LlmConfig } from "../../../shared/api-types";
import { isLocalBaseUrl } from "../../../shared/llm-preflight";

const STORAGE_KEY = "hotclip-llm";
const PREFILTER_KEY = "hotclip-prefilter";
const VISION_KEY = "hotclip-vision";

/** As configurações do endpoint local do primeiro nível do funil (por padrão Ollama + qwen3:4b, desligado). */
export interface PrefilterSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** A API Key do endpoint na nuvem (num Ollama local pode ficar em branco). */
  apiKey?: string;
}

export const PREFILTER_DEFAULTS: PrefilterSettings = {
  enabled: false,
  baseUrl: "http://localhost:11434/v1",
  model: "qwen3:4b",
};

/** As configurações do endpoint VL local do sinal visual de estouro (por padrão Ollama + qwen3.5:4b, desligado). */
export const VISION_DEFAULTS: PrefilterSettings = {
  enabled: false,
  baseUrl: "http://localhost:11434/v1",
  model: "qwen3.5:4b",
};

function loadLocalEndpoint(key: string, defaults: PrefilterSettings): PrefilterSettings {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PrefilterSettings>;
      return {
        enabled: p.enabled === true,
        baseUrl: typeof p.baseUrl === "string" && p.baseUrl ? p.baseUrl : defaults.baseUrl,
        model: typeof p.model === "string" && p.model ? p.model : defaults.model,
        apiKey: typeof p.apiKey === "string" ? p.apiKey : undefined,
      };
    }
  } catch {
    /* volta ao padrão */
  }
  return { ...defaults };
}

export interface LlmPreset {
  id: string;
  label: string;
  baseUrl: string;
  /** O modelo sugerido de fábrica. O id de um modelo vence quando o fornecedor troca de geração — o «buscar modelos» da interface é que está certo. */
  model: string;
  /** O endereço para pedir uma chave; num endpoint local fica vazio. */
  keyUrl: string;
}

/**
 * Os presets dos fornecedores. As base_url foram todas conferidas na documentação oficial de cada um
 * (08/2026); o modelo é só um ponto de partida — os fornecedores trocam de geração rápido (o deepseek-chat
 * saiu do ar em 24/07/2026), então a interface oferece «buscar modelos» para perguntar a lista real ao
 * endpoint, sem contar que o nome daqui continue válido por muito tempo.
 */
export const LLM_PRESET_LIST: LlmPreset[] = [
  {
    id: "atlas",
    label: "Atlas Cloud",
    baseUrl: "https://api.atlascloud.ai/v1",
    model: "qwen/qwen3.5-flash",
    keyUrl: "https://www.atlascloud.ai",
  },
  {
    id: "deepseek",
    label: "DeepSeek (oficial)",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "dashscope",
    label: "Alibaba Cloud Bailian (Qwen)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    keyUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "zhipu",
    label: "Zhipu GLM",
    // O caminho de compatibilidade da Zhipu vai só até v4, e depois vem /chat/completions direto (sem /v1)
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "moonshot",
    label: "Moonshot Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.5",
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4-flash",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-luna",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:8b",
    keyUrl: "",
  },
];

/** Reconhece, pela baseUrl, qual fornecedor está escolhido (se a pessoa mudou a baseUrl, não dá para reconhecer e volta undefined). */
export function presetForBaseUrl(baseUrl: string): LlmPreset | undefined {
  return LLM_PRESET_LIST.find((p) => p.baseUrl === baseUrl);
}

/** Compatibilidade com as referências antigas: a atlas continua sendo o padrão. */
export const LLM_PRESETS = { atlas: LLM_PRESET_LIST[0] } as const;

function load(): LlmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LlmConfig>;
      if (typeof parsed.baseUrl === "string" && typeof parsed.model === "string") {
        return { baseUrl: parsed.baseUrl, apiKey: parsed.apiKey ?? "", model: parsed.model };
      }
    }
  } catch {
    /* segue para os padrões */
  }
  return { baseUrl: LLM_PRESETS.atlas.baseUrl, apiKey: "", model: LLM_PRESETS.atlas.model };
}

interface LlmState {
  config: LlmConfig;
  setConfig: (partial: Partial<LlmConfig>) => void;
  prefilter: PrefilterSettings;
  setPrefilter: (partial: Partial<PrefilterSettings>) => void;
  vision: PrefilterSettings;
  setVision: (partial: Partial<PrefilterSettings>) => void;
}

export const useLlmStore = create<LlmState>((set, get) => ({
  config: load(),
  setConfig: (partial) => {
    const config = { ...get().config, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* a persistência é feita na medida do possível */
    }
    set({ config });
  },
  prefilter: loadLocalEndpoint(PREFILTER_KEY, PREFILTER_DEFAULTS),
  setPrefilter: (partial) => {
    const prefilter = { ...get().prefilter, ...partial };
    try {
      localStorage.setItem(PREFILTER_KEY, JSON.stringify(prefilter));
    } catch {
      /* a persistência é feita na medida do possível */
    }
    set({ prefilter });
  },
  vision: loadLocalEndpoint(VISION_KEY, VISION_DEFAULTS),
  setVision: (partial) => {
    const vision = { ...get().vision, ...partial };
    try {
      localStorage.setItem(VISION_KEY, JSON.stringify(vision));
    } catch {
      /* a persistência é feita na medida do possível */
    }
    set({ vision });
  },
}));

/** Pronto = há campos suficientes para tentar uma chamada (o Ollama não precisa de chave). */
export function isLlmReady(config: LlmConfig): boolean {
  const needsKey = !isLocalBaseUrl(config.baseUrl);
  return Boolean(config.baseUrl && config.model && (!needsKey || config.apiKey));
}
