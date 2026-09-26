import { describe, it, expect } from "vitest";
import { SAFE_ZONE_PLATFORMS, zonesFor, fitContain, cropRect9x16 } from "../../shared/safe-zones";

describe("validade dos dados de SAFE_ZONE_PLATFORMS", () => {
  it("há pelo menos o preset genérico, e todos os retângulos ficam dentro da imagem", () => {
    expect(SAFE_ZONE_PLATFORMS.length).toBeGreaterThan(0);
    for (const p of SAFE_ZONE_PLATFORMS) {
      expect(p.id).toBeTruthy();
      expect(p.name.pt).toBeTruthy();
      expect(p.name.en).toBeTruthy();
      expect(p.zones.length).toBeGreaterThan(0);
      for (const z of p.zones) {
        expect(z.x).toBeGreaterThanOrEqual(0);
        expect(z.y).toBeGreaterThanOrEqual(0);
        expect(z.w).toBeGreaterThan(0);
        expect(z.h).toBeGreaterThan(0);
        expect(z.x + z.w).toBeLessThanOrEqual(1.0001);
        expect(z.y + z.h).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it("zonesFor: um id desconhecido volta para o primeiro preset", () => {
    expect(zonesFor("plataforma-que-nao-existe")).toBe(SAFE_ZONE_PLATFORMS[0]);
    for (const p of SAFE_ZONE_PLATFORMS) expect(zonesFor(p.id)).toBe(p);
  });
});

describe("fitContain (a caixa de exibição do object-contain)", () => {
  it("vídeo largo num contêiner quadrado: barras pretas em cima e embaixo", () => {
    const b = fitContain(100, 100, 16 / 9);
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(100 / (16 / 9));
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo((100 - b.h) / 2);
  });

  it("vídeo vertical num contêiner largo: barras pretas dos lados", () => {
    const b = fitContain(200, 100, 9 / 16);
    expect(b.h).toBeCloseTo(100);
    expect(b.w).toBeCloseTo(100 * (9 / 16));
    expect(b.x).toBeCloseTo((200 - b.w) / 2);
  });

  it("entrada inválida devolve a caixa zerada", () => {
    expect(fitContain(0, 100, 1)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(fitContain(100, 100, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("cropRect9x16 (a janela de recorte vertical pelo centro)", () => {
  it("caixa de exibição 16:9: a janela ocupa toda a altura, é centralizada na horizontal e tem proporção 9:16", () => {
    const box = { x: 0, y: 0, w: 160, h: 90 };
    const c = cropRect9x16(box);
    expect(c.h).toBeCloseTo(90);
    expect(c.w).toBeCloseTo(90 * (9 / 16));
    expect(c.x).toBeCloseTo((160 - c.w) / 2);
    expect(c.y).toBeCloseTo(0);
  });

  it("numa caixa que já é 9:16: a janela de recorte é a caixa inteira", () => {
    const box = { x: 10, y: 5, w: 90, h: 160 };
    const c = cropRect9x16(box);
    expect(c.x).toBeCloseTo(10);
    expect(c.y).toBeCloseTo(5);
    expect(c.w).toBeCloseTo(90);
    expect(c.h).toBeCloseTo(160);
  });

  it("origem mais estreita que 9:16: a janela preserva a largura e é centralizada na vertical", () => {
    const box = { x: 0, y: 0, w: 45, h: 160 }; // mais estreita que 9:16
    const c = cropRect9x16(box);
    expect(c.w).toBeCloseTo(45);
    expect(c.h).toBeCloseTo(45 * (16 / 9));
    expect(c.y).toBeCloseTo((160 - c.h) / 2);
  });
});
