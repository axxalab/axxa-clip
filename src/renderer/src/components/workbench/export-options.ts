/**
 * A montagem das opções de exportação: preferências + estado da sessão → RenderToggles.
 * A exportação manual e o «tudo automático» usam esta mesma montagem — antes o caminho automático tinha um
 * conjunto de chaves padrão fixo no código, cada um crescia para um lado, e mudar num lugar esquecia o outro.
 */
import type { RenderToggles, LlmConfig, Transcript } from "../../../../shared/api-types";
import type { RenderPrefs } from "../../stores/render-prefs-store";
import { activeBrandStyle } from "../../stores/brand-store";

export function buildRenderToggles(opts: {
  prefs: RenderPrefs;
  config: LlmConfig;
  brandState: Parameters<typeof activeBrandStyle>[0];
  diarize: boolean;
  transcript: Transcript | null;
  /** A edição de geração de mídia por IA está disponível (o LLM aponta para a Atlas e há chave). */
  atlasReady: boolean;
}): RenderToggles {
  const { prefs, config, brandState, diarize, transcript, atlasReady } = opts;
  // Material em português é traduzido para o inglês, e o resto para o português — os dois sentidos de quem leva vídeo curto para fora e de quem traz de fora
  const targetLang = (transcript?.language || "").startsWith("pt") ? "en" : "pt";
  return {
    vertical: prefs.vertical,
    captionStyle: prefs.captionStyle,
    jumpCut: prefs.jumpCut,
    keepBreath: prefs.keepBreath,
    speakerLabels: prefs.speakerLabels && diarize,
    templateJitter: prefs.templateJitter,
    cleanFillers: prefs.cleanFillers,
    cutRetakes: prefs.cutRetakes,
    autoZoom: prefs.autoZoom,
    autoEnhance: prefs.autoEnhance,
    sfx: prefs.sfx,
    bgmPath: prefs.bgmPath || undefined,
    genreId: prefs.genreId,
    preciseAlign: prefs.preciseAlign,
    trimUi: prefs.trimUi,
    titleCard: prefs.titleCard,
    openingHook: prefs.openingHook,
    coldOpen: prefs.coldOpen,
    flashForward: prefs.flashForward,
    alsoLandscape: prefs.alsoLandscape,
    normalizeLoudness: prefs.normalizeLoudness,
    denoise: prefs.denoise,
    denoiseMode: prefs.denoiseMode,
    muteTerms: prefs.muteSensitive && prefs.sensitiveWords.length > 0 ? prefs.sensitiveWords : undefined,
    compilation: prefs.compilation,
    brand: activeBrandStyle(brandState),
    translate: prefs.translate ? { targetLang, llm: config } : undefined,
    publishCopy: prefs.publishCopy ? { llm: config } : undefined,
    subtitleFile: prefs.subtitleFile,
    timeline: prefs.timeline,
    jianyingDraft: prefs.jianyingDraft,
    aigcLabel: prefs.aigcLabel,
    evidencePack: prefs.evidencePack,
    publishPack: prefs.publishPack && prefs.packPlatforms.length > 0 ? prefs.packPlatforms : undefined,
    seriesPack: prefs.seriesPack,
    variants: prefs.variants > 1 ? { count: prefs.variants, llm: config } : undefined,
    aiCover: prefs.aiCover !== "off" && atlasReady ? { tier: prefs.aiCover, llm: config } : undefined,
    outDir: prefs.outDir,
    quality: prefs.quality,
  };
}
