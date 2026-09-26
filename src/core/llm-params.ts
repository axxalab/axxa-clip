/**
 * Compatibilidade dos parâmetros de amostragem entre endpoints "compatíveis com OpenAI".
 *
 * O problema concreto: as gerações novas da OpenAI (GPT-5, série o) **recusam** dois parâmetros que
 * todo cliente compatível manda desde sempre, e recusam com HTTP 400, não com um aviso:
 *   - `max_tokens` → "Unsupported parameter: 'max_tokens' is not supported with this model.
 *     Use 'max_completion_tokens' instead."
 *   - `temperature: 0.6` → "Unsupported value: 'temperature' does not support 0.6 with this model.
 *     Only the default (1) is supported."
 * Com isso, escolher o preset da OpenAI fazia TODA chamada falhar, sem caminho de volta.
 *
 * A solução é recuar pelo que o erro diz, não por uma lista de nomes de modelo: nome de modelo muda
 * toda semana, e a mensagem do 400 é que aponta o parâmetro. O recuo aprendido fica guardado por
 * endpoint+modelo, de modo que o custo seja uma requisição perdida uma vez, e não a cada chamada.
 */

export interface LlmParamCompat {
  /** O provedor quer `max_completion_tokens` no lugar de `max_tokens`. */
  completionTokens: boolean;
  /** O provedor só aceita a temperatura padrão dele — o campo tem de sair. */
  defaultTemperature: boolean;
  /** O provedor recusa o parâmetro que desliga o raciocínio (`enable_thinking`). */
  noThinkingParam: boolean;
}

export const DEFAULT_COMPAT: LlmParamCompat = {
  completionTokens: false,
  defaultTemperature: false,
  noThinkingParam: false,
};

/** Monta os campos de orçamento e de amostragem do corpo, conforme o que o endpoint aceita. */
export function samplingParams(compat: LlmParamCompat, maxTokens: number, temperature: number): Record<string, unknown> {
  return {
    ...(compat.completionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(compat.defaultTemperature ? {} : { temperature }),
  };
}

/**
 * Lê a mensagem de um 400 e devolve o recuo seguinte, ou null quando o erro não é de parâmetro
 * (aí quem chamou lança como está, em vez de gastar requisição à toa).
 *
 * As marcas são propositalmente estreitas: um "max_tokens too large" é o orçamento pedido passando
 * do limite do modelo, e não um parâmetro sem suporte — trocar o nome do campo não resolveria nada.
 */
export function advanceCompat(message: string, compat: LlmParamCompat): LlmParamCompat | null {
  if (!/HTTP 400/i.test(message)) return null;
  const unsupported = /unsupported (?:parameter|value)|is not supported|does not support|unknown parameter|unrecognized/i.test(message);

  if (!compat.completionTokens && (/max_completion_tokens/i.test(message) || (unsupported && /max_tokens/i.test(message)))) {
    return { ...compat, completionTokens: true };
  }
  if (!compat.defaultTemperature && /temperature/i.test(message) && (unsupported || /only the default/i.test(message))) {
    return { ...compat, defaultTemperature: true };
  }
  if (!compat.noThinkingParam && (/enable_thinking/i.test(message) || (unsupported && /thinking/i.test(message)))) {
    return { ...compat, noThinkingParam: true };
  }
  return null;
}

/** Quantos recuos de parâmetro cabem numa chamada — há três campos ajustáveis, e nada além disso. */
export const MAX_PARAM_RETRIES = 3;

const learned = new Map<string, LlmParamCompat>();

/** A chave é o par endpoint+modelo: o mesmo host serve modelos com exigências diferentes. */
export function compatKey(baseUrl: string, model: string): string {
  return `${baseUrl.replace(/\/+$/, "")}|${model}`;
}

export function recallCompat(baseUrl: string, model: string): LlmParamCompat {
  return learned.get(compatKey(baseUrl, model)) ?? DEFAULT_COMPAT;
}

export function rememberCompat(baseUrl: string, model: string, compat: LlmParamCompat): void {
  learned.set(compatKey(baseUrl, model), compat);
}

/** Esquece o que foi aprendido (usado pelo teste; o processo em si nunca precisa disso). */
export function resetCompat(): void {
  learned.clear();
}
