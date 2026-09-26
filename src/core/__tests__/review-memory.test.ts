import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadReviewMemory,
  recordReview,
  pickExamples,
  reviewMemorySection,
  type ReviewRecord,
  type ReviewedCandidate,
} from "../review-memory";
import { highlightSystemPrompt } from "../highlight/prompt";
import type { Transcript } from "../transcribe/types";

const cand = (title: string, over: Partial<ReviewedCandidate> = {}): ReviewedCandidate => ({
  title,
  hook: `o gancho de ${title}`,
  score: 80,
  durationSec: 20,
  ...over,
});

const rec = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  at: "2026-07-24T00:00:00.000Z",
  video: "gravacao-da-live.mp4",
  kept: [],
  rejected: [],
  ...over,
});

let root: string;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const freshDir = async (): Promise<string> => (root = await mkdtemp(join(tmpdir(), "hotclip-rm-")));

describe("loadReviewMemory / recordReview", () => {
  it("arquivo ausente ou JSON quebrado contam como vazio, sem lançar erro", async () => {
    const dir = await freshDir();
    expect(await loadReviewMemory(dir)).toEqual([]);
    await writeFile(join(dir, "review-memory.json"), "{oops", "utf8");
    expect(await loadReviewMemory(dir)).toEqual([]);
  });

  it("acrescenta e corta para as 40 sessões mais recentes; o que foi gravado é lido de volta", async () => {
    const dir = await freshDir();
    for (let i = 0; i < 42; i++) {
      await recordReview(dir, rec({ at: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`, kept: [cand(`clipe ${i}`)] }));
    }
    const all = await loadReviewMemory(dir);
    expect(all).toHaveLength(40);
    // As duas sessões mais antigas foram descartadas
    expect(all[0].kept[0].title).toBe("clipe 2");
    // O arquivo é mesmo JSON
    expect(JSON.parse(await readFile(join(dir, "review-memory.json"), "utf8"))).toHaveLength(40);
  });
});

describe("pickExamples", () => {
  it("as sessões mais recentes vêm primeiro, títulos repetidos saem e cada categoria vai até 6", () => {
    const records = [
      rec({ rejected: [cand("clipe antigo"), cand("clipe repetido")] }),
      rec({ rejected: [cand("clipe repetido"), cand("novo 1"), cand("novo 2"), cand("novo 3"), cand("novo 4"), cand("novo 5")] }),
    ];
    const out = pickExamples(records, "rejected");
    expect(out).toHaveLength(6);
    // A sessão mais recente fica na frente e "clipe repetido" aparece uma única vez
    expect(out.map((c) => c.title)).toEqual(["clipe repetido", "novo 1", "novo 2", "novo 3", "novo 4", "novo 5"]);
  });
});

describe("reviewMemorySection", () => {
  it("memória vazia devolve string vazia", () => {
    expect(reviewMemorySection([], true)).toBe("");
    expect(reviewMemorySection([rec()], true)).toBe("");
  });

  it("o bloco em português traz os exemplos descartados e aprovados mais a instrução de generalizar o padrão", () => {
    const s = reviewMemorySection(
      [rec({ rejected: [cand("conversa fiada na frente da câmera", { score: 88 })], kept: [cand("demonstração real", { keywords: ["lenço de papel"] })] })],
      true
    );
    expect(s).toContain("[Preferências de revisão do usuário]");
    expect(s).toContain("conversa fiada na frente da câmera");
    expect(s).toContain("nota 88");
    expect(s).toContain("demonstração real");
    expect(s).toContain("palavras-chave: lenço de papel");
    expect(s).toContain("Generalize o padrão");
  });

  it("o bloco em inglês tem a mesma estrutura", () => {
    const s = reviewMemorySection([rec({ rejected: [cand("talking head ramble")] })], false);
    expect(s).toContain("[User review history]");
    expect(s).toContain('"talking head ramble"');
  });
});

describe("injeção em highlightSystemPrompt", () => {
  const ptTranscript: Transcript = {
    language: "pt",
    durationSec: 60,
    segments: [{ id: 1, startSec: 0, endSec: 5, text: "Hoje eu trouxe para vocês um lenço de papel que é muito bom." }],
  } as Transcript;

  it("com memória, o system prompt carrega o bloco de preferências; sem memória, ele não muda", () => {
    const memory = [rec({ rejected: [cand("conversa fiada na frente da câmera")] })];
    const withMemory = highlightSystemPrompt(ptTranscript, "standard", [], undefined, memory);
    expect(withMemory).toContain("[Preferências de revisão do usuário]");
    const without = highlightSystemPrompt(ptTranscript, "standard", [], undefined, undefined);
    expect(without).not.toContain("[Preferências de revisão do usuário]");
  });
});
