import { describe, it, expect } from "vitest";
import { chunkCells, buildSheetArgs, SHEET_CELLS } from "../contact-sheet";
import type { ColorRenderPlan } from "../color";

const pqPlan: ColorRenderPlan = {
  source: {
    pixelFormat: "yuv420p10le",
    bitDepth: 10,
    primaries: "bt2020",
    transfer: "smpte2084",
    space: "bt2020nc",
    range: "tv",
    peakNits: 1000,
  },
  detected: "pq",
  action: "tonemap-bt709",
  output: {
    pixelFormat: "yuv420p",
    bitDepth: 8,
    primaries: "bt709",
    transfer: "bt709",
    space: "bt709",
    range: "tv",
    peakNits: 100,
  },
  reason: "hdr-pq-tone-map-bt709",
};

describe("chunkCells", () => {
  it("agrupa pela capacidade de uma folha cheia, e o último grupo pode ficar incompleto", () => {
    const groups = chunkCells(Array.from({ length: 20 }, (_, i) => i));
    expect(groups.map((g) => g.length)).toEqual([9, 9, 2]);
    expect(groups[0][0]).toBe(0);
    expect(groups[2]).toEqual([18, 19]);
  });

  it("array vazio devolve vazio; a capacidade personalizada vale", () => {
    expect(chunkCells([])).toEqual([]);
    expect(chunkCells([1, 2, 3], 2).map((g) => g.length)).toEqual([2, 1]);
  });
});

describe("buildSheetArgs", () => {
  it("folha cheia: nove entradas com -ss, um quadro de cada, e depois do concat o tile 3x3", () => {
    const times = Array.from({ length: SHEET_CELLS }, (_, i) => i * 10 + 5);
    const args = buildSheetArgs("/v.mp4", times);
    expect(args.filter((a) => a === "-i")).toHaveLength(9);
    expect(args.filter((a) => a === "/v.mp4")).toHaveLength(9);
    expect(args[args.indexOf("-ss") + 1]).toBe("5.00");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("trim=end_frame=1"); // de cada entrada sai um quadro só, e assim o concat não espera o fluxo inteiro
    expect(graph).toContain("concat=n=9:v=1:a=0");
    expect(graph).toContain("tile=3x3:color=black");
    expect(args[args.indexOf("-map") + 1]).toBe("[sheet]");
    expect(args).toContain("image2pipe");
  });

  it("sem encher, a grade encolhe conforme o necessário (4 quadros → 3x2, com fundo preto completando)", () => {
    const graph = buildSheetArgs("/v.mp4", [1, 2, 3, 4]).join(" ");
    expect(graph).toContain("tile=3x2");
  });

  it("dois quadros → 2x1; com um quadro só, nada é montado em grade", () => {
    expect(buildSheetArgs("/v.mp4", [1, 2]).join(" ")).toContain("tile=2x1");
    const single = buildSheetArgs("/v.mp4", [3]).join(" ");
    expect(single).not.toContain("tile=");
    expect(single).not.toContain("concat=");
    expect(single).toContain("[sheet]");
  });

  it("o número só é queimado quando a fonte é dada, e o caminho é escapado conforme a sintaxe do filtro", () => {
    const withFont = buildSheetArgs("/v.mp4", [1, 2], { fontFile: "C:\\fonts\\f.otf" }).join(" ");
    expect(withFont).toContain("drawtext=fontfile='C\\:/fonts/f.otf'");
    expect(withFont).toContain("text='1'");
    expect(withFont).toContain("text='2'");
    expect(buildSheetArgs("/v.mp4", [1, 2]).join(" ")).not.toContain("drawtext");
  });

  it("instante negativo é preso em 0, e um array de instantes vazio lança erro na hora", () => {
    const args = buildSheetArgs("/v.mp4", [-1]);
    expect(args[args.indexOf("-ss") + 1]).toBe("0.00");
    expect(() => buildSheetArgs("/v.mp4", [])).toThrow();
  });

  it("todas as entradas usam a mesma trilha de vídeo escolhida globalmente, e a pré-visualização HDR passa para SDR antes de escalar", () => {
    const args = buildSheetArgs("/v.mkv", [1, 2], { videoStreamIndex: 3, color: pqPlan });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[0:3]zscale=pin=bt2020");
    expect(graph).toContain("[1:3]zscale=pin=bt2020");
    expect(graph).toContain("trim=end_frame=1");
    expect(graph).not.toContain("[0:v]");
    expect(graph.indexOf("zscale=pin=bt2020")).toBeLessThan(graph.indexOf("scale=448:-2"));
    expect(graph).toContain("tonemap=tonemap=mobius");
  });
});
