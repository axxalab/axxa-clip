import { describe, it, expect } from "vitest";
import { secToTimecode, buildEdl } from "../edl";

describe("secToTimecode", () => {
  it("código de tempo SMPTE sem descarte de quadro, com o número de quadros convertido pelo fps", () => {
    expect(secToTimecode(0, 30)).toBe("00:00:00:00");
    expect(secToTimecode(65.5, 30)).toBe("00:01:05:15");
    expect(secToTimecode(3661.2, 25)).toBe("01:01:01:05");
  });

  it("fps não inteiro (29,97) é arredondado para uma base de quadros inteira; negativo é preso em zero", () => {
    expect(secToTimecode(1, 29.97)).toBe("00:00:01:00");
    expect(secToTimecode(-5, 30)).toBe("00:00:00:00");
  });
});

describe("buildEdl", () => {
  it("a estrutura do CMX3600: título / FCM / linha de evento / linha de comentário, com o lado record acumulando em sequência", () => {
    const edl = buildEdl({
      title: "gravacao - HotClip",
      sourceName: "gravacao.mp4",
      fps: 30,
      clips: [
        { title: "estouro um", segments: [{ startSec: 60, endSec: 70 }] },
        { title: "estouro dois", segments: [{ startSec: 200, endSec: 215 }] },
      ],
    });
    expect(edl).toContain("TITLE: gravacao - HotClip");
    expect(edl).toContain("FCM: NON-DROP FRAME");
    expect(edl).toContain("001  AX       B     C        00:01:00:00 00:01:10:00 00:00:00:00 00:00:10:00");
    // O segundo record continua de 10s
    expect(edl).toContain("002  AX       B     C        00:03:20:00 00:03:35:00 00:00:10:00 00:00:25:00");
    expect(edl).toContain("* FROM CLIP NAME: gravacao.mp4");
    expect(edl).toContain("* COMMENT: estouro um");
  });

  it("corte seco com vários pedaços: um trecho vira vários eventos, com saltos na origem e o record em sequência", () => {
    const edl = buildEdl({
      title: "t",
      sourceName: "s.mp4",
      fps: 30,
      clips: [
        {
          title: "trecho com corte seco",
          segments: [
            { startSec: 100, endSec: 104 },
            { startSec: 106, endSec: 110 }, // os 2s do meio foram cortados pelo corte seco
          ],
        },
      ],
    });
    const events = edl.split("\n").filter((l) => /^\d{3} {2}AX/.test(l));
    expect(events.length).toBe(2);
    expect(events[0]).toContain("00:01:40:00 00:01:44:00 00:00:00:00 00:00:04:00");
    expect(events[1]).toContain("00:01:46:00 00:01:50:00 00:00:04:00 00:00:08:00");
  });

  it("pedaço de duração zero é pulado, e a numeração dos eventos continua em sequência", () => {
    const edl = buildEdl({
      title: "t",
      sourceName: "s.mp4",
      fps: 30,
      clips: [
        { title: "a", segments: [{ startSec: 5, endSec: 5 }, { startSec: 10, endSec: 12 }] },
      ],
    });
    const events = edl.split("\n").filter((l) => /^\d{3} {2}AX/.test(l));
    expect(events.length).toBe(1);
    expect(events[0].startsWith("001")).toBe(true);
  });
});
