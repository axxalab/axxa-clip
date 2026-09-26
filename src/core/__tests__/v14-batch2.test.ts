/**
 * A segunda leva da v0.14: a etiqueta de falante na legenda (para assistir a uma conversa sem som), o respiro preservado no corte seco e a perturbação controlada do modelo.
 */
import { describe, it, expect } from "vitest";
import { buildCaptionAss, createSpeakerLabeler, lineSpeaker, VERTICAL_LAYOUT } from "../subtitle";
import { computeJumpCut } from "../gaps";
import { perturbLayout, fnv1a, mulberry32, JITTER_FONT_SPAN, JITTER_BASELINE_FRAC, JITTER_MARGIN_H_PX } from "../../shared/perturb";
import type { TranscriptWord } from "../../shared/api-types";

const w = (text: string, startSec: number, endSec: number, speaker?: number): TranscriptWord =>
  speaker === undefined ? { text, startSec, endSec } : { text, startSec, endSec, speaker };

describe("lineSpeaker (quem domina a fala na linha)", () => {
  it("vence a maioria por duração das palavras; sem marcação devolve undefined", () => {
    expect(lineSpeaker([w("curta", 0, 0.2, 1), w("bem mais longa", 0.2, 2, 0)])).toBe(0);
    expect(lineSpeaker([w("sem marcacao", 0, 1)])).toBeUndefined();
  });
});

describe("createSpeakerLabeler (o etiquetador de falante)", () => {
  const twoSpeakers = [w("oi.", 0, 1, 0), w("tá aí?", 1, 2, 1), w("tô sim.", 2, 3, 1)];
  it("a etiqueta só aparece quando troca quem fala, e linhas seguidas da mesma pessoa não enchem a tela; as letras seguem a ordem da primeira fala", () => {
    const label = createSpeakerLabeler(twoSpeakers, true);
    expect(label([twoSpeakers[0]])).toContain("A:");
    expect(label([twoSpeakers[1]])).toContain("B:");
    expect(label([twoSpeakers[2]])).toBe(""); // continua sendo o B falando
  });
  it("quem fala primeiro é sempre A (independente do número do agrupamento do diarize)", () => {
    const ids = [w("um", 0, 1, 3), w("dois", 1, 2, 0)];
    const label = createSpeakerLabeler(ids, true);
    expect(label([ids[0]])).toContain("A:");
    expect(label([ids[1]])).toContain("B:");
  });
  it("com um falante só, ou com a opção desligada, nenhuma etiqueta sai", () => {
    const solo = [w("um", 0, 1, 0), w("dois", 1, 2, 0)];
    expect(createSpeakerLabeler(solo, true)([solo[0]])).toBe("");
    expect(createSpeakerLabeler(twoSpeakers, false)([twoSpeakers[0]])).toBe("");
  });
  it("as etiquetas de A e de B têm cores diferentes", () => {
    const label = createSpeakerLabeler(twoSpeakers, true);
    const a = label([twoSpeakers[0]]);
    const b = label([twoSpeakers[1]]);
    const colorOf = (tag: string): string => tag.match(/\\c(&H[0-9A-F]+&)/i)?.[1] ?? "";
    expect(colorOf(a)).not.toBe("");
    expect(colorOf(a)).not.toBe(colorOf(b));
  });
});

describe("buildCaptionAss + etiqueta de falante", () => {
  const words = [w("oi.", 0, 1, 0), w("tá aí?", 1.2, 2, 1), w("tô sim.", 2.2, 3, 1)];
  it("estilo keyword: ao trocar quem fala, a etiqueta colorida sai no começo da linha, uma vez para cada", () => {
    const ass = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "keyword", { speakerLabels: true });
    expect(ass.match(/\\fscy85\}A:\{/g)).toHaveLength(1);
    expect(ass.match(/\\fscy85\}B:\{/g)).toHaveLength(1);
  });
  it("o estilo pop, de blocos curtos, também leva etiqueta; desligado, não leva", () => {
    const withTag = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "pop", { speakerLabels: true });
    expect(withTag).toContain("}A:{");
    const off = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "keyword", {});
    expect(off).not.toContain("}A:{");
  });
});

describe("computeJumpCut: manter o respiro + repassar o falante", () => {
  const words = [w("aaa", 0.5, 5, 0), w("bbb", 7, 9, 1)];
  it("breathPadSec deixa um fôlego em cada emenda (a diferença de duração é exatamente o respiro)", () => {
    const tight = computeJumpCut(words, 0, 10, {});
    const breath = computeJumpCut(words, 0, 10, { breathPadSec: 0.25 });
    expect(tight.segments).toHaveLength(2);
    expect(breath.segments).toHaveLength(2);
    expect(breath.durationSec).toBeCloseTo(tight.durationSec + 0.25, 5);
    expect(breath.removedSec).toBeCloseTo(tight.removedSec - 0.25, 5);
  });
  it("as palavras da linha de tempo comprimida preservam a marcação de falante (é dela que dependem a etiqueta e a cor da legenda)", () => {
    const plan = computeJumpCut(words, 0, 10, {});
    expect(plan.words.map((x) => x.speaker)).toEqual([0, 1]);
  });
});

describe("perturbLayout (perturbação controlada do modelo)", () => {
  const base = { playResX: 1080, playResY: 1920, fontSize: 78, marginV: 560, marginH: 60, outline: 4, maxLineUnits: 22 };
  it("a mesma semente se reproduz de forma determinística, sem alterar o que entrou", () => {
    const a = perturbLayout(base, "video.mp4#1");
    const b = perturbLayout(base, "video.mp4#1");
    expect(a).toEqual(b);
    expect(base.fontSize).toBe(78);
    expect(base.marginV).toBe(560);
  });
  it("trechos diferentes ganham diagramações diferentes (pelo menos uma semente difere da #0)", () => {
    const ref = perturbLayout(base, "video.mp4#0");
    const anyDiff = [1, 2, 3, 4].some((i) => {
      const p = perturbLayout(base, `video.mp4#${i}`);
      return p.fontSize !== ref.fontSize || p.marginV !== ref.marginV || p.marginH !== ref.marginH;
    });
    expect(anyDiff).toBe(true);
  });
  it("a amplitude do tremor é contida: corpo da fonte ±4%, linha de base sem sair da faixa segura de 62 a 72% e margem com piso", () => {
    for (let i = 0; i < 50; i++) {
      const p = perturbLayout(base, `seed#${i}`);
      expect(Math.abs(p.fontSize - base.fontSize)).toBeLessThanOrEqual(Math.ceil(base.fontSize * JITTER_FONT_SPAN) + 1);
      expect(Math.abs(p.marginV - base.marginV)).toBeLessThanOrEqual(Math.ceil(base.playResY * JITTER_BASELINE_FRAC) + 1);
      const baselineFrac = (p.playResY - p.marginV) / p.playResY;
      expect(baselineFrac).toBeGreaterThan(0.62);
      expect(baselineFrac).toBeLessThan(0.725);
      expect(Math.abs(p.marginH - base.marginH)).toBeLessThanOrEqual(JITTER_MARGIN_H_PX);
      expect(p.marginH).toBeGreaterThanOrEqual(20);
      // Os campos que não têm nada a ver com a geometria do layout ficam como estavam
      expect(p.maxLineUnits).toBe(base.maxLineUnits);
      expect(p.playResY).toBe(base.playResY);
    }
  });
  it("as propriedades básicas de fnv1a/mulberry32: mesma entrada, mesma saída, e o resultado em [0,1)", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
    const rand = mulberry32(fnv1a("abc"));
    for (let i = 0; i < 100; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
