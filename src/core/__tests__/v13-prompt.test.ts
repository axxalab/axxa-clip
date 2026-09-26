/**
 * Acréscimos de prompt da v0.13: briefing do usuário (briefSection), pedido de
 * corte feito por quem transmite e linha do tempo visual (renderSignals), os
 * três atos da venda (productSection + genre) e o julgamento em três níveis da
 * reavaliação (REVIEW).
 */
import { describe, it, expect } from "vitest";
import { briefSection, renderSignals, productSection, highlightSystemPrompt, buildReviewPrompt, BRIEF_MAX_CHARS } from "../highlight/prompt";
import { genreSection } from "../genre";
import type { Transcript, TranscriptWord } from "../transcribe/types";

function makeTranscript(sentences: string[]): Transcript {
  let t = 0;
  let id = 0;
  const segments = sentences.map((text) => {
    id++;
    const words: TranscriptWord[] = Array.from(text).map((ch, i) => ({
      text: ch,
      startSec: t + i * 0.2,
      endSec: t + (i + 1) * 0.2,
    }));
    const seg = { id, startSec: words[0].startSec, endSec: words[words.length - 1].endSec, text, words };
    t = seg.endSec + 0.5;
    return seg;
  });
  return { language: "pt", segments, engine: "test", durationSec: t };
}

describe("briefSection (briefing do usuário)", () => {
  it("injeta focus e exclude, e declara a prioridade e a proibição de encher lista", () => {
    const s = briefSection({ focus: "procure a parte do pós-venda dando errado", exclude: "nada de sorteio nem leitura de chat" }, true);
    expect(s).toContain("Procure especialmente: procure a parte do pós-venda dando errado");
    expect(s).toContain("Exclua explicitamente: nada de sorteio nem leitura de chat");
    expect(s).toContain("nunca encha a lista");
  });
  it("preencher só um dos campos já forma o bloco; com os dois vazios devolve string vazia", () => {
    expect(briefSection({ focus: "só o que fala de empreender" }, true)).toContain("Procure especialmente");
    expect(briefSection({ focus: "só o que fala de empreender" }, true)).not.toContain("Exclua explicitamente");
    expect(briefSection({}, true)).toBe("");
    expect(briefSection(undefined, true)).toBe("");
    expect(briefSection({ focus: "  " }, true)).toBe("");
  });
  it("briefing longo demais é truncado", () => {
    const s = briefSection({ focus: "a".repeat(BRIEF_MAX_CHARS * 2) }, true);
    // O briefing entra cortado exatamente no limite, não importa o tamanho do texto fixo em volta
    expect(s).toContain("a".repeat(BRIEF_MAX_CHARS));
    expect(s).not.toContain("a".repeat(BRIEF_MAX_CHARS + 1));
  });
  it("a versão em inglês usa o texto em inglês", () => {
    const s = briefSection({ exclude: "giveaways" }, false);
    expect(s).toContain("Explicitly exclude: giveaways");
  });
  it("highlightSystemPrompt pendura o bloco de briefing no final", () => {
    const tx = makeTranscript(["Primeira frase."]);
    const p = highlightSystemPrompt(tx, "standard", [], undefined, undefined, undefined, { focus: "a parte do pós-venda" });
    expect(p).toContain("[Briefing do usuário]");
    expect(p).toContain("a parte do pós-venda");
  });
});

describe("renderSignals: pedido de corte e linha do tempo visual", () => {
  it("o pedido de corte vira a evidência de maior valor e deixa claro que o conteúdo está antes dele", () => {
    const s = renderSignals({ loudPeaks: [], cutDense: [], clipCommandMarks: [754, 1810] }, true);
    expect(s).toContain("pediu o corte");
    expect(s).toContain("12:34");
    expect(s).toContain("30:10");
    expect(s).toContain("antes");
  });
  it("a linha do tempo visual traz horário e descrição", () => {
    const s = renderSignals(
      { loudPeaks: [], cutDense: [], visualNotes: [{ t: 65, energy: 9, note: "a pessoa derrubou o produto" }] },
      true
    );
    expect(s).toContain("Linha do tempo visual");
    expect(s).toContain("01:05 a pessoa derrubou o produto (9/10)");
  });
  it("sem os sinais novos, as linhas correspondentes não são impressas", () => {
    const s = renderSignals({ loudPeaks: [{ startSec: 1, endSec: 3 }], cutDense: [] }, true);
    expect(s).not.toContain("pediu o corte");
    expect(s).not.toContain("Linha do tempo visual");
  });
});

describe("três atos da venda (dor → demonstração → preço)", () => {
  it("productSection dá a orientação de costura em três atos e proíbe forçar", () => {
    const s = productSection(["lenço de papel"], true);
    expect(s).toContain("dor → demonstração → preço");
    expect(s).toContain("parts");
    expect(s).toContain("não force");
  });
  it("a versão em inglês faz o mesmo", () => {
    const s = productSection(["tissue"], false);
    expect(s).toContain("pain point → demo → price");
  });
  it("o critério do gênero shopping também traz os três atos (vale mesmo sem informar produtos)", () => {
    expect(genreSection("shopping", true)).toContain("dor → demonstração → preço");
    expect(genreSection("shopping", false)).toContain("pain→demo→price");
  });
});

describe("três níveis da reavaliação (camada de LLM da porta de qualidade)", () => {
  it("a instrução de reavaliação contém os três níveis de verdict e o exemplo de saída", () => {
    const tx = makeTranscript(["Primeira frase.", "Segunda frase."]);
    const p = buildReviewPrompt(tx, [
      { id: 1, title: "t", startSec: 0, endSec: 1, text: "Primeira frase." },
    ]);
    expect(p).toContain("verdict");
    expect(p).toContain('"verdict": "publish"');
  });
});
