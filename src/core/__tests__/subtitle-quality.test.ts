import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "../../shared/api-types";
import { VERTICAL_LAYOUT } from "../subtitle";
import { lintSubtitleTimeline } from "../subtitle-quality";

function word(text: string, startSec: number, endSec: number, timingSource?: TranscriptWord["timingSource"]): TranscriptWord {
  return { text, startSec, endSec, ...(timingSource ? { timingSource } : {}) };
}

describe("lintSubtitleTimeline", () => {
  it("passes a readable native timeline", () => {
    const report = lintSubtitleTimeline([
      word("essa", 0, 0.4, "native"),
      word("frase", 0.4, 0.8, "native"),
      word("está", 0.8, 1.2, "native"),
      word("normal.", 1.2, 2, "native"),
    ], VERTICAL_LAYOUT, "keyword");
    expect(report.status).toBe("pass");
    expect(report.lineCount).toBe(1);
    expect(report.uncertainWords).toBe(0);
  });

  it("reports overlap, excessive reading speed and uncertain timing", () => {
    const report = lintSubtitleTimeline([
      word("muito", 0, 0.1, "edited"),
      word("rápida a legenda", 0.04, 0.2, "interpolated"),
    ], VERTICAL_LAYOUT, "keyword");
    expect(report.status).toBe("error");
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "overlap",
      "reading-speed",
      "short-display",
      "uncertain-timing",
    ]));
    expect(report.uncertainWords).toBe(2);
  });

  it("does not label legacy words as uncertain", () => {
    const report = lintSubtitleTimeline([word("projeto", 0, 0.5), word("antigo", 0.5, 1.2)], VERTICAL_LAYOUT, "keyword");
    expect(report.uncertainWords).toBe(0);
    expect(report.issues.some((issue) => issue.code === "uncertain-timing")).toBe(false);
  });

  it("lints the same unbreakable keyword run used by the renderer", () => {
    const words = "muito bom de usar".split(" ").map((text, index) => word(text, index * 0.5, index * 0.5 + 0.5, "native"));
    const report = lintSubtitleTimeline(words, { ...VERTICAL_LAYOUT, maxLineUnits: 4 }, "keyword", [], ["muito bom de usar"]);
    expect(report.lineCount).toBe(1);
    expect(report.issues.some((issue) => issue.code === "oversize-token")).toBe(true);
  });
});
