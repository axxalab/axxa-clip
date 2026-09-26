/**
 * Primeiro bloco da v0.14, "publique e sobreviva": nota de transformação, sinal de
 * densidade útil, CSV do registro de distribuição, texto de sinalização de IA por
 * plataforma e a orientação do texto de publicação para salvamento.
 */
import { describe, it, expect } from "vitest";
import { transformScore, TRANSFORM_WARN_BELOW, type TransformInputs } from "../../shared/transform-score";
import { utilityDensity, utilityBoost, UTILITY_SAVE_WORTHY } from "../../shared/utility-density";
import { buildLedgerCsv, csvField } from "../ledger";
import { adaptPost } from "../publish-pack";
import { platformSpec } from "../../shared/platform-specs";
import { postTextFile, publishSystemPrompt, publishUserPrompt } from "../publish";
import { transformInputsFromRender } from "../export";
import { applyUtilitySignal } from "../highlight/detect";
import type { HighlightCandidate } from "../../shared/api-types";

const ALL_OFF: TransformInputs = {
  vertical: false, captions: false, recut: false, reopened: false, titleOverlay: false,
  autoZoom: false, bgm: false, sfx: false, stitched: false, translated: false, watermark: false,
};

describe("transformScore (nota de transformação)", () => {
  it("tudo desligado dá nota 0 e alerta (é um corte e publica), e os itens que faltam vêm ordenados por peso como sugestão", () => {
    const s = transformScore(ALL_OFF);
    expect(s.score).toBe(0);
    expect(s.level).toBe("warn");
    expect(s.missingTop).toEqual(["vertical", "captions", "recut"]);
  });
  it("a combinação padrão de fábrica (vertical + legenda + corte seco + cartela de título) passa da linha de alerta", () => {
    const s = transformScore({ ...ALL_OFF, vertical: true, captions: true, recut: true, titleOverlay: true });
    expect(s.score).toBeGreaterThanOrEqual(TRANSFORM_WARN_BELOW);
    expect(s.level).not.toBe("warn");
  });
  it("só a legenda não basta (20 pontos, alerta); com tudo ligado a nota trava em 100 e fica strong", () => {
    expect(transformScore({ ...ALL_OFF, captions: true }).level).toBe("warn");
    const all = Object.fromEntries(Object.keys(ALL_OFF).map((k) => [k, true])) as unknown as TransformInputs;
    const s = transformScore(all);
    expect(s.score).toBe(100);
    expect(s.level).toBe("strong");
    expect(s.missingTop).toEqual([]);
  });
});

describe("transformInputsFromRender (mapeia o que de fato aconteceu; um recuo não infla a nota)", () => {
  const render = {
    captionStyle: "keyword", captionsBurned: false, reframe: "center-crop" as const,
    edit: null, fillersRemoved: 0, retakesRemoved: 0, stitchedPieces: 0,
    loudnessNormalized: true, denoised: false, coldOpenSec: null, flashForward: false,
    openingHookBurned: false, translatedLines: 0, shotSnap: null, preciseAligned: false,
    sfxCues: 0, bgmMixed: false,
  };
  it("legenda que não foi queimada (captionsBurned=false) não ganha os pontos de legenda; o vertical é contado pelo reframe", () => {
    const inputs = transformInputsFromRender(render, {});
    expect(inputs.captions).toBe(false);
    expect(inputs.vertical).toBe(true);
    expect(inputs.recut).toBe(false);
  });
  it("o corte seco conta com qualquer um dos três em ação: emendas, vícios de linguagem ou repetições", () => {
    expect(transformInputsFromRender({ ...render, fillersRemoved: 2 }, {}).recut).toBe(true);
    expect(transformInputsFromRender({ ...render, edit: { splices: 3, keptSec: 10, removedSec: 2, cutRatio: 0.16 } }, {}).recut).toBe(true);
  });
});

describe("utilityDensity (densidade útil)", () => {
  it("passo, número e método encontrados dão nota alta; conversa fiada dá 0", () => {
    const dense = utilityDensity("Primeiro ferva a água a 100 graus, depois coloque duas colheres, e por fim esse método economiza 200 reais entre as 3 técnicas");
    expect(dense.score).toBeGreaterThanOrEqual(UTILITY_SAVE_WORTHY);
    expect(dense.hits.length).toBeGreaterThan(0);
    expect(utilityDensity("hahaha o tempo hoje está ótimo, pessoal").score).toBe(0);
  });
  it("o bônus é pequeno e tem teto (não derruba a ordenação por potencial viral)", () => {
    expect(utilityBoost(0)).toBe(0);
    expect(utilityBoost(10)).toBeLessThanOrEqual(6);
  });
});

describe("applyUtilitySignal (o retorno do décimo caminho)", () => {
  const cand = (over: Partial<HighlightCandidate>): HighlightCandidate => ({
    id: 1, startSec: 0, endSec: 20, text: "", title: "t", hook: "h", score: 80, reason: "r",
    boundary: "exact", keywords: [], recommended: true, reviewNote: "", ...over,
  });
  it("passando da linha, o candidato ganha bônus e etiqueta; candidato vindo de sinal e conversa fiada não mudam", () => {
    const out = applyUtilitySignal(
      [
        cand({ id: 1, text: "Primeiro olhe a tabela de composição, depois compare o preço por 100 mililitros; são três técnicas para guardar" }),
        cand({ id: 2, text: "hahaha que engraçado" }),
        cand({ id: 3, boundary: "signal", text: "Primeiro passo, segundo passo, terceiro passo" }),
      ],
      true
    );
    expect(out[0].utility).toBeDefined();
    expect(out[0].score).toBeGreaterThan(80);
    expect(out[0].reason).toContain("densidade útil");
    expect(out[1].utility).toBeUndefined();
    expect(out[2].utility).toBeUndefined();
  });
});

describe("CSV do registro de distribuição", () => {
  it("tem BOM, cabeçalho e escape, e as quatro colunas de publicação ficam em branco", () => {
    const csv = buildLedgerCsv([
      {
        file: "a.mp4", title: 'título com, vírgula e "aspas"', durationSec: 32.18, source: "/v/origem.mp4",
        sourceStartSec: 100.123, sourceEndSec: 132.3, pieces: 2, exportedAt: "2026-08-09T12:00:00Z",
        aigcLabel: true, transformScore: 66,
      },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Arquivo do vídeo,Título");
    expect(csv).toContain('"título com, vírgula e ""aspas"""');
    expect(csv).toContain("sim,66,,,,");
  });
  it("csvField só coloca aspas quando é necessário", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField(null)).toBe("");
  });
});

describe("texto de sinalização de IA por plataforma", () => {
  it("com o selo de IA ligado, o texto do pacote de publicação ganha a instrução daquela plataforma", () => {
    const spec = platformSpec("douyin")!;
    const withNote = adaptPost("titulo", undefined, spec, true);
    expect(withNote.text).toContain("[Sinalização de conteúdo por IA]");
    expect(withNote.text).toContain("conteúdo gerado por IA");
    expect(adaptPost("titulo", undefined, spec, false).text).not.toContain("IA");
  });
  it("com o selo de IA ligado, o .post.txt ganha a declaração geral", () => {
    const copy = { title: "t", hashtags: [], description: "d" };
    expect(postTextFile(copy, true)).toContain("Sinalização de conteúdo por IA");
    expect(postTextFile(copy)).not.toContain("Sinalização de conteúdo por IA");
  });
});

describe("orientação do texto de publicação para salvamento e busca", () => {
  it("o system prompt traz os pontos dos algoritmos de 2026, e a origem que vale salvar é marcada no user prompt", () => {
    expect(publishSystemPrompt(true)).toContain("salvamento");
    expect(publishSystemPrompt(true)).toContain("busca");
    expect(publishSystemPrompt(false)).toContain("save-worthy");
    const u = publishUserPrompt([
      { id: 1, title: "t", hook: "h", text: "x", keywords: [], saveWorthy: true },
      { id: 2, title: "t2", hook: "h2", text: "y", keywords: [] },
    ]);
    expect(u).toContain("[1] [vale salvar]");
    expect(u).not.toContain("[2] [vale salvar]");
  });
});
