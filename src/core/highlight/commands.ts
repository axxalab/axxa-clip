/**
 * Marcação do pedido de corte de quem transmite (voice-activated clipping, a nova
 * tendência das ferramentas de corte em 2026): quando a pessoa diz ao vivo, com as
 * próprias palavras, "corta esse pedaço", "clipa isso" ou "clip that", é como se
 * ela certificasse um destaque em tempo real — é a marcação humana mais direta de
 * todos os sinais, e custa zero (é varredura só de texto, sem rodar modelo).
 *
 * ⚠ Como o riso do público, o pedido é uma "marca atrasada": o conteúdo a cortar
 * aconteceu **antes** dele.
 * Aqui o trabalho é apenas achar o instante em que o pedido apareceu; como voltar
 * para achar o conteúdo é o que o prompt explica ao LLM (veja o bloco
 * clipCommandMarks de renderSignals em prompt.ts).
 *
 * São funções puras, testáveis. O custo de um falso positivo é baixo (só uma linha
 * a mais de evidência no prompt, e o LLM ainda vai conferir o que veio antes),
 * então os padrões são deliberadamente um pouco abertos; mas há exclusão negativa
 * das expressões corriqueiras de alta frequência, para a tela não encher de pedido
 * falso.
 */
import type { Transcript } from "../transcribe/types";

/** Intervalo mínimo entre dois pedidos: quando a mesma fala é quebrada em vários trechos, só um é registrado. */
export const COMMAND_MIN_GAP_SEC = 20;
/** Teto de pedidos: passar disso indica enxurrada de falso positivo (ou um bordão de quem transmite), então o corte evita estourar o prompt. */
export const COMMAND_MAX_MARKS = 12;

/**
 * Padrões em português:
 *  1. Referência ao trecho + verbo de cortar: "corta esse pedaço", "clipa esse
 *     trecho", "recorta essa parte" — com exclusão dos usos corriqueiros do tipo
 *     "corta o barato" ou "corta essa relação", que não são pedido de corte;
 *  2. Verbo de cortar + complemento de corte: "tira um corte disso", "faz um
 *     clipe disso", "vira corte", "manda pro corte";
 *  3. Prefixo imperativo + verbo de cortar: "lembra de cortar", "me corta isso",
 *     "depois corta", "na edição corta", "galera do corte, corta isso".
 * Padrões em inglês: clip that / clip this / clip it / that's a clip / someone clip…
 */
const PT_PATTERNS: RegExp[] = [
  /\b(?:corta|corte|clipa|clipe|recorta)\s+(?:a[íi]|isso|isto|esse|essa|este|esta|aquele|aquela)\s*(?:peda[çc]o|trecho|parte|momento|peda[çc]inho)?\b(?!\s+(?:barato|rela[çc][ãa]o|mal|papo\s+furado))/i,
  /\b(?:tira|faz|fa[çc]a|gera|manda|salva|guarda)\s+(?:um\s+|o\s+|pro\s+|pra\s+|para\s+o\s+)?(?:corte|clipe|clip)\b/i,
  /\bvira\s+(?:um\s+)?(?:corte|clipe)\b/i,
  /\b(?:lembra\s+de|lembre\s+de|depois|na\s+edi[çc][ãa]o|galera\s+do\s+corte|pessoal\s+do\s+corte|time\s+de\s+edi[çc][ãa]o)\b[^.!?]{0,20}?\b(?:corta|cortar|clipa|clipar|recorta|recortar)\b/i,
  /\b(?:me|pra\s+mim)\s+(?:corta|clipa|recorta)\b/i,
];

const EN_PATTERNS: RegExp[] = [
  /\bclip\s+(?:that|this|it)\b/i,
  /\b(?:that|this)(?:'s|\s+is)\s+(?:a\s+)?clip\b/i,
  /\bsomeone\s+clip\b/i,
];

/** Diz se uma fala contém um pedido de corte. */
export function isClipCommand(text: string): boolean {
  if (!text) return false;
  return PT_PATTERNS.some((p) => p.test(text)) || EN_PATTERNS.some((p) => p.test(text));
}

/**
 * Varre a transcrição inteira em busca dos instantes de pedido: devolve o tempo de
 * início das falas encontradas (em ordem crescente), removendo as que estão perto
 * demais uma da outra e cortando o total no teto.
 */
export function detectClipCommands(transcript: Transcript): number[] {
  const marks: number[] = [];
  for (const seg of transcript.segments) {
    if (!isClipCommand(seg.text)) continue;
    const last = marks[marks.length - 1];
    if (last !== undefined && seg.startSec - last < COMMAND_MIN_GAP_SEC) continue;
    marks.push(seg.startSec);
    if (marks.length >= COMMAND_MAX_MARKS) break;
  }
  return marks;
}
