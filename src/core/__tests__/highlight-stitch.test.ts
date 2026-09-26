/**
 * Lado da detecção na costura de vários trechos: leitura de parts → busca
 * reversa de cada trecho → organização → critério de duração e de sobreposição.
 * Destaques do tipo "contradição" precisam citar dois pontos bem distantes um do
 * outro, e é por este caminho que isso acontece.
 */
import { beforeEach, describe, it, expect } from "vitest";
import { resetCompat } from "../llm-params";
import { resolveSelection, type RawSelection } from "../highlight/match";
import { parseParts, parseSelections, parseMomentPicks, dropOverlaps } from "../highlight/detect";
import { highlightSystemPrompt, buildHighlightPrompt, buildReviewPrompt } from "../highlight/prompt";
import { PIECE_JOINER } from "../../shared/pieces";
import type { Transcript, TranscriptWord } from "../transcribe/types";
import type { HighlightCandidate } from "../../shared/api-types";

/** Transcrição com um token de 0,2s por caractere; gapSec entre as frases serve para afastar os dois trechos. */
function makeTranscript(sentences: string[], gapSec = 0.5): Transcript {
  let t = 0;
  let id = 0;
  const segments = sentences.map((text) => {
    id++;
    const words: TranscriptWord[] = Array.from(text).map((ch, i) => ({
      text: ch,
      startSec: Number((t + i * 0.2).toFixed(3)),
      endSec: Number((t + (i + 1) * 0.2).toFixed(3)),
    }));
    const seg = { id, startSec: words[0].startSec, endSec: words[words.length - 1].endSec, text, words };
    t = seg.endSec + gapSec;
    return seg;
  });
  return { language: "pt", segments, engine: "test", durationSec: t };
}

/** Material típico de contradição: primeiro a promessa, no meio um assunto sem relação, e no fim a pessoa se desmentindo. */
const FLIP = makeTranscript(
  [
    "Eu vou deixar registrado aqui, esse preço não vai baixar de jeito nenhum.",
    "Agora vamos falar de outra coisa, pessoal.",
    "Esse trecho do meio não tem relação nenhuma com o resto.",
    "Beleza, então hoje eu vou baixar para setenta e nove reais.",
  ],
  30 // 30 segundos entre as frases, o suficiente para virarem dois trechos separados
);

const base = { title: "t", hook: "h", score: 90, reason: "r", keywords: [] };

// o recuo de parâmetro aprendido é global ao módulo; sem limpar, um teste contamina o seguinte
beforeEach(() => resetCompat());

describe("parseParts", () => {
  it("menos de dois trechos conta como não informado (volta para a localização de trecho único)", () => {
    expect(parseParts([{ quoteStart: "só um trecho" }])).toBeUndefined();
    expect(parseParts(undefined)).toBeUndefined();
    expect(parseParts("não é um array")).toBeUndefined();
  });

  it("lê os dois trechos e preenche -1 quando falta o id da frase (adiante a busca volta a ser pela citação)", () => {
    const out = parseParts([
      { startSegmentId: 1, endSegmentId: 1, quoteStart: "Eu vou deixar", quoteEnd: "de jeito nenhum." },
      { quoteStart: "Beleza, então", quoteEnd: "setenta e nove reais." },
    ]);
    expect(out).toHaveLength(2);
    expect(out![0].startSegmentId).toBe(1);
    expect(out![1].startSegmentId).toBe(-1);
  });

  it("descarta o trecho vazio, sem citação e sem id de frase; sobrando menos de dois, nada vale", () => {
    expect(parseParts([{ quoteStart: "tem citação" }, { title: "vazio" }])).toBeUndefined();
  });

  it("parseSelections leva parts para dentro de RawSelection", () => {
    const out = parseSelections(
      JSON.stringify({
        clips: [
          {
            title: "contradição", score: 90, startSegmentId: 1, endSegmentId: 4,
            quoteStart: "Eu vou deixar", quoteEnd: "setenta e nove reais.",
            parts: [
              { startSegmentId: 1, endSegmentId: 1, quoteStart: "Eu vou deixar", quoteEnd: "de jeito nenhum." },
              { startSegmentId: 4, endSegmentId: 4, quoteStart: "Beleza, então", quoteEnd: "setenta e nove reais." },
            ],
          },
        ],
      })
    );
    expect(out[0].parts).toHaveLength(2);
  });
});

describe("resolveSelection com parts", () => {
  const sel: RawSelection = {
    ...base,
    startSegmentId: 1, endSegmentId: 4,
    quoteStart: "Eu vou deixar registrado aqui", quoteEnd: "setenta e nove reais.",
    parts: [
      { startSegmentId: 1, endSegmentId: 1, quoteStart: "Eu vou deixar registrado aqui", quoteEnd: "não vai baixar de jeito nenhum." },
      { startSegmentId: 4, endSegmentId: 4, quoteStart: "Beleza, então hoje", quoteEnd: "setenta e nove reais." },
    ],
  };

  it("cada trecho é localizado por conta própria, o intervalo pega as pontas e a lista sai em ordem de tempo", () => {
    const r = resolveSelection(FLIP, sel);
    expect(r).not.toBeNull();
    expect(r!.pieces).toHaveLength(2);
    expect(r!.startSec).toBeCloseTo(FLIP.segments[0].startSec, 2);
    expect(r!.endSec).toBeCloseTo(FLIP.segments[3].endSec, 2);
    expect(r!.pieces![0].endSec).toBeLessThan(r!.pieces![1].startSec);
  });

  it("o texto exibido é ligado por reticências — quem revisa e quem usa precisa ver que houve um salto no meio", () => {
    const r = resolveSelection(FLIP, sel);
    expect(r!.text).toContain(PIECE_JOINER.trim());
    expect(r!.text).toContain("não vai baixar");
    expect(r!.text).toContain("setenta e nove");
    // As duas frases sem relação do meio não podem entrar junto
    expect(r!.text).not.toContain("falar de outra coisa");
  });

  it("parts fora de ordem são recolocadas em ordem de tempo (o vídeo final não pode contar a história de trás para frente)", () => {
    const r = resolveSelection(FLIP, { ...sel, parts: [sel.parts![1], sel.parts![0]] });
    expect(r!.pieces![0].startSec).toBeLessThan(r!.pieces![1].startSec);
    expect(r!.text.indexOf("não vai baixar")).toBeLessThan(r!.text.indexOf("setenta e nove"));
  });

  it("se um dos trechos não for localizado, volta para trecho único (a citação de topo continua valendo) em vez de descartar o candidato inteiro", () => {
    const r = resolveSelection(FLIP, {
      ...sel,
      parts: [sel.parts![0], { startSegmentId: 9, endSegmentId: 9, quoteStart: "esta frase não existe", quoteEnd: "e esta também não" }],
    });
    expect(r).not.toBeNull();
    expect(r!.pieces).toBeUndefined();
    expect(r!.startSec).toBeCloseTo(FLIP.segments[0].startSec, 2);
  });

  it("trechos perto demais são fundidos → sobra menos de dois → volta para trecho único", () => {
    const near = makeTranscript(["A frase anterior prometeu muita coisa.", "A frase seguinte já desmentiu na hora."], 0.4);
    const r = resolveSelection(near, {
      ...base,
      startSegmentId: 1, endSegmentId: 2,
      quoteStart: "A frase anterior", quoteEnd: "desmentiu na hora.",
      parts: [
        { startSegmentId: 1, endSegmentId: 1, quoteStart: "A frase anterior", quoteEnd: "muita coisa." },
        { startSegmentId: 2, endSegmentId: 2, quoteStart: "A frase seguinte", quoteEnd: "desmentiu na hora." },
      ],
    });
    expect(r!.pieces).toBeUndefined();
  });

  it("sem parts, o comportamento é exatamente o de antes", () => {
    const r = resolveSelection(FLIP, { ...base, startSegmentId: 1, endSegmentId: 1, quoteStart: "Eu vou deixar registrado", quoteEnd: "de jeito nenhum." });
    expect(r!.pieces).toBeUndefined();
    expect(r!.boundary).toBe("anchored");
  });
});

describe("critério de costura do dropOverlaps", () => {
  const c = (id: number, s: number, e: number, score: number, pieces?: Array<{ startSec: number; endSec: number }>): HighlightCandidate => ({
    id, startSec: s, endSec: e, pieces, text: "", title: "", hook: "", score, reason: "",
    boundary: "exact", keywords: [], recommended: true, reviewNote: "",
  });

  it("um clipe costurado compara sobreposição trecho a trecho e não engole os candidatos que caem no meio do intervalo", () => {
    const stitch = c(1, 0, 600, 80, [{ startSec: 0, endSec: 15 }, { startSec: 580, endSec: 600 }]);
    const middle = c(2, 200, 220, 70); // cai dentro do intervalo, mas não encosta em nenhum trecho
    const kept = dropOverlaps([stitch, middle]);
    expect(kept).toHaveLength(2);
  });

  it("o candidato que realmente cai em cima de um dos trechos continua sendo removido", () => {
    const stitch = c(1, 0, 600, 80, [{ startSec: 0, endSec: 15 }, { startSec: 580, endSec: 600 }]);
    const clash = c(2, 10, 30, 70); // sobrepõe o primeiro trecho
    expect(dropOverlaps([stitch, clash])).toHaveLength(1);
  });
});

describe("as convenções de costura dentro do prompt", () => {
  const tx = makeTranscript(["Primeira frase para o teste.", "Segunda frase para o teste."]);

  it("o system prompt deixa claro que a costura só entra quando o contraste é obrigatório, e mantém a âncora de duração", () => {
    const p = highlightSystemPrompt(tx);
    expect(p).toContain("parts");
    expect(p).toContain("Duração de 8 a 40 segundos"); // âncora que a troca de faixa de duração substitui; o bloco de costura não pode empurrá-la para fora
    expect(p).toContain("nunca pode fabricar um sentido que não existia");
  });

  it("a explicação do formato de saída mostra o formato de parts, mas o exemplo principal continua com trecho único", () => {
    const p = buildHighlightPrompt(tx);
    expect(p).toContain('"parts"');
    // O exemplo principal do OUTPUT_SHAPE (clips → keywords) não traz parts — senão o modelo acha que todo clipe deve ser costurado
    expect(p.slice(p.indexOf('"clips"'), p.indexOf('"keywords"'))).not.toContain("parts");
  });

  it("o prompt de reavaliação informa a duração do vídeo final e marca quantos trechos foram costurados", () => {
    const prompt = buildReviewPrompt(tx, [
      { id: 1, title: "contradição", startSec: 0, endSec: 600, text: `antes${PIECE_JOINER}depois`, pieces: [{ startSec: 0, endSec: 10 }, { startSec: 585, endSec: 600 }] },
    ]);
    expect(prompt).toContain("25s"); // 10+15, e não os 600 do intervalo
    expect(prompt).toContain("costura de 2 partes");
  });
});

describe("a única retentativa do chatCompleteJson", () => {
  /** Monta um endpoint que "suja a saída na primeira vez e acerta na segunda" (a forma de falha observada na prática). */
  function flakyOnce(): { calls: number; complete: (c: string) => string } {
    let calls = 0;
    return {
      get calls() { return calls; },
      complete: () => {
        calls++;
        // Já apareceu de verdade: `"score": mais ou menos 90`, `"momentId": vii`, `"score": —`
        return calls === 1
          ? '{"clips":[{"momentId": vii,"title":"x","score": —}]}'
          : '{"clips":[{"momentId":2,"title":"saída limpa","score":88}]}';
      },
    };
  }

  it("a primeira falha de leitura provoca um reenvio, e vindo limpo na segunda o retorno é normal", async () => {
    const f = flakyOnce();
    let n = 0;
    const parsed = await (async (): Promise<ReturnType<typeof parseMomentPicks>> => {
      let lastErr: unknown;
      for (let i = 0; i < 2; i++) {
        const content = f.complete("");
        n++;
        try {
          return parseMomentPicks(content);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    })();
    expect(n).toBe(2);
    expect(parsed[0].title).toBe("saída limpa");
  });

  it("um token sujo realmente derruba a leitura da resposta inteira (é por isso que a retentativa existe)", () => {
    expect(() => parseMomentPicks('{"clips":[{"momentId": vii,"score": —}]}')).toThrow();
    expect(() => parseSelections('{"clips":[{"endSegmentId": to 3}]}')).toThrow();
  });
});
