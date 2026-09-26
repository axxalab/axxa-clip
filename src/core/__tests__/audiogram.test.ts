import { describe, it, expect } from "vitest";
import { buildAudiogramArgs, audiogramSpec, hexToFfmpegColor } from "../audiogram";

const SPEC = audiogramSpec(true);

describe("hexToFfmpegColor / audiogramSpec", () => {
  it("a cor da marca vira a forma do ffmpeg, e o inválido volta para o laranja de chama", () => {
    expect(hexToFfmpegColor("#00ff88")).toBe("0x00FF88");
    expect(hexToFfmpegColor("vermelho")).toBe("0xFF6E0D");
    expect(hexToFfmpegColor(undefined)).toBe("0xFF6E0D");
  });

  it("vertical 1080×1920 / horizontal 1920×1080, com a onda abaixo de um terço da altura", () => {
    expect(audiogramSpec(true)).toMatchObject({ width: 1080, height: 1920 });
    expect(audiogramSpec(false)).toMatchObject({ width: 1920, height: 1080 });
    expect(SPEC.waveHeight).toBeLessThan(SPEC.height / 3);
  });
});

describe("buildAudiogramArgs", () => {
  const range = [{ startSec: 10, endSec: 25 }];

  it("um pedaço só: busca rápida até o início dele, atrim em tempo relativo e os dois map de áudio e vídeo", () => {
    const args = buildAudiogramArgs("/a.mp3", "/out.mp4", range, { spec: SPEC });
    expect(args.join(" ")).toContain("-ss 10.000 -i /a.mp3");
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("atrim=start=0.000:end=15.000");
    expect(fc).toContain("showwaves=s=1080x480:mode=cline:rate=30:colors=0xFF6E0D");
    expect(fc).toContain("color=c=0x141110:size=1080x1920");
    expect(fc).toContain("overlay=x=0:y=(H-h)/2:shortest=1");
    expect(args).toContain("[v0]");
    expect(args).toContain("[aout]");
  });

  it("corte seco com vários pedaços: atrim×N + concat, e a onda sai do áudio já colado", () => {
    const args = buildAudiogramArgs("/a.mp3", "/out.mp4", [
      { startSec: 10, endSec: 14 },
      { startSec: 16, endSec: 20 },
    ], { spec: SPEC });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("atrim=start=0.000:end=4.000");
    expect(fc).toContain("atrim=start=6.000:end=10.000");
    expect(fc).toContain("concat=n=2:v=0:a=1[acat]");
    expect(fc).toContain("[acat]asplit=2[aout][awave]");
  });

  it("a normalização de volume vem depois da colagem e antes da divisão; a legenda e a marca d'água entram na cadeia em ordem", () => {
    const args = buildAudiogramArgs("/a.mp3", "/out.mp4", range, {
      spec: SPEC,
      normalizeLoudness: true,
      subtitlePath: "/tmp/c.ass",
      fontsDir: "/fonts",
      watermark: { path: "/logo.png", corner: "top-right", opacity: 0.6, widthPx: 172 },
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("loudnorm=I=-14");
    expect(fc).toContain("[anorm]asplit=2");
    expect(fc).toContain("subtitles=filename='/tmp/c.ass':fontsdir='/fonts'[v1]");
    expect(fc).toContain("[v1][wm]");
    expect(args[args.indexOf("-map") + 1]).toBe("[vout]");
  });

  it("a redução de ruído vem antes da normalização: [a0] → ruído [adn] → loudnorm [anorm] → asplit", () => {
    const args = buildAudiogramArgs("/a.mp3", "/out.mp4", range, {
      spec: SPEC,
      denoise: true,
      normalizeLoudness: true,
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("afftdn");
    expect(fc.indexOf("afftdn")).toBeLessThan(fc.indexOf("loudnorm")); // primeiro tira o ruído, depois normaliza
    expect(fc).toContain("[adn]loudnorm");
    expect(fc).toContain("[anorm]asplit=2");
  });

  it("pedaço vazio ou inválido lança erro", () => {
    expect(() => buildAudiogramArgs("/a.mp3", "/o.mp4", [], { spec: SPEC })).toThrow();
    expect(() => buildAudiogramArgs("/a.mp3", "/o.mp4", [{ startSec: 5, endSec: 5 }], { spec: SPEC })).toThrow();
  });
});
