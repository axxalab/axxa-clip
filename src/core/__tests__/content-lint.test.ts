import { describe, it, expect } from "vitest";
import { lintText, lintClipContent, formatLintIssue } from "../content-lint";

describe("lintText (varredura das palavras de risco das plataformas)", () => {
  it("encontra as expressões absolutas", () => {
    const hits = lintText("esse aqui é o menor preço da internet, campeão de vendas do Brasil e simplesmente imbatível");
    const terms = hits.map((h) => h.term.toLowerCase());
    expect(terms).toContain("menor preço da internet");
    expect(terms).toContain("campeão de vendas do brasil");
    expect(terms).toContain("imbatível");
    expect(hits.every((h) => h.category === "expressão absoluta")).toBe(true);
  });

  it("encontra as alegações médicas e as promessas, com a categoria correta", () => {
    const hits = lintText("resultado em 3 dias, combate a queda de cabelo e satisfação garantida ou seu dinheiro de volta");
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: "combate a queda de cabelo", category: "alegação médica" }),
        expect.objectContaining({ term: "resultado em 3 dias", category: "promessa exagerada" }),
        expect.objectContaining({ term: "satisfação garantida ou seu dinheiro de volta", category: "promessa exagerada" }),
      ])
    );
  });

  it("encontra as promessas de renda e as construções de desvio de plataforma", () => {
    const hits = lintText("ganha dormindo com lucro garantido; quem quiser me chama no WhatsApp ou comenta 1 que eu mando");
    const terms = hits.map((h) => h.term.toLowerCase());
    expect(terms).toContain("ganha dormindo");
    expect(terms).toContain("lucro garantido");
    expect(terms).toContain("me chama no whatsapp");
    expect(terms).toContain("comenta 1 que eu mando");
  });

  it("a mesma palavra aparecendo várias vezes é reportada uma só", () => {
    const hits = lintText("menor preço da internet! hoje é o menor preço da internet! ainda é o menor preço da internet!");
    expect(hits.filter((h) => h.term.toLowerCase() === "menor preço da internet")).toHaveLength(1);
  });

  it("fala do dia a dia não gera falso positivo (\"melhor\" e \"primeiro\" sozinhos não estão nas regras)", () => {
    expect(lintText("eu ando fazendo dieta, hoje é a minha primeira transmissão, e no fim a gente conversa")).toEqual([]);
    expect(lintText("essa função é muito boa de usar, vale a pena experimentar")).toEqual([]);
  });

  it("texto vazio devolve vazio", () => {
    expect(lintText("")).toEqual([]);
  });
});

describe("lintClipContent (varredura do material de um clipe inteiro)", () => {
  it("reporta separadamente por origem do material, e a legenda concatenada também revela o que atravessa palavras", () => {
    const hits = lintClipContent({
      title: "o segredo do menor preço da internet",
      hook: "assiste até o fim para saber como ganha dormindo",
      publish: { title: "compra isso", hashtags: ["#achadinho"], description: "100% original, resultado garantido", cta: "me chama no zap para o brinde" },
      // O reconhecimento de fala entrega palavra por palavra: só depois de concatenar é
      // que uma expressão que atravessa palavras pode ser encontrada
      captionText: "essa receita cura a doença do estômago de vez",
    });
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "title", category: "expressão absoluta" }),
        expect.objectContaining({ term: "ganha dormindo", source: "hook" }),
        expect.objectContaining({ term: "100% original", source: "publish" }),
        expect.objectContaining({ term: "resultado garantido", source: "publish" }),
        expect.objectContaining({ term: "me chama no zap", source: "publish" }),
        expect.objectContaining({ term: "cura a doença", source: "caption" }),
      ])
    );
  });

  it("a mesma palavra em materiais diferentes é reportada uma vez em cada (precisam ser corrigidas separadamente)", () => {
    const hits = lintClipContent({ title: "chegou o menor preço da internet", captionText: "hoje é o menor preço da internet" });
    expect(hits.filter((h) => h.term.toLowerCase() === "menor preço da internet")).toHaveLength(2);
  });

  it("tudo ausente ou material limpo → nenhuma ocorrência", () => {
    expect(lintClipContent({})).toEqual([]);
    expect(lintClipContent({ title: "vou compartilhar um método de estudo", captionText: "insistindo, o resultado vem" })).toEqual([]);
  });
});

describe("formatLintIssue (texto do aviso)", () => {
  it("sem ocorrências, devolve null", () => {
    expect(formatLintIssue([])).toBeNull();
  });

  it("cita a palavra, a categoria e a origem; passando de 5, o resto entra como \"em N ocorrências\"", () => {
    const one = formatLintIssue([{ term: "cura a doença", category: "alegação médica", source: "caption" }]);
    expect(one).toContain('"cura a doença"');
    expect(one).toContain("alegação médica");
    expect(one).toContain("legenda");
    const many = formatLintIssue(
      Array.from({ length: 7 }, (_, i) => ({ term: `palavra ${i}`, category: "expressão absoluta", source: "publish" as const }))
    );
    expect(many).toContain("em 7 ocorrências");
  });
});
