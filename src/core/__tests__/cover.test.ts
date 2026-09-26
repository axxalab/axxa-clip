import { describe, it, expect } from "vitest";
import { pickCoverTime, fallbackCoverTime } from "../cover";
import type { PeakTrack } from "../audio-peaks";

/** Monta a trilha de picos: um bloco a cada 0,1s, com values passado direto e startSec como o início na origem. */
function track(values: number[], startSec: number): PeakTrack {
  return { values: Float32Array.from(values), startSec, hopSec: 0.1 };
}

describe("fallbackCoverTime", () => {
  it("0,8s depois do gancho, e num trecho curto o instante é aparado na duração", () => {
    expect(fallbackCoverTime(20)).toBe(0.8);
    expect(fallbackCoverTime(0.5)).toBeCloseTo(0.4);
  });
});

describe("pickCoverTime", () => {
  // O trecho vai de 10 a 20, e o pico está em 15s da origem
  const ranges = [{ startSec: 10, endSec: 20 }];

  it("escolhe o instante de maior volume dentro do trecho e o mapeia para o tempo de saída", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i === 50 ? 0.9 : 0.2)); // 15,0s na origem
    const at = pickCoverTime(track(values, 10), ranges, 10);
    expect(at).toBeCloseTo(5.0, 1); // 15s - 10s = 5s na saída
  });

  it("evita a faixa de guarda das pontas: um pico encostado na borda não é escolhido", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i === 1 ? 0.9 : i === 50 ? 0.5 : 0.1)); // o mais alto está em 10,1s (0,1s na saída, encostado na borda)
    const at = pickCoverTime(track(values, 10), ranges, 10);
    expect(at).toBeCloseTo(5.0, 1); // e o segundo mais alto, no meio, fica no lugar
  });

  it("corte seco com vários pedaços: o pico de uma região cortada não entra, e o tempo de saída acumula por pedaço", () => {
    // Pedaço 1 de 10 a 13 e pedaço 2 de 17 a 20; o mais alto está nos 15s que foram cortados, e o segundo está em 18s, dentro do pedaço 2
    const values = Array.from({ length: 100 }, (_, i) => {
      const t = 10 + i * 0.1;
      if (Math.abs(t - 15) < 0.05) return 1.0;
      if (Math.abs(t - 18) < 0.05) return 0.7;
      return 0.1;
    });
    const at = pickCoverTime(track(values, 10), [
      { startSec: 10, endSec: 13 },
      { startSec: 17, endSec: 20 },
    ], 6);
    expect(at).toBeCloseTo(4.0, 1); // o pedaço 1 ocupa 3s, e 18s fica a 1s do início do pedaço 2 → 4s na saída
  });

  it("sem trilha de picos, em silêncio total ou num trecho curtíssimo, volta ao quadro fixo", () => {
    expect(pickCoverTime(undefined, ranges, 10)).toBe(0.8);
    const silent = Array.from({ length: 100 }, () => 0.01);
    expect(pickCoverTime(track(silent, 10), ranges, 10)).toBe(0.8);
    expect(pickCoverTime(track([0.9], 10), ranges, 0.6)).toBeCloseTo(0.5);
  });
});
