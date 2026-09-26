/**
 * Clímax na frente (cold-open): a frase de gancho mais forte do trecho é recortada num mini-trecho
 * colado no começo, e depois vem o trecho inteiro (que, ao chegar na posição original, repete a frase
 * como estava — a prática de sempre em programa de auditório e em canal de cortes). Quem não é segurado
 * nos 3 primeiros segundos desliza para o vídeo seguinte, e esse é o ponto vital da taxa de conclusão
 * de um vídeo curto; as ferramentas comerciais trancam o gancho por IA na assinatura paga.
 * Este módulo só decide (acha a frase de gancho e escolhe), e a colagem é feita pela camada de
 * exportação com concatClips.
 *
 * Dois tipos de mini-trecho:
 *  - planColdOpen: a **frase** de gancho na frente (1 a 4s, achada de volta na transcrição, um gancho de informação)
 *  - planFlashForward: o **flash da imagem** do estouro (0,3 a 1s, localizado pelo pico de volume, um gancho
 *    visual) — pela pesquisa de 2026, só 0,04% dos cortes da internet têm gancho visual, e o flash-forward
 *    (mostrar o fim num piscar e voltar ao começo) é uma técnica em branco, confirmada tanto pelo ofício
 *    humano quanto pelas implementações abertas.
 */
import type { TranscriptWord } from "../shared/api-types";
import { buildTokenIndex, matchQuote } from "./highlight/match";

export interface ColdOpenPlan {
  startSec: number;
  endSec: number;
}

/** Mini-trecho curto demais e quem assiste não recebe a informação (o piso usual é perto de 1 segundo / meia frase). */
export const COLD_OPEN_MIN_SEC = 1;
/** Passando de 3 ou 4 segundos sem entrar no vídeo em si, começa a perder gente (metodologia do OpusClip: entregar em 2 a 2,5 segundos). */
export const COLD_OPEN_MAX_SEC = 4;
/** Se o estouro já está perto do começo, pôr de novo na frente soa repetição mecânica; a recomendação usual é pular quando estiver a menos de 10 a 15 segundos. */
export const COLD_OPEN_SKIP_NEAR_START_SEC = 10;

/**
 * Decide qual é o trecho de cold-open deste corte: a frase de gancho é achada de volta no fluxo de
 * palavras do trecho (com o mesmo alinhamento de citação da escolha de trechos), e qualquer condição não
 * atendida devolve null (pôr na frente é um bônus, e melhor não fazer que fazer errado):
 * - a frase de gancho não foi localizada (a citação do LLM às vezes não bate com a transcrição)
 * - a frase de gancho está perto demais do começo do trecho (já é a abertura, e repetir não significa nada)
 * - o trecho ficou curto demais; e se ficar longo demais, é cortado em MAX (fechando numa borda de palavra)
 */
export function planColdOpen(
  clipWords: TranscriptWord[],
  hookText: string,
  clipStartSec: number
): ColdOpenPlan | null {
  const hook = (hookText ?? "").trim();
  if (!hook || clipWords.length === 0) return null;
  const m = matchQuote(buildTokenIndex(clipWords), hook, hook);
  if (!m) return null;
  if (m.startSec - clipStartSec < COLD_OPEN_SKIP_NEAR_START_SEC) return null;

  let endSec = m.endSec;
  if (endSec - m.startSec > COLD_OPEN_MAX_SEC) {
    // Do começo da frase são tomados MAX segundos, fechando no fim da última palavra que não passa do limite (o karaokê não corta meia palavra)
    const cap = m.startSec + COLD_OPEN_MAX_SEC;
    let snapped = m.startSec;
    for (const w of clipWords) {
      if (w.startSec >= m.startSec - 1e-3 && w.endSec <= cap + 1e-3) snapped = Math.max(snapped, w.endSec);
    }
    endSec = snapped;
  }
  if (endSec - m.startSec < COLD_OPEN_MIN_SEC) return null;
  return { startSec: m.startSec, endSec };
}

/** O trecho do flash: alguns quadros de preparação antes do pico e um pouco do que ecoa depois dele. */
export const FLASH_LEAD_SEC = 0.2;
export const FLASH_TAIL_SEC = 0.5;
/** Um flash mais curto que isto ninguém consegue enxergar (a pesquisa fala de 0,3 a 1s, e o piso vira o limite). */
export const FLASH_MIN_SEC = 0.3;
/** Se, no tempo de saída do vídeo pronto, o estouro está perto demais do começo, não há flash — ele vem aí em seguida, e o flash seria entregar o final. */
export const FLASH_SKIP_NEAR_START_SEC = 6;

/**
 * Decide o trecho do flash do estouro (flash-forward): entre os picos (em ordem decrescente de
 * intensidade, já filtrados por quem chama para tirar os perto demais do começo da saída), é escolhido o
 * primeiro em que uma janela de flash inteira cabe dentro dos intervalos preservados.
 * O que se passa são os intervalos preservados, e não o início e o fim do trecho: o que o corte seco ou a
 * colagem tiraram não deve aparecer no flash (e o vão entre pedaços de um trecho colado também fica de
 * fora naturalmente, já que um intervalo preservado não atravessa pedaços). Sem nenhuma opção, devolve
 * null, com a mesma semântica do planColdOpen: é um bônus, e melhor não fazer que fazer errado. Função pura.
 */
export function planFlashForward(
  peakAtSec: number[],
  keptSegments: Array<{ startSec: number; endSec: number }>
): ColdOpenPlan | null {
  for (const at of peakAtSec) {
    const seg = keptSegments.find((s) => at >= s.startSec && at < s.endSec);
    if (!seg) continue;
    const startSec = Math.max(seg.startSec, at - FLASH_LEAD_SEC);
    const endSec = Math.min(seg.endSec, at + FLASH_TAIL_SEC);
    // Tolerância de 1e-6: o erro de ponto flutuante do aparo na borda não pode descartar uma janela que bate exatamente no limite
    if (endSec - startSec >= FLASH_MIN_SEC - 1e-6) return { startSec, endSec };
  }
  return null;
}
