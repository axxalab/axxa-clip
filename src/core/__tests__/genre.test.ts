import { describe, it, expect } from "vitest";
import {
  GENRE_PRESETS,
  GENRE_CUSTOM_MAX_CHARS,
  genrePreset,
  genreSection,
  normalizeGenreId,
} from "../genre";

describe("genrePreset", () => {
  it("pega o preset correspondente pelo id", () => {
    expect(genrePreset("game").id).toBe("game");
    expect(genrePreset("show").labelPt).toContain("dança");
  });

  it("id desconhecido ou vazio volta para o preset geral, sem lançar erro", () => {
    expect(genrePreset("gênero que não existe").id).toBe("auto");
    expect(genrePreset(undefined).id).toBe("auto");
  });

  it("todo preset interno tem rótulo em português e em inglês, e todos menos auto/custom têm critérios", () => {
    for (const g of GENRE_PRESETS) {
      expect(g.labelPt).not.toBe("");
      expect(g.labelEn).not.toBe("");
      if (g.id !== "auto" && g.id !== "custom") {
        expect(g.criteriaPt.length).toBeGreaterThan(50);
        expect(g.criteriaEn.length).toBeGreaterThan(50);
      }
    }
  });

  it("não repete id (a lista não pode ter dois itens com o mesmo nome)", () => {
    const ids = GENRE_PRESETS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("a lista de gêneros acompanha as categorias reais das plataformas", () => {
  // A tabela de gêneros foi montada a partir das 11 categorias de primeiro nível
  // do Area/getList do Bilibili Live mais as categorias públicas do Douyin e do
  // Douyu. Estes são justamente os gêneros que ficaram de fora quando a lista foi
  // feita de cabeça e só entraram depois de olhar as categorias reais — a
  // regressão precisa protegê-los.
  it("cobre as categorias que mais facilmente ficam de fora", () => {
    const ids = GENRE_PRESETS.map((g) => g.id);
    for (const must of ["vtuber", "radio", "pet", "food", "esports", "craft", "cowatch", "looks", "sports"]) {
      expect(ids).toContain(must);
    }
  });

  it("todo preset declara sua classe de evidência, e as três classes têm representante", () => {
    const classes = new Set(GENRE_PRESETS.map((g) => g.evidence));
    expect(classes).toEqual(new Set(["words", "reaction", "visual"]));
    // Os gêneros em que a transcrição é mais inútil não podem ser words, senão o
    // canal de sinais simplesmente não roda
    for (const id of ["show", "pet", "food", "craft"]) {
      expect(genrePreset(id).evidence).toBe("visual");
    }
    for (const id of ["game", "outdoor", "vtuber", "radio", "esports"]) {
      expect(genrePreset(id).evidence).toBe("reaction");
    }
  });

  it("os ids guardados em preferências antigas continuam valendo (reordenar a lista não pode invalidar a configuração da máquina)", () => {
    expect(normalizeGenreId("live-sell")).toBe("shopping");
    expect(normalizeGenreId("gaming")).toBe("game");
    expect(normalizeGenreId("lecture")).toBe("knowledge");
    expect(normalizeGenreId("show")).toBe("show");
    expect(normalizeGenreId(undefined)).toBeUndefined();
    // Passando por genreSection, os novos critérios precisam chegar de verdade
    expect(genreSection("live-sell", true)).toContain("venda ao vivo");
  });
});

describe("genreSection", () => {
  it("o preset geral não injeta nada (os critérios genéricos continuam valendo)", () => {
    expect(genreSection("auto", true)).toBe("");
    expect(genreSection(undefined, false)).toBe("");
  });

  it("entrega os critérios no idioma pedido", () => {
    expect(genreSection("shopping", true)).toContain("venda ao vivo");
    expect(genreSection("shopping", false)).toContain("Live-selling");
  });

  it("critério personalizado passa por cima do preset interno (escolher o mais próximo e mudar duas frases)", () => {
    const out = genreSection("game", true, "só os trechos em que o chefe xinga alguém");
    expect(out).toContain("só os trechos em que o chefe xinga alguém");
    expect(out).not.toContain("jogadas no limite");
  });

  it("personalização em branco não conta, e o preset continua valendo", () => {
    expect(genreSection("game", true, "   ")).toContain("jogadas no limite");
    expect(genreSection("game", true, "")).toContain("jogadas no limite");
  });

  it("critério personalizado longo demais é truncado (não pode estourar o prompt)", () => {
    const huge = "um critério bem comprido ".repeat(1000);
    const out = genreSection("custom", true, huge);
    expect(out.length).toBeLessThan(GENRE_CUSTOM_MAX_CHARS + 100);
  });

  it("o preset custom não tem critério próprio: sem personalização, não injeta nada", () => {
    expect(genreSection("custom", true)).toBe("");
  });

  it("os gêneros em que a transcrição não é confiável dizem isso com todas as letras", () => {
    expect(genreSection("game", true)).toContain("não olhe só a transcrição");
    expect(genreSection("show", true)).toContain("praticamente não tem informação");
    expect(genreSection("pet", true)).toContain("não serve de critério");
    expect(genreSection("outdoor", true)).toContain("captação de áudio na rua é ruim");
  });

  it("o preset de VTuber avisa que o sinal de expressão facial não vale (o rosto é um modelo, não uma pessoa)", () => {
    expect(genreSection("vtuber", true)).toContain("sinal de emoção facial é praticamente inútil");
  });

  it("o preset de rádio avisa que não há imagem (só áudio, com onda sonora no vídeo final)", () => {
    expect(genreSection("radio", true)).toContain("não há imagem disponível");
  });

  it("o preset de assistir junto coloca o risco de direitos autorais na frente de tudo — isso pesa mais do que escolher bem", () => {
    const out = genreSection("cowatch", true);
    expect(out).toContain("direitos");
    expect(out).toContain("nunca corte o filme ou a série em si");
  });
});
