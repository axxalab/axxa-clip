import { describe, it, expect } from "vitest";
import {
  planEmotionFrameTimes,
  grayFaceTensor,
  softmax,
  emotionPeakScore,
  collectEmotionSignal,
  EMOTION_MAX_FRAMES,
  EMOTION_MIN_SPACING_SEC,
  FER_INPUT,
  type EmotionDeps,
} from "../emotion";
import type { MediaSignals } from "../signals";
import type { FaceBox } from "../reframe/yunet";

describe("planEmotionFrameTimes", () => {
  it("sem sinal, a amostragem é espalhada por igual, respeitando a distância e o teto", () => {
    const times = planEmotionFrameTimes(3600, undefined);
    expect(times.length).toBe(EMOTION_MAX_FRAMES);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(EMOTION_MIN_SPACING_SEC);
    }
  });

  it("dentro da janela de sinal a amostragem tem passo de 2s (mais densa que a uniforme do vídeo inteiro)", () => {
    const signals: MediaSignals = {
      loudPeaks: [{ startSec: 100, endSec: 110 }],
      cutDense: [],
    };
    const times = planEmotionFrameTimes(3600, signals);
    const inWindow = times.filter((t) => t >= 100 && t <= 110);
    expect(inWindow.length).toBeGreaterThanOrEqual(3); // janela de 10s / distância de 3s
  });

  it("duração inválida devolve vazio", () => {
    expect(planEmotionFrameTimes(0.5, undefined)).toEqual([]);
  });
});

describe("grayFaceTensor", () => {
  const SIZE = 64; // testado com quadro pequeno (o inputSize é parametrizado)

  function frame(fill: [number, number, number]): Uint8Array {
    const buf = new Uint8Array(SIZE * SIZE * 3);
    for (let i = 0; i < SIZE * SIZE; i++) {
      buf[i * 3] = fill[0];
      buf[i * 3 + 1] = fill[1];
      buf[i * 3 + 2] = fill[2];
    }
    return buf;
  }

  it("a saída é 64×64, o quadro branco dá ≈255 e o preto ≈0", () => {
    const box: FaceBox = { x: 16, y: 16, w: 32, h: 32, score: 0.9 };
    const white = grayFaceTensor(frame([255, 255, 255]), SIZE, box);
    expect(white.length).toBe(FER_INPUT * FER_INPUT);
    expect(white[FER_INPUT * 32 + 32]).toBeCloseTo(255, 0);
    const black = grayFaceTensor(frame([0, 0, 0]), SIZE, box);
    expect(black[FER_INPUT * 32 + 32]).toBe(0);
  });

  it("os pesos de cinza do BT.601: o verde fica mais claro que o azul", () => {
    const box: FaceBox = { x: 16, y: 16, w: 32, h: 32, score: 0.9 };
    // Quadro BGR: verde puro vs azul puro
    const green = grayFaceTensor(frame([0, 255, 0]), SIZE, box)[2080];
    const blue = grayFaceTensor(frame([255, 0, 0]), SIZE, box)[2080];
    expect(green).toBeGreaterThan(blue);
    expect(green).toBeCloseTo(0.587 * 255, 0);
    expect(blue).toBeCloseTo(0.114 * 255, 0);
  });

  it("com a caixa do rosto na borda, o esticar não passa do limite (sem lançar erro, com valores finitos)", () => {
    const box: FaceBox = { x: 0, y: 0, w: 20, h: 20, score: 0.9 };
    const out = grayFaceTensor(frame([128, 128, 128]), SIZE, box);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("softmax / emotionPeakScore", () => {
  it("o softmax normaliza e preserva a ordem", () => {
    const p = softmax([1, 3, 2]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(p[1]).toBeGreaterThan(p[2]);
    expect(p[2]).toBeGreaterThan(p[0]);
  });

  it("número grande não estoura", () => {
    const p = softmax([1000, 999]);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(Number.isFinite(p[0])).toBe(true);
  });

  it("a nota do pico usa o maior valor entre riso, susto e raiva, ignorando o neutro e a tristeza", () => {
    //          neutro alegre surpreso triste raivoso enojado com-medo desdenhoso
    expect(emotionPeakScore([0.9, 0.05, 0.02, 0, 0.03, 0, 0, 0])).toBeCloseTo(0.05);
    expect(emotionPeakScore([0.1, 0.2, 0.6, 0, 0.1, 0, 0, 0])).toBeCloseTo(0.6);
    expect(emotionPeakScore([0, 0, 0, 1, 0, 0, 0, 0])).toBe(0); // tristeza pura não conta como estouro
  });
});

describe("collectEmotionSignal", () => {
  const okFrame = new Uint8Array(640 * 640 * 3);
  const face: FaceBox = { x: 200, y: 200, w: 100, h: 100, score: 0.9 };

  function deps(overrides: Partial<EmotionDeps> = {}): EmotionDeps {
    return {
      extractFrame: async () => okFrame,
      detectFaces: async () => [face],
      scoreEmotion: async () => [0.1, 0.8, 0.05, 0, 0.05, 0, 0, 0], // alegre 0,8
      ...overrides,
    };
  }

  it("caminho normal: rosto + alegria → os trechos de pico de expressão são cercados", async () => {
    const outcome = await collectEmotionSignal({
      videoPath: "/v.mp4",
      durationSec: 300,
      modelsRoot: "/tmp/x",
      deps: deps(),
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.stats.facesScored).toBe(outcome!.stats.framesTotal);
    expect(outcome!.emotionPeaks.length).toBeGreaterThan(0);
    expect(outcome!.stats.peakCount).toBe(outcome!.emotionPeaks.length);
  });

  it("nenhum rosto em todo o material (paisagem, jogo) → null", async () => {
    const outcome = await collectEmotionSignal({
      videoPath: "/v.mp4",
      durationSec: 300,
      modelsRoot: "/tmp/x",
      deps: deps({ detectFaces: async () => [] }),
    });
    expect(outcome).toBeNull();
  });

  it("expressão neutra do começo ao fim → há estatística, mas nenhum pico (nada de sinal falso)", async () => {
    const outcome = await collectEmotionSignal({
      videoPath: "/v.mp4",
      durationSec: 300,
      modelsRoot: "/tmp/x",
      deps: deps({ scoreEmotion: async () => [0.95, 0.02, 0.01, 0, 0.02, 0, 0, 0] }),
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.emotionPeaks).toEqual([]);
  });

  it("a extração de quadros falha em tudo → null", async () => {
    const outcome = await collectEmotionSignal({
      videoPath: "/v.mp4",
      durationSec: 300,
      modelsRoot: "/tmp/x",
      deps: deps({ extractFrame: async () => null }),
    });
    expect(outcome).toBeNull();
  });

  it("a inferência que falha num quadro é pulada, sem atrapalhar o conjunto", async () => {
    let n = 0;
    const outcome = await collectEmotionSignal({
      videoPath: "/v.mp4",
      durationSec: 300,
      modelsRoot: "/tmp/x",
      deps: deps({
        scoreEmotion: async () => {
          if (++n % 4 === 0) throw new Error("falha num quadro");
          return [0.2, 0.7, 0.05, 0, 0.05, 0, 0, 0];
        },
      }),
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.stats.facesScored).toBeLessThan(outcome!.stats.framesTotal);
  });

  it("com o orçamento esgotado, encerra com o que já tem", async () => {
    let calls = 0;
    const outcome = await collectEmotionSignal({
      videoPath: "/v.mp4",
      durationSec: 3600,
      modelsRoot: "/tmp/x",
      budgetMs: 80,
      deps: deps({
        extractFrame: async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 15));
          return okFrame;
        },
      }),
    });
    expect(calls).toBeLessThan(EMOTION_MAX_FRAMES);
    if (outcome) expect(outcome.stats.facesScored).toBeGreaterThanOrEqual(3);
  });
});
