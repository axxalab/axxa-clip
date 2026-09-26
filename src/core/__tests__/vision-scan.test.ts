/**
 * O nível de varredura visual completa (v0.13): orçamento de quadros, escolha da
 * linha do tempo visual e o modo de varredura do collectVisionSignal (com chat e
 * montagem injetados, sem rodar ffmpeg nem endpoint de verdade).
 */
import { describe, it, expect } from "vitest";
import {
  scanFrameBudget,
  pickVisualNotes,
  collectVisionSignal,
  SCAN_MAX_FRAMES,
  SCAN_NOTES_MAX,
  VISION_MAX_FRAMES,
} from "../highlight/vision";

describe("scanFrameBudget", () => {
  it("um quadro a cada ~30 segundos, com o piso de um mosaico cheio e teto em 270", () => {
    expect(scanFrameBudget(60)).toBe(9); // até um material curto tem pelo menos 9 quadros
    expect(scanFrameBudget(3600)).toBe(120); // 1 hora = 120 quadros
    expect(scanFrameBudget(6 * 3600)).toBe(SCAN_MAX_FRAMES); // material longuíssimo trava no teto
    expect(scanFrameBudget(0)).toBe(0);
  });
});

describe("pickVisualNotes", () => {
  it("só entra quem atinge a energia, e depois de pegar os N maiores a ordem volta a ser a de tempo", () => {
    const scored = [
      { t: 300, energy: 8, note: "o momento em que deu errado" },
      { t: 100, energy: 9, note: "derrubou o produto" },
      { t: 200, energy: 3, note: "locução estática" }, // energia baixa é descartada
    ];
    expect(pickVisualNotes(scored)).toEqual([
      { t: 100, energy: 9, note: "derrubou o produto" },
      { t: 300, energy: 8, note: "o momento em que deu errado" },
    ]);
  });
  it("o texto na tela é preservado junto com a linha do tempo visual", () => {
    expect(pickVisualNotes([{ t: 20, energy: 9, note: "placar", visibleText: ["3 : 2"] }]))
      .toEqual([{ t: 20, energy: 9, note: "placar", visibleText: ["3 : 2"] }]);
  });
  it("o texto nítido de uma imagem estática de baixa energia ainda entra na evidência de seleção", () => {
    expect(pickVisualNotes([{ t: 20, energy: 2, note: "slide", visibleText: ["conversão 32% maior"] }]))
      .toEqual([{ t: 20, energy: 2, note: "slide", visibleText: ["conversão 32% maior"] }]);
  });
  it("a quantidade de itens tem teto", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ t: i * 10, energy: 7, note: `imagem ${i}` }));
    expect(pickVisualNotes(many)).toHaveLength(SCAN_NOTES_MAX);
  });
});

describe("collectVisionSignal no nível de varredura completa", () => {
  const config = { baseUrl: "http://localhost:11434/v1", model: "qwen3-vl:4b" };
  /** O julgamento injetado: cada célula com energy 7 e uma descrição. */
  const chat = async (_llm: unknown, _sys: string, user: string): Promise<string> => {
    const n = (user.match(/\d+=/g) ?? []).length;
    const cells = Array.from({ length: n }, (_, i) => `{"i":${i + 1},"energy":7,"note":"imagem ${i + 1}"}`);
    return `{"cells":[${cells.join(",")}]}`;
  };
  const composeSheet = async (): Promise<string> => "ZmFrZQ=="; // jpeg falso

  it("no nível de varredura, a quantidade de quadros cresce com a duração além da varredura rápida, e a linha do tempo visual volta", async () => {
    const out = await collectVisionSignal({
      videoPath: "/tmp/fake.mp4",
      durationSec: 3600,
      config,
      scan: true,
      composeSheet,
      chat,
    });
    expect(out).not.toBeNull();
    expect(out!.stats.framesTotal).toBeGreaterThan(VISION_MAX_FRAMES);
    expect(out!.stats.fullScan).toBe(true);
    expect(out!.stats.notedMoments).toBe(out!.visualNotes.length);
    expect(out!.visualNotes.length).toBeGreaterThan(0);
    expect(out!.visualNotes.length).toBeLessThanOrEqual(SCAN_NOTES_MAX);
    // a linha do tempo vem em ordem crescente de tempo
    const ts = out!.visualNotes.map((n) => n.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("na varredura rápida (o padrão) a linha do tempo não volta, e a estatística não traz fullScan", async () => {
    const out = await collectVisionSignal({
      videoPath: "/tmp/fake.mp4",
      durationSec: 3600,
      config,
      composeSheet,
      chat,
    });
    expect(out).not.toBeNull();
    expect(out!.visualNotes).toEqual([]);
    expect(out!.stats.fullScan).toBeUndefined();
    expect(out!.stats.framesTotal).toBeLessThanOrEqual(VISION_MAX_FRAMES);
  });
});
