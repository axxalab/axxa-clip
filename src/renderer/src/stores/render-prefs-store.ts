/**
 * Memória das preferências de exportação: a combinação de chaves da barra de ferramentas (vertical /
 * estilo de legenda / corte seco / bilíngue / texto de publicação / faixa de duração…) é guardada nesta
 * máquina — a pessoa não precisa clicar uma dúzia de chaves de novo a cada vídeo: como saiu da última vez,
 * sai desta. A conversa com várias pessoas (diarize) de propósito não é guardada: ela vale para um vídeo
 * específico, e trocar de material pede um novo julgamento.
 */
import { create } from "zustand";
import type { CaptionStyleChoice, ClipLength, ExportQuality } from "../../../shared/api-types";
import { validPlatformIds } from "../../../shared/platform-specs";
import { DEFAULT_SENSITIVE_WORDS, sanitizeSensitiveWords } from "../../../core/sensitive-words";

const STORAGE_KEY = "hotclip-render-prefs";

export interface RenderPrefs {
  vertical: boolean;
  captionStyle: CaptionStyleChoice;
  jumpCut: boolean;
  /** Manter o respiro: ao cortar as pausas longas, o corte seco deixa um fôlego em cada emenda, em vez de colar sem costura. */
  keepBreath: boolean;
  /** Etiqueta de falante: num trecho de várias pessoas, a troca de quem fala põe um «A:» colorido no começo da linha da legenda (só existe com a conversa de várias pessoas ligada). */
  speakerLabels: boolean;
  /** Perturbação controlada do modelo: a geometria da legenda tremula de leve conforme a semente do trecho, para uma leva de vídeos não compartilhar a impressão digital do modelo. */
  templateJitter: boolean;
  cleanFillers: boolean;
  cutRetakes: boolean;
  autoZoom: boolean;
  /** Correção inteligente de imagem: só corrige, com contenção, quando a medição é suficiente e a imagem está claramente escura, acinzentada ou saturada demais. */
  autoEnhance: boolean;
  /** Marcação de efeito sonoro: whoosh na emenda da colagem, ding no pico de emoção e pop no gancho de abertura. */
  sfx: boolean;
  /** O caminho do arquivo de trilha; string vazia = sem trilha. */
  bgmPath: string;
  trimUi: boolean;
  titleCard: boolean;
  openingHook: boolean;
  normalizeLoudness: boolean;
  denoise: boolean;
  /** O filtro fixo básico ou o realce de voz aprendido, opcional, em 48 kHz. */
  denoiseMode: "basic" | "smart";
  muteSensitive: boolean;
  sensitiveWords: string[];
  compilation: boolean;
  coldOpen: boolean;
  /** Flash do estouro: a imagem do pico entra de 0,3 a 1s antes (o gancho visual). */
  flashForward: boolean;
  /** Ponto de corte preciso: a segunda passada do Paraformer corrige a marca de tempo por palavra. */
  preciseAlign: boolean;
  alsoLandscape: boolean;
  translate: boolean;
  publishCopy: boolean;
  subtitleFile: boolean;
  timeline: boolean;
  /** Rascunho do JianYing / CapCut: uma pasta de rascunho por trecho, que basta copiar para a pasta de rascunhos do editor e abrir para o acabamento. */
  jianyingDraft: boolean;
  /** A faixa da capa por IA: off desliga / volume = Seedream, a de volume / premium = Nano Banana Pro. */
  aiCover: "off" | "volume" | "premium";
  aigcLabel: boolean;
  /** Pacote de comprovação: de cada trecho são copiados, em fluxo, 3 minutos antes e depois do original (a gravação original que as análises de autorização pedem). */
  evidencePack: boolean;
  /** Pacote de publicação por plataforma: uma pasta completa por plataforma, do tipo «é só pegar e publicar». */
  publishPack: boolean;
  /** Pacote de série temática: os vídeos originais que dividem uma palavra-chave são organizados numa pasta para publicação em sequência. */
  seriesPack: boolean;
  /** Os ids das plataformas escolhidas para o pacote (platform-specs.ts). */
  packPlatforms: string[];
  /** Várias versões de um trecho: o total de versões (1 = desligado; 2 ou 3 = quantas embalagens diferentes saem do mesmo trecho). */
  variants: number;
  clipLength: ClipLength;
  /** Os critérios da categoria da live (veja core/genre.ts); com custom, vale o texto de genreCustom. */
  genreId: string;
  /** O texto de critérios reescrito pela pessoa; quando não está vazio, ele sempre cobre o preset embutido. */
  genreCustom: string;
  /** A pauta da pessoa: o que procurar nesta sessão (em linguagem natural, injetado nos critérios de escolha). */
  briefFocus: string;
  /** A pauta da pessoa: o que excluir explicitamente. */
  briefExclude: string;
  /** Modo de apresentação de produto: a lista de palavras do produto (numa live de vendas, a escolha dos trechos segue o produto). */
  products: string[];
  /** Varredura completa da imagem: um quadro a cada ~30 segundos em todo o material (exige o endpoint de visão configurado; é demorado e, na nuvem, cobrado). */
  fullScan: boolean;
  /** A pasta raiz de exportação dos vídeos; string vazia = segue o padrão do sistema (~/Vídeos/HotClip). */
  outDir: string;
  /** A faixa de qualidade da exportação (CRF 18/23/28); de fábrica é high, a qualidade padrão de sempre. */
  quality: ExportQuality;
}

/** Igual ao padrão de fábrica: já sai vertical, com karaokê e corte seco; o que custa dinheiro ou gera arquivo extra vem desligado. */
export const RENDER_PREF_DEFAULTS: RenderPrefs = {
  vertical: true,
  captionStyle: "keyword",
  jumpCut: true,
  keepBreath: false, // o respiro muda o ritmo do corte seco, então o padrão mantém o aperto de sempre e a pessoa liga conforme o material
  speakerLabels: true, // ligado por padrão: sem a conversa de várias pessoas o vocabulário não tem marcação, e isso naturalmente não aparece
  templateJitter: false, // a perturbação muda a geometria do vídeo (embora imperceptível), então vem desligada e quem trabalha com rede de contas liga
  cleanFillers: true,
  cutRetakes: false, // o que sai é uma frase inteira, e o custo de errar é alto — desligado por padrão, a pessoa liga conforme o material
  autoZoom: false, // o movimento de câmera é uma escolha de estilo (briga quando o material já tem movimento), então vem desligado
  autoEnhance: false, // os pixels mudam e o material varia muito, então vem desligado e a pessoa liga explicitamente
  sfx: false, // o efeito sonoro muda como o vídeo soa, então vem desligado e a pessoa escolhe (as regras de marcação estão em sound-design.ts)
  bgmPath: "", // a trilha é uma escolha de estilo forte e envolve material próprio da pessoa, então nada é acrescentado por padrão
  trimUi: true,
  titleCard: true,
  openingHook: true,
  normalizeLoudness: true,
  denoise: false, // o material varia demais, e na redução de ruído é melhor ser conservador: desligada
  denoiseMode: "basic", // a atualização não muda o comportamento da chave antiga; a edição inteligente precisa de escolha explícita
  muteSensitive: false,
  sensitiveWords: DEFAULT_SENSITIVE_WORDS,
  compilation: false, // o compilado é um resultado extra, então vem desligado
  coldOpen: false, // o clímax na frente muda a estrutura do vídeo, então vem desligado e a pessoa escolhe
  flashForward: false, // o flash do estouro é a mesma coisa: abertura de estilo forte, desligada por padrão
  preciseAlign: false, // a primeira vez baixa um modelo de ~240MB e cada trecho leva alguns segundos a mais decodificando, então vem desligado
  alsoLandscape: false, // vários enquadramentos dobram o tempo de exportação, então vem desligado
  translate: false,
  publishCopy: false,
  subtitleFile: false,
  timeline: false,
  jianyingDraft: false, // o rascunho é um resultado extra (uma pasta por trecho), então vem desligado e a pessoa liga quando precisa
  aiCover: "off", // cada capa é cobrada por uso (na nuvem), então vem desligada e a pessoa escolhe a faixa
  aigcLabel: false,
  evidencePack: false, // o trecho de comprovação ocupa disco (uns 6 minutos do original por trecho), então vem desligado e a pessoa liga quando precisa
  publishPack: false, // o pacote de publicação cria um monte de pastas, então vem desligado e a pessoa liga quando precisa
  seriesPack: false, // só faz sentido com vários trechos do mesmo tema na mesma sessão, então vem desligado
  packPlatforms: ["douyin", "xiaohongshu", "channels"], // o trio mais comum de quem publica em rede
  variants: 1, // várias versões = tempo de exportação multiplicado + uma chamada de LLM, então vem desligado
  clipLength: "standard",
  genreId: "auto", // de fábrica nenhuma categoria é indicada: o prompt geral já pede ao modelo que julgue antes o tipo de conteúdo
  genreCustom: "",
  briefFocus: "", // a pauta sai vazia de fábrica: sem pauta, a busca segue os critérios gerais
  briefExclude: "",
  products: [],
  fullScan: false, // a varredura completa é demorada (e na nuvem é cobrada), então vem desligada e a pessoa liga
  outDir: "", // de fábrica segue a pasta padrão do sistema, e só depois de a pessoa escolher um caminho absoluto é guardado
  quality: "high", // igual ao vídeo de antes da atualização; trocar de faixa é uma decisão ativa da pessoa
};

function load(): RenderPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<RenderPrefs>;
      // Validação campo a campo: valor ruim volta ao padrão, e campo novo é completado sozinho
      const out = { ...RENDER_PREF_DEFAULTS };
      for (const key of Object.keys(RENDER_PREF_DEFAULTS) as Array<keyof RenderPrefs>) {
        const v = p[key];
        if (typeof v === typeof RENDER_PREF_DEFAULTS[key]) {
          (out as Record<string, unknown>)[key] = v;
        }
      }
      // Nos campos de array e de enum o typeof não é rigoroso o bastante, então cada um é validado à parte
      out.packPlatforms = Array.isArray(out.packPlatforms)
        ? validPlatformIds(out.packPlatforms.filter((x): x is string => typeof x === "string"))
        : [...RENDER_PREF_DEFAULTS.packPlatforms];
      out.products = Array.isArray(out.products)
        ? out.products.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 20)
        : [];
      out.sensitiveWords = Array.isArray(out.sensitiveWords)
        ? sanitizeSensitiveWords(out.sensitiveWords)
        : [...RENDER_PREF_DEFAULTS.sensitiveWords];
      // Na versão antiga as palavras do produto ficavam numa chave própria do localStorage; depois de migradas para as preferências, aquela chave não é mais lida
      if (out.products.length === 0) {
        try {
          const legacy = JSON.parse(localStorage.getItem("hotclip-products") ?? "[]");
          if (Array.isArray(legacy)) out.products = legacy.filter((x): x is string => typeof x === "string").slice(0, 20);
        } catch {
          /* não há dado antigo */
        }
      }
      if (![1, 2, 3].includes(out.variants)) out.variants = 1;
      if (!["short", "standard", "long"].includes(out.clipLength)) out.clipLength = "standard";
      if (!["high", "standard", "compact"].includes(out.quality)) out.quality = "high";
      if (!["keyword", "pop", "minimal", "hormozi", "bubble", "karaoke", "none"].includes(out.captionStyle)) out.captionStyle = "keyword";
      if (!["off", "volume", "premium"].includes(out.aiCover)) out.aiCover = "off";
      if (!["basic", "smart"].includes(out.denoiseMode)) out.denoiseMode = "basic";
      return out;
    }
  } catch {
    /* volta ao padrão */
  }
  return { ...RENDER_PREF_DEFAULTS };
}

interface RenderPrefsState {
  prefs: RenderPrefs;
  setPref: (partial: Partial<RenderPrefs>) => void;
}

export const useRenderPrefs = create<RenderPrefsState>((set, get) => ({
  prefs: load(),
  setPref: (partial) => {
    const prefs = { ...get().prefs, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* a persistência é feita na medida do possível */
    }
    set({ prefs });
  },
}));
