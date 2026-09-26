import { describe, it, expect } from "vitest";
import { planColdOpen, COLD_OPEN_MAX_SEC, COLD_OPEN_MIN_SEC } from "../coldopen";
import type { TranscriptWord } from "../../shared/api-types";

/** Fluxo de palavras de 0,5s cada, a partir de startSec. */
function words(text: string, startSec: number, perWord = 0.5): TranscriptWord[] {
  return text.split(" ").map((piece, i) => ({
    text: piece,
    startSec: startSec + i * perWord,
    endSec: startSec + (i + 1) * perWord,
  }));
}

describe("planColdOpen", () => {
  // O trecho começa em 100s, os 12 primeiros segundos são preparação, e a frase de gancho
  // «eu jogo meio copo de água e não passa nada» começa em 112s
  const clipStart = 100;
  const clipWords = [
    ...words("hoje eu trouxe um papel toalha muito bom de três camadas que não rasga molhado seis sete oito nove", clipStart),
    ...words("eu jogo meio copo de água e não passa nada", 112),
  ];

  it("localiza a frase de gancho e devolve o intervalo nas bordas das palavras (10 palavras × 0,5s = 5s, acima do MAX de 4s, cortado em 116s)", () => {
    const p = planColdOpen(clipWords, "eu jogo meio copo de água e não passa nada", clipStart);
    expect(p).not.toBeNull();
    expect(p!.startSec).toBeCloseTo(112, 3);
    expect(p!.endSec).toBeCloseTo(116, 3);
  });

  it("frase de gancho comprida demais: cortada do começo até o MAX, fechando numa borda de palavra", () => {
    const p = planColdOpen(clipWords, "eu jogo meio copo de água e não passa nada", clipStart)!;
    expect(p.endSec - p.startSec).toBeLessThanOrEqual(COLD_OPEN_MAX_SEC + 1e-6);
    // Fechamento na borda da palavra: endSec tem de ser igual ao endSec de alguma palavra
    expect(clipWords.some((w) => Math.abs(w.endSec - p.endSec) < 1e-6)).toBe(true);
  });

  it("gancho perto demais do começo do trecho (<10s) → pulado", () => {
    const near = [
      ...words("so a abertura", 100),
      ...words("o estouro está aqui", 103),
      ...words("e a conversa continua depois", 108),
    ];
    expect(planColdOpen(near, "o estouro está aqui", 100)).toBeNull();
  });

  it("gancho não localizado / vazio / trecho curto demais → null (melhor não fazer que fazer errado)", () => {
    expect(planColdOpen(clipWords, "essa frase não existe na transcrição", clipStart)).toBeNull();
    expect(planColdOpen(clipWords, "", clipStart)).toBeNull();
    expect(planColdOpen([], "eu jogo", clipStart)).toBeNull();
    // Encontrado, mas com uma palavra só (0,5s < MIN = 1s)
    const tiny = [
      ...words("uma preparação bem longa falando sem parar por um tempão até aqui", 100),
      ...words("explodiu", 115),
    ];
    expect(planColdOpen(tiny, "explodiu", 100)).toBeNull();
    expect(COLD_OPEN_MIN_SEC).toBeGreaterThan(0.5);
  });

  it("citação com pontuação ou caixa diferente da transcrição ainda alinha (a mesma comparação normalizada da escolha de trechos)", () => {
    const p = planColdOpen(clipWords, "Eu jogo meio copo de água, e não passa nada!", clipStart);
    expect(p).not.toBeNull();
    expect(p!.startSec).toBeCloseTo(112, 3);
  });
});
