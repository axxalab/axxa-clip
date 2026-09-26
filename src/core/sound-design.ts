/**
 * Desenho de som (marcação de efeitos + esquiva da trilha): a camada sonora da embalagem do vídeo pronto.
 *
 * Conclusões da pesquisa de 2026 (docs/RESEARCH-2026-08-CLIP-QUALITY.md, seções 2 e 3):
 *  - «em que quadro entra o efeito» não tem solução acadêmica nem API pronta — um motor de regras bem
 *    feito já é vantagem competitiva: whoosh no quadro do corte seco da colagem, ding no pico de emoção
 *    (a piada / a conclusão caindo), pop no instante em que o gancho de abertura entra na tela;
 *    no máximo 3 por vídeo, com distância mínima entre eles — mais que isso soa barato na hora.
 *  - a trilha precisa ficar de 15 a 20dB abaixo da voz, esquivar da voz por sidechain e fechar em fade.
 *
 * Escolhas de implementação:
 *  - os efeitos são sintetizados localmente pelo ffmpeg (varredura de ruído / seno decaindo) — nenhum
 *    arquivo de material, nenhum risco de licença, e quem quiser um pacote de efeitos de verdade só troca
 *    o wav de mesmo nome (a síntese só acontece quando o arquivo falta).
 *  - a mixagem é uma passada de pós-processamento à parte, depois do vídeo pronto: o vídeo vai em
 *    `-c:v copy`, sem perda de qualidade, e só o áudio é recodificado; todos os caminhos de saída
 *    (trecho único / corte seco / colagem / clímax na frente) são cobertos igual, e a verificação de
 *    qualidade (qa) revisa depois, como sempre.
 *
 * Fora ensureSfxAssets/applySoundDesign, é tudo função pura e testável.
 */
import { stat, rename, rm } from "fs/promises";
import { join } from "path";
import { runFfmpeg, LOUDNORM_FILTER, LOUDNORM_OUT_RATE } from "./cut";

export type SfxType = "whoosh" | "pop" | "ding";

/** Uma marcação de efeito sonoro (na linha de tempo do vídeo pronto, em segundos). */
export interface SfxCue {
  type: SfxType;
  atSec: number;
}

/** Teto de efeitos por vídeo — a pesquisa fala de 3 a 5, e aqui fica o valor conservador de baixo: mais que isso soa barato. */
export const SFX_MAX_PER_CLIP = 3;
/** Distância mínima entre efeitos vizinhos (segundos): colados um no outro, viram um borrão. */
export const SFX_MIN_SPACING_SEC = 1.5;
/** Distância mínima do efeito até o fim do vídeo (segundos): um efeito solto no finalzinho parece acidente. */
const SFX_TAIL_GUARD_SEC = 0.6;
/** Nível com que o efeito entra na mixagem (em relação ao material sintetizado em escala cheia): abaixo da voz, mas audível no instante da transição. */
export const SFX_MIX_VOLUME = 0.4;

/** Atenuação de referência da trilha em relação à voz (dB) — a pesquisa fala de 15 a 20dB, e aqui fica o meio. */
export const BGM_GAIN_DB = -17;
/** Duração do fade final da trilha (segundos). */
export const BGM_TAIL_FADE_SEC = 1.2;

/**
 * Receitas de síntese dos três efeitos no ffmpeg (wav mono de 48k):
 *  - whoosh: ruído rosa + passa-faixa + fade simétrico ≈ o «vum» de um ruído passando, no quadro do corte seco
 *  - pop: seno agudo decaindo rápido ≈ um «pop» leve, no quadro em que o texto/gancho entra
 *  - ding: fundamental + dois harmônicos com decaimento de sino ≈ o «tim», no pico de emoção / na conclusão caindo
 * Função pura: só produz os parâmetros, não executa.
 */
export function synthSfxArgs(type: SfxType, outPath: string): string[] {
  const recipes: Record<SfxType, string[]> = {
    whoosh: [
      "-f", "lavfi",
      "-i", "anoisesrc=color=pink:r=48000:d=0.5",
      "-af",
      "highpass=f=300,lowpass=f=2400," +
        "afade=t=in:st=0:d=0.28:curve=qsin,afade=t=out:st=0.28:d=0.22:curve=qsin,volume=0.9",
    ],
    pop: [
      "-f", "lavfi",
      "-i", "aevalsrc=0.9*sin(2*PI*820*t)*exp(-22*t)+0.3*sin(2*PI*1640*t)*exp(-30*t):s=48000:d=0.2",
    ],
    ding: [
      "-f", "lavfi",
      "-i",
      "aevalsrc=0.55*sin(2*PI*1318.5*t)*exp(-5*t)+0.28*sin(2*PI*2637*t)*exp(-7*t)+0.12*sin(2*PI*3951*t)*exp(-9*t):s=48000:d=0.8",
    ],
  };
  return ["-hide_banner", "-y", ...recipes[type], "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", outPath];
}

/** A entrada do planejamento das marcações (tudo na linha de tempo do vídeo pronto). */
export interface SfxPlanInput {
  durationSec: number;
  /** Emendas de corte seco estrutural: a emenda da colagem de vários pedaços e a emenda do mini-trecho do clímax na frente com o vídeo em si. */
  seamsSec?: number[];
  /** O instante em que o gancho de abertura entra na tela, quando ele existe (normalmente perto de 0); null/ausente = sem gancho. */
  hookAtSec?: number | null;
  /** Os instantes dos picos, em ordem decrescente de intensidade (o ding pega só o mais alto). */
  peakEventsSec?: number[];
  /** Teto sobrescrito (por padrão SFX_MAX_PER_CLIP). */
  maxCues?: number;
}

/**
 * Planeja as marcações de efeito. Prioridade: whoosh da emenda da colagem (é estrutural, e quem assiste
 * percebe o salto de qualquer jeito) > ding do pico de emoção > pop do gancho de abertura. Cada um entra
 * por vez, e o que violar a distância mínima ou sair do intervalo é descartado — melhor de menos que de mais.
 * Função pura.
 */
export function planSfxCues(input: SfxPlanInput): SfxCue[] {
  const max = Math.max(0, input.maxCues ?? SFX_MAX_PER_CLIP);
  if (max === 0 || !(input.durationSec > 1)) return [];
  const placed: SfxCue[] = [];
  const fits = (at: number): boolean =>
    at >= 0 &&
    at <= input.durationSec - SFX_TAIL_GUARD_SEC &&
    placed.every((c) => Math.abs(c.atSec - at) >= SFX_MIN_SPACING_SEC);
  const put = (type: SfxType, at: number): void => {
    if (placed.length < max && fits(at)) placed.push({ type, atSec: Number(at.toFixed(3)) });
  };

  // As emendas estruturais entram na ordem do tempo (são todas whoosh, e entre elas não há mais forte nem mais fraco)
  for (const s of [...(input.seamsSec ?? [])].sort((a, b) => a - b)) put("whoosh", s);
  // Do pico de emoção só o mais alto é usado — muito ding e o vídeo parece um jogo
  const topPeak = input.peakEventsSec?.[0];
  if (topPeak !== undefined) put("ding", topPeak);
  // Gancho de abertura: entra na tela e «pop»; o gancho fica no comecinho, e cede lugar ao whoosh pela regra de distância de fits
  if (input.hookAtSec !== null && input.hookAtSec !== undefined) put("pop", Math.max(0.03, input.hookAtSec));

  return placed.sort((a, b) => a.atSec - b.atSec);
}

/** Opções da mixagem do desenho de som. */
export interface SoundDesignOptions {
  /** As marcações de efeito (pode ser vazio; array vazio = só mixar a trilha). */
  cues: SfxCue[];
  /** A pasta onde ficam os wav dos efeitos (<tipo>.wav); obrigatória quando cues não está vazio. */
  sfxDir?: string;
  /** Caminho do arquivo de trilha (opcional); é repetido em laço por todo o vídeo e esquiva da voz. */
  bgmPath?: string;
  /** Duração do vídeo pronto (segundos) — necessária para cortar a trilha e para o fade final. */
  durationSec: number;
  /** Com a normalização de volume ligada na saída, o loudnorm passa mais uma vez depois da mixagem para segurar os -14 LUFS. */
  normalizeLoudness?: boolean;
}

/** Se há algo a fazer (função pura; é por ela que quem chama decide pular a passada de pós-processamento inteira). */
export function hasSoundDesignWork(o: Pick<SoundDesignOptions, "cues" | "bgmPath">): boolean {
  return o.cues.length > 0 || Boolean(o.bgmPath);
}

/**
 * Monta os parâmetros do ffmpeg da passada de desenho de som (função pura):
 * entrada 0 = o vídeo pronto, 1..N = cada wav de efeito, a última = a trilha (-stream_loop em laço).
 * voz → (asplit gerando a cadeia lateral da esquiva) → amix com a trilha (sidechaincompress) e com cada
 * efeito (adelay) (normalize=0 mantém os níveis já definidos) → loudnorm opcional → o vídeo é copiado de volta para o contêiner.
 */
export function buildSoundDesignArgs(
  inPath: string,
  outPath: string,
  o: SoundDesignOptions
): string[] {
  if (!hasSoundDesignWork(o)) throw new Error("sound design called with nothing to do");
  if (o.cues.length > 0 && !o.sfxDir) throw new Error("sfx cues require sfxDir");
  const inputs: string[] = ["-i", inPath];
  const graph: string[] = [];
  const mixIns: string[] = [];
  let inputIdx = 1;

  // Voz: com trilha presente, uma cópia é separada para servir de cadeia lateral da esquiva
  if (o.bgmPath) {
    graph.push("[0:a]asplit=2[voice][sc]");
    mixIns.push("[voice]");
  } else {
    mixIns.push("[0:a]");
  }

  // Efeitos: cada um recebe adelay até o seu instante (o mesmo atraso nos dois canais), todos no mesmo nível de mixagem
  for (const cue of o.cues) {
    const ms = Math.max(0, Math.round(cue.atSec * 1000));
    inputs.push("-i", join(o.sfxDir!, `${cue.type}.wav`));
    graph.push(`[${inputIdx}:a]adelay=${ms}|${ms},volume=${SFX_MIX_VOLUME}[s${inputIdx}]`);
    mixIns.push(`[s${inputIdx}]`);
    inputIdx++;
  }

  // Trilha: lida em laço infinito → cortada na duração do vídeo → atenuação de referência → esquiva por cadeia lateral da voz → fade final
  if (o.bgmPath) {
    inputs.push("-stream_loop", "-1", "-i", o.bgmPath);
    const fadeStart = Math.max(0, o.durationSec - BGM_TAIL_FADE_SEC);
    graph.push(
      `[${inputIdx}:a]atrim=end=${o.durationSec.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `volume=${BGM_GAIN_DB}dB[bgmv]`,
      // Parâmetros da esquiva: quando a voz entra, a trilha é comprimida ~10dB a mais, e volta subindo devagar por 0,5s — o famoso «dar passagem para a fala»
      `[bgmv][sc]sidechaincompress=threshold=0.015:ratio=8:attack=60:release=500[bgmduck]`,
      `[bgmduck]afade=t=out:st=${fadeStart.toFixed(3)}:d=${BGM_TAIL_FADE_SEC}[bgmout]`
    );
    mixIns.push("[bgmout]");
  }

  // duration=first: tudo se mede pela duração da voz (a trilha de áudio original do vídeo pronto), e o efeito atrasado além dela é cortado naturalmente
  const tail = o.normalizeLoudness ? `,${LOUDNORM_FILTER}` : ",alimiter=limit=0.98";
  graph.push(`${mixIns.join("")}amix=inputs=${mixIns.length}:duration=first:normalize=0${tail}[mix]`);

  return [
    "-hide_banner", "-y",
    ...inputs,
    "-filter_complex", graph.join(";"),
    "-map", "0:v?",
    "-c:v", "copy",
    "-map", "[mix]",
    ...(o.normalizeLoudness ? ["-ar", LOUDNORM_OUT_RATE] : []),
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    outPath,
  ];
}

/** O conjunto dos três efeitos (ensureSfxAssets sintetiza um por um). */
export const SFX_TYPES: SfxType[] = ["whoosh", "pop", "ding"];

/**
 * Garante que o material de efeito esteja no lugar: o que falta na pasta é sintetizado (quem quiser trocar o
 * som padrão só coloca um wav de mesmo nome). Devolve o caminho da pasta como veio, para quem chama poder encadear.
 */
export async function ensureSfxAssets(dir: string, signal?: AbortSignal): Promise<string> {
  for (const type of SFX_TYPES) {
    const path = join(dir, `${type}.wav`);
    const exists = await stat(path).then((s) => s.size > 0, () => false);
    if (!exists) await runFfmpeg(synthSfxArgs(type, path), { signal });
  }
  return dir;
}

/**
 * Roda o desenho de som num vídeo pronto: mixa para um arquivo temporário e, só no sucesso, troca de
 * forma atômica (rename); a falha em qualquer passo é lançada e quem chama trata em falha aberta —
 * nunca se deixa um efeito derrubar o vídeo.
 */
export async function applySoundDesign(
  clipPath: string,
  options: SoundDesignOptions,
  signal?: AbortSignal
): Promise<void> {
  const tmpPath = clipPath.replace(/\.mp4$/, ".sound.mp4");
  try {
    await runFfmpeg(buildSoundDesignArgs(clipPath, tmpPath, options), { signal });
    await rename(tmpPath, clipPath);
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw e;
  }
}
