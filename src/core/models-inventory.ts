/**
 * Inventário dos modelos e mudança de pasta (issue #3).
 *
 * As pessoas não achavam onde aquele 1GB de modelos ficava — a pasta nunca tinha aparecido na interface.
 * Este módulo cuida de duas coisas: «quantos são, quanto cada um ocupa e quais estão instalados» e
 * «mover a pasta inteira para outro disco».
 * O limite de segurança da mudança: **nem um byte da pasta antiga sai antes de a nova estar inteira no
 * lugar** — baixar os modelos de novo leva mais de uma hora, e perder tudo numa mudança é muito pior que
 * não poder mudar.
 */
import { cp, mkdir, readdir, rename, rm, stat } from "fs/promises";
import * as nodePath from "path";
import { join, resolve } from "path";
import {
  isModelInstalled,
  modelDir,
  SENSEVOICE_MODEL,
  PARAFORMER_MODEL,
  FIRERED_MODEL,
  YUNET_MODEL,
  EMOTION_MODEL,
  PUNCT_MODEL,
  SEGMENTATION_MODEL,
  SPEAKER_EMBEDDING_MODEL,
  TRANSNETV2_MODEL,
  SILERO_VAD_MODEL,
  DPDFNET_SPEECH_ENHANCEMENT_MODEL,
  type ModelAsset,
} from "./models";

/** Todos os modelos que dá para baixar, agrupados pela finalidade que a pessoa entende (a interface mostra nesta ordem). */
export const MODEL_CATALOG: Array<{ asset: ModelAsset; useKey: string }> = [
  { asset: SENSEVOICE_MODEL, useKey: "useAsrFast" },
  { asset: PARAFORMER_MODEL, useKey: "useAsrAccurate" },
  { asset: FIRERED_MODEL, useKey: "useAsrDialect" },
  { asset: PUNCT_MODEL, useKey: "usePunct" },
  { asset: SEGMENTATION_MODEL, useKey: "useDiarize" },
  { asset: SPEAKER_EMBEDDING_MODEL, useKey: "useDiarize" },
  { asset: YUNET_MODEL, useKey: "useFace" },
  { asset: EMOTION_MODEL, useKey: "useEmotion" },
  { asset: TRANSNETV2_MODEL, useKey: "useShots" },
  { asset: SILERO_VAD_MODEL, useKey: "useSpeechSafety" },
  { asset: DPDFNET_SPEECH_ENHANCEMENT_MODEL, useKey: "useSpeechEnhance" },
];

export interface ModelEntry {
  id: string;
  /** A chave de i18n do texto de finalidade (a interface traduz por conta própria). */
  useKey: string;
  installed: boolean;
  /** O espaço em disco realmente ocupado por um modelo instalado; 0 quando não está instalado. */
  bytes: number;
  /** O tamanho estimado do download, mostrado quando não está instalado. */
  approxBytes: number;
}

export interface ModelsInfo {
  root: string;
  defaultRoot: string;
  /** O total ocupado pelos modelos instalados. */
  totalBytes: number;
  entries: ModelEntry[];
}

/** Soma o espaço da pasta recursivamente; o que não puder ser lido conta 0 (permissão ou concorrência não devem derrubar a página inteira). */
export async function dirSize(path: string): Promise<number> {
  let total = 0;
  let items: string[];
  try {
    const s = await stat(path);
    if (s.isFile()) return s.size;
    items = await readdir(path);
  } catch {
    return 0;
  }
  for (const name of items) {
    total += await dirSize(join(path, name));
  }
  return total;
}

/** Faz o inventário dos modelos: quais estão instalados, quanto cada um ocupa e quanto é o total. */
export async function inspectModels(root: string, defaultRoot: string): Promise<ModelsInfo> {
  const entries: ModelEntry[] = [];
  for (const { asset, useKey } of MODEL_CATALOG) {
    const installed = await isModelInstalled(root, asset);
    entries.push({
      id: asset.id,
      useKey,
      installed,
      bytes: installed ? await dirSize(modelDir(root, asset)) : 0,
      approxBytes: asset.approxBytes,
    });
  }
  return {
    root,
    defaultRoot,
    totalBytes: entries.reduce((a, e) => a + e.bytes, 0),
    entries,
  };
}

/** A superfície mínima do path de que isInside precisa; por padrão a implementação da plataforma atual, e no teste unitário dá para trocar por path.win32 e reproduzir o comportamento do Windows. */
type PathImpl = Pick<typeof nodePath, "relative" | "resolve" | "isAbsolute" | "sep">;

/**
 * Se a pasta de destino está dentro da de origem (mudar para uma subpasta de si mesma recursa para sempre).
 * No Windows, entre discos diferentes, relative() não produz ".." — devolve o caminho absoluto do destino
 * (E:\x, por exemplo), e é por isAbsolute que isso precisa ser julgado «fora», senão toda mudança entre
 * discos seria barrada por engano (issue #4).
 */
export function isInside(parent: string, child: string, p: PathImpl = nodePath): boolean {
  const rel = p.relative(p.resolve(parent), p.resolve(child));
  if (rel === "") return true;
  return !p.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${p.sep}`);
}

/**
 * Move a pasta de modelos inteira para o lugar novo e devolve o caminho que ficou valendo.
 *
 * No mesmo disco usa rename (instantâneo); entre discos cai em «copiar tudo, conferir e só então apagar o
 * original». Uma falha no meio da cópia limpa a pasta de destino pela metade e deixa o original intocado —
 * melhor mudar de novo à toa que perder o que já estava lá.
 */
export async function moveModelsDir(from: string, to: string): Promise<string> {
  const src = resolve(from);
  const dest = resolve(to);
  if (src === dest) return dest;
  if (isInside(src, dest)) throw new Error("a pasta de destino está dentro da pasta de modelos atual; escolha outro lugar");

  const srcExists = await stat(src).then((s) => s.isDirectory()).catch(() => false);
  await mkdir(dest, { recursive: true });
  if (!srcExists) return dest; // nenhum modelo foi baixado ainda: basta trocar o lugar, não há o que mover

  const names = await readdir(src);
  if (names.length === 0) return dest;

  // Com o destino não vazio, nada de arriscar uma fusão — a pessoa escolhe uma pasta limpa, para modelos de mesmo nome não se sobrescreverem
  if ((await readdir(dest)).length > 0) throw new Error("a pasta de destino não está vazia; escolha uma pasta vazia");

  try {
    await rename(src, dest);
    return dest;
  } catch {
    /* entre discos o rename falha (EXDEV), e a cópia assume */
  }

  try {
    for (const name of names) {
      await cp(join(src, name), join(dest, name), { recursive: true, force: true });
    }
    // Conferência grosseira da integridade da cópia: se o total de bytes não bate, a mudança não valeu
    const [srcBytes, destBytes] = [await dirSize(src), await dirSize(dest)];
    if (destBytes < srcBytes) throw new Error("a cópia ficou incompleta");
    await rm(src, { recursive: true, force: true });
    return dest;
  } catch (e) {
    await rm(dest, { recursive: true, force: true }).catch(() => {});
    throw new Error(`a mudança dos modelos falhou, e a pasta original não foi alterada: ${e instanceof Error ? e.message : String(e)}`);
  }
}
