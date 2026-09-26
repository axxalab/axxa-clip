import { describe, expect, it } from "vitest";
import { findSensitiveRanges, mapSensitiveRanges, sanitizeSensitiveWords } from "../sensitive-words";
import { buildCutArgs, buildJumpCutArgs } from "../cut";
import { audiogramSpec, buildAudiogramArgs } from "../audiogram";

describe("tempo das palavras de risco", () => {
  it("uma expressão em escrita ideográfica combina atravessando as palavras de um caractere", () => {
    const words = [..."\u4f60\u8fd9\u4e2a\u50bb\u903c"].map((text, i) => ({ text, startSec: i, endSec: i + 0.8 }));
    expect(findSensitiveRanges(words, ["\u50bb\u903c"], 0)).toEqual([{ startSec: 3, endSec: 4.8 }]);
  });

  it("a palavra latina combina inteira, sem diferenciar maiúsculas e sem tocar em subcadeia", () => {
    const words = [
      { text: "SHIT", startSec: 1, endSec: 1.5 }, { text: "shipment", startSec: 2, endSec: 2.8 },
    ];
    expect(findSensitiveRanges(words, ["shit"], 0)).toEqual([{ startSec: 1, endSec: 1.5 }]);
  });

  it("mapeia o tempo de origem através de uma saída de vários pedaços e une a folga", () => {
    const words = [{ text: "porra", startSec: 11, endSec: 12 }, { text: "shit", startSec: 31, endSec: 32 }];
    const ranges = mapSensitiveRanges(words, ["porra", "shit"], [{ startSec: 10, endSec: 15 }, { startSec: 30, endSec: 35 }]);
    expect(ranges[0].startSec).toBeCloseTo(0.94);
    expect(ranges[0].endSec).toBeCloseTo(2.06);
    expect(ranges[1].startSec).toBeCloseTo(5.94);
    expect(ranges[1].endSec).toBeCloseTo(7.06);
  });

  it("limpa, remove repetidos e limita os termos personalizados", () => {
    expect(sanitizeSensitiveWords([" shit ", "shit", "", 3])).toEqual(["shit"]);
  });

  it("injeta as janelas de silêncio nos grafos de áudio do corte único, do corte seco e do audiograma", () => {
    const muteRanges = [{ startSec: 1, endSec: 1.5 }];
    const single = buildCutArgs("in.mp4", "out.mp4", 10, 15, { muteRanges });
    expect(single[single.indexOf("-af") + 1]).toContain("between(t,1.000,1.500)");
    const jump = buildJumpCutArgs("in.mp4", "out.mp4", 10, [{ startSec: 10, endSec: 12 }, { startSec: 14, endSec: 16 }], { muteRanges });
    expect(jump[jump.indexOf("-filter_complex") + 1]).toContain("between(t,1.000,1.500)");
    const audio = buildAudiogramArgs("in.mp3", "out.mp4", [{ startSec: 10, endSec: 15 }], { spec: audiogramSpec(true), muteRanges });
    expect(audio[audio.indexOf("-filter_complex") + 1]).toContain("between(t,1.000,1.500)");
  });
});
