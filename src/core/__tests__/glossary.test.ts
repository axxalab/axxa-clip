import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  sanitizeGlossary,
  applyGlossaryToText,
  applyGlossaryToTranscript,
  countGlossaryHits,
  diffReplacement,
  upsertGlossaryEntry,
} from "../../shared/glossary";
import { loadGlossary, saveGlossary, glossaryPath } from "../glossary-store";
import type { Transcript } from "../../shared/api-types";

// Alguns ideogramas ficam como escapes Unicode: material em escrita ideográfica combina
// como subcadeia direta, e esse caminho continua coberto.
const CJ = { errado: "川普", certo: "特朗普" };

function makeTranscript(texts: string[]): Transcript {
  let t = 0;
  return {
    language: "pt",
    engine: "test",
    durationSec: texts.length * 3,
    segments: texts.map((text, i) => {
      const pieces = text.split(" ");
      const seg = {
        id: i + 1,
        startSec: t,
        endSec: t + 3,
        text,
        words: pieces.map((piece, j) => ({
          text: piece,
          startSec: t + (3 * j) / pieces.length,
          endSec: t + (3 * (j + 1)) / pieces.length,
        })),
      };
      t += 3;
      return seg;
    }),
  };
}

describe("sanitizeGlossary", () => {
  it("descarta o vazio, o que aponta para si mesmo e o inválido, e do mesmo termo errado fica a primeira entrada", () => {
    expect(
      sanitizeGlossary([
        { wrong: " gestao ", right: "gestão" },
        { wrong: "gestao", right: "outra coisa" }, // termo errado repetido, descartado
        { wrong: "igual", right: "igual" }, // aponta para si mesmo, descartado
        { wrong: "", right: "x" },
        { wrong: "y", right: "" },
        null,
        "texto",
      ])
    ).toEqual([{ wrong: "gestao", right: "gestão" }]);
  });

  it("entrada que não é array devolve uma tabela vazia", () => {
    expect(sanitizeGlossary(undefined)).toEqual([]);
    expect(sanitizeGlossary({})).toEqual([]);
  });
});

describe("applyGlossaryToText", () => {
  it("substitui a palavra acentuada em todas as ocorrências", () => {
    expect(applyGlossaryToText("hoje a gestao falou, e a gestao decidiu", [{ wrong: "gestao", right: "gestão" }])).toBe(
      "hoje a gestão falou, e a gestão decidiu"
    );
  });

  it("escrita ideográfica combina como subcadeia direta", () => {
    expect(applyGlossaryToText(`${CJ.errado}a${CJ.errado}`, [{ wrong: CJ.errado, right: CJ.certo }])).toBe(
      `${CJ.certo}a${CJ.certo}`
    );
  });

  it("palavra latina só combina inteira: IA não toca em MAIS, e a caixa é ignorada", () => {
    const entries = [{ wrong: "Chatgpt", right: "ChatGPT" }];
    expect(applyGlossaryToText("eu uso Chatgpt e CHATGPT para escrever", entries)).toBe("eu uso ChatGPT e ChatGPT para escrever");
    expect(applyGlossaryToText("o ponto MAIS importante", [{ wrong: "IA", right: "inteligência artificial" }])).toBe("o ponto MAIS importante");
  });

  it("o limite de palavra também respeita o acento: uma entrada sem acento não invade a palavra acentuada", () => {
    expect(applyGlossaryToText("a gestão da casa", [{ wrong: "gest", right: "GEST" }])).toBe("a gestão da casa");
  });

  it("quando várias entradas combinam, o termo errado mais longo tem prioridade", () => {
    const entries = [
      { wrong: "ia", right: "IA" },
      { wrong: "open ia", right: "OpenAI" },
    ];
    expect(applyGlossaryToText("open ia e ia aparecem", entries)).toBe("OpenAI e IA aparecem");
  });

  it("uma passagem só: o resultado de uma entrada não é reescrito por outra", () => {
    const entries = [
      { wrong: "alfa", right: "beta" },
      { wrong: "beta", right: "gama" },
    ];
    expect(applyGlossaryToText("alfa beta", entries)).toBe("beta gama");
  });

  it("termo errado com caractere especial de regex não quebra", () => {
    expect(applyGlossaryToText("quem estuda c++ sabe", [{ wrong: "c++", right: "C++" }])).toBe("quem estuda C++ sabe");
  });

  it("várias grafias erradas apontando para o mesmo termo certo", () => {
    const entries = [
      { wrong: "ciberpunk 2077", right: "Cyberpunk 2077" },
      { wrong: "saiberpunk 2077", right: "Cyberpunk 2077" },
    ];
    expect(applyGlossaryToText("joguei saiberpunk 2077 e ciberpunk 2077", entries)).toBe(
      "joguei Cyberpunk 2077 e Cyberpunk 2077"
    );
  });
});

describe("applyGlossaryToTranscript", () => {
  const entries = [{ wrong: "gestao", right: "gestão" }];

  it("só a frase alterada é reconstruída, a intocada mantém a referência original, e sem mudança nenhuma a transcrição volta como veio", () => {
    const t = makeTranscript(["a gestao falou hoje", "o tempo está bom"]);
    const { transcript: out, replaced } = applyGlossaryToTranscript(t, entries);
    expect(replaced).toBe(1);
    expect(out.segments[0].text).toBe("a gestão falou hoje");
    expect(out.segments[0].glossaryApplied).toBe(true);
    expect(out.segments[1]).toBe(t.segments[1]); // a referência original

    const untouched = applyGlossaryToTranscript(makeTranscript(["o tempo está bom"]), entries);
    expect(untouched.replaced).toBe(0);
  });

  it("na frase alterada a linha de tempo por palavra é monótona e as pontas batem com o intervalo da frase", () => {
    const t = makeTranscript(["a gestao falou hoje"]);
    const { transcript: out } = applyGlossaryToTranscript(t, entries);
    const words = out.segments[0].words;
    expect(words[0].startSec).toBeCloseTo(t.segments[0].startSec, 6);
    expect(words[words.length - 1].endSec).toBeCloseTo(t.segments[0].endSec, 6);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].startSec).toBeGreaterThanOrEqual(words[i - 1].startSec);
      expect(words[i].startSec).toBeCloseTo(words[i - 1].endSec, 6);
    }
  });

  it("a marcação de falante é preservada: o speaker da frase volta para as palavras reconstruídas", () => {
    const t = makeTranscript(["a gestao falou hoje"]);
    t.segments[0].speaker = 1;
    const { transcript: out } = applyGlossaryToTranscript(t, entries);
    expect(out.segments[0].words.every((w) => w.speaker === 1)).toBe(true);
  });

  it("countGlossaryHits conta quantas frases foram atingidas", () => {
    const t = makeTranscript(["a gestao um", "nada a ver", "a gestao dois"]);
    expect(countGlossaryHits(t, entries)).toBe(2);
    expect(countGlossaryHits(t, [])).toBe(0);
  });
});

describe("diffReplacement", () => {
  it("extrai a correção de um ponto só na escrita ideográfica", () => {
    expect(diffReplacement(`hoje ${CJ.errado} falou`, `hoje ${CJ.certo} falou`)).toEqual({ wrong: CJ.errado, right: CJ.certo });
  });

  it("o limite da palavra latina é expandido até a palavra inteira", () => {
    expect(diffReplacement("we use chatgpt daily", "we use ChatGPT daily")).toEqual({
      wrong: "chatgpt",
      right: "ChatGPT",
    });
  });

  it("a palavra acentuada também sai inteira, e não só a letra trocada", () => {
    expect(diffReplacement("a gestao da casa", "a gestão da casa")).toEqual({ wrong: "gestao", right: "gestão" });
  });

  it("sem mudança, inserção pura, remoção pura e reescrita da frase inteira devolvem null", () => {
    expect(diffReplacement("é igual", "é igual")).toBeNull();
    expect(diffReplacement("antes depois", "antes meio depois")).toBeNull(); // inserção pura
    expect(diffReplacement("antes meio depois", "antes depois")).toBeNull(); // remoção pura
    expect(
      diffReplacement(
        "essa frase é completamente diferente essa frase é completamente diferente",
        "virou uma frase inteira outra sem nenhuma sobreposição com a de antes"
      )
    ).toBeNull(); // os dois lados passam de 16 caracteres: é reescrita de frase, não correção de termo
  });
});

describe("upsertGlossaryEntry", () => {
  it("o mesmo termo errado substitui o termo certo antigo, e o novo é acrescentado", () => {
    const base = [{ wrong: "termoA", right: "antigo" }];
    expect(upsertGlossaryEntry(base, { wrong: "termoA", right: "novo" })).toEqual([{ wrong: "termoA", right: "novo" }]);
    expect(upsertGlossaryEntry(base, { wrong: "termoB", right: "beta" })).toEqual([
      { wrong: "termoA", right: "antigo" },
      { wrong: "termoB", right: "beta" },
    ]);
  });
});

describe("glossary-store", () => {
  it("escreve e lê de volta; arquivo ausente ou quebrado devolve tabela vazia", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hotclip-glossary-"));
    expect(await loadGlossary(dir)).toEqual([]);
    await saveGlossary(dir, [{ wrong: "gestao", right: "gestão" }, { wrong: "x", right: "x" }]);
    expect(await loadGlossary(dir)).toEqual([{ wrong: "gestao", right: "gestão" }]); // a entrada que aponta para si mesma foi limpa
    expect(JSON.parse(await readFile(glossaryPath(dir), "utf8"))).toHaveLength(1);
    await writeFile(glossaryPath(dir), "{broken json", "utf8");
    expect(await loadGlossary(dir)).toEqual([]); // falha em aberto
  });
});
