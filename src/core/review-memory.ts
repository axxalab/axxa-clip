/**
 * Retorno das decisões de revisão: aprovar ou descartar na bancada de revisão é
 * o sinal de preferência mais honesto que existe. Essas decisões viram um
 * arquivo de memória local que é injetado no prompt da próxima detecção — quanto
 * mais se usa, melhor o sistema entende esta pessoa, e os dados de preferência
 * não saem da máquina.
 * (É a versão HotClip da ideia de memória de sessão do project.md do video-use:
 * o desktop acumula, e CLI, MCP e o monitoramento de gravações compartilham.)
 * A memória é apenas evidência de apoio; a qualidade do conteúdo é sempre o
 * primeiro critério.
 */
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join, dirname } from "path";
import type { ReviewedCandidate } from "../shared/api-types";

export type { ReviewedCandidate };

/** Uma sessão de revisão (um clique em exportar): quem foi aprovado e quem foi deixado de fora. */
export interface ReviewRecord {
  /** Data e hora absoluta, em formato ISO. */
  at: string;
  /** Nome do arquivo de origem (sem o caminho, para não revelar a estrutura de pastas). */
  video: string;
  kept: ReviewedCandidate[];
  rejected: ReviewedCandidate[];
}

/** Guarda apenas as N sessões mais recentes — a preferência muda, e memória velha tem mesmo que ser esquecida. */
const MAX_RECORDS = 40;
/** Limite de exemplos injetados no prompt por categoria (aprovados/descartados) — controla o gasto de tokens e evita afogar o texto principal. */
const MAX_EXAMPLES = 6;

const memoryPath = (userDataDir: string): string => join(userDataDir, "review-memory.json");

/** Lê o arquivo de memória; ausente ou corrompido conta como vazio (se a memória se perde, ela é reconstruída aos poucos e nunca trava a esteira). */
export async function loadReviewMemory(userDataDir: string): Promise<ReviewRecord[]> {
  try {
    const raw = JSON.parse(await readFile(memoryPath(userDataDir), "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is ReviewRecord =>
        !!r && typeof (r as ReviewRecord).at === "string" && Array.isArray((r as ReviewRecord).kept) && Array.isArray((r as ReviewRecord).rejected)
    );
  } catch {
    return [];
  }
}

/** Acrescenta uma sessão de revisão e descarta as antigas; a gravação é atômica, via arquivo temporário e rename. */
export async function recordReview(userDataDir: string, record: ReviewRecord): Promise<void> {
  // Registra mesmo quando tudo foi aprovado e nada descartado: um exemplo aprovado também é evidência de preferência
  const all = [...(await loadReviewMemory(userDataDir)), record].slice(-MAX_RECORDS);
  const file = memoryPath(userDataDir);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
  await rename(tmp, file);
}

/** Escolhe os exemplos: as sessões mais recentes vêm primeiro, títulos repetidos saem, e cada categoria vai até MAX_EXAMPLES itens. */
export function pickExamples(records: ReviewRecord[], kind: "kept" | "rejected"): ReviewedCandidate[] {
  const out: ReviewedCandidate[] = [];
  const seen = new Set<string>();
  for (const rec of [...records].reverse()) {
    for (const c of rec[kind]) {
      if (!c?.title || seen.has(c.title)) continue;
      seen.add(c.title);
      out.push(c);
      if (out.length >= MAX_EXAMPLES) return out;
    }
  }
  return out;
}

const exampleLine = (c: ReviewedCandidate, pt: boolean): string => {
  const kw = c.keywords && c.keywords.length > 0 ? (pt ? `, palavras-chave: ${c.keywords.join(", ")}` : `, keywords: ${c.keywords.join(", ")}`) : "";
  return pt
    ? `- "${c.title}" com o gancho "${c.hook}" (${Math.round(c.durationSec)}s, nota ${c.score} na época${kw})`
    : `- "${c.title}" hook "${c.hook}" (${Math.round(c.durationSec)}s, scored ${c.score}${kw})`;
};

/**
 * Bloco injetado no prompt: sem memória, devolve "". O LLM é instruído a
 * generalizar o padrão em vez de fugir do texto literal — o valor de um exemplo
 * descartado está em "não quero desse tipo", não em "não quero estes títulos".
 */
export function reviewMemorySection(records: ReviewRecord[], pt: boolean): string {
  const rejected = pickExamples(records, "rejected");
  const kept = pickExamples(records, "kept");
  if (rejected.length === 0 && kept.length === 0) return "";
  if (pt) {
    let s = `\n\n[Preferências de revisão do usuário] (vêm do histórico de revisões desta máquina e servem apenas de referência — a qualidade do conteúdo continua sendo o primeiro critério. Generalize o padrão dos exemplos abaixo e ajuste na direção de "escolher menos desse tipo / escolher mais desse tipo", em vez de fugir mecanicamente do texto idêntico)`;
    if (rejected.length > 0) s += `\nCandidatos que o usuário descartou (escolha menos desse tipo):\n${rejected.map((c) => exampleLine(c, true)).join("\n")}`;
    if (kept.length > 0) s += `\nCandidatos que o usuário aprovou (escolha mais desse tipo):\n${kept.map((c) => exampleLine(c, true)).join("\n")}`;
    return s;
  }
  let s = `\n\n[User review history] (from local review records, advisory only — content quality still rules. Generalize the patterns below; adjust toward "more like kept / fewer like rejected", never just avoid identical titles)`;
  if (rejected.length > 0) s += `\nPreviously rejected (pick fewer like these):\n${rejected.map((c) => exampleLine(c, false)).join("\n")}`;
  if (kept.length > 0) s += `\nPreviously kept (pick more like these):\n${kept.map((c) => exampleLine(c, false)).join("\n")}`;
  return s;
}
