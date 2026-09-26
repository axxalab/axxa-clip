/**
 * O canal guiado por sinais: quando a transcrição não tem conteúdo (dança, bichinho, comida, ar livre, rádio), é o único caminho que ainda produz candidatos.
 */
import { describe, it, expect } from "vitest";
import {
  fuseMoments,
  speechRatio,
  shouldRunMoments,
  MOMENT_WEIGHTS,
  MOMENT_SATURATION,
  SPARSE_SPEECH_RATIO,
  topMoments,
} from "../highlight/moments";
import { momentsToCandidates, parseMomentPicks, textInRange } from "../highlight/detect";
import type { MediaSignals } from "../signals";
import type { Transcript } from "../transcribe/types";

const r = (startSec: number, endSec: number): { startSec: number; endSec: number } => ({ startSec, endSec });
const empty: MediaSignals = { loudPeaks: [], cutDense: [] };

/** Uma transcrição só com cumprimentos soltos (a típica live de dança). */
function sparseTranscript(durationSec = 600): Transcript {
  const segments = [
    { id: 1, startSec: 5, endSec: 8, text: "oi, gente", words: [] },
    { id: 2, startSec: 300, endSec: 303, text: "obrigada pelo presente", words: [] },
  ];
  return { language: "zh", segments, engine: "test", durationSec };
}

describe("speechRatio", () => {
  it("numa live de dança, com trechos longos em que ninguém fala, a proporção é bem baixa", () => {
    expect(speechRatio(sparseTranscript(600))).toBeCloseTo(6 / 600, 4);
  });

  it("num podcast que fala do começo ao fim, fica perto de 1", () => {
    const tx: Transcript = {
      language: "zh",
      engine: "t",
      durationSec: 100,
      segments: [{ id: 1, startSec: 0, endSec: 95, text: "falando sem parar", words: [] }],
    };
    expect(speechRatio(tx)).toBeGreaterThan(0.9);
  });

  it("duração 0 não quebra", () => {
    expect(speechRatio({ language: "zh", engine: "t", durationSec: 0, segments: [] })).toBe(0);
  });
});

describe("shouldRunMoments", () => {
  it("as categorias de reação e de imagem sempre rodam (a transcrição não é para ser confiada mesmo)", () => {
    expect(shouldRunMoments("visual", 0.9, 5)).toBe(true);
    expect(shouldRunMoments("reaction", 0.9, 5)).toBe(true);
  });

  it("com proporção de fala baixa demais, roda mesmo na categoria mais falante (o material fala por si)", () => {
    expect(shouldRunMoments("words", SPARSE_SPEECH_RATIO - 0.05, 5)).toBe(true);
  });

  it("quando o canal de texto produz pouco, este entra como reserva", () => {
    expect(shouldRunMoments("words", 0.9, 1)).toBe(true);
  });

  it("categoria falante + muita fala + canal de texto normal → não roda (economiza uma chamada de LLM)", () => {
    expect(shouldRunMoments("words", 0.9, 4)).toBe(false);
  });
});

describe("fuseMoments", () => {
  it("sem sinal devolve vazio, sem inventar instantes", () => {
    expect(fuseMoments(undefined, 600, { weights: MOMENT_WEIGHTS.visual, minSec: 10, maxSec: 30 })).toEqual([]);
    expect(fuseMoments(empty, 600, { weights: MOMENT_WEIGHTS.visual, minSec: 10, maxSec: 30 })).toEqual([]);
  });

  it("onde várias trilhas coincidem fica no topo; a prova solitária de uma trilha, muito mais fraca, não entra na lista", () => {
    const signals: MediaSignals = {
      loudPeaks: [r(100, 110)],
      cutDense: [r(100, 110)],
      visualPeaks: [r(100, 110)],
      danmakuPeaks: [r(100, 110)],
      // No outro ponto há só uma prova solitária de trilha de peso baixo — o bônus de ressonância e o piso de ruído a barram
      emotionPeaks: [r(400, 410)],
    };
    const out = fuseMoments(signals, 600, { weights: MOMENT_WEIGHTS.visual, minSec: 10, maxSec: 30 });
    expect(out.length).toBeGreaterThanOrEqual(1);
    const hot = [...out].sort((a, b) => b.heat - a.heat)[0];
    expect(hot.startSec).toBeLessThan(120);
    expect(hot.endSec).toBeGreaterThan(100);
    // A cadeia de evidências precisa listar os tipos de sinal que participaram
    expect(hot.evidence).toEqual(expect.arrayContaining(["loud", "cut", "visual", "danmaku"]));
    // A prova solitária fraca é barrada pelo piso de ruído (o prompt já dizia «a prova de uma trilha só pode ser descartada sem medo», e agora a matemática cumpre isso direto)
    expect(out.every((m) => m.startSec < 300)).toBe(true);
  });

  it("bônus de ressonância: duas trilhas somadas superam uma só de soma de pesos maior", () => {
    // Pesos de reação: voice=3 numa trilha só; loud+cut = 2+1 = 3, a mesma soma, mas com duas trilhas em ressonância
    const signals: MediaSignals = {
      loudPeaks: [r(100, 110)],
      cutDense: [r(100, 110)],
      voiceEmotionPeaks: [r(400, 410)],
    };
    const out = fuseMoments(signals, 600, { weights: MOMENT_WEIGHTS.reaction, minSec: 10, maxSec: 30 });
    const hot = [...out].sort((a, b) => b.heat - a.heat)[0];
    expect(hot.startSec).toBeLessThan(200); // o ponto de ressonância ganha
  });

  it("os instantes são ordenados no tempo e numerados de 1 em sequência (o LLM cita pelo número)", () => {
    const signals: MediaSignals = {
      loudPeaks: [r(500, 510)],
      cutDense: [r(100, 110)],
      danmakuPeaks: [r(300, 310)],
    };
    const out = fuseMoments(signals, 600, { weights: MOMENT_WEIGHTS.reaction, minSec: 10, maxSec: 30 });
    expect(out.map((m) => m.id)).toEqual(out.map((_, i) => i + 1));
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startSec).toBeGreaterThanOrEqual(out[i - 1].startSec);
    }
  });

  it("os instantes não se sobrepõem (um mesmo clímax não vira vários)", () => {
    const signals: MediaSignals = {
      loudPeaks: [r(100, 104), r(112, 116), r(124, 128)],
      cutDense: [],
      danmakuPeaks: [r(100, 128)],
    };
    const out = fuseMoments(signals, 600, { weights: MOMENT_WEIGHTS.reaction, minSec: 10, maxSec: 30 });
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startSec).toBeGreaterThanOrEqual(out[i - 1].endSec);
    }
  });

  it("o sinal aceso do começo ao fim é descontado — senão a curva achata e o pico degenera em aleatório", () => {
    // O chat cobre o material inteiro (muito acima do limite de saturação), e o volume só num ponto
    const saturated: MediaSignals = {
      loudPeaks: [r(200, 210)],
      cutDense: [],
      danmakuPeaks: [r(0, 600)],
    };
    const out = fuseMoments(saturated, 600, { weights: MOMENT_WEIGHTS.reaction, minSec: 10, maxSec: 30 });
    expect(out.length).toBeGreaterThan(0);
    // O pico tem de cair no ponto do volume, e não ser levado pelo chat do material inteiro
    const hot = [...out].sort((a, b) => b.heat - a.heat)[0];
    expect(hot.startSec).toBeLessThanOrEqual(210);
    expect(hot.endSec).toBeGreaterThanOrEqual(200);
    expect(MOMENT_SATURATION).toBeLessThan(1);
  });

  it("a duração da janela fica na faixa de duração de destino e não passa das bordas do material", () => {
    const signals: MediaSignals = { loudPeaks: [r(2, 6)], cutDense: [], danmakuPeaks: [r(2, 6)] };
    const out = fuseMoments(signals, 60, { weights: MOMENT_WEIGHTS.reaction, minSec: 10, maxSec: 30 });
    expect(out).toHaveLength(1);
    expect(out[0].startSec).toBeGreaterThanOrEqual(0);
    expect(out[0].endSec).toBeLessThanOrEqual(60);
    const dur = out[0].endSec - out[0].startSec;
    expect(dur).toBeGreaterThanOrEqual(10); // um pico curto também é completado até o piso, formando uma janela em que dá para ver o conteúdo inteiro
    expect(dur).toBeLessThanOrEqual(32);
  });

  it("a janela acompanha o conteúdo: clímax sustentado dá janela longa, e pico curto dá janela curta", () => {
    const sustained: MediaSignals = {
      loudPeaks: [r(100, 128)],
      cutDense: [],
      danmakuPeaks: [r(100, 128)],
    };
    const burst: MediaSignals = {
      loudPeaks: [r(300, 304)],
      cutDense: [],
      danmakuPeaks: [r(300, 304)],
    };
    const long = fuseMoments(sustained, 600, { weights: MOMENT_WEIGHTS.reaction, minSec: 10, maxSec: 40 });
    const short = fuseMoments(burst, 600, { weights: MOMENT_WEIGHTS.reaction, minSec: 10, maxSec: 40 });
    const durOf = (m: { startSec: number; endSec: number }): number => m.endSec - m.startSec;
    // Um clímax sustentado de 28 segundos recebe uma janela perto da sua duração real; um pico de 4 segundos só é completado até perto do piso
    expect(durOf(long[0])).toBeGreaterThan(20);
    expect(durOf(short[0])).toBeLessThan(durOf(long[0]));
    expect(durOf(short[0])).toBeGreaterThanOrEqual(10);
  });

  it("os pesos da categoria de imagem e da de reação são opostos: o mesmo conjunto de sinais elege instantes diferentes", () => {
    const signals: MediaSignals = {
      loudPeaks: [],
      cutDense: [],
      // No ponto A só imagem, no ponto B só entonação
      visualPeaks: [r(100, 115)],
      voiceEmotionPeaks: [r(400, 415)],
    };
    const vis = fuseMoments(signals, 600, { weights: MOMENT_WEIGHTS.visual, minSec: 10, maxSec: 30 });
    const rea = fuseMoments(signals, 600, { weights: MOMENT_WEIGHTS.reaction, minSec: 10, maxSec: 30 });
    const hottest = (a: typeof vis): number => [...a].sort((x, y) => y.heat - x.heat)[0].startSec;
    expect(hottest(vis)).toBeLessThan(200); // a categoria de imagem escolhe A
    expect(hottest(rea)).toBeGreaterThan(300); // a categoria de reação escolhe B
  });
});

describe("momentsToCandidates", () => {
  const tx = sparseTranscript(600);
  const moments = fuseMoments(
    { loudPeaks: [r(100, 110)], cutDense: [], visualPeaks: [r(100, 110)] },
    600,
    { weights: MOMENT_WEIGHTS.visual, minSec: 10, maxSec: 30 }
  );

  it("o tempo vem inteiramente dos sinais, e o boundary é marcado como signal", () => {
    const out = momentsToCandidates(tx, moments, [
      { momentId: 1, title: "o trecho do refrão", hook: "aquele giro", score: 88, reason: "imagem de alta energia + chat", keywords: ["no ritmo"] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].boundary).toBe("signal");
    expect(out[0].startSec).toBe(moments[0].startSec);
    expect(out[0].endSec).toBe(moments[0].endSec);
    expect(out[0].signalEvidence).toEqual(moments[0].evidence);
  });

  it("número inventado é descartado — nada de adivinhar tempo", () => {
    const out = momentsToCandidates(tx, moments, [
      { momentId: 999, title: "inventado", hook: "", score: 90, reason: "", keywords: [] },
    ]);
    expect(out).toEqual([]);
  });

  it("a palavra-chave não passa pelo filtro de «precisa aparecer no trecho» (ela descreve a imagem, não a fala)", () => {
    const out = momentsToCandidates(tx, moments, [
      { momentId: 1, title: "t", hook: "", score: 80, reason: "", keywords: ["movimento difícil"] },
    ]);
    expect(out[0].keywords).toEqual(["movimento difícil"]);
  });
});

describe("parseMomentPicks", () => {
  it("lê o JSON entre cercas e prende o score entre 0 e 100", () => {
    const out = parseMomentPicks('```json\n{"clips":[{"momentId":2,"title":"x","score":150}]}\n```');
    expect(out).toHaveLength(1);
    expect(out[0].momentId).toBe(2);
    expect(out[0].score).toBe(100);
  });

  it("a linha sem momentId é descartada; se o todo não é JSON, lança erro", () => {
    expect(parseMomentPicks('{"clips":[{"title":"sem numero"},{"momentId":1,"title":"com numero"}]}')).toHaveLength(1);
    expect(() => parseMomentPicks("eu acho que o terceiro trecho é bom")).toThrow();
  });
});

describe("textInRange", () => {
  it("pega as frases inteiras que se sobrepõem; numa live de dança pode não haver fala nenhuma", () => {
    const tx = sparseTranscript(600);
    expect(textInRange(tx, 0, 20)).toBe("oi, gente");
    expect(textInRange(tx, 100, 200)).toBe("");
  });
});

describe("topMoments", () => {
  it("abaixo do teto devolve como está", () => {
    const ms = [
      { id: 1, startSec: 0, endSec: 10, heat: 5, evidence: [] as never[] },
      { id: 2, startSec: 20, endSec: 30, heat: 9, evidence: [] as never[] },
    ];
    expect(topMoments(ms, 8)).toEqual(ms);
  });

  it("passando do teto, ficam os N mais quentes, que voltam à ordem do tempo e são renumerados", () => {
    const ms = [1, 2, 3, 4, 5].map((i) => ({
      id: i, startSec: i * 100, endSec: i * 100 + 20, heat: i === 2 ? 1 : 10 + i, evidence: [] as never[],
    }));
    const out = topMoments(ms, 3);
    expect(out).toHaveLength(3);
    // O mais frio, id=2, é eliminado
    expect(out.map((m) => m.startSec)).toEqual([300, 400, 500]);
    // A numeração tem de ser refeita em 1..n — é ela que está no prompt, e um deslocamento faria escolher o instante errado
    expect(out.map((m) => m.id)).toEqual([1, 2, 3]);
  });
});
