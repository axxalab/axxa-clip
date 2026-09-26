/**
 * O 400 das gerações novas da OpenAI: `max_tokens` e uma temperatura fora do padrão são recusados,
 * e sem recuo TODA chamada falha. As mensagens aqui são as que a API devolve de verdade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatComplete } from "../highlight/detect";
import { advanceCompat, DEFAULT_COMPAT, recallCompat, resetCompat, samplingParams } from "../llm-params";

const OPENAI = { baseUrl: "https://api.openai.com/v1", apiKey: "sk-x", model: "gpt-5.6-luna" };

const bodies = (mock: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> =>
  mock.mock.calls.map((c) => JSON.parse((c as [string, { body: string }])[1].body) as Record<string, unknown>);

const ok = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });

const UNSUPPORTED_MAX_TOKENS =
  "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
const UNSUPPORTED_TEMPERATURE =
  "Unsupported value: 'temperature' does not support 0.6 with this model. Only the default (1) is supported.";

beforeEach(() => resetCompat());
afterEach(() => { vi.unstubAllGlobals(); resetCompat(); });

describe("advanceCompat", () => {
  it("reconhece o pedido de trocar max_tokens por max_completion_tokens", () => {
    expect(advanceCompat(`HTTP 400: ${UNSUPPORTED_MAX_TOKENS}`, DEFAULT_COMPAT)).toMatchObject({ completionTokens: true });
  });

  it("reconhece a temperatura travada no padrão", () => {
    expect(advanceCompat(`HTTP 400: ${UNSUPPORTED_TEMPERATURE}`, DEFAULT_COMPAT)).toMatchObject({ defaultTemperature: true });
  });

  it("«max_tokens too large» é orçamento demais, não parâmetro sem suporte — trocar o nome não resolveria", () => {
    expect(advanceCompat("HTTP 400: max_tokens too large", DEFAULT_COMPAT)).toBeNull();
  });

  it("um erro que não é 400 nunca vira recuo de parâmetro", () => {
    expect(advanceCompat(`HTTP 401: ${UNSUPPORTED_MAX_TOKENS}`, DEFAULT_COMPAT)).toBeNull();
    expect(advanceCompat("HTTP 429: rate limited", DEFAULT_COMPAT)).toBeNull();
  });

  it("não recua duas vezes o mesmo campo (senão o laço nunca terminaria)", () => {
    const already = { ...DEFAULT_COMPAT, completionTokens: true };
    expect(advanceCompat(`HTTP 400: ${UNSUPPORTED_MAX_TOKENS}`, already)).toBeNull();
  });
});

describe("samplingParams", () => {
  it("manda max_tokens e temperature por padrão", () => {
    expect(samplingParams(DEFAULT_COMPAT, 4000, 0.6)).toEqual({ max_tokens: 4000, temperature: 0.6 });
  });

  it("troca o campo de orçamento e retira a temperatura quando o provedor exige", () => {
    expect(samplingParams({ ...DEFAULT_COMPAT, completionTokens: true, defaultTemperature: true }, 4000, 0.6))
      .toEqual({ max_completion_tokens: 4000 });
  });
});

describe("chatComplete contra um endpoint que recusa os dois parâmetros", () => {
  it("recua uma vez por campo e entrega o conteúdo, em vez de falhar", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(UNSUPPORTED_MAX_TOKENS, { status: 400 }))
      .mockResolvedValueOnce(new Response(UNSUPPORTED_TEMPERATURE, { status: 400 }))
      .mockResolvedValueOnce(ok('{"clips":[]}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatComplete(OPENAI, "s", "u")).resolves.toBe('{"clips":[]}');
    const sent = bodies(fetchMock);
    expect(sent).toHaveLength(3);
    expect(sent[0].max_tokens).toBeTypeOf("number");
    expect(sent[1].max_completion_tokens).toBeTypeOf("number");
    expect(sent[1].max_tokens).toBeUndefined();
    expect(sent[2].max_completion_tokens).toBeTypeOf("number");
    expect(sent[2].temperature).toBeUndefined();
  });

  it("o que foi aprendido vale para a chamada seguinte — o recuo custa uma requisição, não todas", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(UNSUPPORTED_MAX_TOKENS, { status: 400 }))
      .mockResolvedValue(ok('{"clips":[]}')));
    await chatComplete(OPENAI, "s", "u");
    expect(recallCompat(OPENAI.baseUrl, OPENAI.model)).toMatchObject({ completionTokens: true });

    const second = vi.fn().mockResolvedValue(ok('{"clips":[]}'));
    vi.stubGlobal("fetch", second);
    await chatComplete(OPENAI, "s", "u");
    expect(second).toHaveBeenCalledTimes(1);
    expect(bodies(second)[0].max_completion_tokens).toBeTypeOf("number");
  });

  it("o aprendizado é por endpoint+modelo, e não vaza para outro modelo do mesmo host", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(UNSUPPORTED_MAX_TOKENS, { status: 400 }))
      .mockResolvedValue(ok("x")));
    await chatComplete(OPENAI, "s", "u");
    expect(recallCompat(OPENAI.baseUrl, "gpt-4.1")).toEqual(DEFAULT_COMPAT);
  });

  it("um 400 que não é de parâmetro continua subindo na hora, sem gastar requisição extra", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("invalid api key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatComplete(OPENAI, "s", "u")).rejects.toThrow("HTTP 401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
