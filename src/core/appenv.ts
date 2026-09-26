/**
 * O ambiente de execução sem interface (compartilhado pela CLI e pelo servidor MCP): a localização da pasta
 * de dados do usuário e a configuração do LLM por variáveis de ambiente quando nada sobe pelo Electron.
 * O caminho é exatamente o mesmo do app.getPath("userData") do desktop — os modelos, o cache de transcrição
 * e o vocabulário de termos são baixados e configurados uma vez, e o desktop, a CLI e o MCP usam os três.
 */
import { homedir } from "os";
import { join } from "path";
import { resolveModelsRoot } from "./app-settings";
import type { LlmConfig } from "../shared/api-types";

/** O mesmo caminho do app.getPath("userData") do Electron — os modelos e o cache são compartilhados pelos dois lados. */
export function userDataDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "hotclip");
  if (platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "hotclip");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "hotclip");
}

/** A pasta raiz dos modelos de IA (os de transcrição, de enquadramento e de detecção de cortes, baixados sozinhos na primeira vez); se a pessoa mudou isso nas configurações, vale a escolha dela. */
export const modelsRoot = (): string => resolveModelsRoot(userDataDir());

/** A pasta do cache local dos resultados de transcrição (reabrir o mesmo arquivo entra na hora). */
export const cacheDir = (): string => join(userDataDir(), "transcript-cache");

/** O cache reaproveitável dos vídeos base (um LRU limitado, gerido à parte do cache de transcrição). */
export const renderCacheDir = (): string => join(userDataDir(), "render-cache");

/** As evidências reaproveitáveis da análise do material (um índice JSON pequeno, limitado e apagável por conta própria). */
export const evidenceCacheDir = (): string => join(userDataDir(), "evidence-index");

/**
 * A pasta em que o vídeo pronto aterrissa: <raiz de exportação>/<nome do material>/.
 * A raiz é, por padrão, HotClip dentro da pasta «Vídeos» do sistema (onde quem está começando acha no
 * gerenciador de arquivos), e se a pessoa mudou isso na interface, vale a escolha dela (issue #3). String
 * vazia ou em branco conta sempre como «nunca escolheu».
 */
export function clipOutDir(chosen: string | null | undefined, videosDir: string, sourceName: string): string {
  const root = typeof chosen === "string" && chosen.trim() ? chosen.trim() : join(videosDir, "HotClip");
  return join(root, sourceName);
}

/** A configuração do LLM vem de variáveis de ambiente; sem ela, o agente ou a pessoa recebem uma instrução que dá para seguir. */
export function llmFromEnv(): LlmConfig {
  const baseUrl = process.env.HOTCLIP_LLM_BASE_URL ?? "";
  const model = process.env.HOTCLIP_LLM_MODEL ?? "";
  if (!baseUrl || !model) {
    throw new Error(
      "falta a configuração do LLM: defina as variáveis de ambiente HOTCLIP_LLM_BASE_URL e HOTCLIP_LLM_MODEL (um endpoint compatível com a OpenAI; num Ollama local é http://localhost:11434/v1, sem chave; na nuvem é preciso também HOTCLIP_LLM_API_KEY)"
    );
  }
  return { baseUrl, apiKey: process.env.HOTCLIP_LLM_API_KEY ?? "ollama", model };
}
