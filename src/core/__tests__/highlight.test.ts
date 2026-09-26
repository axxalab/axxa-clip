import { describe, it, expect } from "vitest";
import { normalizeText, buildTokenIndex, matchQuote, resolveSelection } from "../highlight/match";
import { parseSelections, dropOverlaps, parseReviews, applyReviews, normalizeScores, clipLengthBounds, mergeProductKeywords } from "../highlight/detect";
import {
  buildHighlightPrompt,
  renderTranscriptLines,
  extractJson,
  isPortugueseTranscript,
  isMultiSpeaker,
  highlightSystemPrompt,
  renderSignals,
} from "../highlight/prompt";
import type { Transcript, TranscriptWord } from "../transcribe/types";
import type { HighlightCandidate } from "../../shared/api-types";

/** Monta uma transcrição a partir de frases: cada caractere vira um token de 0,2s. */
function makeTranscript(sentences: string[]): Transcript {
  let t = 0;
  let id = 0;
  const segments = sentences.map((text) => {
    id++;
    const words: TranscriptWord[] = Array.from(text).map((ch, i) => ({
      text: ch,
      startSec: t + i * 0.2,
      endSec: t + (i + 1) * 0.2,
    }));
    const seg = { id, startSec: words[0].startSec, endSec: words[words.length - 1].endSec, text, words };
    t = seg.endSec + 0.5;
    return seg;
  });
  return { language: "pt", segments, engine: "test", durationSec: t };
}

describe("normalizeText", () => {
  it("remove pontuação e espaços, deixa o latim em minúsculas e preserva a escrita ideográfica", () => {
    expect(normalizeText("Olá, mundo! Hello, World!")).toBe("olámundohelloworld");
    // A escrita ideográfica é preservada para o material gravado nesses idiomas
    // (escrito com escapes: o código-fonte não carrega ideogramas).
    expect(normalizeText("\u4f60\u597d\uff0c\u4e16\u754c\uff01 Hi!")).toBe("\u4f60\u597d\u4e16\u754chi");
  });
});

describe("matchQuote", () => {
  const tx = makeTranscript(["O tempo está ótimo hoje.", "Vamos falar sobre ganhar dinheiro.", "Lembre desta frase: não se empolgue."]);
  const index = buildTokenIndex(tx.segments.flatMap((s) => s.words));

  it("exact contiguous match returns precise token times", () => {
    const m = matchQuote(index, "Vamos falar sobre", " ganhar dinheiro.");
    expect(m).not.toBeNull();
    expect(m!.boundary).toBe("exact");
    expect(m!.startSec).toBeCloseTo(tx.segments[1].startSec, 3);
    expect(m!.endSec).toBeCloseTo(tx.segments[1].endSec, 3);
  });

  it("anchored match spans head→tail across sentences", () => {
    const m = matchQuote(index, "Vamos falar sobre ganhar", "não se empolgue.");
    expect(m).not.toBeNull();
    expect(m!.boundary).toBe("anchored");
    expect(m!.startSec).toBeCloseTo(tx.segments[1].startSec, 3);
    expect(m!.endSec).toBeCloseTo(tx.segments[2].endSec, 3);
  });

  it("quote punctuation differences do not break matching", () => {
    const m = matchQuote(index, "Lembre desta frase", "não se empolgue");
    expect(m).not.toBeNull();
  });

  it("returns null when text is absent", () => {
    expect(matchQuote(index, "uma frase que não existe", "e esta também não")).toBeNull();
  });
});

describe("resolveSelection", () => {
  const tx = makeTranscript(["A abertura foi bem sem graça.", "Mas a próxima frase explodiu.", "É essa a opinião que viralizou em todo lugar.", "Depois tudo voltou à calma."]);

  it("resolves via quotes scoped to declared segments", () => {
    const r = resolveSelection(tx, {
      title: "t", hook: "h", score: 90, reason: "r", keywords: [],
      startSegmentId: 2, endSegmentId: 3,
      quoteStart: "Mas a próxima", quoteEnd: "viralizou em todo lugar.",
    });
    expect(r).not.toBeNull();
    expect(r!.boundary).toBe("anchored");
    expect(r!.startSec).toBeCloseTo(tx.segments[1].startSec, 3);
    expect(r!.endSec).toBeCloseTo(tx.segments[2].endSec, 3);
    expect(r!.text).toContain("explodiu");
  });

  it("falls back to segment boundaries when quotes are hallucinated", () => {
    const r = resolveSelection(tx, {
      title: "t", hook: "h", score: 50, reason: "r", keywords: [],
      startSegmentId: 2, endSegmentId: 3,
      quoteStart: "uma frase inventada pelo LLM", quoteEnd: "que não bate com nada",
    });
    expect(r).not.toBeNull();
    expect(r!.boundary).toBe("segment");
    expect(r!.startSec).toBeCloseTo(tx.segments[1].startSec, 3);
  });

  it("returns null when nothing is locatable", () => {
    const r = resolveSelection(tx, {
      title: "t", hook: "h", score: 50, reason: "r", keywords: [],
      startSegmentId: 99, endSegmentId: 98,
      quoteStart: "não existe", quoteEnd: "também não existe",
    });
    expect(r).toBeNull();
  });
});

describe("parseSelections", () => {
  it("parses fenced JSON and clamps score", () => {
    const out = parseSelections('```json\n{"clips":[{"title":"gancho","score":150,"startSegmentId":1,"endSegmentId":2,"quoteStart":"abertura","quoteEnd":"encerramento"}]}\n```');
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(100);
  });

  it("drops rows without any locator and throws on non-JSON", () => {
    const out = parseSelections('{"clips":[{"title":"sem localizador"},{"quoteStart":"tem citação","startSegmentId":1,"endSegmentId":1,"quoteEnd":"x"}]}');
    expect(out).toHaveLength(1);
    expect(() => parseSelections("resumindo, não vou devolver JSON nenhum")).toThrow();
  });
});

describe("parseReviews / applyReviews", () => {
  it("parses verdicts and tolerates fenced JSON", () => {
    const out = parseReviews('```json\n{"reviews":[{"id":1,"keep":false,"score":30,"note":"sem graça"},{"id":2,"keep":true,"score":88}]}\n```');
    expect(out).toEqual([
      // A saída antiga não tem verdict: keep=false é deduzido como o nível
      // conservador review (e não drop)
      { id: 1, keep: false, gate: "review", score: 30, note: "sem graça" },
      { id: 2, keep: true, gate: "publish", score: 88, note: "" },
    ]);
  });

  it("parses the three-tier verdict field and keep follows it", () => {
    const out = parseReviews(
      '{"reviews":[{"id":1,"verdict":"publish","score":90},{"id":2,"verdict":"review","keep":true,"score":70,"note":"o final não fecha"},{"id":3,"verdict":"drop","score":20,"note":"só enchendo lista"},{"id":4,"verdict":"besteira","keep":true,"score":50}]}'
    );
    // keep é sempre deduzido do verdict (só publish vira true), então o modelo
    // preencher keep errado não muda o nível
    expect(out.map((r) => [r.gate, r.keep])).toEqual([
      ["publish", true],
      ["review", false],
      ["drop", false],
      ["publish", true], // verdict inválido volta a deduzir pelo keep
    ]);
  });

  it("applies verdicts and fails open for unreviewed ids", () => {
    const base = {
      startSec: 0, endSec: 10, text: "", title: "", hook: "", reason: "",
      boundary: "exact" as const, keywords: [], recommended: true, reviewNote: "",
    };
    const cands = [
      { ...base, id: 1, score: 90 },
      { ...base, id: 2, score: 80 },
    ];
    const out = applyReviews(cands, [{ id: 1, keep: false, gate: "drop", score: 35, note: "gancho fraco" }]);
    expect(out[0]).toMatchObject({ recommended: false, score: 35, reviewNote: "gancho fraco", gate: "drop", gateNotes: ["gancho fraco"] });
    expect(out[1]).toMatchObject({ recommended: true, score: 80 });
    expect(out[1].gate).toBeUndefined();
  });

  it("throws on malformed reviewer output", () => {
    expect(() => parseReviews("isso não é JSON de jeito nenhum")).toThrow();
  });

  it("parses four-dimension verdicts into a weighted composite", () => {
    const out = parseReviews(
      '{"reviews":[{"id":1,"keep":true,"hook":80,"hookNote":"forte","flow":60,"flowNote":"corre bem","value":100,"valueNote":"alto","trend":40,"trendNote":"mediano","teaser":"meio copo de água muda tudo?","note":"avaliação geral"}]}'
    );
    expect(out[0].dims).toEqual({ hook: 80, flow: 60, value: 100, trend: 40 });
    // 80*0,35 + 60*0,25 + 100*0,25 + 40*0,15 = 74
    expect(out[0].score).toBe(74);
    expect(out[0].dimNotes?.value).toBe("alto");
    expect(out[0].teaser).toBe("meio copo de água muda tudo?");
  });

  it("carries dims and teaser onto candidates via applyReviews", () => {
    const base = {
      startSec: 0, endSec: 10, text: "", title: "", hook: "", reason: "",
      boundary: "exact" as const, keywords: [], recommended: true, reviewNote: "",
    };
    const out = applyReviews(
      [{ ...base, id: 1, score: 90 }],
      [{ id: 1, keep: true, gate: "publish", score: 74, note: "", dims: { hook: 80, flow: 60, value: 100, trend: 40 }, teaser: "frase de gancho" }]
    );
    expect(out[0].scoreDims).toEqual({ hook: 80, flow: 60, value: 100, trend: 40 });
    expect(out[0].teaser).toBe("frase de gancho");
  });
});

describe("normalizeScores", () => {
  const base = {
    startSec: 0, endSec: 10, text: "", title: "", hook: "", reason: "",
    boundary: "exact" as const, keywords: [], recommended: true, reviewNote: "",
  };

  it("maps recommended clips onto 76-99 by rank, preserving order", () => {
    const out = normalizeScores([
      { ...base, id: 1, score: 74 },
      { ...base, id: 2, score: 88 },
      { ...base, id: 3, score: 60 },
    ]);
    expect(out.map((c) => c.id)).toEqual([1, 2, 3]); // array order untouched
    expect(out.find((c) => c.id === 2)?.score).toBe(99); // best
    expect(out.find((c) => c.id === 1)?.score).toBe(88); // middle: 99-23*1/2 rounded
    expect(out.find((c) => c.id === 3)?.score).toBe(76); // worst
  });

  it("a single recommended clip gets 97, rejected clips sit below 75", () => {
    const out = normalizeScores([
      { ...base, id: 1, score: 40 },
      { ...base, id: 2, score: 90, recommended: false },
    ]);
    expect(out.find((c) => c.id === 1)?.score).toBe(97);
    expect(out.find((c) => c.id === 2)?.score).toBe(62);
  });
});

describe("dropOverlaps", () => {
  const c = (id: number, s: number, e: number, score: number): HighlightCandidate => ({
    id, startSec: s, endSec: e, text: "", title: "", hook: "", score, reason: "", boundary: "exact", keywords: [], recommended: true, reviewNote: "",
  });

  it("keeps higher-scored clip among overlaps, renumbers by time order", () => {
    const kept = dropOverlaps([c(1, 0, 20, 70), c(2, 10, 30, 90), c(3, 40, 60, 50)]);
    expect(kept).toHaveLength(2);
    expect(kept[0].score).toBe(90);
    expect(kept.map((k) => k.id)).toEqual([1, 2]);
  });
});

describe("prompt builders", () => {
  const tx = makeTranscript(["Primeira frase.", "Segunda frase."]);

  it("renders [id] MM:SS lines", () => {
    const lines = renderTranscriptLines(tx).split("\n");
    expect(lines[0]).toMatch(/^\[1\] 00:00 Primeira frase\.$/);
    expect(lines[1]).toMatch(/^\[2\] 00:0\d Segunda frase\.$/);
  });

  it("prompt forbids timestamps and demands verbatim quotes", () => {
    const p = buildHighlightPrompt(tx);
    expect(p).toContain("quoteStart");
    expect(p).toContain("startSegmentId");
    expect(p).toContain("Transcrição");
  });

  it("extractJson handles fences and prose-wrapped objects", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('claro, o resultado é este {"a":1} confira')).toBe('{"a":1}');
  });

  it("prefixes speaker labels and injects attribution guidance when multi-speaker", () => {
    const multi = makeTranscript(["Fala do convidado.", "Pergunta de quem apresenta."]);
    multi.segments[0].speaker = 0;
    multi.segments[1].speaker = 1;
    expect(isMultiSpeaker(multi)).toBe(true);
    const lines = renderTranscriptLines(multi).split("\n");
    expect(lines[0]).toContain("S1: Fala do convidado.");
    expect(lines[1]).toContain("S2: Pergunta de quem apresenta.");
    expect(buildHighlightPrompt(multi)).toContain("Conversa com várias pessoas");
  });

  it("stays single-speaker (no S-prefix) when only one speaker present", () => {
    const one = makeTranscript(["Só tem uma pessoa.", "Continua sendo a mesma pessoa."]);
    one.segments[0].speaker = 0;
    one.segments[1].speaker = 0;
    expect(isMultiSpeaker(one)).toBe(false);
    expect(renderTranscriptLines(one)).not.toContain("S1:");
    expect(buildHighlightPrompt(one)).not.toContain("Conversa com várias pessoas");
  });
});

describe("escolha do idioma do prompt (português ou inglês)", () => {
  const ptTx = makeTranscript(["Hoje a gente vai falar de como transformar um vídeo longo em corte viral.", "O segredo é uma coisa só."]);
  const enTx: Transcript = {
    language: "en",
    engine: "test",
    durationSec: 10,
    segments: [
      {
        id: 1,
        startSec: 0,
        endSec: 4,
        text: "Today we talk about turning long videos into viral shorts.",
        words: [{ text: "Today", startSec: 0, endSec: 0.4 }],
      },
    ],
  };

  it("transcrição em português → prompt de sistema e de usuário em português", () => {
    expect(isPortugueseTranscript(ptTx)).toBe(true);
    expect(highlightSystemPrompt(ptTx)).toContain("estrategista");
    expect(buildHighlightPrompt(ptTx)).toContain("Transcrição");
  });

  it("transcrição em inglês → prompt de sistema e de usuário em inglês, sem vazar português", () => {
    expect(isPortugueseTranscript(enTx)).toBe(false);
    const sys = highlightSystemPrompt(enTx);
    const user = buildHighlightPrompt(enTx);
    expect(sys).toContain("clipping strategist");
    expect(user).toContain("Transcript");
    expect(sys).not.toContain("estrategista");
    // o prompt de usuário carrega só o texto da transcrição, que aqui é inglês
    expect(user).not.toContain("Transcrição");
  });

  it("com idioma auto, a detecção cai para a análise das palavras do texto", () => {
    const autoTx: Transcript = { ...ptTx, language: "auto" };
    expect(isPortugueseTranscript(autoTx)).toBe(true);
    const autoEn: Transcript = { ...enTx, language: "auto" };
    expect(isPortugueseTranscript(autoEn)).toBe(false);
  });
});

describe("faixas de duração do clipe", () => {
  it("standard mantém o system prompt original; short e long reescrevem a linha de duração nos dois idiomas", () => {
    const pt = makeTranscript(["Primeira frase.", "Segunda frase."]);
    expect(highlightSystemPrompt(pt)).toContain("Duração de 8 a 40 segundos");
    expect(highlightSystemPrompt(pt, "short")).toContain("Duração de 10 a 30 segundos (exigência rígida, melhor ficar abaixo do que passar)");
    expect(highlightSystemPrompt(pt, "long")).toContain("Duração de 40 a 90 segundos");
    const en: Transcript = { ...makeTranscript(["First sentence here.", "Second sentence there."]), language: "en" };
    expect(highlightSystemPrompt(en, "short")).toContain("Length 10–30 seconds (hard requirement)");
    expect(highlightSystemPrompt(en, "long")).toContain("Length 40–90 seconds");
  });

  it("clipLengthBounds: folga em torno do alvo, com piso absoluto de 4 segundos", () => {
    expect(clipLengthBounds("standard")).toEqual({ lo: 4, hi: 60 });
    expect(clipLengthBounds("short")).toEqual({ lo: 5, hi: 45 });
    expect(clipLengthBounds("long")).toEqual({ lo: 20, hi: 135 });
    expect(clipLengthBounds()).toEqual(clipLengthBounds("standard"));
  });
});

describe("renderSignals / signal injection", () => {
  const signals = {
    loudPeaks: [{ startSec: 192, endSec: 198 }],
    cutDense: [{ startSec: 500, endSec: 515 }],
  };

  it("renders bilingual signal blocks with MM:SS ranges", () => {
    const pt = renderSignals(signals, true);
    expect(pt).toContain("Sinais de imagem e som");
    expect(pt).toContain("03:12-03:18");
    const en = renderSignals(signals, false);
    expect(en).toContain("Audiovisual signals");
    expect(en).toContain("08:20-08:35");
  });

  it("empty signals render nothing", () => {
    expect(renderSignals({ loudPeaks: [], cutDense: [] }, true)).toBe("");
    expect(renderSignals(undefined, true)).toBe("");
  });

  it("a linha de pico de expressão facial só aparece quando emotionPeaks existe", () => {
    const withEmotion = { ...signals, emotionPeaks: [{ startSec: 30, endSec: 42 }] };
    const pt = renderSignals(withEmotion, true);
    expect(pt).toContain("Picos de expressão facial");
    expect(pt).toContain("00:30-00:42");
    expect(renderSignals(withEmotion, false)).toContain("Facial-emotion peaks");
    expect(renderSignals(signals, true)).not.toContain("expressão facial");
  });

  it("a linha de pico visual só aparece quando visualPeaks existe", () => {
    const withVision = { ...signals, visualPeaks: [{ startSec: 60, endSec: 72 }] };
    const pt = renderSignals(withVision, true);
    expect(pt).toContain("Picos visuais apontados pelo modelo de visão");
    expect(pt).toContain("01:00-01:12");
    expect(renderSignals(withVision, false)).toContain("Vision-model visual peaks");
    // Sem visualPeaks a linha não aparece (quem já chamava antes não sente nada)
    expect(renderSignals(signals, true)).not.toContain("modelo de visão");
  });

  it("buildHighlightPrompt embeds the signal section when provided", () => {
    const tx = makeTranscript(["Primeira frase.", "Segunda frase."]);
    expect(buildHighlightPrompt(tx, 6, signals)).toContain("Sinais de imagem e som");
    expect(buildHighlightPrompt(tx)).not.toContain("Sinais de imagem e som");
  });
});

describe("modo de apresentação de produto", () => {
  it("com produtos informados o system prompt ganha o bloco de produto nos dois idiomas; sem eles, nada é acrescentado", () => {
    const pt = makeTranscript(["Primeira frase.", "Segunda frase."]);
    expect(highlightSystemPrompt(pt)).not.toContain("Modo de apresentação de produto");
    const ptSys = highlightSystemPrompt(pt, "standard", ["lenço de papel", "creme facial"]);
    expect(ptSys).toContain("[Modo de apresentação de produto]");
    expect(ptSys).toContain("lenço de papel, creme facial");
    expect(ptSys).toContain("isca de engajamento");
    expect(ptSys).toContain("keywords de cada candidato precisam conter");
    const en: Transcript = { ...makeTranscript(["First sentence here.", "Second sentence there."]), language: "en" };
    const enSys = highlightSystemPrompt(en, "standard", ["tissue"]);
    expect(enSys).toContain("[Product mode]");
    expect(enSys).toContain("tissue");
    // O bloco de produto do texto em inglês não carrega português junto
    expect(enSys).not.toContain("Modo de apresentação");
  });

  it("o bloco de produto e a reescrita da duração se somam", () => {
    const pt = makeTranscript(["Primeira frase.", "Segunda frase."]);
    const sys = highlightSystemPrompt(pt, "short", ["lenço de papel"]);
    expect(sys).toContain("Duração de 10 a 30 segundos (exigência rígida, melhor ficar abaixo do que passar)");
    expect(sys).toContain("[Modo de apresentação de produto]");
  });

  it("mergeProductKeywords: o produto encontrado entra nas keywords de forma determinística", () => {
    expect(mergeProductKeywords(["absorção", "teste real"], "olha a velocidade de absorção desse lenço de papel", ["lenço de papel", "creme facial"])).toEqual([
      "absorção",
      "teste real",
      "lenço de papel",
    ]);
  });

  it("mergeProductKeywords: lista de produtos vazia devolve tudo como está, e o que não é encontrado não entra", () => {
    expect(mergeProductKeywords(["a"], "um texto qualquer", [])).toEqual(["a"]);
    expect(mergeProductKeywords(["a"], "não citou produto nenhum", ["lenço de papel"])).toEqual(["a"]);
  });

  it("mergeProductKeywords: palavras latinas casam sem diferenciar maiúsculas e não são duplicadas", () => {
    // A busca não diferencia maiúsculas de minúsculas
    expect(mergeProductKeywords([], "The new iPhone case is great", ["iphone"])).toEqual(["iphone"]);
    // O que já está em keywords (com outra caixa) não entra de novo
    expect(mergeProductKeywords(["iPhone"], "the iphone case", ["IPHONE"])).toEqual(["iPhone"]);
    // Produto em branco é ignorado
    expect(mergeProductKeywords([], "some text", ["  ", ""])).toEqual([]);
  });
});
