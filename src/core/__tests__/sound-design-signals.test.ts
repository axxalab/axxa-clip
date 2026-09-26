import { describe, it, expect } from "vitest";
import { findPeakEvents, type PeakTrack } from "../audio-peaks";
import { computeJumpCut } from "../gaps";
import { genrePauseGapSec, DEFAULT_PAUSE_GAP_SEC } from "../genre";
import { maxVisualGapSec, assessClipQa, PACING_MAX_GAP_SEC } from "../qa";
import { buildCaptionAss, minimalText, VERTICAL_LAYOUT } from "../subtitle";
import type { TranscriptWord } from "../../shared/api-types";

function w(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec };
}

/** Trilha de picos feita à mão: cada valor de values vale 1/30s, contado de startSec. */
function track(values: number[], startSec = 0): PeakTrack {
  return { values: Float32Array.from(values), startSec, hopSec: 1 / 30 };
}

describe("findPeakEvents (extração dos picos)", () => {
  it("os blocos acima de 75% do pico mais alto viram um evento, ordenados do maior pico para o menor", () => {
    // 30 blocos de silêncio + 6 blocos altos (perto de t=1,0s) + 30 de silêncio + 3 do segundo mais alto (t≈2,2s)
    const values = [...Array(30).fill(0.02), 0.7, 0.9, 0.8, 0.75, 0.72, 0.7, ...Array(30).fill(0.02), 0.71, 0.7, 0.69];
    const events = findPeakEvents(track(values));
    expect(events.length).toBe(2);
    expect(events[0].peak).toBeCloseTo(0.9, 5);
    expect(events[0].atSec).toBeCloseTo(31 / 30, 3);
    expect(events[1].peak).toBeCloseTo(0.71, 5);
  });

  it("material quase todo em silêncio devolve vazio (não há alto de emoção nenhum)", () => {
    expect(findPeakEvents(track(Array(60).fill(0.03)))).toHaveLength(0);
  });
});

describe("guarda de emoção do computeJumpCut (protectedSpans)", () => {
  // fala de 10 a 12s, 3s de pausa em silêncio, e fala de 15 a 17 — ou seja, o vão vai de 12 a 15
  const words = [w("preparação", 10, 12), w("piada", 15, 17)];

  it("o vão a remover que encosta num intervalo protegido não é cortado (a respirada antes da piada tem de ficar)", () => {
    const base = computeJumpCut(words, 10, 17);
    expect(base.segments.length).toBe(2); // sem guarda: o silêncio é cortado
    const guarded = computeJumpCut(words, 10, 17, {
      protectedSpans: [{ startSec: 14.0, endSec: 16.0 }], // o pico da piada ±1s
    });
    expect(guarded.segments.length).toBe(1); // com guarda: o trecho fica inteiro
    expect(guarded.removedSec).toBe(0);
  });

  it("o intervalo protegido não mexe num vão que não o cruza", () => {
    const guarded = computeJumpCut(words, 10, 17, {
      protectedSpans: [{ startSec: 20, endSec: 22 }],
    });
    expect(guarded.segments.length).toBe(2);
  });
});

describe("genrePauseGapSec (faixa de pausa por categoria)", () => {
  it("narração é faixa rápida, conversa é faixa lenta e categoria desconhecida volta ao padrão", () => {
    expect(genrePauseGapSec("esports")).toBeLessThan(DEFAULT_PAUSE_GAP_SEC);
    expect(genrePauseGapSec("interview")).toBeGreaterThan(DEFAULT_PAUSE_GAP_SEC);
    expect(genrePauseGapSec("auto")).toBe(DEFAULT_PAUSE_GAP_SEC);
    expect(genrePauseGapSec(undefined)).toBe(DEFAULT_PAUSE_GAP_SEC);
    // o id antigo passa pela mesma normalização (live-sell → shopping)
    expect(genrePauseGapSec("live-sell")).toBe(genrePauseGapSec("shopping"));
  });
});

describe("sinal de ritmo da verificação de qualidade", () => {
  it("maxVisualGapSec: o maior intervalo entre eventos (contando o começo e o fim)", () => {
    expect(maxVisualGapSec([], 30)).toBe(30);
    expect(maxVisualGapSec([10, 20], 30)).toBe(10);
    expect(maxVisualGapSec([3], 30)).toBe(27);
  });

  it("passar do teto de 5s gera o aviso de ritmo; não avaliado (null) não avisa", () => {
    const base = {
      durationSec: 30,
      expectedDurationSec: 30,
      blackSpans: [],
      silenceSpans: [],
      loudness: null,
      loudnessNormalized: false,
      midWordCuts: null,
    };
    const warn = assessClipQa({ ...base, pacingGapSec: PACING_MAX_GAP_SEC + 3 });
    expect(warn.status).toBe("warn");
    expect(warn.issues.some((i) => i.includes("sem mudança visual"))).toBe(true);
    expect(warn.pacingGapSec).toBe(PACING_MAX_GAP_SEC + 3);
    const pass = assessClipQa({ ...base, pacingGapSec: null });
    expect(pass.status).toBe("pass");
    expect(pass.pacingGapSec).toBeNull();
  });
});

describe("legenda minimalista dinâmica (minimal)", () => {
  const words = [w("esse", 0, 0.4), w("método", 0.4, 0.8), w("economiza", 0.8, 1.0), w("300reais", 1.0, 1.5)];

  it("no máximo 1 destaque por bloco: a palavra-chave primeiro, o número depois", () => {
    // Palavra-chave encontrada: «método» é colorido e o número já não é
    const kw = minimalText(words, ["método"], "#00FF00");
    expect(kw.indexOf("\\c&H00FF00&")).toBeGreaterThanOrEqual(0);
    expect(kw.split("\\c&H00FF00&").length).toBe(2); // o destaque abre uma única vez
    // Sem palavra-chave: o token numérico «300reais» é colorido como reserva
    const digit = minimalText(words, [], undefined);
    expect(digit).toContain("300reais");
    expect(digit.split("\\fscx108").length).toBe(2);
  });

  it("buildCaptionAss usa blocos curtos e não passa tudo para maiúsculas", () => {
    const latin = [w("Save", 0, 0.4), w("Money", 0.4, 0.8)];
    const ass = buildCaptionAss(latin, 0, VERTICAL_LAYOUT, "minimal", {});
    expect(ass).toContain("\\fscx96"); // entrada de leve
    expect(ass).toContain("Save"); // não vira SAVE como no hormozi
    expect(ass).not.toContain("SAVE");
  });

  it("o estilo minimal tem contorno mais fino e uma sombra suave (linha de estilo)", () => {
    const ass = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "minimal", {});
    const styleLine = ass.split("\n").find((l) => l.startsWith("Style: Caption"))!;
    const cols = styleLine.split(",");
    // Coluna Outline = 2 (VERTICAL_LAYOUT.outline 4 - 2) e coluna Shadow = 1
    expect(Number(cols[16])).toBe(2);
    expect(Number(cols[17])).toBe(1);
  });
});
