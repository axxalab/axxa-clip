/**
 * Sinal de densidade útil (o décimo caminho, v0.14): a concentração de informação
 * que "vale salvar" dentro do texto de um candidato.
 *
 * Base: em 2026, várias fontes apontam que o peso da taxa de salvamento no
 * algoritmo do Douyin passa de 40%, e a avaliação lenta de 7 dias olha
 * salvamento e volta pela busca; no TikTok o valor de busca entra no RPM do
 * programa de criadores. "Útil, salvável e buscável" é uma dimensão diferente de
 * "espetacular" — os trechos que trazem passos, listas, números concretos e
 * método fazem o público segurar para salvar e voltar depois pela busca, e esse
 * tipo de conteúdo até aqui saía perdendo numa função-objetivo focada só em
 * "destaque".
 *
 * É estatística de texto puramente heurística, sem modelo e sem custo; a nota só
 * serve para "um pequeno bônus + uma etiqueta + a direção do texto de
 * publicação", e não derruba a ordenação por potencial viral (a densidade de
 * informação é um bônus, não um substituto). São funções puras, sem dependência
 * de Node.
 */

/** Palavras que indicam passo ou ordem (em português e em inglês). */
const STEP_RE = /\b(?:primeiro|segundo|terceiro|depois|em seguida|por fim|por último|passo\s*\d+|etapa\s*\d+|step\s*\d+|first,|second,|finally)\b/gi;
/** Estrutura de lista ou contagem ("três métodos", "5 erros"). */
const LIST_RE = /\b(?:um|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|\d+)\s+(?:grandes\s+)?(?:métodos?|metodos?|técnicas?|tecnicas?|dicas?|erros?|armadilhas?|conselhos?|hábitos?|habitos?|detalhes?|passos?|etapas?|princípios?|principios?|sinais?|problemas?|motivos?|razões?|razoes?|maneiras?|formas?|tips?)\b/gi;
/** Palavras de método e de conteúdo denso. */
const METHOD_RE = /\b(?:método|metodo|técnica|tecnica|fórmula|formula|receita|passo a passo|tutorial|guia|checklist|lista de verificação|como fazer|o segredo|truque|macete|erro comum|recipe|how to)\b/gi;
/** Números concretos (preço, proporção, parâmetro — só com 2 dígitos ou mais, porque um dígito sozinho é ruído demais). */
const NUMBER_RE = /\d{2,}\s*(?:%|reais|mil|mi)?|\d+[.,]\d+/g;

export interface UtilityDensity {
  /** De 0 a 10: a nota de densidade útil. */
  score: number;
  /** As palavras que serviram de evidência (sem repetição, como explicação para a pessoa). */
  hits: string[];
}

/** A nota a partir da qual o trecho é considerado "vale salvar". */
export const UTILITY_SAVE_WORTHY = 4;
/** Teto do bônus que volta para a ordenação dos trechos (é pequeno de propósito: a densidade é um bônus, não um substituto). */
export const UTILITY_BOOST_MAX = 6;

/** Texto → densidade útil (função pura). */
export function utilityDensity(text: string): UtilityDensity {
  if (!text) return { score: 0, hits: [] };
  const hits: string[] = [];
  const seen = new Set<string>();
  const collect = (re: RegExp, cap: number): number => {
    const found = text.match(re) ?? [];
    let fresh = 0;
    for (const f of found) {
      const key = f.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      if (hits.length < 8) hits.push(f.trim());
      fresh++;
    }
    return Math.min(cap, fresh);
  };
  // A evidência estrutural (passos e listas) pesa mais; as palavras de método e os
  // números têm teto, para ninguém inflar a nota
  const score =
    collect(STEP_RE, 3) * 2 + collect(LIST_RE, 2) * 3 + collect(METHOD_RE, 3) + collect(NUMBER_RE, 3);
  return { score: Math.min(10, score), hits };
}

/** Bônus na ordenação: passando da linha, cada ponto vale +2, com teto em UTILITY_BOOST_MAX. */
export function utilityBoost(score: number): number {
  if (score < UTILITY_SAVE_WORTHY) return 0;
  return Math.min(UTILITY_BOOST_MAX, (score - UTILITY_SAVE_WORTHY + 1) * 2);
}
