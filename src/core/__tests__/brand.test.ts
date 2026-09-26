import { describe, it, expect } from "vitest";
import {
  hexToAssColor,
  hexToAssInline,
  lightenHex,
  applyBrandToLayout,
  sanitizeBrand,
  isValidHex,
  FONT_SCALE_CHOICES,
} from "../brand";
import { VERTICAL_LAYOUT, buildCaptionAss, keywordText } from "../subtitle";
import { buildOverlayPayload } from "../caption-overlay/payload";
import { watermarkStages, composeVideoFilter, buildCutArgs, buildJumpCutArgs } from "../cut";

describe("conversão de cor hex → ASS", () => {
  it("#RRGGBB → &HAABBGGRR (na ordem BGR)", () => {
    expect(hexToAssColor("#FF6E0D")).toBe("&H000D6EFF");
    expect(hexToAssColor("#3355FF", "7F")).toBe("&H7FFF5533");
    expect(hexToAssColor("22C55E")).toBe("&H005EC522"); // sem o prefixo # também é aceito
  });

  it("a forma de sobrescrita dentro da linha, &HBBGGRR&", () => {
    expect(hexToAssInline("#FF6E0D")).toBe("&H0D6EFF&");
  });

  it("entrada inválida devolve null", () => {
    expect(hexToAssColor("#FFF")).toBeNull();
    expect(hexToAssColor("red")).toBeNull();
    expect(hexToAssInline("#GG0000")).toBeNull();
    expect(isValidHex("#12345")).toBe(false);
  });

  it("clareia para o branco (a segunda parada do gradiente)", () => {
    expect(lightenHex("#000000", 1)).toBe("#FFFFFF");
    expect(lightenHex("#FF6E0D", 0)).toBe("#FF6E0D");
    expect(lightenHex("bad", 0.5)).toBe("bad"); // o inválido volta como está
  });
});

describe("applyBrandToLayout", () => {
  it("sem marca ou tudo no padrão → o layout fica como está (a mesma referência)", () => {
    expect(applyBrandToLayout(VERTICAL_LAYOUT)).toBe(VERTICAL_LAYOUT);
    expect(applyBrandToLayout(VERTICAL_LAYOUT, { highlightColor: "#123456" })).toBe(VERTICAL_LAYOUT);
  });

  it("corpo de fonte maior → as unidades de largura por linha diminuem na mesma proporção", () => {
    const l = applyBrandToLayout(VERTICAL_LAYOUT, { fontScale: 1.18 });
    expect(l.fontSize).toBe(Math.round(78 * 1.18));
    expect(l.maxLineUnits).toBe(Math.round(22 / 1.18));
  });

  it("a faixa de fonte pequena encolhe bem a legenda dinâmica", () => {
    const l = applyBrandToLayout(VERTICAL_LAYOUT, { fontScale: FONT_SCALE_CHOICES.small });
    expect(l.fontSize).toBe(Math.round(VERTICAL_LAYOUT.fontSize * 0.68));
    expect(l.fontSize).toBeLessThan(VERTICAL_LAYOUT.fontSize * 0.7);
  });

  it("as três faixas de posição movem só o marginV", () => {
    expect(applyBrandToLayout(VERTICAL_LAYOUT, { captionPosition: "low" }).marginV).toBe(420);
    expect(applyBrandToLayout(VERTICAL_LAYOUT, { captionPosition: "high" }).marginV).toBe(700);
  });
});

describe("sanitizeBrand (limpeza na fronteira do IPC)", () => {
  it("o campo válido passa e o inválido é descartado", () => {
    const b = sanitizeBrand({
      highlightColor: "#22C55E",
      fontScale: 99, // fora do limite → preso em 1,6
      captionPosition: "middle", // faixa inválida → descartada
      watermark: { path: "/tmp/logo.png", corner: "nowhere", opacity: 5 },
    });
    expect(b).toEqual({
      highlightColor: "#22C55E",
      fontScale: 1.6,
      watermark: { path: "/tmp/logo.png", corner: "top-right", opacity: 1 },
    });
  });

  it("tudo vazio ou o que não é objeto → undefined (a esteira usa o padrão)", () => {
    expect(sanitizeBrand(undefined)).toBeUndefined();
    expect(sanitizeBrand({})).toBeUndefined();
    expect(sanitizeBrand({ highlightColor: "nope" })).toBeUndefined();
  });
});

describe("a cor da marca atravessa a montagem da legenda", () => {
  const words = [
    { text: "oi", startSec: 0.2, endSec: 0.8 },
    { text: "mundo", startSec: 0.9, endSec: 1.5 },
  ];

  it("a cor principal do karaokê e a do gancho usam a cor da marca; sem configuração continua o laranja de chama", () => {
    const branded = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "karaoke", { highlightHex: "#22C55E" });
    expect(branded).toContain("&H005EC522");
    expect(branded).not.toContain("&H000D6EFF");
    const plain = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "karaoke", {});
    expect(plain).toContain("&H000D6EFF");
  });

  it("a sobrescrita da palavra-chave dentro da linha usa a cor da marca", () => {
    expect(keywordText(words, ["mundo"], "#3355FF")).toContain("\\c&HFF5533&");
    expect(keywordText(words, ["mundo"])).toContain("\\c&H0D6EFF&");
  });

  it("o payload do balão traz as duas cores do gradiente; cor inválida volta ao padrão", () => {
    const p = buildOverlayPayload(words, VERTICAL_LAYOUT, { highlightHex: "#3355FF" });
    expect(p.highlightColor).toBe("#3355FF");
    expect(p.highlightColor2).not.toBe("#3355FF"); // já foi clareada para o branco
    expect(buildOverlayPayload(words, VERTICAL_LAYOUT, {}).highlightColor).toBe("#FF6E0D");
  });
});

describe("montagem do filtro da marca d'água", () => {
  const wm = { path: "/tmp/logo.png", corner: "top-right" as const, opacity: 0.8, widthPx: 172 };

  it("fonte movie + transparência + escala, com a expressão de posição dos quatro cantos", () => {
    const s = watermarkStages(wm);
    expect(s.source).toBe("movie='/tmp/logo.png',format=rgba,colorchannelmixer=aa=0.800,scale=172:-1");
    expect(s.overlay).toBe("overlay=W-w-44:44:format=auto");
    expect(watermarkStages({ ...wm, corner: "bottom-left" }).overlay).toBe("overlay=44:H-h-44:format=auto");
    // Com opacidade 1, o mixer é dispensado
    expect(watermarkStages({ ...wm, opacity: 1 }).source).not.toContain("colorchannelmixer");
  });

  it("composeVideoFilter: sem marca d'água fica como está; com ela abre a segunda entrada; sem cadeia anterior, o copy serve de base", () => {
    expect(composeVideoFilter(["scale=1080:1920"])).toBe("scale=1080:1920");
    expect(composeVideoFilter(["scale=1080:1920"], wm)).toBe(
      "scale=1080:1920[main];movie='/tmp/logo.png',format=rgba,colorchannelmixer=aa=0.800,scale=172:-1[wm];[main][wm]overlay=W-w-44:44:format=auto"
    );
    expect(composeVideoFilter([], wm)).toMatch(/^copy\[main\];/);
  });

  it("buildCutArgs: a marca d'água entra no -vf e recodificar passa a ser obrigatório", () => {
    const args = buildCutArgs("/in.mp4", "/out.mp4", 0, 10, { mode: "copy", watermark: wm });
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("[main][wm]overlay=W-w-44:44");
    expect(args).toContain("libx264"); // copy foi promovido a recodificação
  });

  it("buildJumpCutArgs: a marca d'água é sobreposta depois da cadeia de pós-processamento (acima da legenda)", () => {
    const args = buildJumpCutArgs("/in.mp4", "/out.mp4", 0, [{ startSec: 0, endSec: 2 }, { startSec: 3, endSec: 5 }], {
      vertical: true,
      watermark: wm,
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("[vc]"); // o concat entrega [vc] primeiro
    expect(fc).toContain("[vmain][wm]overlay=W-w-44:44:format=auto[vout]");
    // Sem cadeia de pós-processamento, [vc][wm] fecha direto
    const bare = buildJumpCutArgs("/in.mp4", "/out.mp4", 0, [{ startSec: 0, endSec: 2 }, { startSec: 3, endSec: 5 }], {
      watermark: wm,
    });
    const fcBare = bare[bare.indexOf("-filter_complex") + 1];
    expect(fcBare).toContain("[vc][wm]overlay=W-w-44:44:format=auto[vout]");
  });
});
