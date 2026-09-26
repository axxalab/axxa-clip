import { afterEach, describe, it, expect, vi } from "vitest";
import {
  chunkSegments,
  stripThinkBlocks,
  parseWindows,
  expandAndMergeWindows,
  filterTranscriptByIds,
  funnelStats,
  prefilterTranscript,
  prefilterUserPrompt,
  PREFILTER_MIN_CHARS,
  PREFILTER_CONCURRENCY,
  type ChatFn,
} from "../highlight/prefilter";
import type { Transcript, TranscriptSegment } from "../transcribe/types";

afterEach(() => vi.restoreAllMocks());

// Monta uma transcrição de n frases, com o texto de cada uma repetido até o tamanho pedido
function mockTranscript(n: number, charsPerSeg = 40): Transcript {
  const segments: TranscriptSegment[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    startSec: i * 4,
    endSec: i * 4 + 3.5,
    text: `conteudo da frase ${i + 1} `.padEnd(charsPerSeg, "a"),
    words: [],
  }));
  return { language: "zh", engine: "mock", durationSec: n * 4, segments };
}

describe("chunkSegments", () => {
  it("os blocos são formados pelo total de caracteres, sempre por frase inteira", () => {
    const t = mockTranscript(50, 100); // 5000 caracteres
    const chunks = chunkSegments(t.segments, 1000);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.flat().length).toBe(50); // nenhuma frase se perde
    for (const c of chunks) expect(c.length).toBeGreaterThan(0);
  });

  it("uma frase comprida demais também forma bloco (sem laço infinito)", () => {
    const t = mockTranscript(2, 5000);
    expect(chunkSegments(t.segments, 1000).length).toBe(2);
  });
});

describe("stripThinkBlocks / parseWindows", () => {
  const ids = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

  it("o bloco <think> é tirado antes de ler o JSON (a forma de saída de raciocínio do qwen3)", () => {
    const content = `<think>hum, {preciso pensar bem} neste trecho…</think>\n{"windows":[{"start":2,"end":5}]}`;
    expect(parseWindows(content, ids)).toEqual([{ start: 2, end: 5 }]);
    expect(stripThinkBlocks("<think>a</think>rest")).toBe("rest");
  });

  it("a janela com id inválido ou campo faltando é descartada; start>end são trocados sozinhos", () => {
    const content = `{"windows":[{"start":99,"end":100},{"start":5,"end":3},{"end":4}]}`;
    expect(parseWindows(content, ids)).toEqual([{ start: 3, end: 5 }]);
  });

  it("quando não há nada para ler, lança erro (e quem chama recua)", () => {
    expect(() => parseWindows("eu acho que está tudo bom!", ids)).toThrow();
    expect(() => parseWindows(`{"clips":[]}`, ids)).toThrow();
  });
});

describe("expandAndMergeWindows / filterTranscriptByIds", () => {
  const orderedIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("cada lado é esticado em pad frases e as sobreposições se unem", () => {
    const kept = expandAndMergeWindows([{ start: 4, end: 5 }, { start: 6, end: 7 }], orderedIds, 1);
    // 4-5 vira 3-6 e 6-7 vira 5-8 → unidos em 3-8
    expect([...kept].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("o esticar não passa das pontas da transcrição", () => {
    const kept = expandAndMergeWindows([{ start: 1, end: 2 }], orderedIds, 3);
    expect(Math.min(...kept)).toBe(1);
  });

  it("a transcrição filtrada preserva o id original (a citação da nuvem pode ser achada de volta no texto inteiro)", () => {
    const t = mockTranscript(10);
    const filtered = filterTranscriptByIds(t, new Set([3, 7]));
    expect(filtered.segments.map((s) => s.id)).toEqual([3, 7]);
    const stats = funnelStats(t, filtered);
    expect(stats.totalSegments).toBe(10);
    expect(stats.keptSegments).toBe(2);
    expect(stats.keptChars).toBeLessThan(stats.totalChars);
  });
});

describe("prefilterUserPrompt", () => {
  it("no modelo qwen3 é acrescentado /no_think, e nos outros não", () => {
    const seg = mockTranscript(2).segments;
    expect(prefilterUserPrompt(seg, true, "qwen3:4b")).toContain("/no_think");
    expect(prefilterUserPrompt(seg, true, "llama3.2:3b")).not.toContain("/no_think");
  });
});

describe("prefilterTranscript (com um chat falso injetado)", () => {
  const local = { baseUrl: "http://localhost:11434/v1", apiKey: "ollama", model: "qwen3:4b" };

  it("caminho normal: as janelas são cercadas → a transcrição é filtrada + a estatística do funil", async () => {
    const t = mockTranscript(100, 60); // 6000 caracteres, uns 3 blocos
    const chat: ChatFn = async (_l, _s, user) => {
      // Em cada bloco, a primeira e a segunda frase formam uma janela
      const m = user.match(/\[(\d+)\]/);
      const first = Number(m![1]);
      return `{"windows":[{"start":${first},"end":${first + 1}}]}`;
    };
    const out = await prefilterTranscript(t, local, chat);
    expect(out).not.toBeNull();
    expect(out!.transcript.segments.length).toBeLessThan(100 * 0.85);
    expect(out!.funnel.totalSegments).toBe(100);
    expect(out!.funnel.keptChars).toBeLessThan(out!.funnel.totalChars);
    // As frases que passaram preservam o id original
    expect(out!.transcript.segments.every((s) => t.segments.some((o) => o.id === s.id))).toBe(true);
  });

  it("transcrição curta demais não liga o funil", async () => {
    const t = mockTranscript(5, 40); // 200 caracteres, abaixo do limite
    expect(PREFILTER_MIN_CHARS).toBeGreaterThan(200);
    const chat: ChatFn = async () => `{"windows":[]}`;
    expect(await prefilterTranscript(t, local, chat)).toBeNull();
  });

  it("endpoint todo fora do ar → null (volta ao texto inteiro)", async () => {
    const t = mockTranscript(100, 60);
    const chat: ChatFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await prefilterTranscript(t, local, chat)).toBeNull();
  });

  it("o modelo pequeno julga que não há estouro nenhum → null (não é confiável, e o texto inteiro segue)", async () => {
    const t = mockTranscript(100, 60);
    const chat: ChatFn = async () => `{"windows":[]}`;
    expect(await prefilterTranscript(t, local, chat)).toBeNull();
  });

  it("a falha de um bloco → aquele bloco entra inteiro, e os outros continuam sendo filtrados", async () => {
    const t = mockTranscript(100, 60);
    let call = 0;
    const chat: ChatFn = async (_l, _s, user) => {
      if (call++ === 0) throw new Error("timeout"); // o primeiro bloco cai
      const m = user.match(/\[(\d+)\]/);
      const first = Number(m![1]);
      return `{"windows":[{"start":${first},"end":${first + 1}}]}`;
    };
    const out = await prefilterTranscript(t, local, chat);
    expect(out).not.toBeNull();
    // Todas as frases do primeiro bloco estão presentes (a falha em aberto escolhe «gastar mais» em vez de «perder conteúdo»)
    expect(out!.transcript.segments.some((s) => s.id === 1)).toBe(true);
  });

  it("se a filtragem tira pouco (≥85% fica), o funil não é ligado", async () => {
    const t = mockTranscript(20, 200); // um bloco de 4000 caracteres
    const chat: ChatFn = async () => `{"windows":[{"start":1,"end":20}]}`; // tudo passa
    expect(await prefilterTranscript(t, local, chat)).toBeNull();
  });

  it("um texto longo é processado em partes com concorrência limitada, e terminar fora de ordem não perde bloco", async () => {
    const t = mockTranscript(300, 100);
    let inFlight = 0, peak = 0, calls = 0;
    const completed: number[] = [];
    const chat: ChatFn = async (_llm, _system, user) => {
      calls++; inFlight++; peak = Math.max(peak, inFlight);
      const first = Number(user.match(/\[(\d+)\]/)![1]);
      await new Promise((resolve) => setTimeout(resolve, first === 1 ? 15 : 1));
      completed.push(first); inFlight--;
      return JSON.stringify({ windows: [{ start: first, end: first }] });
    };
    const out = await prefilterTranscript(t, local, chat);
    expect(peak).toBe(PREFILTER_CONCURRENCY);
    expect(calls).toBe(chunkSegments(t.segments).length);
    expect(completed[0]).not.toBe(1);
    expect(out).not.toBeNull();
    for (const first of completed) expect(out!.transcript.segments.some((s) => s.id === first)).toBe(true);
  });

  it("depois de a pessoa parar, nenhuma parte da fila é despachada, sem virar um recuo silencioso ao texto inteiro", async () => {
    const controller = new AbortController();
    let calls = 0;
    const chat: ChatFn = async () => {
      if (++calls === PREFILTER_CONCURRENCY) controller.abort(new Error("user-stopped"));
      return '{"windows":[]}';
    };
    await expect(prefilterTranscript(mockTranscript(300, 100), local, chat, controller.signal)).rejects.toThrow("user-stopped");
    expect(calls).toBe(PREFILTER_CONCURRENCY);
  });

  it("quando o orçamento total termina, o despacho para e o conteúdo não processado continua preservado", async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const t = mockTranscript(200, 100);
    const chunks = chunkSegments(t.segments);
    let calls = 0;
    const chat: ChatFn = async (_llm, _system, user) => {
      const first = Number(user.match(/\[(\d+)\]/)![1]);
      if (++calls === 4) timeout.abort();
      return JSON.stringify({ windows: [{ start: first, end: first }] });
    };
    const out = await prefilterTranscript(t, local, chat);
    expect(calls).toBe(4);
    // Se a filtragem tirar pouco, tudo volta ao texto inteiro; senão, o bloco não despachado tem de entrar inteiro na etapa seguinte.
    const retained = new Set((out?.transcript ?? t).segments.map((s) => s.id));
    for (const segment of chunks.slice(calls).flat()) expect(retained.has(segment.id)).toBe(true);
  });
});
