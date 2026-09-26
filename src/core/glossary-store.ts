/**
 * A persistência local do vocabulário de termos: userData/glossary.json. O IPC do desktop, o servidor MCP e o
 * vigia de gravações usam o mesmo vocabulário — corrigiu uma vez, vale em todo lugar. Uma falha de leitura ou
 * um arquivo corrompido devolvem sempre uma tabela vazia (falha em aberto, sem nunca derrubar a transcrição).
 */
import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import type { GlossaryEntry } from "../shared/api-types";
import { sanitizeGlossary } from "../shared/glossary";

export function glossaryPath(userDataDir: string): string {
  return join(userDataDir, "glossary.json");
}

/** Lê o vocabulário; arquivo inexistente ou corrompido devolve []. */
export async function loadGlossary(userDataDir: string): Promise<GlossaryEntry[]> {
  try {
    const raw = await readFile(glossaryPath(userDataDir), "utf8");
    return sanitizeGlossary(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Grava a tabela inteira de volta (limpando antes; se a pasta não existir, ela é criada). */
export async function saveGlossary(userDataDir: string, entries: GlossaryEntry[]): Promise<GlossaryEntry[]> {
  const clean = sanitizeGlossary(entries);
  await mkdir(userDataDir, { recursive: true });
  await writeFile(glossaryPath(userDataDir), JSON.stringify(clean, null, 2), "utf8");
  return clean;
}
