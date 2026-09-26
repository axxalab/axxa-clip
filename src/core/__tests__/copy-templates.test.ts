import { describe, it, expect } from "vitest";
import {
  isHookAngle,
  isCtaType,
  hookAngleMenu,
  ctaMenu,
  hookAngleLabel,
  ctaTypeLabel,
} from "../copy-templates";

describe("validadores", () => {
  it("id que está no menu passa; fora do menu ou não-string é recusado", () => {
    expect(isHookAngle("question")).toBe(true);
    expect(isHookAngle("urgency")).toBe(true);
    expect(isHookAngle("clickbait")).toBe(false);
    expect(isHookAngle(1)).toBe(false);
    expect(isCtaType("product")).toBe(true);
    expect(isCtaType("buy_now")).toBe(false);
    expect(isCtaType(undefined)).toBe(false);
  });
});

describe("menus do prompt", () => {
  it("o menu em português tem 8 ângulos e 5 CTA, com id e uso em cada linha", () => {
    const angles = hookAngleMenu(true).split("\n");
    expect(angles.length).toBe(8);
    expect(angles[0]).toContain("question = pergunta");
    const ctas = ctaMenu(true).split("\n");
    expect(ctas.length).toBe(5);
    expect(ctas.some((l) => l.startsWith("product = produto"))).toBe(true);
  });

  it("as dicas dos ângulos e CTA de risco trazem a linha vermelha (conversando com a checagem de palavras proibidas)", () => {
    expect(hookAngleMenu(true)).toContain("proibido inventar prazo");
    expect(ctaMenu(true)).toContain("proibido levar o público para fora da plataforma");
  });

  it("o menu em inglês também sai em linhas", () => {
    expect(hookAngleMenu(false).split("\n").length).toBe(8);
    expect(ctaMenu(false).split("\n").length).toBe(5);
  });
});

describe("rótulos", () => {
  it("um id conhecido devolve o nome legível, e um id desconhecido volta como está", () => {
    expect(hookAngleLabel("pain", true)).toBe("dor em comum");
    expect(hookAngleLabel("pain", false)).toBe("pain");
    expect(ctaTypeLabel("save", true)).toBe("salvar");
    expect(hookAngleLabel("mystery", true)).toBe("mystery");
  });
});
