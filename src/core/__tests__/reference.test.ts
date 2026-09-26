import { describe, it, expect } from "vitest";
import { buildReferenceProfile, referencePromptSection } from "../reference";
import type { Transcript } from "../../shared/api-types";

/** Fábrica mínima de transcrição frase a frase (words vazio — o perfil só usa dados no nível da frase). */
const t = (
  segments: Array<{ start: number; end: number; text: string }>,
  language = "pt",
  durationSec?: number
): Transcript => ({
  language,
  engine: "test",
  durationSec: durationSec ?? (segments.length > 0 ? segments[segments.length - 1].end : 0),
  segments: segments.map((s, i) => ({ id: i + 1, startSec: s.start, endSec: s.end, text: s.text, words: [] })),
});

describe("buildReferenceProfile (medição do perfil)", () => {
  it("português conta palavras: a velocidade usa o tempo de fala, o tamanho da frase é a média e o gancho vem da primeira frase", () => {
    // Duas frases de 6 palavras cada; tempo de fala 4s+4s=8s → 1,5 palavra/segundo
    const p = buildReferenceProfile(
      t([
        { start: 0, end: 4, text: "você acredita que esse preço é" }, // 6 palavras
        { start: 5, end: 9, text: "hoje eu vou falar tudo claramente" }, // 6 palavras
      ]),
      [1.2, 3.4, 6.8]
    );
    expect(p.charUnits).toBe(false);
    expect(p.durationSec).toBe(9);
    expect(p.speechRate).toBe(1.5); // 12 palavras / 8 segundos de fala, com uma casa decimal
    expect(p.avgSentenceLen).toBe(6);
    expect(p.hookLine).toBe("você acredita que esse preço é");
    // 3 limites de plano / 9 segundos = 20 trocas por minuto
    expect(p.cutsPerMin).toBeCloseTo(20, 0);
  });

  it("inglês também conta palavras; a dimensão de plano fica null quando a detecção falha", () => {
    const p = buildReferenceProfile(
      t([{ start: 0, end: 5, text: "you will not believe this price" }], "en"),
      null
    );
    expect(p.charUnits).toBe(false);
    expect(p.speechRate).toBeCloseTo(6 / 5, 1);
    expect(p.avgSentenceLen).toBe(6);
    expect(p.cutsPerMin).toBeNull();
  });

  it("transcrição vazia não quebra nada: o perfil sai todo zerado", () => {
    const p = buildReferenceProfile(t([]), []);
    expect(p.durationSec).toBe(0);
    expect(p.speechRate).toBe(0);
    expect(p.avgSentenceLen).toBe(0);
    expect(p.cutsPerMin).toBeNull(); // com durationSec ≤ 3 a frequência de troca não é calculada
    expect(p.hookLine).toBe("");
  });
});

describe("referencePromptSection (bloco do prompt)", () => {
  const profile = buildReferenceProfile(
    t([
      { start: 0, end: 10, text: "você acredita que esse preço é" },
      { start: 10, end: 30, text: "hoje eu vou falar tudo sem enrolação nenhuma" },
    ]),
    Array.from({ length: 15 }, (_, i) => i * 2)
  );

  it("bloco em português: traz as dimensões medidas, a duração alvo com ±30% e declara que é preferência, não regra rígida", () => {
    const s = referencePromptSection(profile, true);
    expect(s).toContain("Perfil do corte de referência");
    expect(s).toContain("duração de 30 segundos");
    expect(s).toContain("21 a 39 segundos"); // ±30% de 30
    expect(s).toContain("30 trocas de plano por minuto");
    expect(s).toContain("você acredita que esse preço é");
    expect(s).toContain("preferência, não uma restrição rígida");
  });

  it("bloco em inglês: também traz a faixa alvo e a declaração de que não é regra rígida", () => {
    const s = referencePromptSection(profile, false);
    expect(s).toContain("Reference clip profile");
    expect(s).toContain("21–39s");
    expect(s).toContain("not a hard rule");
  });

  it("quando a dimensão de plano não existe, o item não é impresso", () => {
    const noCuts = { ...profile, cutsPerMin: null };
    expect(referencePromptSection(noCuts, true)).not.toContain("trocas de plano");
  });
});
