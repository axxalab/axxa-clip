/**
 * Camada de regras da porta de qualidade (v0.13): checagem determinística dos
 * defeitos evidentes — abertura solta, final que não fecha, disputa pela fala.
 * Regra de ferro: só rebaixa até review, nunca dá drop e nunca promove
 * (fail-open, porque o custo de um falso positivo das regras precisa ser pequeno).
 */
import { describe, it, expect } from "vitest";
import { openingDangles, endingUnfinished, speakerTangled, ruleGateIssues, applyRuleGate } from "../highlight/gate";
import type { Transcript } from "../transcribe/types";
import type { HighlightCandidate } from "../../shared/api-types";

function cand(over: Partial<HighlightCandidate>): HighlightCandidate {
  return {
    id: 1, startSec: 0, endSec: 20, text: "Uma frase completa.", title: "t", hook: "h",
    score: 90, reason: "", boundary: "exact", keywords: [], recommended: true, reviewNote: "",
    ...over,
  };
}

const EMPTY_TX: Transcript = { language: "pt", engine: "test", durationSec: 60, segments: [] };

describe("openingDangles (abertura solta)", () => {
  it("começar por conectivo solto é meia frase", () => {
    for (const s of ["Então a gente devolveu o dinheiro.", "Mas ele não aceitou.", "E aí deu tudo errado.", "Além disso o preço é maior.", "So we refunded it."]) {
      expect(openingDangles(s), s).toBe(true);
    }
  });
  it("abertura normal não é acusada à toa (na verdade / resumindo abrem boas frases)", () => {
    for (const s of ["Na verdade isso é bem simples.", "Você acha que o caro é melhor?", "Resumindo, é só falta de informação.", "90% das pessoas não sabem disso.", "Sochi is beautiful."]) {
      expect(openingDangles(s), s).toBe(false);
    }
  });
  it("pula as aspas de abertura antes de julgar", () => {
    expect(openingDangles('"Mas ele disse que não ia baixar o preço"')).toBe(true);
  });
});

describe("endingUnfinished (final que não fecha)", () => {
  it("terminar em vírgula, dois-pontos ou ponto e vírgula é fala inacabada", () => {
    for (const s of ["Primeiro a gente olha o primeiro,", "incluindo o material;", "os motivos são três:", "so we tried,"]) {
      expect(endingUnfinished(s), s).toBe(true);
    }
  });
  it("final normal e final sem pontuação não contam (o reconhecimento de fala perde pontuação com frequência)", () => {
    for (const s of ["Essa é a verdade inteira.", "Você acredita?", "Valeu demais!", "Ficou decidido assim"]) {
      expect(endingUnfinished(s), s).toBe(false);
    }
  });
});

describe("speakerTangled (disputa pela fala)", () => {
  const seg = (id: number, startSec: number, speaker: number): Transcript["segments"][number] => ({
    id, startSec, endSec: startSec + 2, text: "fala", words: [], speaker,
  });
  it("só conta quando a densidade de troca passa do limite (8 trocas em 20 segundos = 24 por minuto)", () => {
    const tangled: Transcript = {
      ...EMPTY_TX,
      segments: Array.from({ length: 9 }, (_, i) => seg(i + 1, i * 2.2, i % 2)),
    };
    expect(speakerTangled(tangled, { startSec: 0, endSec: 20 })).toBe(true);
  });
  it("um único falante ou sem separação é sempre false", () => {
    const single: Transcript = { ...EMPTY_TX, segments: Array.from({ length: 9 }, (_, i) => seg(i + 1, i * 2.2, 0)) };
    const unlabeled: Transcript = {
      ...EMPTY_TX,
      segments: Array.from({ length: 9 }, (_, i) => ({ ...seg(i + 1, i * 2.2, 0), speaker: undefined })),
    };
    expect(speakerTangled(single, { startSec: 0, endSec: 20 })).toBe(false);
    expect(speakerTangled(unlabeled, { startSec: 0, endSec: 20 })).toBe(false);
  });
  it("pergunta e resposta em ritmo normal não é acusada à toa (4 trocas em 60 segundos)", () => {
    const qa: Transcript = {
      ...EMPTY_TX,
      segments: Array.from({ length: 5 }, (_, i) => seg(i + 1, i * 12, i % 2)),
    };
    expect(speakerTangled(qa, { startSec: 0, endSec: 60 })).toBe(false);
  });
});

describe("ruleGateIssues / applyRuleGate", () => {
  it("candidato vindo de sinal pula as regras de texto (ele não foi cortado a partir da fala)", () => {
    expect(ruleGateIssues(EMPTY_TX, cand({ boundary: "signal", text: "Mas," }), true)).toEqual([]);
  });

  it("publish e indefinido caem para review com o motivo registrado; em review o motivo é acrescentado; drop não muda de nível", () => {
    const bad = "Mas essa coisa aqui,";
    const out = applyRuleGate(EMPTY_TX, [
      cand({ id: 1, text: bad, gate: "publish" }),
      cand({ id: 2, text: bad }), // a reavaliação não rodou, gate ficou indefinido
      cand({ id: 3, text: bad, gate: "drop", gateNotes: ["enchendo lista"] }),
      cand({ id: 4, text: "Uma frase completa.", gate: "publish" }),
    ], true);
    expect(out[0].gate).toBe("review");
    expect(out[0].gateNotes).toEqual(["abre como meia frase (conectivo solto)", "final não fecha (cortado numa vírgula)"]);
    expect(out[1].gate).toBe("review");
    expect(out[2].gate).toBe("drop"); // nunca promove
    expect(out[2].gateNotes).toEqual(["enchendo lista", "abre como meia frase (conectivo solto)", "final não fecha (cortado numa vírgula)"]);
    expect(out[3].gate).toBe("publish");
    expect(out[3].gateNotes).toBeUndefined();
  });

  it("o rebaixamento por regra não altera recommended (o estado de seleção segue só a reavaliação do LLM)", () => {
    const out = applyRuleGate(EMPTY_TX, [cand({ text: "Mas assim,", gate: "publish", recommended: true })], true);
    expect(out[0].recommended).toBe(true);
  });
});
