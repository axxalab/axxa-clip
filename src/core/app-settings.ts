/**
 * As configurações locais do aplicativo (uma só, compartilhada pelo desktop, pela CLI e pelo MCP): ficam em
 * <userData>/settings.json.
 *
 * Hoje há só um item, «onde os modelos ficam» — com modelos a partir de 1GB, a pessoa tem direito de saber
 * onde eles estão e de mudá-los para outro disco (nas palavras de quem abriu a issue #3: arquivo grande eu
 * sempre acompanho de perto).
 * A leitura é síncrona: o modelsRoot() é usado como um valor comum em vários lugares, e torná-lo assíncrono
 * contaminaria uma cadeia enorme de chamadas.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export interface AppSettings {
  /** A pasta raiz onde os modelos ficam; ausente = <userData>/models. */
  modelsDir?: string;
}

export function settingsPath(userDataDir: string): string {
  return join(userDataDir, "settings.json");
}

/** Lê as configurações; arquivo ausente ou corrompido volta sempre ao padrão de fábrica — não ler as configurações nunca deve impedir a exportação. */
export function readAppSettings(userDataDir: string): AppSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(userDataDir), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const dir = (parsed as AppSettings).modelsDir;
    return typeof dir === "string" && dir.trim() ? { modelsDir: dir.trim() } : {};
  } catch {
    return {};
  }
}

export function writeAppSettings(userDataDir: string, next: AppSettings): void {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(settingsPath(userDataDir), JSON.stringify(next, null, 2), "utf8");
}

/** A pasta de modelos de fábrica — é ela quando a pessoa nunca mudou nada. */
export function defaultModelsRoot(userDataDir: string): string {
  return join(userDataDir, "models");
}

/** A pasta raiz dos modelos: a que a pessoa definiu, ou o lugar de fábrica. */
export function resolveModelsRoot(userDataDir: string): string {
  return readAppSettings(userDataDir).modelsDir ?? defaultModelsRoot(userDataDir);
}
