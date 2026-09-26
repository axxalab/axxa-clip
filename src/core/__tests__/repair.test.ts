import { describe, it, expect } from "vitest";
import { planRepair, buildRepairArgs, type RepairContext } from "../repair";
import { planColorRender } from "../color";
import type { ClipQaReport } from "../qa";

/** A base de um relatório limpo, sobre a qual cada caso empilha os seus avisos. */
const baseReport = (over: Partial<ClipQaReport> = {}): ClipQaReport => ({
  status: "warn",
  issues: ["aviso de exemplo"],
  durationSec: 30,
  expectedDurationSec: 30,
  blackSpans: [],
  silenceSpans: [],
  loudness: { integratedLufs: -14, truePeakDb: -1.5 },
  midWordCuts: 0,
  contentHits: null,
  pacingGapSec: null,
  hookPayoffMissing: null,
  ...over,
});

const ctx = (over: Partial<RepairContext> = {}): RepairContext => ({
  normalizeLoudness: true,
  headTrimmable: true,
  ...over,
});

describe("planRepair (dedução do plano de reparo)", () => {
  it("silêncio longo encostado no fim → o fim é aparado (deixando 0,25s de respiro)", () => {
    const plan = planRepair(baseReport({ silenceSpans: [{ startSec: 27.5, endSec: 30 }] }), ctx());
    expect(plan).not.toBeNull();
    expect(plan!.trimEndSec).toBeCloseTo(27.75);
    expect(plan!.trimStartSec).toBe(0);
    expect(plan!.trimmedSec).toBeCloseTo(2.25);
    expect(plan!.actions[0]).toContain("do fim");
  });

  it("silêncio longo encostado no começo → o começo é aparado; com o clímax na frente (headTrimmable=false) o começo não é tocado", () => {
    const report = baseReport({ silenceSpans: [{ startSec: 0, endSec: 3 }] });
    const plan = planRepair(report, ctx());
    expect(plan!.trimStartSec).toBeCloseTo(2.75);
    expect(planRepair(report, ctx({ headTrimmable: false }))).toBeNull();
  });

  it("tela preta no começo é aparada inteira (sem respiro)", () => {
    const plan = planRepair(baseReport({ blackSpans: [{ startSec: 0, endSec: 1.2 }] }), ctx());
    expect(plan!.trimStartSec).toBeCloseTo(1.2);
  });

  it("silêncio e tela preta no meio são escolha de conteúdo e não são aparados", () => {
    expect(planRepair(baseReport({ silenceSpans: [{ startSec: 10, endSec: 14 }] }), ctx())).toBeNull();
    expect(planRepair(baseReport({ blackSpans: [{ startSec: 12, endSec: 13 }] }), ctx())).toBeNull();
  });

  it("aparar menos que o piso (0,4s) não vale a recodificação → não apara", () => {
    expect(planRepair(baseReport({ silenceSpans: [{ startSec: 0, endSec: 0.5 }] }), ctx())).toBeNull();
  });

  it("guarda contra aparar demais: só apara se sobrar mais da metade, e senão desiste", () => {
    const report = baseReport({
      durationSec: 10,
      silenceSpans: [
        { startSec: 0, endSec: 4 },
        { startSec: 6.5, endSec: 10 },
      ],
    });
    expect(planRepair(report, ctx())).toBeNull();
  });

  it("volume desviado / pico real acima do limite → segunda normalização; sem a normalização ligada, não conserta", () => {
    const off = baseReport({ loudness: { integratedLufs: -18, truePeakDb: -2 } });
    expect(planRepair(off, ctx())!.loudness).toBe(true);
    expect(planRepair(off, ctx({ normalizeLoudness: false }))).toBeNull();
    const peak = baseReport({ loudness: { integratedLufs: -14, truePeakDb: -0.2 } });
    expect(planRepair(peak, ctx())!.loudness).toBe(true);
  });

  it("sem nada auto-curável (por exemplo, só o aviso de meia palavra) devolve null", () => {
    expect(planRepair(baseReport({ midWordCuts: 2 }), ctx())).toBeNull();
  });
});

describe("buildRepairArgs (parâmetros do reparo)", () => {
  const hdrColor = planColorRender({
    durationSec: 30,
    hasVideo: true,
    hasAudio: true,
    width: 1920,
    height: 1080,
    fps: 30,
    bitRate: 8_000_000,
    videoCodec: "hevc",
    audioCodec: "aac",
    pixelFormat: "yuv420p10le",
    bitDepth: 10,
    colorPrimaries: "bt2020",
    colorTransfer: "smpte2084",
    colorSpace: "bt2020nc",
    colorRange: "tv",
  });

  it("só o volume: o vídeo é copiado + loudnorm, em segundos e sem perda de qualidade", () => {
    const plan = { loudness: true, trimStartSec: 0, trimEndSec: null, trimmedSec: 0, actions: [] };
    const args = buildRepairArgs("in.mp4", "out.mp4", plan, 30);
    expect(args).toContain("copy");
    expect(args.join(" ")).toContain("loudnorm");
    expect(args).not.toContain("-ss");
    expect(args).not.toContain("libx264");
    expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
      "-map", "0:v:0", "-map", "0:a:0?",
    ]);
  });

  it("o reparo explícito de trilha segue o índice global de stream", () => {
    const plan = { loudness: true, trimStartSec: 0, trimEndSec: null, trimmedSec: 0, actions: [] };
    const args = buildRepairArgs("in.mkv", "out.mp4", plan, 30, undefined, 3, 5);
    expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
      "-map", "0:3", "-map", "0:5",
    ]);
  });

  it("aparar a ponta: recodificação exata no quadro + 30ms de suavização na borda nova", () => {
    const plan = { loudness: false, trimStartSec: 2.75, trimEndSec: 27.75, trimmedSec: 5, actions: [] };
    const args = buildRepairArgs("in.mp4", "out.mp4", plan, 30);
    expect(args).toContain("libx264");
    expect(args[args.indexOf("-ss") + 1]).toBe("00:00:02.750");
    expect(args[args.indexOf("-t") + 1]).toBe("00:00:25.000");
    expect(args.join(" ")).toContain("afade=t=in");
    expect(args.join(" ")).not.toContain("loudnorm");
  });

  it("aparar e consertar o volume cabem numa passada só, com o loudnorm antes da suavização", () => {
    const plan = { loudness: true, trimStartSec: 0, trimEndSec: 27, trimmedSec: 3, actions: [] };
    const args = buildRepairArgs("in.mp4", "out.mp4", plan, 30);
    const af = args[args.indexOf("-af") + 1];
    expect(af.indexOf("loudnorm")).toBeGreaterThanOrEqual(0);
    expect(af.indexOf("loudnorm")).toBeLessThan(af.indexOf("afade"));
  });

  it("no segundo reparo de um vídeo HDR a etiqueta BT.709 continua explícita", () => {
    const loudnessOnly = buildRepairArgs(
      "in.mp4",
      "out.mp4",
      { loudness: true, trimStartSec: 0, trimEndSec: null, trimmedSec: 0, actions: [] },
      30,
      hdrColor
    );
    const trimmed = buildRepairArgs(
      "in.mp4",
      "out.mp4",
      { loudness: false, trimStartSec: 1, trimEndSec: 29, trimmedSec: 2, actions: [] },
      30,
      hdrColor
    );
    for (const args of [loudnessOnly, trimmed]) {
      expect(args.slice(args.indexOf("-color_primaries"), args.indexOf("-color_primaries") + 8)).toEqual([
        "-color_primaries", "bt709",
        "-color_trc", "bt709",
        "-colorspace", "bt709",
        "-color_range", "tv",
      ]);
    }
  });
});
