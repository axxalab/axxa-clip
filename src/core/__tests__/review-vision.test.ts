import { describe, it, expect } from "vitest";
import {
  planCandidateFrames,
  parseCandidateReview,
  applyCandidateReviews,
  reviewCandidatesVision,
  reviewUserPrompt,
  REVIEW_FRAMES_PER_CANDIDATE,
} from "../highlight/review-vision";
import type { HighlightCandidate } from "../../shared/api-types";

function cand(over: Partial<HighlightCandidate>): HighlightCandidate {
  return {
    id: 1,
    startSec: 100,
    endSec: 130,
    text: "este é um conteúdo de teste",
    title: "título de teste",
    hook: "gancho de teste",
    score: 80,
    reason: "justificativa original",
    boundary: "exact",
    keywords: [],
    recommended: true,
    reviewNote: "",
    ...over,
  } as HighlightCandidate;
}

describe("planCandidateFrames (amostragem dentro do candidato)", () => {
  it("num trecho único, espalha os quadros uniformemente, todos dentro do intervalo do candidato", () => {
    const times = planCandidateFrames({ startSec: 100, endSec: 130 });
    expect(times).toHaveLength(REVIEW_FRAMES_PER_CANDIDATE);
    for (const t of times) {
      expect(t).toBeGreaterThan(100);
      expect(t).toBeLessThan(130);
    }
  });

  it("num clipe costurado, distribui os quadros na proporção da duração de cada trecho, com pelo menos um por trecho e nenhum caindo no intervalo entre eles", () => {
    const pieces = [
      { startSec: 100, endSec: 124 }, // 24s
      { startSec: 200, endSec: 203 }, // 3s
    ];
    const times = planCandidateFrames({ startSec: 100, endSec: 203, pieces });
    expect(times.length).toBeLessThanOrEqual(REVIEW_FRAMES_PER_CANDIDATE);
    const inPiece = (t: number): boolean => pieces.some((p) => t > p.startSec && t < p.endSec);
    expect(times.every(inPiece)).toBe(true);
    expect(times.some((t) => t > 200)).toBe(true); // o trecho curto também recebeu quadro
  });
});

describe("parseCandidateReview (leitura da saída da revisão)", () => {
  it("JSON válido (inclusive com bloco de raciocínio e texto em volta) é lido com sucesso, e visual volta para a faixa de 0 a 10", () => {
    const v = parseCandidateReview('<think>hum</think>certo: {"visual":12,"scene":"o gato pulou no teclado","match":false}');
    expect(v).toEqual({ visual: 10, scene: "o gato pulou no teclado", match: false });
  });
  it("o texto na tela mantém só as strings curtas e volta estruturado para o candidato", () => {
    const review = parseCandidateReview('{"visual":8,"scene":"close da cartela de preço","match":true,"visibleText":["R$ 19,90"," R$ 19,90 ","por tempo limitado"]}')!;
    expect(review.visibleText).toEqual(["R$ 19,90", "por tempo limitado"]);
    const { candidates } = applyCandidateReviews([cand({ id: 1 })], new Map([[1, review]]));
    expect(candidates[0].visualEvidence).toEqual({ score: 8, scene: "close da cartela de preço", match: true, visibleText: ["R$ 19,90", "por tempo limitado"] });
    expect(candidates[0].reason).toContain("texto na tela: R$ 19,90 / por tempo limitado");
  });
  it("saída inaproveitável devolve null", () => {
    expect(parseCandidateReview("a imagem está muito boa")).toBeNull();
    expect(parseCandidateReview('{"scene":"sem nota"}')).toBeNull();
  });
});

describe("applyCandidateReviews (retorno da revisão)", () => {
  it("nota visual alta dá bônus e reordena; o ponto forte entra na justificativa", () => {
    const a = cand({ id: 1, score: 80 });
    const b = cand({ id: 2, score: 84 });
    const { candidates, stats } = applyCandidateReviews(
      [b, a],
      new Map([[1, { visual: 10, scene: "a plateia toda em alvoroço", match: true }]])
    );
    // a: 80 + min(12, (10-7)*4=12) = 92 > 84 → vai para o primeiro lugar
    expect(candidates[0].id).toBe(1);
    expect(candidates[0].score).toBe(92);
    expect(candidates[0].reason).toContain("revisão da imagem 10/10: a plateia toda em alvoroço");
    expect(stats).toEqual({ reviewed: 1, boosted: 1, demoted: 0 });
  });

  it("candidato vindo de sinal com imagem sem vida perde pontos; candidato comum com nota baixa só é registrado, sem desconto", () => {
    const sig = cand({ id: 1, score: 70, boundary: "signal" });
    const txt = cand({ id: 2, score: 70, boundary: "exact" });
    const reviews = new Map([
      [1, { visual: 1, scene: "cena estática e vazia", match: true }],
      [2, { visual: 1, scene: "locução estática", match: true }],
    ]);
    const { candidates, stats } = applyCandidateReviews([sig, txt], reviews);
    const outSig = candidates.find((c) => c.id === 1)!;
    const outTxt = candidates.find((c) => c.id === 2)!;
    expect(outSig.score).toBe(64); // o que sustenta um candidato vindo de sinal é a imagem, e imagem sem vida é evidência negativa
    expect(outTxt.score).toBe(70); // num candidato de texto a imagem sem graça é normal, e a nota não muda
    expect(stats.demoted).toBe(1);
  });

  it("a incoerência com o título gera aviso, sem mexer na nota", () => {
    const { candidates } = applyCandidateReviews(
      [cand({ id: 1, score: 75 })],
      new Map([[1, { visual: 5, scene: "o que o título diz não aparece na imagem", match: false }]])
    );
    expect(candidates[0].score).toBe(75);
    expect(candidates[0].reason).toContain("não combinar com o título");
  });
});

describe("reviewCandidatesVision (camada de execução, com injeção simulada)", () => {
  it("uma chamada por candidato; o que falha é pulado; a conclusão volta para o candidato", async () => {
    const calls: string[] = [];
    const result = await reviewCandidatesVision({
      videoPath: "/v.mp4",
      candidates: [cand({ id: 1, score: 80 }), cand({ id: 2, score: 78, startSec: 200, endSec: 230 })],
      config: { baseUrl: "http://x/v1", model: "m" },
      composeSheet: async () => "sheetbase64",
      chat: async (_llm, _sys, user) => {
        calls.push(user);
        // o segundo (como o título não distingue por id, vai pela ordem da chamada) devolve lixo de propósito
        if (calls.length === 2) return "saída inaproveitável";
        return '{"visual":9,"scene":"imagem de destaque","match":true}';
      },
    });
    expect(calls).toHaveLength(2);
    expect(result).not.toBeNull();
    expect(result!.stats.reviewed).toBe(1);
    expect(result!.candidates.find((c) => c.id === 1)!.score).toBe(88); // 80 + (9-7)*4
    expect(result!.candidates.find((c) => c.id === 2)!.score).toBe(78); // não revisado, fica como estava
  });

  it("se tudo falhar, devolve null (e quem chamou segue com os candidatos originais)", async () => {
    const result = await reviewCandidatesVision({
      videoPath: "/v.mp4",
      candidates: [cand({ id: 1 })],
      config: { baseUrl: "http://x/v1", model: "m" },
      composeSheet: async () => null,
    });
    expect(result).toBeNull();
  });

  it("o mosaico da revisão de candidato usa a mesma trilha de vídeo escolhida na renderização final", async () => {
    const seen: unknown[] = [];
    await reviewCandidatesVision({
      videoPath: "/v.mkv",
      candidates: [cand({ id: 1 })],
      config: { baseUrl: "http://x/v1", model: "m" },
      analysis: { videoStreamIndex: 2 },
      composeSheet: async (_path, _times, analysis) => {
        seen.push(analysis);
        return "sheet";
      },
      chat: async () => '{"visual":8,"scene":"subject","match":true}',
    });
    expect(seen).toEqual([{ videoStreamIndex: 2 }]);
  });

  it("o prompt de usuário leva o título, o gancho e o trecho (que é a base do julgamento de match)", () => {
    const p = reviewUserPrompt(cand({ title: "T", hook: "H", text: "X".repeat(300) }));
    expect(p).toContain("T");
    expect(p).toContain("H");
    expect(p.length).toBeLessThan(300); // o trecho é truncado
  });
});
