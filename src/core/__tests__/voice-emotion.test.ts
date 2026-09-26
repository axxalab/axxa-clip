import { describe, it, expect } from "vitest";
import {
  stripSenseVoiceTag,
  isHotEmotion,
  isHotEvent,
  planVoiceScanWindows,
  mergeHitWindows,
  collectVoiceEmotionSignal,
  topByDuration,
  VOICE_WINDOW_SEC,
  VOICE_MAX_WINDOWS,
  type VoiceWindowTags,
} from "../voice-emotion";
import type { MediaSignals } from "../signals";

describe("stripSenseVoiceTag", () => {
  it("tira o embrulho <|TAG|> e normaliza em maiúsculas", () => {
    expect(stripSenseVoiceTag("<|HAPPY|>")).toBe("HAPPY");
    expect(stripSenseVoiceTag("<|Laughter|>")).toBe("LAUGHTER");
  });

  it("valor vazio e entrada que não é etiqueta não quebram (mesmo que o modelo mude de versão e de formato)", () => {
    expect(stripSenseVoiceTag(undefined)).toBe("");
    expect(stripSenseVoiceTag(null)).toBe("");
    expect(stripSenseVoiceTag("")).toBe("");
    expect(stripSenseVoiceTag("happy")).toBe("HAPPY");
  });
});

describe("julgamento das etiquetas quentes", () => {
  it("só riso, raiva e susto contam; o neutro e o para baixo não são estouro", () => {
    expect(isHotEmotion("<|HAPPY|>")).toBe(true);
    expect(isHotEmotion("<|ANGRY|>")).toBe(true);
    expect(isHotEmotion("<|SURPRISED|>")).toBe(true);
    expect(isHotEmotion("<|NEUTRAL|>")).toBe(false);
    expect(isHotEmotion("<|SAD|>")).toBe(false);
    expect(isHotEmotion(undefined)).toBe(false);
  });

  it("só risada, palmas e choro contam; a fala normal e a trilha não", () => {
    expect(isHotEvent("<|Laughter|>")).toBe(true);
    expect(isHotEvent("<|Applause|>")).toBe(true);
    expect(isHotEvent("<|Cry|>")).toBe(true);
    expect(isHotEvent("<|Speech|>")).toBe(false);
    expect(isHotEvent("<|BGM|>")).toBe(false);
  });
});

describe("planVoiceScanWindows", () => {
  it("sem sinal, a grade uniforme espalha tudo, com janela de duração fixa e sem sair do limite", () => {
    const windows = planVoiceScanWindows(300, undefined);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.startSec).toBeGreaterThanOrEqual(0);
      expect(w.endSec).toBeLessThanOrEqual(300);
      expect(w.endSec - w.startSec).toBeCloseTo(VOICE_WINDOW_SEC, 5);
    }
    // Ordenado no tempo (o mergeHitWindows depende de entrada ordenada)
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].startSec).toBeGreaterThanOrEqual(windows[i - 1].startSec);
    }
  });

  it("com pico de volume, a varredura vai primeiro à região do pico (o orçamento é gasto onde mais provavelmente há estouro)", () => {
    const signals: MediaSignals = {
      loudPeaks: [{ startSec: 100, endSec: 130 }],
      cutDense: [],
    };
    const windows = planVoiceScanWindows(600, signals);
    const inPeak = windows.filter((w) => w.startSec >= 95 && w.endSec <= 140).length;
    // A região do pico é só 5% do material, mas recebe bem mais de 5% das janelas
    expect(inPeak).toBeGreaterThan(3);
    expect(inPeak / windows.length).toBeGreaterThan(0.05);
  });

  it("o número de janelas não passa do teto, e material curtíssimo não gera janela", () => {
    expect(planVoiceScanWindows(36000, undefined).length).toBeLessThanOrEqual(VOICE_MAX_WINDOWS);
    expect(planVoiceScanWindows(0.5, undefined)).toEqual([]);
    expect(planVoiceScanWindows(0, undefined)).toEqual([]);
  });
});

describe("mergeHitWindows", () => {
  it("janelas vizinhas que acertaram viram um trecho, e as distantes formam trechos próprios", () => {
    const merged = mergeHitWindows(
      [
        { startSec: 10, endSec: 16 },
        { startSec: 18, endSec: 24 },
        { startSec: 100, endSec: 106 },
      ],
      4
    );
    expect(merged).toEqual([
      { startSec: 10, endSec: 24 },
      { startSec: 100, endSec: 106 },
    ]);
  });

  it("entrada vazia devolve vazio, sem alterar o que entrou", () => {
    const input = [{ startSec: 1, endSec: 7 }];
    const out = mergeHitWindows(input);
    expect(mergeHitWindows([])).toEqual([]);
    out[0].endSec = 999;
    expect(input[0].endSec).toBe(7); // o resultado da união é um objeto novo, sem contaminar quem chamou
  });
});

describe("topByDuration", () => {
  it("abaixo do teto devolve como está", () => {
    const rs = [{ startSec: 0, endSec: 5 }];
    expect(topByDuration(rs, 12)).toBe(rs);
  });

  it("passando do teto ficam os mais longos, não os mais antigos (pegar os N primeiros seria olhar só o começo)", () => {
    const rs = [
      { startSec: 0, endSec: 2 },
      { startSec: 10, endSec: 30 },
      { startSec: 40, endSec: 42 },
      { startSec: 50, endSec: 65 },
    ];
    const top = topByDuration(rs, 2);
    expect(top).toEqual([
      { startSec: 10, endSec: 30 },
      { startSec: 50, endSec: 65 },
    ]);
  });

  it("o resultado continua ordenado no tempo (quem consome usa a linha de tempo)", () => {
    const rs = Array.from({ length: 20 }, (_, i) => ({ startSec: i * 10, endSec: i * 10 + (20 - i) }));
    const top = topByDuration(rs, 5);
    for (let i = 1; i < top.length; i++) expect(top[i].startSec).toBeGreaterThan(top[i - 1].startSec);
  });
});

describe("collectVoiceEmotionSignal", () => {
  const base = { videoPath: "/x.mp4", durationSec: 300, modelsRoot: "/models" };

  /** Um etiquetador falso que dá etiquetas por intervalo de tempo. */
  const tagger = (fn: (startSec: number) => VoiceWindowTags | null) => ({
    tagWindow: async (startSec: number): Promise<VoiceWindowTags | null> => fn(startSec),
  });

  it("as janelas que acertaram viram os trechos das duas trilhas, com a estatística fiel", async () => {
    const out = await collectVoiceEmotionSignal({
      ...base,
      deps: tagger((t) => {
        if (t >= 100 && t < 130) return { emotion: "HAPPY", event: "Laughter" };
        return { emotion: "NEUTRAL", event: "Speech" };
      }),
    });
    expect(out).not.toBeNull();
    expect(out!.voiceEmotionPeaks.length).toBeGreaterThan(0);
    expect(out!.audioEventPeaks.length).toBeGreaterThan(0);
    expect(out!.voiceEmotionPeaks[0].startSec).toBeGreaterThanOrEqual(95);
    expect(out!.stats.emotionPeakCount).toBe(out!.voiceEmotionPeaks.length);
    expect(out!.stats.windowsScored).toBeGreaterThanOrEqual(3);
  });

  it("neutro do começo ao fim → as duas trilhas ficam vazias, mas a varredura conta como bem-sucedida", async () => {
    const out = await collectVoiceEmotionSignal({
      ...base,
      deps: tagger(() => ({ emotion: "NEUTRAL", event: "Speech" })),
    });
    expect(out!.voiceEmotionPeaks).toEqual([]);
    expect(out!.audioEventPeaks).toEqual([]);
    expect(out!.stats.windowsScored).toBeGreaterThan(0);
  });

  it("a falha ao decodificar uma janela só pula aquela janela, sem derrubar a coleta inteira", async () => {
    let calls = 0;
    const out = await collectVoiceEmotionSignal({
      ...base,
      deps: {
        tagWindow: async (): Promise<VoiceWindowTags> => {
          calls++;
          if (calls % 3 === 0) throw new Error("decode failed");
          return { emotion: "HAPPY", event: "Speech" };
        },
      },
    });
    expect(out).not.toBeNull();
    expect(out!.stats.windowsScored).toBeGreaterThan(0);
    expect(out!.stats.windowsScored).toBeLessThan(out!.stats.windowsPlanned);
  });

  it("janelas bem-sucedidas de menos → evidência fraca, devolve null em vez de sinal falso", async () => {
    const out = await collectVoiceEmotionSignal({
      ...base,
      deps: { tagWindow: async (): Promise<null> => null },
    });
    expect(out).toBeNull();
  });

  it("com o orçamento esgotado, encerra com o que já tem (sem voltar de mãos vazias)", async () => {
    let n = 0;
    const out = await collectVoiceEmotionSignal({
      ...base,
      budgetMs: 60,
      deps: {
        tagWindow: async (): Promise<VoiceWindowTags> => {
          await new Promise((r) => setTimeout(r, 8));
          // Uma janela exaltada em três: há acerto, mas não satura
          return { emotion: n++ % 3 === 0 ? "HAPPY" : "NEUTRAL", event: "Speech" };
        },
      },
    });
    expect(out).not.toBeNull();
    expect(out!.stats.windowsScored).toBeLessThan(out!.stats.windowsPlanned);
    expect(out!.voiceEmotionPeaks.length).toBeGreaterThan(0);
  });

  it("acerto em toda janela → a trilha satura e é descartada inteira, em vez de marcar o material todo como estouro", async () => {
    const out = await collectVoiceEmotionSignal({
      ...base,
      deps: tagger(() => ({ emotion: "HAPPY", event: "Laughter" })),
    });
    expect(out).not.toBeNull();
    expect(out!.stats.emotionSaturated).toBe(true);
    expect(out!.stats.eventSaturated).toBe(true);
    expect(out!.voiceEmotionPeaks).toEqual([]);
    expect(out!.audioEventPeaks).toEqual([]);
  });

  it("o acerto alto de um stand-up (risada em cerca de 60% das janelas) não é saturação, e a duração separa as ondas mais fortes", async () => {
    // Medido na prática: num stand-up de 6 minutos, 36 das 58 janelas acertam risada, e o limite antigo de 0,6 jogaria a trilha inteira fora
    let n = 0;
    const out = await collectVoiceEmotionSignal({
      ...base,
      deps: {
        tagWindow: async (): Promise<VoiceWindowTags> => ({
          emotion: "NEUTRAL",
          event: n++ % 5 < 3 ? "Laughter" : "Speech", // 60% de acerto
        }),
      },
    });
    expect(out!.stats.eventSaturated).toBe(false);
    expect(out!.audioEventPeaks.length).toBeGreaterThan(0);
    expect(out!.audioEventPeaks.length).toBeLessThanOrEqual(12);
  });

  it("com taxa de acerto moderada (cerca de 30%) não há saturação, e o sinal sai normalmente", async () => {
    let n = 0;
    const out = await collectVoiceEmotionSignal({
      ...base,
      deps: {
        tagWindow: async (): Promise<VoiceWindowTags> => ({
          emotion: n++ % 3 === 0 ? "ANGRY" : "NEUTRAL",
          event: "Speech",
        }),
      },
    });
    expect(out!.stats.emotionSaturated).toBe(false);
    expect(out!.voiceEmotionPeaks.length).toBeGreaterThan(0);
  });

  it("material curtíssimo não tem janela de varredura → null", async () => {
    const out = await collectVoiceEmotionSignal({
      ...base,
      durationSec: 0.5,
      deps: tagger(() => ({ emotion: "HAPPY", event: "Laughter" })),
    });
    expect(out).toBeNull();
  });
});
