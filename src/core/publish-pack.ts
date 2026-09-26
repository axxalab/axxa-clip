/**
 * Pacote por plataforma: depois que a exportação termina, os vídeos são
 * organizados conforme as especificações de cada plataforma em pastas do tipo
 * "pegou e publicou" — dentro de `pacotes-publicacao/<plataforma>/`, cada clipe
 * sai completo com três peças: o vídeo (em link físico, para não ocupar disco em
 * dobro), a capa recortada na proporção daquela plataforma (RedNote 3:4, Bilibili
 * 16:10, WeChat Channels 6:7…) e o texto adaptado aos limites de lá (.post.txt,
 * com o corte do título e a quantidade de hashtags seguindo a tabela de
 * especificações), mais um manifest.json registrando o que foi adaptado.
 *
 * O fluxo real de quem faz cortes é publicar o mesmo lote em N plataformas, e
 * cada uma tem especificação diferente — este passo era, antes, repetido à mão N
 * vezes no editor ou no editor de imagem. É fail-open: qualquer etapa do pacote
 * que falha significa apenas uma peça de menos, e nunca derruba a exportação que
 * já terminou.
 *
 * As funções puras (o filtro da capa e a adaptação do texto) são testáveis; o
 * sistema de arquivos e o ffmpeg são injetados ou cuidados por quem chama.
 */
import { copyFile, link, mkdir, rm, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { platformSpec, validPlatformIds, type PlatformSpec } from "../shared/platform-specs";
import type { PublishCopy } from "./publish";

/** Nome da plataforma → nome da pasta (mesma regra do sanitizeFilename de export.ts; export não é importado aqui para evitar dependência circular). */
function safeDirName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} \-_]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned || fallback;
}

/** Nome da pasta raiz dos pacotes de publicação (fica dentro da pasta de exportação). */
export const PACK_DIR_NAME = "pacotes-publicacao";

/** Entrada do empacotamento: um vídeo já exportado. */
export interface PackClipInput {
  /** Caminho absoluto do mp4 final. */
  file: string;
  /** Caminho absoluto do jpg de capa (ausente quando a captura da capa falhou). */
  coverFile?: string;
  /** Título do clipe (é o título de reserva quando não há texto de publicação). */
  title: string;
  /** Texto de publicação (título, hashtags e descrição); ausente, só o título é escrito. */
  publish?: PublishCopy;
}

/** Resultado do empacotamento de uma plataforma (entra no comprovante do clips.json). */
export interface PackSummary {
  platform: string;
  name: string;
  dir: string;
  clipCount: number;
  /** Quantos títulos foram cortados por passar do limite da plataforma (o manifesto permite conferir um por um). */
  truncatedTitles: number;
}

/** Ponto de injeção da adaptação de capa: recorta e redimensiona src para a proporção da plataforma, escrevendo em dest, e devolve um booleano de sucesso. */
export type AdaptCoverFn = (src: string, dest: string, spec: PlatformSpec) => Promise<boolean>;

/**
 * Filtro de ffmpeg da capa de cada plataforma: primeiro recorta na proporção alvo
 * (centralizado na horizontal e deslocado um terço para cima na vertical — o
 * assunto principal e os rostos ficam geralmente na parte de cima, e um recorte
 * centralizado corta a cabeça), e depois redimensiona para os pixels recomendados
 * pela plataforma.
 * A expressão vale para qualquer tamanho de entrada, então capas verticais,
 * horizontais e de onda sonora não precisam ter o tamanho lido antes.
 */
export function coverFilter(spec: PlatformSpec): string {
  const aspect = (spec.cover.w / spec.cover.h).toFixed(6);
  return [
    `crop='min(iw,ih*${aspect})':'min(ih,iw/${aspect})':'(iw-ow)/2':'(ih-oh)*0.33'`,
    `scale=${spec.cover.w}:${spec.cover.h}`,
  ].join(",");
}

/** Resultado da adaptação do texto. */
export interface AdaptedPost {
  /** O conteúdo completo do .post.txt (título, hashtags e descrição, pronto para selecionar tudo e copiar). */
  text: string;
  /** O título já adaptado (o corte é por caractere e não por byte, então um emoji nunca é partido ao meio). */
  title: string;
  /** Se o título foi cortado pelo limite da plataforma. */
  titleTruncated: boolean;
  /** As hashtags já adaptadas (a quantidade é cortada pelo limite da plataforma). */
  hashtags: string[];
}

/**
 * Adapta o texto de publicação aos limites da plataforma: o título é cortado em
 * titleMax (os 20 caracteres do RedNote são limite rígido, e os 55 do Douyin são o
 * corte da listagem) e as hashtags são cortadas em tagsMax. Sem texto de
 * publicação, o título do clipe serve de reserva — o campo de publicação precisa
 * ter, no mínimo, um título utilizável.
 */
export function adaptPost(
  clipTitle: string,
  copy: PublishCopy | undefined,
  spec: PlatformSpec,
  /** Com o selo de conteúdo por IA ligado: o texto ganha no fim a instrução de sinalização daquela plataforma (v0.14; pelas novas regras, três infrações derrubam a conta). */
  aigc = false
): AdaptedPost {
  const raw = (copy?.title ?? clipTitle).trim();
  const chars = Array.from(raw); // o corte é por ponto de código, então par substituto e emoji não são partidos ao meio
  const titleTruncated = chars.length > spec.titleMax;
  const title = titleTruncated ? chars.slice(0, spec.titleMax).join("") : raw;
  const hashtags = (copy?.hashtags ?? []).slice(0, spec.tagsMax);
  const parts = [title];
  if (hashtags.length > 0) parts.push(hashtags.join(" "));
  const body = [copy?.description ?? "", copy?.cta ?? ""].filter(Boolean).join("\n");
  if (body) parts.push(body);
  if (aigc) parts.push(`[Sinalização de conteúdo por IA] ${spec.aigcNotePt}`);
  return { text: parts.join("\n\n") + "\n", title, titleTruncated, hashtags };
}

/** Cria o link físico do vídeo dentro do pacote (cópia zero no mesmo disco); quando o link físico não é suportado (disco de rede, FAT), volta a copiar. */
async function linkOrCopy(src: string, dest: string): Promise<void> {
  await rm(dest, { force: true }).catch(() => {});
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

/**
 * Empacota para as plataformas selecionadas. Qualquer peça que falhe (recorte da
 * capa, link físico, escrita do arquivo) é pulada e o resto continua, e uma
 * plataforma que falhe por inteiro significa apenas uma pasta de menos — nada é
 * propagado para cima.
 */
export async function buildPublishPacks(
  outDir: string,
  clips: PackClipInput[],
  platformIds: string[],
  adaptCover: AdaptCoverFn,
  /** Com o selo de conteúdo por IA ligado: o texto de cada plataforma ganha a instrução de sinalização, e o manifesto registra isso também. */
  aigc = false
): Promise<PackSummary[]> {
  const summaries: PackSummary[] = [];
  for (const id of validPlatformIds(platformIds)) {
    const spec = platformSpec(id)!;
    try {
      const dir = join(outDir, PACK_DIR_NAME, safeDirName(spec.name.pt, spec.id));
      await mkdir(dir, { recursive: true });
      let truncated = 0;
      const rows: Array<Record<string, unknown>> = [];
      for (const clip of clips) {
        const base = basename(clip.file);
        await linkOrCopy(clip.file, join(dir, base)).catch(() => {});
        // Capa: recortada na proporção da plataforma; capa de origem ausente ou recorte que falha significam apenas ficar sem capa
        let coverName: string | null = null;
        if (clip.coverFile) {
          const dest = join(dir, base.replace(/\.mp4$/, ".jpg"));
          const ok = await adaptCover(clip.coverFile, dest, spec).catch(() => false);
          if (ok) coverName = basename(dest);
        }
        const post = adaptPost(clip.title, clip.publish, spec, aigc);
        if (post.titleTruncated) truncated++;
        const postName = base.replace(/\.mp4$/, ".post.txt");
        await writeFile(join(dir, postName), post.text, "utf8").catch(() => {});
        rows.push({
          file: base,
          cover: coverName,
          postFile: postName,
          title: post.title,
          titleTruncated: post.titleTruncated,
          hashtags: post.hashtags,
        });
      }
      // Manifesto: o que foi adaptado e sob qual especificação, para dar uma olhada antes de publicar e já saber se há armadilha
      await writeFile(
        join(dir, "manifest.json"),
        JSON.stringify(
          {
            platform: spec.id,
            name: spec.name.pt,
            coverSize: `${spec.cover.w}x${spec.cover.h}`,
            titleMax: spec.titleMax,
            tagsMax: spec.tagsMax,
            note: spec.notePt,
            // Aviso de sinalização de IA: só é escrito com o selo ligado (olhar o manifesto antes de publicar já diz qual opção marcar na plataforma)
            aigcNote: aigc ? spec.aigcNotePt : null,
            clips: rows,
          },
          null,
          2
        ),
        "utf8"
      ).catch(() => {});
      summaries.push({ platform: spec.id, name: spec.name.pt, dir, clipCount: clips.length, truncatedTitles: truncated });
    } catch {
      // Uma plataforma que falha não derruba as outras
    }
  }
  return summaries;
}
