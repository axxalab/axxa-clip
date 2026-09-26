import { describe, it, expect } from "vitest";
import {
  mergePieces,
  normalizePieces,
  piecesDurationSec,
  clipDurationSec,
  isStitched,
  pieceCutSpans,
  planFromPieces,
  withinOnePiece,
  wordsInPieces,
  MIN_PIECE_SEC,
  MAX_PIECES,
  PIECE_PAD_AFTER_SEC,
  PIECE_PAD_BEFORE_SEC,
} from "../../shared/pieces";
import { subtractSpans, computeJumpCut } from "../gaps";

const p = (startSec: number, endSec: number): { startSec: number; endSec: number } => ({ startSec, endSec });

describe("normalizePieces", () => {
  it("ordena no tempo, e uma entrada fora de ordem volta para a ordem de reprodução", () => {
    expect(normalizePieces([p(100, 110), p(10, 20)])).toEqual([p(10, 20), p(100, 110)]);
  });

  it("descarta o intervalo inválido (invertido ou NaN)", () => {
    expect(normalizePieces([p(20, 10), p(NaN, 5), p(10, 20)])).toEqual([p(10, 20)]);
  });

  it("dois pedaços sobrepostos ou encostados se unem — aquele vãozinho não vale um corte", () => {
    expect(normalizePieces([p(10, 20), p(18, 26)])).toEqual([p(10, 26)]);
    expect(normalizePieces([p(10, 20), p(20.5, 26)])).toEqual([p(10, 26)]);
  });

  it("só com o intervalo suficientemente grande são dois pedaços", () => {
    expect(normalizePieces([p(10, 20), p(30, 40)])).toHaveLength(2);
  });

  it("o fragmento curto demais é descartado", () => {
    const out = normalizePieces([p(10, 20), p(100, 100 + MIN_PIECE_SEC - 0.5)]);
    expect(out).toEqual([p(10, 20)]);
  });

  it("quando todos são curtos demais, o mais longo fica (vira um pedaço só, em vez de apagar tudo)", () => {
    const out = normalizePieces([p(10, 11), p(100, 101.5)]);
    expect(out).toEqual([p(100, 101.5)]);
  });

  it("passando do teto, ficam os N mais longos, que voltam à ordem do tempo", () => {
    const out = normalizePieces([p(0, 3), p(100, 120), p(200, 210), p(300, 330), p(400, 415)]);
    expect(out).toHaveLength(MAX_PIECES);
    // O mais curto, (0,3), é eliminado; os que sobram continuam na ordem do tempo
    expect(out[0]).toEqual(p(100, 120));
    expect(out.map((x) => x.startSec)).toEqual([...out.map((x) => x.startSec)].sort((a, b) => a - b));
  });

  it("entrada vazia devolve vazio", () => {
    expect(normalizePieces([])).toEqual([]);
  });
});

describe("mergePieces (para a escolha manual: não corta pedaço nem descarta frase curta)", () => {
  it("com gap=0 só o que de fato se sobrepõe se une, e um intervalo mínimo continua sendo dois pedaços", () => {
    expect(mergePieces([p(10, 20), p(19, 26)], 0)).toEqual([p(10, 26)]);
    expect(mergePieces([p(10, 20), p(20.3, 26)], 0)).toEqual([p(10, 20), p(20.3, 26)]);
  });

  it("passando de 4 pedaços não há teto, e o pedaço curto também fica — nada do que a pessoa escolheu à mão pode ser perdido", () => {
    const six = [0, 1, 2, 3, 4, 5].map((i) => p(i * 10, i * 10 + 1));
    expect(mergePieces(six, 0)).toHaveLength(6);
  });

  it("o gap padrão usa o mesmo critério de união do normalizePieces", () => {
    expect(mergePieces([p(10, 20), p(20.5, 26)])).toEqual([p(10, 26)]);
  });
});

describe("o critério de duração", () => {
  it("a duração de um trecho colado é a soma dos pedaços, não o intervalo total", () => {
    const pieces = [p(10, 20), p(600, 615)];
    expect(piecesDurationSec(pieces)).toBe(25);
    expect(clipDurationSec({ startSec: 10, endSec: 615, pieces })).toBe(25);
  });

  it("com um pedaço ou sem lista de pedaços, vale a duração do intervalo", () => {
    expect(clipDurationSec({ startSec: 10, endSec: 25 })).toBe(15);
    expect(clipDurationSec({ startSec: 10, endSec: 25, pieces: [p(10, 25)] })).toBe(15);
  });

  it("isStitched só reconhece a partir de 2 pedaços", () => {
    expect(isStitched(undefined)).toBe(false);
    expect(isStitched([p(1, 2)])).toBe(false);
    expect(isStitched([p(1, 2), p(9, 10)])).toBe(true);
  });
});

describe("pieceCutSpans", () => {
  it("o vão entre pedaços deixa uma folga em cada ponta — a emenda não corta encostada na palavra", () => {
    const spans = pieceCutSpans([p(10, 20), p(100, 110)]);
    expect(spans).toEqual([{ startSec: 20 + PIECE_PAD_AFTER_SEC, endSec: 100 - PIECE_PAD_BEFORE_SEC }]);
  });

  it("um pedaço só não tem vão", () => {
    expect(pieceCutSpans([p(10, 20)])).toEqual([]);
  });

  it("três pedaços produzem dois vãos", () => {
    expect(pieceCutSpans([p(0, 10), p(50, 60), p(200, 210)])).toHaveLength(2);
  });

  it("depois do subtractSpans, o que sobra é exatamente cada pedaço (com a folga)", () => {
    const pieces = [p(10, 20), p(100, 110)];
    const kept = subtractSpans([{ startSec: 10, endSec: 110 }], pieceCutSpans(pieces));
    expect(kept).toHaveLength(2);
    expect(kept[0].startSec).toBe(10);
    expect(kept[0].endSec).toBeCloseTo(20 + PIECE_PAD_AFTER_SEC, 6);
    expect(kept[1].startSec).toBeCloseTo(100 - PIECE_PAD_BEFORE_SEC, 6);
    expect(kept[1].endSec).toBe(110);
  });
});

describe("planFromPieces", () => {
  it("a lista de pedaços é a lista de intervalos preservados, e o ponto de quebra de linha cai no instante de saída de cada emenda", () => {
    const plan = planFromPieces([p(10, 20), p(100, 115)]);
    expect(plan.segments).toEqual([p(10, 20), p(100, 115)]);
    expect(plan.durationSec).toBe(25);
    expect(plan.breaks).toEqual([10]);
    expect(plan.removedSec).toBe(105 - 25 + 0); // o intervalo total de 105 menos os 25 do vídeo pronto
    expect(plan.words).toEqual([]);
  });

  it("três pedaços têm dois pontos de quebra", () => {
    expect(planFromPieces([p(0, 5), p(50, 58), p(100, 103)]).breaks).toEqual([5, 13]);
  });
});

describe("a colagem reaproveita a máquina do corte seco (de ponta a ponta)", () => {
  it("manual boundaries exclude even very short unwanted speech between pieces", () => {
    const pieces = [{ startSec: 1, endSec: 3 }, { startSec: 3.1, endSec: 5 }];
    const spans = pieceCutSpans(pieces, { exact: true });
    expect(spans).toEqual([{ startSec: 3, endSec: 3.1 }]);
    const plan = computeJumpCut([
      { text: "keep", startSec: 1, endSec: 3 },
      { text: "also", startSec: 3.1, endSec: 5 },
    ], 1, 5, { forceCutSpans: spans, gapThresholdSec: Infinity });
    expect(plan.segments).toEqual(pieces);
    expect(plan.durationSec).toBeCloseTo(3.9);
  });
  // Dois pedaços: de 10 a 14s e de 100 a 104s, com 4 palavras cada; o vão entre eles entra como intervalo de corte forçado
  const words = [
    { text: "essa", startSec: 10, endSec: 11 },
    { text: "frase", startSec: 11, endSec: 12 },
    { text: "vem", startSec: 12, endSec: 13 },
    { text: "antes", startSec: 13, endSec: 14 },
    { text: "e", startSec: 100, endSec: 101 },
    { text: "depois", startSec: 101, endSec: 102 },
    { text: "ele", startSec: 102, endSec: 103 },
    { text: "desmente", startSec: 103, endSec: 104 },
  ];
  const pieces = [p(10, 14), p(100, 104)];

  it("mesmo com o corte seco desligado saem dois pedaços, e as palavras são reordenadas na linha de tempo comprimida", () => {
    const plan = computeJumpCut(words, 10, 104, {
      forceCutSpans: pieceCutSpans(pieces),
      gapThresholdSec: Infinity, // o corte seco está desligado — só o vão da colagem deve ser cortado
    });
    expect(plan.segments).toHaveLength(2);
    // A duração do vídeo pronto ≈ a soma dos dois pedaços (com a folga das pontas), muito menor que o intervalo de 94 segundos
    expect(plan.durationSec).toBeLessThan(12);
    expect(plan.breaks).toHaveLength(1);
    // As palavras do segundo pedaço são deslocadas para depois da emenda e já não carregam os 100 segundos do original
    const last = plan.words[plan.words.length - 1];
    expect(last.text).toBe("desmente");
    expect(last.endSec).toBeLessThan(12);
    expect(plan.words.map((w) => w.text).join(" ")).toBe("essa frase vem antes e depois ele desmente");
  });

  it("nem um segundo do que está no vão entra no vídeo pronto", () => {
    const plan = computeJumpCut(words, 10, 104, {
      forceCutSpans: pieceCutSpans(pieces),
      gapThresholdSec: Infinity,
    });
    const covered = (t: number): boolean => plan.segments.some((s) => t >= s.startSec && t <= s.endSec);
    expect(covered(50)).toBe(false);
    expect(covered(99)).toBe(false);
    expect(covered(12)).toBe(true);
    expect(covered(102)).toBe(true);
  });
});

describe("withinOnePiece", () => {
  const pieces = [p(10, 20), p(100, 110)];
  it("só conta o que cabe inteiro dentro de um pedaço", () => {
    expect(withinOnePiece(pieces, 11, 15)).toBe(true);
    expect(withinOnePiece(pieces, 100, 110)).toBe(true);
  });
  it("o intervalo que atravessa o vão não conta — copiar esse trecho no clímax na frente devolveria ao vídeo o que foi cortado", () => {
    expect(withinOnePiece(pieces, 15, 105)).toBe(false);
    expect(withinOnePiece(pieces, 19, 21)).toBe(false);
  });
});

describe("wordsInPieces", () => {
  it("só as palavras de dentro dos pedaços ficam, e as do vão são todas descartadas", () => {
    const words = [
      { text: "a", startSec: 11, endSec: 12 },
      { text: "b", startSec: 50, endSec: 51 },
      { text: "c", startSec: 101, endSec: 102 },
    ];
    expect(wordsInPieces(words, [p(10, 20), p(100, 110)]).map((w) => w.text)).toEqual(["a", "c"]);
  });

  it("o julgamento é pelo ponto médio da palavra, e a que fica na borda não conta nos dois lados", () => {
    const words = [{ text: "x", startSec: 19.6, endSec: 20.4 }];
    expect(wordsInPieces(words, [p(10, 20)])).toHaveLength(1); // o ponto médio 20,0 ainda está dentro do pedaço
  });
});
