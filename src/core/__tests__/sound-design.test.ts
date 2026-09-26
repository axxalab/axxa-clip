import { describe, it, expect } from "vitest";
import {
  planSfxCues,
  buildSoundDesignArgs,
  hasSoundDesignWork,
  synthSfxArgs,
  SFX_MAX_PER_CLIP,
  SFX_MIN_SPACING_SEC,
  SFX_TYPES,
} from "../sound-design";

describe("planSfxCues", () => {
  it("whoosh na emenda + ding no pico de emoção + pop no gancho, devolvidos na ordem do tempo", () => {
    const cues = planSfxCues({
      durationSec: 30,
      seamsSec: [12],
      hookAtSec: 0.05,
      peakEventsSec: [20],
    });
    expect(cues.map((c) => c.type)).toEqual(["pop", "whoosh", "ding"]);
    expect(cues.map((c) => c.atSec)).toEqual([0.05, 12, 20]);
  });

  it("a marcação que passa do teto é descartada (a emenda estrutural tem prioridade)", () => {
    const cues = planSfxCues({
      durationSec: 60,
      seamsSec: [10, 20, 30, 40],
      hookAtSec: 0.05,
      peakEventsSec: [50],
    });
    expect(cues).toHaveLength(SFX_MAX_PER_CLIP);
    expect(cues.every((c) => c.type === "whoosh")).toBe(true);
  });

  it("a marcação que viola a distância mínima é descartada, e não movida de lugar", () => {
    const cues = planSfxCues({
      durationSec: 30,
      seamsSec: [10],
      peakEventsSec: [10.5], // a 0,5s do whoosh, abaixo da distância mínima
    });
    expect(cues).toHaveLength(1);
    expect(cues[0].type).toBe("whoosh");
    expect(SFX_MIN_SPACING_SEC).toBeGreaterThan(0.5);
  });

  it("a marcação encostada no fim é descartada; num trecho curto demais não entra nenhuma", () => {
    expect(planSfxCues({ durationSec: 30, peakEventsSec: [29.8] })).toHaveLength(0);
    expect(planSfxCues({ durationSec: 0.5, seamsSec: [0.2] })).toHaveLength(0);
  });

  it("sem material nenhum, devolve vazio", () => {
    expect(planSfxCues({ durationSec: 30 })).toHaveLength(0);
  });
});

describe("buildSoundDesignArgs", () => {
  it("o efeito recebe adelay até o milissegundo da marcação, e o vídeo é copiado", () => {
    const args = buildSoundDesignArgs("in.mp4", "out.mp4", {
      cues: [{ type: "ding", atSec: 12.345 }],
      sfxDir: "/sfx",
      durationSec: 30,
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("adelay=12345|12345");
    expect(graph).toContain("amix=inputs=2");
    expect(graph).toContain("normalize=0");
    // O vídeo não é recodificado: qualidade intacta na passada de pós-processamento é promessa dura
    expect(args.join(" ")).toContain("-map 0:v? -c:v copy");
    // Sem a normalização de volume ligada, o limitador entra como rede de segurança contra o corte de pico
    expect(graph).toContain("alimiter");
  });

  it("trilha: lida em laço, atenuada, esquivando da voz por cadeia lateral, com fade final", () => {
    const args = buildSoundDesignArgs("in.mp4", "out.mp4", {
      cues: [],
      bgmPath: "/music/bgm.mp3",
      durationSec: 30,
      normalizeLoudness: true,
    });
    const joined = args.join(" ");
    expect(joined).toContain("-stream_loop -1");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("asplit=2[voice][sc]");
    expect(graph).toContain("sidechaincompress");
    expect(graph).toContain("volume=-17dB");
    expect(graph).toContain("afade=t=out:st=28.800");
    // Com a normalização de volume ligada: depois da mixagem o loudnorm passa mais uma vez para segurar o alvo de -14
    expect(graph).toContain("loudnorm");
  });

  it("sem nada a fazer, lança erro (quem chama deve filtrar antes com hasSoundDesignWork)", () => {
    expect(() => buildSoundDesignArgs("a.mp4", "b.mp4", { cues: [], durationSec: 10 })).toThrow();
    expect(hasSoundDesignWork({ cues: [] })).toBe(false);
    expect(hasSoundDesignWork({ cues: [], bgmPath: "/x.mp3" })).toBe(true);
    expect(hasSoundDesignWork({ cues: [{ type: "pop", atSec: 0 }] })).toBe(true);
  });
});

describe("synthSfxArgs", () => {
  it("cada um dos três efeitos tem a sua receita de síntese, todos em wav mono de 48k", () => {
    for (const type of SFX_TYPES) {
      const args = synthSfxArgs(type, `/tmp/${type}.wav`);
      expect(args).toContain("lavfi");
      expect(args.join(" ")).toContain("-ar 48000 -ac 1");
      expect(args[args.length - 1]).toBe(`/tmp/${type}.wav`);
    }
  });
});
