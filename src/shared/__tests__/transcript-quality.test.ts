import { describe, expect, it } from "vitest";
import { summarizeTimingQuality, wordsForClip } from "../transcript-quality";

describe("qualidade do tempo da transcrição", () => {
  const words = [
    { text: "nativa", startSec: 0, endSec: 0.4, timingSource: "native" as const },
    { text: "editada", startSec: 0.4, endSec: 0.8, timingSource: "edited" as const },
    { text: "estimada", startSec: 0.8, endSec: 1.2, timingSource: "interpolated" as const },
    { text: "antiga", startSec: 4, endSec: 4.5 },
  ];

  it("agrupa as palavras incertas vizinhas e deixa o tempo legado como neutro", () => {
    const summary = summarizeTimingQuality(words);
    expect(summary.uncertainWords).toBe(2);
    expect(summary.uncertainSpans).toEqual([{ startSec: 0.4, endSec: 1.2, text: "editada estimada", wordCount: 2 }]);
    expect(summary.sourceCounts.legacy).toBe(1);
  });

  it("escolhe as palavras candidatas entre pedaços separados", () => {
    expect(wordsForClip(words, {
      startSec: 0,
      endSec: 5,
      pieces: [{ startSec: 0, endSec: 0.5 }, { startSec: 3.5, endSec: 5 }],
    }).map((word) => word.text)).toEqual(["nativa", "antiga"]);
  });
});
