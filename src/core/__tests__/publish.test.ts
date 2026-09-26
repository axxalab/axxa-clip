import { describe, it, expect } from "vitest";
import {
  publishSystemPrompt,
  publishUserPrompt,
  parsePublishCopies,
  generatePublishCopies,
  postTextFile,
  type PublishSource,
  type PublishChatFn,
} from "../publish";

const LLM = { baseUrl: "http://x/v1", apiKey: "k", model: "m" };

const SOURCES: PublishSource[] = [
  { id: 1, title: "meio copo de água e não passa nada", hook: "olha a velocidade de absorção", text: "texto ".repeat(400), keywords: ["velocidade de absorção"] },
  { id: 2, title: "10 vezes mais barato", hook: "qual é a diferença", text: "texto", keywords: [] },
];

describe("publishUserPrompt", () => {
  it("cada material vira um bloco, e o texto é truncado em 300 caracteres", () => {
    const p = publishUserPrompt(SOURCES);
    expect(p).toContain("[1] Nome do clipe: meio copo de água e não passa nada · Gancho: olha a velocidade de absorção Palavras-chave: velocidade de absorção");
    expect(p).toContain("[2]");
    // O trecho do texto entra cortado exatamente no limite, independente do
    // tamanho do rótulo que vem antes dele
    const excerpt = p.split("\n\n")[0].split("Trecho do texto: ")[1];
    expect(excerpt).toHaveLength(300);
  });
});

describe("parsePublishCopies", () => {
  it("lê a saída padrão, completa o prefixo # sozinho e corta as hashtags em 6", () => {
    const content = JSON.stringify({
      posts: [
        { id: 1, title: "o que acontece com meio copo de água?", hashtags: ["#testedelenço", "recomendação", "#a", "#b", "#c", "#d", "#e"], description: "o teste real para você ver." },
      ],
    });
    const map = parsePublishCopies(content, new Set([1]));
    const c = map.get(1)!;
    expect(c.title).toBe("o que acontece com meio copo de água?");
    expect(c.hashtags[1]).toBe("#recomendação"); // o # é completado sozinho
    expect(c.hashtags.length).toBe(6);
    expect(c.description).toBe("o teste real para você ver.");
  });

  it("os itens inválidos são pulados: sem título, com id desconhecido ou com saída inaproveitável", () => {
    expect(parsePublishCopies('{"posts":[{"id":1,"hashtags":[]}]}', new Set([1])).size).toBe(0);
    expect(parsePublishCopies('{"posts":[{"id":9,"title":"x"}]}', new Set([1])).size).toBe(0);
    expect(parsePublishCopies("não consigo fazer isso", new Set([1])).size).toBe(0);
  });

  it("continua sendo possível ler depois de remover o bloco de raciocínio", () => {
    const map = parsePublishCopies('<think>hum</think>{"posts":[{"id":1,"title":"título com gancho"}]}', new Set([1]));
    expect(map.get(1)?.title).toBe("título com gancho");
    expect(map.get(1)?.hashtags).toEqual([]);
  });

  it("ângulo e CTA: o que está no menu é mantido, o que está fora vira não marcado, e ctaType só fica quando existe cta", () => {
    const content = JSON.stringify({
      posts: [
        { id: 1, title: "A", angle: "pain", cta: "conta nos comentários como você faz", ctaType: "comment" },
        { id: 2, title: "B", angle: "clickbait", cta: "  ", ctaType: "comment" },
        { id: 3, title: "C", ctaType: "share" },
      ],
    });
    const map = parsePublishCopies(content, new Set([1, 2, 3]));
    expect(map.get(1)).toMatchObject({ angle: "pain", cta: "conta nos comentários como você faz", ctaType: "comment" });
    expect(map.get(2)?.angle).toBeUndefined();
    expect(map.get(2)?.cta).toBeUndefined();
    expect(map.get(3)?.ctaType).toBeUndefined(); // sem o texto do cta, a etiqueta de tipo não significa nada
  });
});

describe("generatePublishCopies", () => {
  it("caminho normal: prompt em português com os pares de id e material", async () => {
    const chat: PublishChatFn = async (_llm, system, user) => {
      expect(system).toContain("redes de um canal de vídeo curto");
      expect(user).toContain("[1] Nome do clipe: meio copo de água e não passa nada");
      return '{"posts":[{"id":1,"title":"A","hashtags":["#x"],"description":"d"},{"id":2,"title":"B"}]}';
    };
    const map = await generatePublishCopies(SOURCES, true, LLM, chat);
    expect(map?.size).toBe(2);
  });

  it("material em inglês usa o prompt em inglês", async () => {
    const chat: PublishChatFn = async (_llm, system) => {
      expect(system).toContain("social manager");
      return '{"posts":[{"id":1,"title":"A"}]}';
    };
    await generatePublishCopies(SOURCES, false, LLM, chat);
  });

  it("endpoint que falha ou leitura vazia → fail-open devolvendo null; um cancelamento de cima é propagado", async () => {
    expect(await generatePublishCopies(SOURCES, true, LLM, async () => { throw new Error("down"); })).toBeNull();
    expect(await generatePublishCopies(SOURCES, true, LLM, async () => "lixo")).toBeNull();
    expect(await generatePublishCopies([], true, LLM, async () => "{}")).toBeNull();
    const ac = new AbortController();
    ac.abort();
    await expect(
      generatePublishCopies(SOURCES, true, LLM, async () => { throw new Error("aborted"); }, ac.signal)
    ).rejects.toThrow();
  });
});

describe("postTextFile", () => {
  it("três blocos: título, hashtags e descrição, com os blocos vazios omitidos", () => {
    expect(postTextFile({ title: "T", hashtags: ["#a", "#b"], description: "D" })).toBe("T\n\n#a #b\n\nD\n");
    expect(postTextFile({ title: "T", hashtags: [], description: "" })).toBe("T\n");
  });

  it("o CTA fica na linha seguinte à descrição; sem descrição, ele forma um bloco próprio", () => {
    expect(postTextFile({ title: "T", hashtags: [], description: "D", cta: "me segue que no próximo eu destrincho", ctaType: "follow" })).toBe(
      "T\n\nD\nme segue que no próximo eu destrincho\n"
    );
    expect(postTextFile({ title: "T", hashtags: [], description: "", cta: "salva para ver com calma" })).toBe("T\n\nsalva para ver com calma\n");
  });
});
