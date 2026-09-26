/**
 * Trilha por IA na nuvem (v0.14): uma música instrumental livre de direitos é gerada conforme a categoria
 * da live, guardada localmente, e segue pela cadeia de mixagem de bgmPath que já existe (o laço que
 * preenche o vídeo, a esquiva da voz e o fade final são todos reaproveitados). As plataformas fiscalizam
 * direito de trilha com rigor e biblioteca comercial é caríssima — música gerada não tem terceiro
 * reivindicando direito, e é a solução «segura em direitos» de quem vive de cortes. O MiniMax Music (na
 * edição Atlas) entrega uma música inteira por vez, a US$ 0,15 cada.
 */
import { join } from "path";
import { mkdir } from "fs/promises";
import { atlasMediaBase, generateMedia, downloadMedia } from "./atlas-media";

/** O modelo e o preço por música (pelo preço de tabela; a Atlas cobra menos em promoção). */
export const BGM_MODEL = "minimax/music-2.6";
export const BGM_COST_USD = 0.15;

/** Gerar uma música é lento (150 a 180s+ medidos em máquina real), então o orçamento tem o dobro de margem. */
export const BGM_TIMEOUT_MS = 360_000;

/**
 * Categoria → prompt de estilo da trilha (em inglês — o vocabulário de estilo dos modelos de música vem
 * sobretudo de material em inglês).
 * As restrições valem para todas: música instrumental, boa de repetir em laço (uma trilha precisa dar
 * laço) e sem roubar a cena (tem de ficar abaixo da voz).
 */
const STYLE_BY_GENRE: Record<string, string> = {
  shopping: "upbeat bright pop funk instrumental, playful shopping vibe, steady groove, 118bpm",
  game: "energetic electronic synthwave instrumental, driving beat, gaming energy, 128bpm",
  esports: "epic hybrid electronic orchestral instrumental, tension and release, stadium energy",
  knowledge: "warm lofi chillhop instrumental, soft keys, focused calm study mood, 85bpm",
  talk: "light jazzy lounge instrumental, brushed drums, relaxed conversational mood",
  food: "cozy acoustic bossa nova instrumental, warm guitar, appetizing cafe mood",
  outdoor: "fresh acoustic folk instrumental, bright strums, sunny travel mood",
  show: "catchy dance pop instrumental, four-on-the-floor, stage performance energy, 124bpm",
  radio: "ambient late-night lofi instrumental, mellow pads, intimate radio mood",
  interview: "minimal warm ambient instrumental, soft piano, thoughtful podcast mood",
};

const STYLE_DEFAULT = "modern upbeat pop instrumental, clean mix, positive energy, 115bpm";

/** O prompt de estilo da trilha: categoria desconhecida ou não listada vai para a faixa animada genérica. */
export function bgmPrompt(genreId: string | undefined): string {
  const style = (genreId && STYLE_BY_GENRE[genreId]) || STYLE_DEFAULT;
  // Boa de laço + sem voz + com espaço para a voz — as três exigências duras de uma trilha
  return `${style}, instrumental only, no vocals, loop-friendly structure, consistent energy, background music that leaves space for speech`;
}

/**
 * Gera uma trilha por IA em destDir (o nome do arquivo traz a categoria e a marca de tempo, então gerar de
 * novo não sobrescreve nada) e devolve o caminho salvo. Se o baseUrl não for da Atlas ou faltar a chave,
 * lança erro (a entrada já é desabilitada na interface conforme a configuração, então chegar aqui
 * indisponível é anomalia, e a pessoa tem de ver o motivo em vez de ficar sem resposta nenhuma).
 */
export async function generateAiBgm(opts: {
  genreId?: string;
  baseUrl: string;
  apiKey: string;
  destDir: string;
  signal?: AbortSignal;
  /** A marca de tempo injetada (por padrão Date.now; o teste pode passar um valor fixo). */
  now?: () => number;
}): Promise<string> {
  const mediaBase = atlasMediaBase(opts.baseUrl);
  if (!mediaBase) throw new Error("a trilha por IA precisa de um endpoint da Atlas Cloud (nas configurações, troque o serviço de IA para a edição Atlas)");
  if (!opts.apiKey) throw new Error("a trilha por IA precisa de uma API Key");
  const url = await generateMedia(
    "generateAudio",
    { model: BGM_MODEL, prompt: bgmPrompt(opts.genreId), is_instrumental: true, format: "mp3", sample_rate: 44100, bitrate: 256000 },
    { mediaBase, apiKey: opts.apiKey, timeoutMs: BGM_TIMEOUT_MS, signal: opts.signal }
  );
  await mkdir(opts.destDir, { recursive: true });
  const stamp = new Date((opts.now ?? Date.now)()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = join(opts.destDir, `ai-bgm-${opts.genreId ?? "auto"}-${stamp}.mp3`);
  await downloadMedia(url, dest, opts.signal);
  return dest;
}
