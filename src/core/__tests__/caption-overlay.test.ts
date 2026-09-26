import { describe, expect, it } from "vitest";
import { buildOverlayPayload } from "../caption-overlay/payload";
import { VERTICAL_LAYOUT } from "../subtitle";
import type { TranscriptWord } from "../../shared/api-types";

const w = (text: string, s: number, e: number): TranscriptWord => ({ text, startSec: s, endSec: e });

describe("buildOverlayPayload", () => {
  const words = [w("olha", 0, 0.4), w("essa", 0.4, 0.8), w("velocidade", 0.8, 1.2), w("muito", 3.0, 3.4), w("absurda", 3.4, 3.8)];

  it("derives geometry from the ASS layout", () => {
    const p = buildOverlayPayload(words, VERTICAL_LAYOUT);
    expect(p.width).toBe(1080);
    expect(p.height).toBe(1920);
    expect(p.fontSize).toBe(78);
    // marginV 560 from the bottom of 1920 → baseline ≈ 70.8%
    expect(p.baselineFrac).toBeCloseTo((1920 - 560) / 1920, 5);
  });

  it("times words in ms and lingers the last line", () => {
    const p = buildOverlayPayload(words, VERTICAL_LAYOUT);
    const last = p.lines[p.lines.length - 1];
    expect(last.words[last.words.length - 1].endMs).toBe(3800);
    expect(last.endMs).toBe(3800 + 350);
  });

  it("marks keyword words after fusion", () => {
    const kw = buildOverlayPayload(words, VERTICAL_LAYOUT, { keywords: ["velocidade"] });
    const flat = kw.lines.flatMap((l) => l.words);
    expect(flat.find((x) => x.text === "velocidade")?.keyword).toBe(true);
    expect(flat.find((x) => x.text === "olha")?.keyword).toBe(false);
  });

  it("respects forced breaks (jump-cut splice points)", () => {
    const tight = [w("um", 0, 0.3), w("dois", 0.3, 0.6), w("tres", 0.6, 0.9)];
    const p = buildOverlayPayload(tight, VERTICAL_LAYOUT, { forcedBreaks: [0.6] });
    expect(p.lines.length).toBe(2);
    expect(p.lines[1].words[0].text).toBe("tres");
  });

  it("holds each line until the next begins (anti-flicker) but clears on a real pause", () => {
    // O vão de 0,4s depois de «essa» é atravessado; o de 1,8s depois de «velocidade» segura só até o teto, sem atravessar
    const p = buildOverlayPayload(words, { ...VERTICAL_LAYOUT, maxLineUnits: 4 });
    expect(p.lines.length).toBeGreaterThanOrEqual(3);
    // A linha «olha» (que acaba em 0,4) se segura até o começo de «essa» (0,4) — contígua, sem piscar
    expect(p.lines[0].endMs).toBe(p.lines[1].startMs);
    // «velocidade» acaba em 1,2 antes de uma pausa de 1,8s → se segura só o teto de +0,8 = 2,0s, e não até 3,0
    const beforePause = p.lines[2];
    expect(beforePause.endMs).toBe(2000);
  });

  it("carries per-word speaker ids through for caption coloring", () => {
    const spoken = [
      { ...w("ana", 0, 0.4), speaker: 0 },
      { ...w("bia", 0.4, 0.8), speaker: 1 },
    ];
    const p = buildOverlayPayload(spoken, VERTICAL_LAYOUT);
    const flat = p.lines.flatMap((l) => l.words);
    expect(flat.find((x) => x.text === "ana")?.speaker).toBe(0);
    expect(flat.find((x) => x.text === "bia")?.speaker).toBe(1);
  });
});
