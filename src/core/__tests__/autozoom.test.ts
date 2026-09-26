import { describe, it, expect } from "vitest";
import {
  planZoomKeyframes,
  renderZoomExpr,
  buildZoomFilter,
  ZOOM_BASE,
  ZOOM_BREATH,
  ZOOM_EMPHASIS,
  ZOOM_MIN_CLIP_SEC,
} from "../autozoom";

describe("planZoomKeyframes", () => {
  it("trecho curto demais não recebe movimento de câmera (a imagem não chegaria onde ia e só pareceria tremida)", () => {
    expect(planZoomKeyframes(ZOOM_MIN_CLIP_SEC - 0.1)).toEqual([]);
    expect(planZoomKeyframes(0)).toEqual([]);
  });

  it("o ritmo da respiração: começa no padrão e vai e volta entre o padrão e a aproximação, sem empurrar num sentido só", () => {
    const kfs = planZoomKeyframes(30);
    expect(kfs[0]).toEqual({ t: 0, z: ZOOM_BASE });
    const zooms = kfs.map((k) => k.z);
    expect(Math.max(...zooms)).toBeCloseTo(ZOOM_BREATH, 5);
    expect(Math.min(...zooms)).toBeCloseTo(ZOOM_BASE, 5);
    // Voltou: depois do pico existe sempre um valor de referência
    const firstPeak = zooms.findIndex((z) => z > ZOOM_BASE);
    expect(zooms.slice(firstPeak).some((z) => z === ZOOM_BASE)).toBe(true);
  });

  it("o tempo dos quadros-chave cresce sempre e não passa da duração do trecho", () => {
    const kfs = planZoomKeyframes(47, { emphasisAtSec: [5, 20, 33] });
    for (let i = 1; i < kfs.length; i++) expect(kfs[i].t).toBeGreaterThan(kfs[i - 1].t);
    expect(kfs[kfs.length - 1].t).toBeLessThanOrEqual(47);
    expect(kfs.every((k) => k.z >= ZOOM_BASE)).toBe(true);
  });

  it("no instante de ênfase a aproximação é máxima, e a câmera se move antes de o conteúdo chegar", () => {
    const kfs = planZoomKeyframes(40, { emphasisAtSec: [20] });
    const peak = kfs.find((k) => k.z === ZOOM_EMPHASIS);
    expect(peak).toBeDefined();
    expect(peak!.t).toBeLessThanOrEqual(20);
    // Antes da aproximação existe um quadro de referência (de onde ela parte), anterior ao ponto de ênfase
    const lead = kfs.filter((k) => k.t < peak!.t && k.z === ZOOM_BASE).pop();
    expect(lead).toBeDefined();
  });

  it("várias ênfases bem próximas viram uma aproximação longa só, sem espasmo de ir e voltar", () => {
    const kfs = planZoomKeyframes(40, { emphasisAtSec: [20, 20.5, 21] });
    // Aproxima uma vez e volta uma vez
    let rises = 0;
    let falls = 0;
    for (let i = 1; i < kfs.length; i++) {
      if (kfs[i].z === ZOOM_EMPHASIS && kfs[i - 1].z < ZOOM_EMPHASIS) rises++;
      if (kfs[i - 1].z === ZOOM_EMPHASIS && kfs[i].z < ZOOM_EMPHASIS) falls++;
    }
    expect(rises).toBe(1);
    expect(falls).toBe(1);
  });

  it("a velocidade da mudança de escala entre dois quadros-chave quaisquer fica no que o olho aceita (sem salto instantâneo)", () => {
    // Mais de 0,3 de escala por segundo já é espasmo — houve um bug assim: ao unir duas ênfases
    // vizinhas, o ponto de volta da primeira não era limpo, e a imagem saltava de 1,0 para 1,1 em 0,1s
    const cases = [
      [8, 8.5],
      [8, 8.5, 22],
      [5, 5.2, 5.4, 5.6],
      [10, 11, 12, 13, 14],
    ];
    for (const emphasisAtSec of cases) {
      const kfs = planZoomKeyframes(30, { emphasisAtSec });
      for (let i = 1; i < kfs.length; i++) {
        const dz = Math.abs(kfs[i].z - kfs[i - 1].z);
        const dt = kfs[i].t - kfs[i - 1].t;
        expect(dz / dt).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it("instante de ênfase fora do intervalo é ignorado", () => {
    const kfs = planZoomKeyframes(20, { emphasisAtSec: [-5, 100, NaN] });
    expect(kfs.every((k) => k.z <= ZOOM_BREATH)).toBe(true);
  });
});

describe("renderZoomExpr", () => {
  it("sem quadros-chave = sem escala", () => {
    expect(renderZoomExpr([])).toBe("1");
  });

  it("um único quadro-chave = fator constante", () => {
    expect(renderZoomExpr([{ t: 0, z: 1.05 }])).toBe("1.0500");
  });

  it("interpolação linear por pedaços, com in_time como variável (não o número do quadro de saída)", () => {
    const expr = renderZoomExpr([
      { t: 0, z: 1 },
      { t: 5, z: 1.1 },
    ]);
    expect(expr).toContain("in_time");
    expect(expr).toContain("lt(in_time,5.000)");
    expect(expr).not.toContain("NaN");
  });

  it("com quadros-chave demais há reamostragem, e a profundidade do aninhamento fica controlada", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ t: i, z: 1 + (i % 2) * 0.05 }));
    const expr = renderZoomExpr(many, 8);
    expect((expr.match(/if\(/g) ?? []).length).toBeLessThanOrEqual(8);
    expect(expr).not.toContain("NaN");
  });

  it("quadros-chave repetidos no mesmo instante não geram divisão por zero", () => {
    const expr = renderZoomExpr([
      { t: 1, z: 1 },
      { t: 1, z: 1.1 },
      { t: 3, z: 1 },
    ]);
    expect(expr).not.toContain("Infinity");
    expect(expr).not.toContain("NaN");
    expect(expr).not.toContain("/0.0000");
  });
});

describe("buildZoomFilter", () => {
  it("monta a cadeia do zoompan: escala pelo centro, sai no tamanho de destino e leva a taxa de quadros da origem explícita", () => {
    const f = buildZoomFilter(30, 30, 1080, 1920)!;
    expect(f).toContain("zoompan=");
    expect(f).toContain("s=1080x1920");
    expect(f).toContain("fps=30"); // sem passar o fps explícito, o material seria reamostrado para 25
    expect(f).toContain("d=1");
    expect(f).toContain("iw/2-(iw/zoom/2)");
  });

  it("com a taxa de quadros desconhecida, recusa gerar (melhor sem movimento de câmera que mudar a taxa de quadros)", () => {
    expect(buildZoomFilter(30, 0, 1080, 1920)).toBeNull();
    expect(buildZoomFilter(30, NaN, 1080, 1920)).toBeNull();
  });

  it("trecho curto demais devolve null, e quem chama volta para o scale comum", () => {
    expect(buildZoomFilter(2, 30, 1080, 1920)).toBeNull();
  });
});
