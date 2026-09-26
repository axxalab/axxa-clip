/**
 * Marcação do pedido de corte de quem transmite (v0.13): "corta esse pedaço" ou
 * "clip that" é um destaque certificado pela própria pessoa.
 * O custo de um falso positivo é baixo (só uma linha a mais de evidência no
 * prompt), mas as expressões corriqueiras de alta frequência ("corta o barato",
 * "corta essa relação") precisam ficar de fora, senão uma enxurrada de pedido falso
 * dilui o sinal de verdade.
 */
import { describe, it, expect } from "vitest";
import { isClipCommand, detectClipCommands, COMMAND_MAX_MARKS } from "../highlight/commands";
import type { Transcript } from "../transcribe/types";

function tx(sentences: Array<[string, number]>): Transcript {
  return {
    language: "pt",
    engine: "test",
    durationSec: sentences[sentences.length - 1]?.[1] ?? 0,
    segments: sentences.map(([text, startSec], i) => ({
      id: i + 1,
      startSec,
      endSec: startSec + 3,
      text,
      words: [],
    })),
  };
}

describe("isClipCommand", () => {
  it("encontra os pedidos de corte mais comuns em português", () => {
    for (const s of [
      "corta esse pedaço",
      "corta esse trecho para postar no TikTok",
      "clipa essa parte aí",
      "lembra de cortar isso depois",
      "faz um clipe disso",
      "na edição corta esse trecho",
      "recorta essa parte que vai bombar",
      "manda pro corte",
      "me corta isso",
      "isso vira corte",
    ]) {
      expect(isClipCommand(s), s).toBe(true);
    }
  });

  it("encontra os pedidos em inglês", () => {
    for (const s of ["clip that", "someone clip this moment", "that's a clip right there", "CLIP IT"]) {
      expect(isClipCommand(s), s).toBe(true);
    }
  });

  it("não acusa expressões do dia a dia", () => {
    for (const s of [
      "nesse período eu editei muito vídeo",
      "vamos mudar para o próximo assunto",
      "eu normalmente uso outro editor",
      "é só cortar ao meio que já dá para comer",
      "corta o barato aí, gente",
      "essa relação me fez crescer muito",
      "a clip from yesterday", // uso como substantivo
      "hoje a gente vai falar de técnicas de edição",
    ]) {
      expect(isClipCommand(s), s).toBe(false);
    }
  });
});

describe("detectClipCommands", () => {
  it("devolve o instante das falas encontradas, e duas próximas contam só uma vez", () => {
    const t = tx([
      ["olá, pessoal", 0],
      ["corta esse pedaço", 100],
      ["isso, clipa essa parte mesmo", 110], // a menos de 20s da anterior, então é removida
      ["conversa normal", 200],
      ["clip that", 300],
    ]);
    expect(detectClipCommands(t)).toEqual([100, 300]);
  });

  it("corta o total para não encher a lista quando isso virar bordão", () => {
    const many = Array.from({ length: 40 }, (_, i) => ["corta esse pedaço", i * 30] as [string, number]);
    expect(detectClipCommands(tx(many))).toHaveLength(COMMAND_MAX_MARKS);
  });

  it("sem nenhum pedido, devolve um array vazio", () => {
    expect(detectClipCommands(tx([["hoje a gente vai falar de curadoria de produto", 0]]))).toEqual([]);
  });
});
