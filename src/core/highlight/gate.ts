/**
 * Camada de regras da porta de qualidade (v0.13): além da reavaliação feita
 * pelo LLM, regras determinísticas pegam os "defeitos que saltam aos olhos" —
 * conectivo solto na abertura (então/mas… = meia frase), final que não fecha
 * (termina em vírgula ou ponto e vírgula) e disputa densa pela fala (frequência
 * de troca de falante acima do limite; em conversa, a taxa de acerto da IA ao
 * escolher trechos é de apenas 4 em 10).
 *
 * Conclusão de três rodadas de pesquisa: de 30% a 45% do que a IA entrega é
 * descartável, e em 2026 o preço de publicar clipe ruim é pago pela conta
 * inteira (avaliação lenta de 7 dias, teto de distribuição do canal). O papel da
 * porta de qualidade é separar "escolher" de "terminar de escolher":
 * publish = recomendado publicar / review = precisa de revisão humana /
 * drop = não recomendado publicar.
 *
 * A camada de regras só rebaixa, nunca promove, e vai no máximo até review,
 * nunca até drop (fail-open: o custo de um falso positivo das regras precisa ser
 * pequeno). Só a reavaliação do LLM pode dar drop. Funções puras, testáveis.
 */
import type { Transcript } from "../transcribe/types";
import type { HighlightCandidate } from "../../shared/api-types";
import { clipDurationSec } from "../../shared/pieces";

/** Níveis da porta de qualidade: recomendado publicar / precisa de revisão / não recomendado. */
export type GateTier = "publish" | "review" | "drop";

/**
 * Conectivos soltos: quando aparecem no começo da primeira frase do trecho,
 * indicam que a frase anterior foi cortada fora e que o público vai ouvir uma
 * meia frase. A lista só recebe palavras que quase nunca abrem uma fala
 * completa — termos como "na verdade" ou "resumindo" costumam justamente abrir
 * uma boa frase e não podem entrar aqui.
 */
const DANGLING_OPENERS_PT = [
  "por isso",
  "portanto",
  "então",
  "entao",
  "e aí",
  "e ai",
  "mas",
  "porém",
  "porem",
  "contudo",
  "todavia",
  "no entanto",
  "entretanto",
  "aí",
  "daí",
  "dai",
  "além disso",
  "alem disso",
  "e também",
  "e tambem",
  "senão",
  "senao",
  "caso contrário",
  "caso contrario",
  "em seguida",
  "logo depois",
  "outra coisa",
  "enfim",
];

const DANGLING_OPENER_EN = /^(?:so|but|and|then|also|because|however|anyway|therefore)\b/i;

/** Diz se a abertura é uma meia frase solta. */
export function openingDangles(text: string): boolean {
  const t = text.trim().replace(/^["'“‘(\(\[]+/, "");
  if (!t) return false;
  if (DANGLING_OPENER_EN.test(t)) return true;
  const lower = t.toLowerCase();
  return DANGLING_OPENERS_PT.some((w) => lower.startsWith(w));
}

/**
 * Final que não fecha: terminar em vírgula, dois-pontos, ponto e vírgula ou
 * travessão indica claramente que a fala não acabou.
 * Só os defeitos evidentes contam — "terminar sem nenhuma pontuação" não entra
 * (o reconhecimento de fala perde pontuação final com muita frequência, e o
 * falso positivo inundaria a lista).
 */
export function endingUnfinished(text: string): boolean {
  const t = text.trim().replace(/["'”’)\)\]]+$/, "");
  if (!t) return false;
  return /[,:;—–-]$/.test(t);
}

/** Limite de densidade de troca de falante (por minuto): acima disso é disputa pela fala ou conversa picotada, que sozinha o público provavelmente não entende. */
export const SPEAKER_TANGLE_PER_MIN = 10;

/**
 * Disputa densa pela fala: o número de trocas de falante dentro do candidato,
 * convertido para minutos, passa do limite.
 * Só faz sentido quando a separação de falantes foi realmente feita (2 ou mais
 * pessoas); com um único falante ou sem separação, o resultado é sempre false.
 */
export function speakerTangled(
  transcript: Transcript,
  candidate: Pick<HighlightCandidate, "startSec" | "endSec" | "pieces">
): boolean {
  const ranges =
    candidate.pieces && candidate.pieces.length > 1
      ? candidate.pieces
      : [{ startSec: candidate.startSec, endSec: candidate.endSec }];
  let switches = 0;
  let prev: number | undefined;
  let sawSpeaker = false;
  const speakers = new Set<number>();
  for (const r of ranges) {
    for (const s of transcript.segments) {
      if (s.endSec <= r.startSec || s.startSec >= r.endSec) continue;
      if (s.speaker === undefined) continue;
      sawSpeaker = true;
      speakers.add(s.speaker);
      if (prev !== undefined && s.speaker !== prev) switches++;
      prev = s.speaker;
    }
  }
  if (!sawSpeaker || speakers.size < 2) return false;
  const durMin = Math.max(1 / 60, clipDurationSec(candidate) / 60);
  return switches / durMin > SPEAKER_TANGLE_PER_MIN;
}

/** Resultado da checagem por regras de um candidato (pt define o idioma do texto de motivo mostrado ao usuário). */
export function ruleGateIssues(
  transcript: Transcript,
  candidate: HighlightCandidate,
  pt: boolean
): string[] {
  // Candidatos vindos de sinal (dança, pets etc.) não são cortados a partir da
  // fala, então as regras de texto não dizem nada sobre eles
  if (candidate.boundary === "signal") return [];
  const issues: string[] = [];
  if (openingDangles(candidate.text)) {
    issues.push(pt ? "abre como meia frase (conectivo solto)" : "opens mid-thought (dangling connective)");
  }
  if (endingUnfinished(candidate.text)) {
    issues.push(pt ? "final não fecha (cortado numa vírgula)" : "ends unfinished (cut on a comma)");
  }
  if (speakerTangled(transcript, candidate)) {
    issues.push(pt ? "muita disputa pela fala; sozinho pode não se entender" : "dense speaker overlap, may not stand alone");
  }
  return issues;
}

/**
 * Funde a conclusão da camada de regras no candidato:
 * - havendo defeito e estando em publish (ou com a reavaliação do LLM não
 *   executada, deixando gate indefinido) → rebaixa para review;
 * - nunca promove e nunca dá drop (só a reavaliação do LLM pode julgar drop);
 * - os motivos são acrescentados em gateNotes (a cadeia de evidências que a
 *   pessoa lê).
 */
export function applyRuleGate(
  transcript: Transcript,
  candidates: HighlightCandidate[],
  pt: boolean
): HighlightCandidate[] {
  return candidates.map((c) => {
    const issues = ruleGateIssues(transcript, c, pt);
    if (issues.length === 0) return c;
    const demote = c.gate === "publish" || c.gate === undefined;
    return {
      ...c,
      gate: demote ? "review" : c.gate,
      // Precisar de revisão não é o mesmo que não recomendar a exportação;
      // recommended segue apenas o keep/verdict do LLM, e o rebaixamento por
      // regra só afeta o nível exibido e o aviso na interface, sem alterar em
      // silêncio nada além do estado de seleção
      gateNotes: [...(c.gateNotes ?? []), ...issues],
    };
  });
}
