import { describe, it, expect } from "vitest";
import {
  decodeBoundaries,
  snapClipToShots,
  snapContextAround,
  TRANSNET_FPS,
  SNAP_MAX_OUT_SEC,
  SNAP_MAX_IN_SEC,
} from "../shots";

describe("decodeBoundaries", () => {
  // Monta uma sequência de probabilidade de n quadros, pondo probabilidade alta nos quadros indicados
  const probsOf = (n: number, spikes: Record<number, number>) => {
    const p = new Array(n).fill(0.01);
    for (const [i, v] of Object.entries(spikes)) p[Number(i)] = v;
    return p;
  };

  it("pico num quadro só → a borda fica entre o quadro de pico e o seguinte", () => {
    // O quadro 99 é o último do corte antigo → borda = 100/25 = 4,0s
    expect(decodeBoundaries(probsOf(300, { 99: 0.97 }))).toEqual([4]);
  });

  it("um trecho contínuo acima do limite é reduzido ao quadro de pico, reportando uma borda só", () => {
    const p = probsOf(300, { 98: 0.6, 99: 0.95, 100: 0.7 });
    expect(decodeBoundaries(p)).toEqual([4]);
  });

  it("várias bordas independentes saem na ordem do tempo", () => {
    expect(decodeBoundaries(probsOf(300, { 99: 0.97, 199: 0.9 }))).toEqual([4, 8]);
  });

  it("abaixo do limite não há borda; sequência vazia não quebra nada", () => {
    expect(decodeBoundaries(probsOf(300, { 99: 0.49 }))).toEqual([]);
    expect(decodeBoundaries([])).toEqual([]);
  });

  it("a taxa de quadros personalizada entra na conta", () => {
    expect(decodeBoundaries(probsOf(100, { 49: 0.9 }), 50)).toEqual([1]);
    expect(TRANSNET_FPS).toBe(25);
  });
});

describe("snapClipToShots", () => {
  it("esticando para fora: o início encaixa numa borda um pouco antes e o fim numa borda um pouco depois", () => {
    const r = snapClipToShots(10.3, 40.5, [10.0, 41.0]);
    expect(r.snapped).toBe(true);
    expect(r.startSec).toBe(10.0);
    expect(r.endSec).toBe(41.0);
    expect(r.startDeltaSec).toBeCloseTo(-0.3);
    expect(r.endDeltaSec).toBeCloseTo(0.5);
  });

  it("borda além do teto de esticar não encaixa", () => {
    const r = snapClipToShots(10.3, 40.5, [10.3 - SNAP_MAX_OUT_SEC - 0.1, 40.5 + SNAP_MAX_OUT_SEC + 0.1]);
    expect(r.snapped).toBe(false);
    expect(r.startSec).toBe(10.3);
  });

  it("recolhendo para dentro: a primeira/última palavra de dentro precisa ser conhecida e a folga respeitada", () => {
    // Sem a informação das palavras → recolher é recusado
    expect(snapClipToShots(10, 40, [10.2, 39.8]).snapped).toBe(false);
    // Com a informação das palavras e a borda fora delas → recolher é permitido
    const ok = snapClipToShots(10, 40, [10.2, 39.8], {
      firstWordStartSec: 10.5,
      lastWordEndSec: 39.5,
    });
    expect(ok.startSec).toBe(10.2);
    expect(ok.endSec).toBe(39.8);
    // A borda cortaria uma palavra → recusado
    const cut = snapClipToShots(10, 40, [10.2], { firstWordStartSec: 10.21 });
    expect(cut.snapped).toBe(false);
  });

  it("o quanto se recolhe é limitado por SNAP_MAX_IN_SEC", () => {
    const r = snapClipToShots(10, 40, [10 + SNAP_MAX_IN_SEC + 0.1], {
      firstWordStartSec: 12,
    });
    expect(r.snapped).toBe(false);
  });

  it("esticar para fora não passa pela palavra imediatamente vizinha de fora do trecho", () => {
    // A palavra anterior só termina em 9,9s, e a borda em 10,0 fica a 0,1s dela, mais que a folga → permitido
    const ok = snapClipToShots(10.3, 40, [10.0], { prevWordEndSec: 9.9 });
    expect(ok.startSec).toBe(10.0);
    // A palavra vai até 9,98 → a borda em 10,0 fica a 0,02 dela, menos que a folga → recusado
    const blocked = snapClipToShots(10.3, 40, [10.0], { prevWordEndSec: 9.98 });
    expect(blocked.snapped).toBe(false);
    // No fim vale o mesmo
    const endBlocked = snapClipToShots(10, 40.5, [41.0], { nextWordStartSec: 41.01 });
    expect(endBlocked.snapped).toBe(false);
  });

  it("já estando na borda (deslocamento pequeno demais), não recorta", () => {
    expect(snapClipToShots(10.0, 40.0, [10.02, 40.03]).snapped).toBe(false);
  });

  it("guarda de duração: o encaixe não deixa o trecho curto demais", () => {
    // Num trecho de 1,2s, recolher os dois lados deixaria 0,5s → o encaixe é abandonado
    const r = snapClipToShots(10, 11.2, [10.3, 10.9], {
      firstWordStartSec: 10.5,
      lastWordEndSec: 10.7,
    });
    expect(r.endSec - r.startSec).toBeGreaterThanOrEqual(1);
  });

  it("sem bordas ou com intervalo inválido, devolve sem quebrar", () => {
    expect(snapClipToShots(10, 40, []).snapped).toBe(false);
    expect(snapClipToShots(40, 10, [20]).snapped).toBe(false);
  });
});

describe("snapContextAround", () => {
  const w = (startSec: number, endSec: number) => ({ startSec, endSec });
  const words = [w(1, 1.5), w(2, 2.5), w(9, 9.5), w(10.5, 11), w(20, 20.5), w(41, 41.5)];

  it("acha a palavra imediatamente vizinha de fora: o fim da anterior e o começo da seguinte", () => {
    expect(snapContextAround(words, 10, 40)).toEqual({
      prevWordEndSec: 9.5,
      nextWordStartSec: 41,
    });
  });

  it("sem palavra fora do trecho, é null (esticar é livre)", () => {
    expect(snapContextAround(words, 0.5, 50)).toEqual({
      prevWordEndSec: null,
      nextWordStartSec: null,
    });
    expect(snapContextAround([], 10, 40)).toEqual({
      prevWordEndSec: null,
      nextWordStartSec: null,
    });
  });

  it("palavra que atravessa a borda não conta como palavra de fora", () => {
    // A palavra de 10,5 a 11 está dentro do trecho e não deve servir de prev/next
    const ctx = snapContextAround(words, 10.2, 40);
    expect(ctx.prevWordEndSec).toBe(9.5);
  });
});
