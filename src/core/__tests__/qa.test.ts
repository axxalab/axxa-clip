import { describe, it, expect } from "vitest";
import {
  parseBlackSpans,
  parseSilenceSpans,
  parseFreezeSpans,
  parseLoudnessSummary,
  summarizeSubjectCoverage,
  countMidWordCuts,
  assessClipQa,
  type QaAssessment,
} from "../qa";

// Simulação de trechos do stderr do ffmpeg (no mesmo formato da saída real)
const BLACK_LINES = [
  "[blackdetect @ 0x7f8a] black_start:12.04 black_end:12.92 black_duration:0.88",
  "frame=  100 fps= 50 q=-0.0 size=N/A",
  "[blackdetect @ 0x7f8a] black_start:30.5 black_end:31.1 black_duration:0.6",
].join("\n");

const SILENCE_LINES = [
  "[silencedetect @ 0x600] silence_start: 5.2",
  "[silencedetect @ 0x600] silence_end: 8.1 | silence_duration: 2.9",
  "[silencedetect @ 0x600] silence_start: 20.0",
].join("\n");

const FREEZE_LINES = [
  "[freezedetect @ 0x600] lavfi.freezedetect.freeze_start: 2.4",
  "[freezedetect @ 0x600] lavfi.freezedetect.freeze_duration: 3.8",
  "[freezedetect @ 0x600] lavfi.freezedetect.freeze_end: 6.2",
  "[freezedetect @ 0x600] lavfi.freezedetect.freeze_start: 20.0",
].join("\n");

const EBUR128_SUMMARY = `
[Parsed_ebur128_1 @ 0x600] Summary:

  Integrated loudness:
    I:         -14.2 LUFS
    Threshold: -24.9 LUFS

  Loudness range:
    LRA:         3.4 LU
    Threshold:  -34.6 LUFS
    LRA low:   -16.5 LUFS
    LRA high:  -13.1 LUFS

  True peak:
    Peak:       -1.4 dBFS
`;

describe("parseBlackSpans", () => {
  it("extrai os pares start/end que vêm na mesma linha", () => {
    expect(parseBlackSpans(BLACK_LINES)).toEqual([
      { startSec: 12.04, endSec: 12.92 },
      { startSec: 30.5, endSec: 31.1 },
    ]);
  });

  it("sem nenhuma correspondência, devolve um array vazio", () => {
    expect(parseBlackSpans("frame= 10 fps=25")).toEqual([]);
  });
});

describe("parseSilenceSpans", () => {
  it("empareia na ordem os start/end que vêm em linhas separadas; o que não fecha no final é fechado com a duração do fluxo", () => {
    expect(parseSilenceSpans(SILENCE_LINES, 25)).toEqual([
      { startSec: 5.2, endSec: 8.1 },
      { startSec: 20, endSec: 25 },
    ]);
  });

  it("sem a duração do fluxo, o silêncio final que não fecha é descartado", () => {
    expect(parseSilenceSpans(SILENCE_LINES)).toEqual([{ startSec: 5.2, endSec: 8.1 }]);
  });

  it("silence_start pode ser negativo (silêncio antes do começo, posto pelo codificador) e é preso em 0", () => {
    const spans = parseSilenceSpans("silence_start: -0.02\nsilence_end: 3.0 | silence_duration: 3.02");
    expect(spans).toEqual([{ startSec: 0, endSec: 3 }]);
  });
});

describe("parseFreezeSpans", () => {
  it("parses completed spans and closes a trailing freeze at EOF", () => {
    expect(parseFreezeSpans(FREEZE_LINES, 25)).toEqual([
      { startSec: 2.4, endSec: 6.2 },
      { startSec: 20, endSec: 25 },
    ]);
  });

  it("drops an unclosed trailing freeze without stream duration", () => {
    expect(parseFreezeSpans(FREEZE_LINES)).toEqual([{ startSec: 2.4, endSec: 6.2 }]);
  });
});

describe("summarizeSubjectCoverage", () => {
  it("summarizes clipped and severe sampled frames", () => {
    expect(summarizeSubjectCoverage([
      { minVisibleFraction: 1 },
      { minVisibleFraction: 0.85 },
      { minVisibleFraction: 0.4 },
    ])).toEqual({
      sampledFrames: 3,
      clippedFrames: 2,
      severeFrames: 1,
      clippedRatio: 0.667,
      worstVisibleFraction: 0.4,
    });
  });

  it("returns null when no face samples survived", () => {
    expect(summarizeSubjectCoverage([])).toBeNull();
  });
});

describe("parseLoudnessSummary", () => {
  it("pega o I e o pico real do resumo final", () => {
    expect(parseLoudnessSummary(EBUR128_SUMMARY)).toEqual({ integratedLufs: -14.2, truePeakDb: -1.4 });
  });

  it("com várias saídas, pega o último conjunto (o resumo fica no fim)", () => {
    const doubled = `I: -20.0 LUFS\nPeak: -5.0 dBFS\n${EBUR128_SUMMARY}`;
    expect(parseLoudnessSummary(doubled)).toEqual({ integratedLufs: -14.2, truePeakDb: -1.4 });
  });

  it("faltando o I ou o Peak, devolve null", () => {
    expect(parseLoudnessSummary("I: -14.0 LUFS")).toBeNull();
    expect(parseLoudnessSummary("")).toBeNull();
  });
});

describe("countMidWordCuts (conferência de palavra partida no corte)", () => {
  const words = [
    { text: "hoje", startSec: 10.0, endSec: 10.5 },
    { text: "transmito", startSec: 10.6, endSec: 11.2 },
    { text: "começa", startSec: 11.3, endSec: 12.0 },
  ];

  it("um corte no meio da palavra é contado", () => {
    // o início 10.9 cai dentro de "transmito" (10.6 a 11.2)
    expect(countMidWordCuts(words, [{ startSec: 10.9, endSec: 12.0 }])).toBe(1);
  });

  it("corte no limite da palavra ou no intervalo entre palavras não conta", () => {
    expect(countMidWordCuts(words, [{ startSec: 10.55, endSec: 12.0 }])).toBe(0); // no intervalo
    expect(countMidWordCuts(words, [{ startSec: 10.6, endSec: 12.0 }])).toBe(0); // no limite
  });

  it("encostar no limite dentro da tolerância não conta (é a janela da transição)", () => {
    // 10.63 está a só 0.03 do começo da palavra, em 10.6, dentro da tolerância
    expect(countMidWordCuts(words, [{ startSec: 10.63, endSec: 12.0 }])).toBe(0);
  });

  it("com várias partes do corte seco, os dois lados de cada emenda interna são conferidos", () => {
    const segs = [
      { startSec: 10.0, endSec: 10.9 }, // o fim corta dentro de "transmito"
      { startSec: 11.5, endSec: 12.0 }, // o começo corta dentro de "começa"
    ];
    expect(countMidWordCuts(words, segs)).toBe(2);
  });

  it("sem palavras ou sem trechos, devolve 0", () => {
    expect(countMidWordCuts([], [{ startSec: 0, endSec: 1 }])).toBe(0);
    expect(countMidWordCuts(words, [])).toBe(0);
  });
});

describe("assessClipQa (julgamento puro)", () => {
  const clean: QaAssessment = {
    durationSec: 30.1,
    expectedDurationSec: 30,
    blackSpans: [],
    silenceSpans: [],
    loudness: { integratedLufs: -14.2, truePeakDb: -1.4 },
    loudnessNormalized: true,
    midWordCuts: 0,
  };

  it("tudo aprovado → pass com issues vazio", () => {
    const r = assessClipQa(clean);
    expect(r.status).toBe("pass");
    expect(r.issues).toEqual([]);
  });

  it("desvio de duração além da tolerância → aviso", () => {
    const r = assessClipQa({ ...clean, durationSec: 28 });
    expect(r.status).toBe("warn");
    expect(r.issues[0]).toContain("desvia");
  });

  it("tela preta e silêncio longo → cada um vira um aviso", () => {
    const r = assessClipQa({
      ...clean,
      blackSpans: [{ startSec: 1, endSec: 2 }],
      silenceSpans: [{ startSec: 5, endSec: 8 }],
    });
    expect(r.issues).toHaveLength(2);
    expect(r.issues[0]).toContain("tela preta");
    expect(r.issues[1]).toContain("silêncio");
  });

  it("congelamento longo → aviso, preservando o intervalo legível por máquina", () => {
    const r = assessClipQa({ ...clean, frozenSpans: [{ startSec: 2.4, endSec: 6.2 }] });
    expect(r.issues[0]).toContain("imagem congelada");
    expect(r.frozenSpans).toEqual([{ startSec: 2.4, endSec: 6.2 }]);
  });

  it("rosto cortado de forma persistente → aviso de composição; poucas bordas leves não geram falso positivo", () => {
    const warn = assessClipQa({
      ...clean,
      subjectCoverage: {
        sampledFrames: 10,
        clippedFrames: 2,
        severeFrames: 0,
        clippedRatio: 0.2,
        worstVisibleFraction: 0.7,
      },
    });
    expect(warn.issues[0]).toContain("não preservam o rosto por inteiro");
    const pass = assessClipQa({
      ...clean,
      subjectCoverage: {
        sampledFrames: 20,
        clippedFrames: 1,
        severeFrames: 0,
        clippedRatio: 0.05,
        worstVisibleFraction: 0.85,
      },
    });
    expect(pass.status).toBe("pass");
  });

  it("desvio de volume e pico real acima do teto → só são conferidos com a normalização de volume ligada", () => {
    const off = { integratedLufs: -18, truePeakDb: -0.2 };
    const on = assessClipQa({ ...clean, loudness: off });
    expect(on.issues).toHaveLength(2);
    // sem a normalização de volume ligada: o desvio medido não é erro (a origem nunca foi normalizada)
    const offNorm = assessClipQa({ ...clean, loudness: off, loudnessNormalized: false });
    expect(offNorm.status).toBe("pass");
  });

  it("corte com palavra partida → aviso; com midWordCuts em null (sem palavras) não há aviso", () => {
    expect(assessClipQa({ ...clean, midWordCuts: 2 }).issues[0]).toContain("no meio de uma palavra");
    expect(assessClipQa({ ...clean, midWordCuts: null }).status).toBe("pass");
  });

  it("os números do relatório têm a precisão normalizada (para o JSON ficar legível)", () => {
    const r = assessClipQa({ ...clean, blackSpans: [{ startSec: 1.23456, endSec: 2.34567 }] });
    expect(r.blackSpans[0]).toEqual({ startSec: 1.23, endSec: 2.35 });
    expect(r.loudness).toEqual({ integratedLufs: -14.2, truePeakDb: -1.4 });
  });

  it("palavra proibida encontrada → um aviso de resumo, com a lista de ocorrências entrando como está no relatório", () => {
    const hits = [{ term: "o menor preço da internet", category: "expressão absoluta", source: "publish" as const }];
    const r = assessClipQa({ ...clean, contentHits: hits });
    expect(r.status).toBe("warn");
    expect(r.issues[0]).toContain('"o menor preço da internet"');
    expect(r.contentHits).toEqual(hits);
    // sem a checagem rodada (ausente) não há aviso, e contentHits fica null
    const off = assessClipQa(clean);
    expect(off.status).toBe("pass");
    expect(off.contentHits).toBeNull();
  });
});
