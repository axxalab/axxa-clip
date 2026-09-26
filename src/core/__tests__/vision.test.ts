import { describe, it, expect } from "vitest";
import {
  planFrameTimes,
  parseSheetVerdicts,
  sanitizeVisibleText,
  sheetUserPrompt,
  visualPeakRanges,
  collectVisionSignal,
  VISION_MAX_FRAMES,
  VISION_MIN_SPACING_SEC,
  type VisionChatFn,
} from "../highlight/vision";
import type { MediaSignals } from "../signals";

describe("planFrameTimes", () => {
  it("sem nenhum sinal, espalha uniformemente pelo material inteiro e não passa do teto", () => {
    const times = planFrameTimes(600, undefined);
    expect(times.length).toBe(VISION_MAX_FRAMES);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(VISION_MIN_SPACING_SEC);
    }
    expect(times[0]).toBeGreaterThanOrEqual(0.5);
    expect(times[times.length - 1]).toBeLessThanOrEqual(599.5);
  });

  it("o meio das janelas de sinal entra primeiro", () => {
    const signals: MediaSignals = {
      loudPeaks: [{ startSec: 100, endSec: 110 }],
      cutDense: [{ startSec: 300, endSec: 320 }],
    };
    const times = planFrameTimes(600, signals);
    expect(times).toContain(105); // meio de loudPeaks
    expect(times).toContain(310); // meio de cutDense
  });

  it("quando os meios das janelas ficam perto demais, só um é mantido (o intervalo mínimo)", () => {
    const signals: MediaSignals = {
      loudPeaks: [{ startSec: 100, endSec: 104 }],
      cutDense: [{ startSec: 101, endSec: 105 }], // meio em 103, a 1s do 102
    };
    const times = planFrameTimes(600, signals);
    const near = times.filter((t) => t >= 100 && t <= 105);
    expect(near.length).toBe(1);
  });

  it("os instantes que representam muito movimento ocupam no máximo dois terços da cota, e a cobertura uniforme do material inteiro é preservada", () => {
    const signals: MediaSignals = {
      loudPeaks: [],
      cutDense: [],
      activityKeyframes: Array.from({ length: 40 }, (_, index) => ({ t: 10 + index * 9, score: 1 - index / 100 })),
    };
    const times = planFrameTimes(600, signals, 27, 8);
    expect(times).toHaveLength(27);
    expect(times.some((time) => time > 500)).toBe(true);
  });

  it("num material curto a cota diminui sozinha, e os instantes ficam dentro dele", () => {
    const times = planFrameTimes(20, undefined);
    expect(times.length).toBeGreaterThan(0);
    expect(times.length).toBeLessThan(VISION_MAX_FRAMES);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(0.5);
      expect(t).toBeLessThanOrEqual(19.5);
    }
  });

  it("com duração inválida, devolve vazio", () => {
    expect(planFrameTimes(0, undefined)).toEqual([]);
    expect(planFrameTimes(-5, undefined)).toEqual([]);
  });
});

describe("parseSheetVerdicts", () => {
  it("mantém o texto na tela curto, de alta confiança e sem repetição, ignorando lixo e respeitando o teto", () => {
    const content = JSON.stringify({
      cells: [{ i: 1, energy: 7, note: "close do produto", visibleText: ["  HotClip  ", "hotclip", "sem texto", 3, "R$ 19,90", "A", "B", "C", "D"] }],
    });
    expect(parseSheetVerdicts(content, 1)).toEqual([
      { i: 1, energy: 7, note: "close do produto", visibleText: ["HotClip", "R$ 19,90", "A", "B", "C"] },
    ]);
    expect(sanitizeVisibleText("not-an-array")).toEqual([]);
  });
  it("lê a saída em lote do mosaico padrão de nove células", () => {
    const content = '{"cells":[{"i":1,"energy":8,"note":"duas pessoas discutindo forte"},{"i":2,"energy":3,"note":"locução estática"}]}';
    expect(parseSheetVerdicts(content, 9)).toEqual([
      { i: 1, energy: 8, note: "duas pessoas discutindo forte" },
      { i: 2, energy: 3, note: "locução estática" },
    ]);
  });

  it("continua sendo possível ler depois de remover o bloco de raciocínio e o texto em volta", () => {
    const content = '<think>vamos ver a primeira célula…</think>resultado: {"cells":[{"i":1,"energy":3,"note":"locução"}]}';
    expect(parseSheetVerdicts(content, 9)).toEqual([{ i: 1, energy: 3, note: "locução" }]);
  });

  it("número de célula fora do intervalo é descartado, célula repetida fica com a primeira e energy volta para a faixa de 0 a 10", () => {
    const content =
      '{"cells":[{"i":0,"energy":9},{"i":10,"energy":9},{"i":2,"energy":99},{"i":2,"energy":1},{"i":3,"energy":-4}]}';
    expect(parseSheetVerdicts(content, 9)).toEqual([
      { i: 2, energy: 10, note: "" },
      { i: 3, energy: 0, note: "" },
    ]);
  });

  it("as células além de cellCount são filtradas (o último mosaico não vem cheio)", () => {
    const content = '{"cells":[{"i":1,"energy":5},{"i":8,"energy":5}]}';
    expect(parseSheetVerdicts(content, 2)).toEqual([{ i: 1, energy: 5, note: "" }]);
  });

  it("saída inaproveitável devolve null", () => {
    expect(parseSheetVerdicts("este lote está todo muito bom", 9)).toBeNull();
    expect(parseSheetVerdicts('{"cells":"não é um array"}', 9)).toBeNull();
    expect(parseSheetVerdicts('{"cells":[{"i":1,"note":"sem nota"}]}', 9)).toBeNull();
    expect(parseSheetVerdicts("", 9)).toBeNull();
  });
});

describe("sheetUserPrompt", () => {
  it("informa o instante de cada célula em mm:ss", () => {
    const p = sheetUserPrompt([65, 130.6]);
    expect(p).toContain("1=01:05");
    expect(p).toContain("2=02:10");
  });
});

describe("visualPeakRanges", () => {
  it("os quadros de alta energia se abrem em trechos e são fundidos pelo intervalo", () => {
    const ranges = visualPeakRanges(
      [
        { t: 100, energy: 8 },
        { t: 106, energy: 9 }, // intervalo menor que o de fusão em relação ao trecho anterior → fundido
        { t: 300, energy: 7 },
        { t: 50, energy: 3 }, // abaixo do limite, então ignorado
      ],
      600
    );
    expect(ranges.length).toBe(2);
    expect(ranges[0].startSec).toBeCloseTo(96.5);
    expect(ranges[0].endSec).toBeCloseTo(109.5);
    expect(ranges[1].startSec).toBeCloseTo(296.5);
  });

  it("os trechos ficam presos dentro de [0, duração]", () => {
    const ranges = visualPeakRanges([{ t: 1, energy: 9 }, { t: 599, energy: 9 }], 600);
    expect(ranges[0].startSec).toBe(0);
    expect(ranges[ranges.length - 1].endSec).toBe(600);
  });

  it("sem nenhum quadro de alta energia, devolve um array vazio", () => {
    expect(visualPeakRanges([{ t: 10, energy: 2 }], 600)).toEqual([]);
  });
});

describe("collectVisionSignal (em lote por mosaico)", () => {
  const config = { baseUrl: "http://localhost:11434/v1", model: "qwen3-vl:4b" };
  const okSheet = async (): Promise<string> => "ZmFrZQ=="; // o base64 de "fake"
  /** Saída em lote com as nove notas de um mosaico cheio (um mosaico incompleto é filtrado pela leitura, conforme cellCount). */
  const cellsJson = (energy: number): string =>
    JSON.stringify({ cells: Array.from({ length: 9 }, (_, k) => ({ i: k + 1, energy, note: "" })) });

  it("caminho normal: um mosaico julga nove quadros em lote e delimita os trechos de alta energia", async () => {
    let calls = 0;
    const chat: VisionChatFn = async () => {
      calls++;
      return cellsJson(9);
    };
    const outcome = await collectVisionSignal({
      videoPath: "/v.mp4",
      durationSec: 300,
      config,
      composeSheet: okSheet,
      chat,
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.stats.framesScored).toBe(outcome!.stats.framesTotal);
    // 27 quadros usam só 3 chamadas — é para isso que o lote por mosaico existe
    expect(calls).toBe(Math.ceil(outcome!.stats.framesTotal / 9));
    expect(outcome!.visualPeaks.length).toBeGreaterThan(0);
    expect(outcome!.stats.peakCount).toBe(outcome!.visualPeaks.length);
  });

  it("passa a trilha de vídeo escolhida e o contrato de prévia de cor para cada mosaico", async () => {
    const seen: unknown[] = [];
    await collectVisionSignal({
      videoPath: "/v.mkv",
      durationSec: 30,
      config,
      analysis: { videoStreamIndex: 4 },
      composeSheet: async (_path, _times, analysis) => {
        seen.push(analysis);
        return "jpeg";
      },
      chat: async () => cellsJson(8),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => (value as { videoStreamIndex?: number }).videoStreamIndex === 4)).toBe(true);
  });

  it("com todos os endpoints fora do ar → fail-open devolvendo null", async () => {
    const chat: VisionChatFn = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const outcome = await collectVisionSignal({
      videoPath: "/v.mp4",
      durationSec: 300,
      config,
      composeSheet: okSheet,
      chat,
    });
    expect(outcome).toBeNull();
  });

  it("um mosaico que falha não afeta o resultado geral", async () => {
    let n = 0;
    const chat: VisionChatFn = async () => {
      n++;
      if (n === 2) throw new Error("tempo esgotado num mosaico");
      return cellsJson(2);
    };
    const outcome = await collectVisionSignal({
      videoPath: "/v.mp4",
      durationSec: 300,
      config,
      composeSheet: okSheet,
      chat,
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.stats.framesScored).toBeLessThan(outcome!.stats.framesTotal);
    expect(outcome!.visualPeaks).toEqual([]); // tudo com nota baixa, então nenhum sinal falso é dado
  });

  it("com a montagem falhando por completo (num material só de áudio, por exemplo) → null", async () => {
    const chat: VisionChatFn = async () => cellsJson(9);
    const outcome = await collectVisionSignal({
      videoPath: "/audio.mp3",
      durationSec: 300,
      config,
      composeSheet: async () => null,
      chat,
    });
    expect(outcome).toBeNull();
  });

  it("um cancelamento vindo de cima é propagado como está", async () => {
    const ac = new AbortController();
    ac.abort();
    const chat: VisionChatFn = async () => cellsJson(5);
    await expect(
      collectVisionSignal({
        videoPath: "/v.mp4",
        durationSec: 300,
        config,
        signal: ac.signal,
        composeSheet: okSheet,
        chat,
      })
    ).rejects.toThrow();
  });

  it("com o orçamento esgotado, o trabalho encerra com o que já foi obtido", async () => {
    let calls = 0;
    const chat: VisionChatFn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 40));
      return cellsJson(8);
    };
    const outcome = await collectVisionSignal({
      videoPath: "/v.mp4",
      durationSec: 600,
      config,
      composeSheet: okSheet,
      chat,
      budgetMs: 30, // só dá para rodar um mosaico
    });
    expect(calls).toBeLessThan(Math.ceil(VISION_MAX_FRAMES / 9));
    // o primeiro mosaico sempre termina → pelo menos nove quadros em mãos, e o sinal se sustenta
    expect(outcome).not.toBeNull();
    expect(outcome!.stats.framesScored).toBeGreaterThanOrEqual(9);
    expect(outcome!.stats.framesScored).toBeLessThan(outcome!.stats.framesTotal);
  });
});
