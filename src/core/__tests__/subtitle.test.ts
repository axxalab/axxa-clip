import { describe, it, expect } from "vitest";
import {
  sliceWords,
  groupWordsIntoLines,
  toAssTime,
  buildKaraokeAss,
  buildCaptionAss,
  keywordText,
  popText,
  mergeKeywordWords,
  wrapTitle,
  VERTICAL_LAYOUT,
  HORIZONTAL_LAYOUT,
} from "../subtitle";
import type { Transcript, TranscriptWord } from "../../shared/api-types";

function w(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec };
}

/**
 * Amostras em escrita ideográfica, escritas como escapes Unicode: o código-fonte deste
 * projeto não carrega ideogramas, e mesmo assim os caminhos que só existem para esses
 * idiomas — largura dupla, quebra por partícula e junção sem espaço — continuam
 * cobertos por teste. IDEO[0..7] são oito caracteres distintos, e PARTICLE é uma das
 * partículas em que a linha pode terminar com segurança.
 */
const IDEO = ["\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d", "\u4e03", "\u516b"];
const PARTICLE = "\u7684";
const IDEO_PAIR = ["\u5230", "\u5e95"]; // duas palavras que não devem ser partidas

const TRANSCRIPT: Transcript = {
  language: "pt",
  engine: "test",
  durationSec: 30,
  segments: [
    { id: 1, startSec: 0, endSec: 4, text: "olá mundo bom dia", words: [w("olá", 0, 1), w("mundo", 1, 2), w("bom", 2, 3), w("dia", 3, 4)] },
    { id: 2, startSec: 5, endSec: 8, text: "segunda frase aqui vai", words: [w("segunda", 5, 6), w("frase", 6, 7), w("aqui", 7, 7.5), w("vai", 7.5, 8)] },
  ],
};

describe("sliceWords", () => {
  it("devolve apenas as palavras cujo ponto médio cai dentro do clipe", () => {
    const words = sliceWords(TRANSCRIPT, 1, 6);
    expect(words.map((x) => x.text).join(" ")).toBe("mundo bom dia segunda");
  });

  it("pula os trechos inteiros que estão fora do intervalo", () => {
    expect(sliceWords(TRANSCRIPT, 10, 20)).toEqual([]);
  });

  it("preserva a identificação de falante de cada palavra, para colorir a legenda de ponta a ponta", () => {
    const labeled: Transcript = {
      ...TRANSCRIPT,
      segments: [
        { ...TRANSCRIPT.segments[0], words: TRANSCRIPT.segments[0].words.map((x) => ({ ...x, speaker: 0 })) },
        { ...TRANSCRIPT.segments[1], words: TRANSCRIPT.segments[1].words.map((x) => ({ ...x, speaker: 1 })) },
      ],
    };
    const words = sliceWords(labeled, 1, 6);
    expect(words.find((x) => x.text === "mundo")?.speaker).toBe(0);
    expect(words.find((x) => x.text === "segunda")?.speaker).toBe(1);
  });
});

describe("groupWordsIntoLines", () => {
  it("quebra no limite de largura (a escrita ideográfica conta em dobro)", () => {
    // 6 caracteres ideográficos = 12 unidades; com limite 4, cada linha fica com 2 caracteres
    const words = IDEO.slice(0, 6).map((ch, i) => w(ch, i, i + 1));
    const lines = groupWordsIntoLines(words, 4);
    expect(lines.map((l) => l.map((x) => x.text).join(""))).toEqual([
      IDEO[0] + IDEO[1],
      IDEO[2] + IDEO[3],
      IDEO[4] + IDEO[5],
    ]);
  });

  it("quebra nos intervalos de silêncio maiores que 0,8s", () => {
    const words = [w("a", 0, 0.5), w("b", 0.6, 1), w("c", 2.5, 3)];
    const lines = groupWordsIntoLines(words, 100);
    expect(lines).toHaveLength(2);
    expect(lines[1][0].text).toBe("c");
  });

  it("quebra depois da vírgula que fecha uma oração, uma vez que a linha já tem tamanho", () => {
    // limite 20 → a quebra suave é permitida a partir de 10 unidades; "muitos amigos,"
    // já tem 14 e a vírgula fecha a oração
    const words = [w("muitos", 0, 1), w("amigos,", 1, 2)];
    const tail = [w("essa", 2, 3), w("coisa", 3, 4), w("aqui", 4, 5)];
    const lines = groupWordsIntoLines([...words, ...tail], 20);
    expect(lines[0].map((x) => x.text).join(" ")).toBe("muitos amigos,");
    expect(lines[1][0].text).toBe("essa");
  });

  it("mantém uma oração curta numa linha, em vez de fragmentar numa vírgula que vem cedo", () => {
    // "oi," chega a só 3 unidades, menos da metade do limite 12 → ainda não há quebra suave
    const words = [w("oi,", 0, 1), w("bom", 1, 2), w("dia", 2, 3)];
    const lines = groupWordsIntoLines(words, 12);
    expect(lines).toHaveLength(1);
    expect(lines[0].map((x) => x.text).join(" ")).toBe("oi, bom dia");
  });

  it("recua o transbordo de largura até o último limite bom, para a expressão não ser partida", () => {
    // Com limite 10: os 4 caracteres ideográficos (8 unidades) cabem, e o quinto
    // transborda. A quebra recua até a partícula, levando o par de palavras inteiro
    // para a linha seguinte.
    const words = [...IDEO.slice(0, 3), PARTICLE, ...IDEO_PAIR].map((ch, i) => w(ch, i, i + 1));
    const lines = groupWordsIntoLines(words, 10);
    expect(lines[0].map((x) => x.text).join("")).toBe(IDEO.slice(0, 3).join("") + PARTICLE);
    expect(lines[1].map((x) => x.text).join("")).toBe(IDEO_PAIR.join(""));
  });

  it("em português, a linha não termina numa preposição: a quebra recua até a palavra de conteúdo", () => {
    // limite 12 → "o preço de" transbordaria ao juntar "dez"; como a linha não pode
    // terminar em "de", a quebra recua para depois de "preço"
    const words = [w("o", 0, 1), w("preço", 1, 2), w("de", 2, 3), w("dez", 3, 4), w("reais", 4, 5)];
    const lines = groupWordsIntoLines(words, 8);
    expect(lines[0].map((x) => x.text).join(" ")).toBe("o preço");
    expect(lines[1].map((x) => x.text).join(" ")).toBe("de dez");
  });

  it("recorre ao corte por largura quando o trecho que transborda não tem nenhum limite bom", () => {
    const words = [IDEO[0], PARTICLE, IDEO[1]].map((ch, i) => w(ch, i, i + 1));
    const lines = groupWordsIntoLines(words, 4); // limite 4 → 2 caracteres por linha
    expect(lines.map((l) => l.map((x) => x.text).join(""))).toEqual([IDEO[0] + PARTICLE, IDEO[1]]);
  });
});

describe("toAssTime", () => {
  it("formata como H:MM:SS.CC e prende os negativos em zero", () => {
    expect(toAssTime(0)).toBe("0:00:00.00");
    expect(toAssTime(62.345)).toBe("0:01:02.35"); // arredonda para centésimos
    expect(toAssTime(3600 + 61.5)).toBe("1:01:01.50");
    expect(toAssTime(-3)).toBe("0:00:00.00");
  });
});

describe("buildKaraokeAss", () => {
  const words = [w("olá", 10, 10.5), w("gente", 10.5, 11), w("hello", 11, 11.8), w("world", 12, 12.6)];

  it("emite o cabeçalho de PlayRes vertical e um diálogo por linha", () => {
    const ass = buildKaraokeAss(words, 10, VERTICAL_LAYOUT, "PingFang SC");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("Style: Caption,PingFang SC,");
    expect(ass.match(/^Dialogue:/gm)).toHaveLength(1);
  });

  it("desloca as marcações para o tempo relativo ao clipe e varre o \\k pelos intervalos entre palavras", () => {
    const ass = buildKaraokeAss(words, 10, HORIZONTAL_LAYOUT, "Arial");
    // a linha vai de 10 a 12,6 em tempo absoluto → de 0:00:00.00 a 0:00:02.60 relativo
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.60,Caption");
    // "hello" varre até "world" COMEÇAR (12), e não até ele mesmo terminar (11,8) → 100cs
    expect(ass).toContain("{\\k100}hello ");
    // a última palavra varre a própria duração → 60cs, e entre duas palavras latinas entrou um espaço
    expect(ass).toContain("{\\k60}world");
  });

  it("junta a escrita ideográfica sem espaço e remove os caracteres hostis ao ASS", () => {
    const hostile = [w(`${IDEO[0]}{${IDEO[1]}}`, 0, 1), w(`${IDEO[2]}\\${IDEO[3]}`, 1, 2)];
    const ass = buildKaraokeAss(hostile, 0, HORIZONTAL_LAYOUT, "Arial");
    expect(ass).toContain(`{\\k100}${IDEO[0]}${IDEO[1]}{\\k100}${IDEO[2]}${IDEO[3]}`);
  });

  it("segura a linha até a seguinte começar, para a fala contínua nunca piscar", () => {
    // duas linhas partidas por largura, com um intervalo de 0,3s (de 1,0 a 1,3): a linha 1
    // precisa terminar em 1,30 e não na última palavra dela (1,0), para não piscar um
    // quadro em branco entre as duas.
    const words = IDEO.slice(0, 4).map((ch, i) => w(ch, i === 0 ? 0 : i === 1 ? 0.5 : i === 2 ? 1.3 : 1.8, i === 0 ? 0.5 : i === 1 ? 1.0 : i === 2 ? 1.8 : 2.3));
    const ass = buildCaptionAss(words, 0, { ...VERTICAL_LAYOUT, maxLineUnits: 4 }, "karaoke");
    expect(ass.match(/^Dialogue:/gm)).toHaveLength(2);
    // a linha 1 termina no começo da linha 2 (1,30), cobrindo o intervalo de 0,3s
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.30,Caption");
  });

  it("limpa a legenda numa pausa de verdade, em vez de segurar um texto vencido", () => {
    // intervalo de 1,5s (acima do teto de 0,8): a linha 1 segura só +0,8 (termina em 1,80) e
    // depois a tela fica em branco até a linha 2
    const words = IDEO.slice(0, 4).map((ch, i) => w(ch, i === 0 ? 0 : i === 1 ? 0.5 : i === 2 ? 2.5 : 3.0, i === 0 ? 0.5 : i === 1 ? 1.0 : i === 2 ? 3.0 : 3.5));
    const ass = buildCaptionAss(words, 0, { ...VERTICAL_LAYOUT, maxLineUnits: 4 }, "karaoke");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.80,Caption");
  });
});

describe("keywordText", () => {
  it("tinge as palavras que a palavra-chave cobre e devolve a cor base depois delas", () => {
    const line = [w("coloca", 0, 1), w("meio", 1, 2), w("copo", 2, 3), w("de", 3, 4), w("água", 4, 5), w("ali", 5, 6)];
    const text = keywordText(line, ["meio copo de água"]);
    expect(text).toBe("coloca {\\c&H0D6EFF&\\fscx108\\fscy108}meio copo de água {\\c&HFFFFFF&\\fscx100\\fscy100}ali");
  });

  it("encontra a palavra-chave latina sem diferenciar maiúsculas, atravessando palavras separadas por espaço", () => {
    const line = [w("this", 0, 1), w("Amazing", 1, 2), w("deal", 2, 3)];
    const text = keywordText(line, ["amazing deal"]);
    expect(text).toContain("this {\\c&H0D6EFF&\\fscx108\\fscy108}Amazing deal");
  });

  it("sem palavras-chave → texto puro", () => {
    const line = [w("olá", 0, 1), w("gente", 1, 2)];
    expect(keywordText(line, [])).toBe("olá gente");
  });
});

describe("groupWordsIntoLines e as quebras por pontuação", () => {
  it("começa uma nova linha depois da pontuação que fecha a frase", () => {
    const words = [w("olá.", 0, 1), w("até", 1, 2), w("logo", 2, 3)];
    const lines = groupWordsIntoLines(words, 100);
    expect(lines.map((l) => l.map((x) => x.text).join(" "))).toEqual(["olá.", "até logo"]);
  });
});

describe("mergeKeywordWords", () => {
  it("funde o trecho da palavra-chave numa palavra indivisível (preservando as marcações de tempo)", () => {
    const words = ["muito", "bom", "de", "usar", "mesmo"].map((t, i) => w(t, i, i + 1));
    const merged = mergeKeywordWords(words, ["muito bom de usar"]);
    expect(merged.map((x) => x.text)).toEqual(["muito bom de usar", "mesmo"]);
    expect(merged[0].startSec).toBe(0);
    expect(merged[0].endSec).toBe(4);
  });

  it("a palavra-chave não pode mais ser partida entre linhas", () => {
    const words = "um lenço muito bom de usar".split(" ").map((t, i) => w(t, i, i + 1));
    const merged = mergeKeywordWords(words, ["muito bom"]);
    // um limite que antes partiria por dentro de "muito bom"
    const lines = groupWordsIntoLines(merged, 10);
    const joined = lines.map((l) => l.map((x) => x.text).join(" "));
    expect(joined.some((l) => l.includes("muito bom"))).toBe(true);
  });
});

describe("cartela de título", () => {
  it("quebra os títulos longos em duas linhas, por unidade de largura", () => {
    expect(wrapTitle("título curto")).toBe("título curto");
    const wrapped = wrapTitle("este é um título de corte viral bem bem comprido que precisa quebrar");
    expect(wrapped).toContain("\\N");
    expect(wrapped.split("\\N")).toHaveLength(2);
  });

  it("emite um diálogo de Title na camada 1, com a duração inteira", () => {
    const words = [w("olá", 0, 1)];
    const ass = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "karaoke", {
      titleCard: { text: "meio copo de água, e agora?", durationSec: 12.5 },
    });
    expect(ass).toContain("Style: Title,");
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:12.50,Title,,0,0,0,,meio copo de água, e agora?");
  });

  it("um ASS só com título funciona sem nenhuma palavra de legenda", () => {
    const ass = buildCaptionAss([], 0, VERTICAL_LAYOUT, "karaoke", {
      titleCard: { text: "título", durationSec: 5 },
    });
    expect(ass.match(/^Dialogue:/gm)).toHaveLength(1);
  });
});

describe("gancho de abertura", () => {
  it("emite um diálogo de Hook com transição na camada 2, nos primeiros segundos", () => {
    const words = [w("olá", 0, 1)];
    const ass = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "karaoke", {
      openingHook: { text: "e se for meio copo de água?", durationSec: 2.2 },
    });
    expect(ass).toContain("Style: Hook,");
    expect(ass).toContain("Dialogue: 2,0:00:00.00,0:00:02.20,Hook,,0,0,0,,{\\fad(220,300)}e se for meio copo de água?");
  });

  it("o gancho conviva com a cartela de título e com a legenda (em camadas distintas)", () => {
    const words = [w("olá", 0, 1)];
    const ass = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "karaoke", {
      titleCard: { text: "título", durationSec: 12 },
      openingHook: { text: "frase de gancho", durationSec: 2.2 },
    });
    expect(ass).toMatch(/^Dialogue: 1,.*,Title,/m);
    expect(ass).toMatch(/^Dialogue: 2,.*,Hook,/m);
    expect(ass).toMatch(/^Dialogue: 0,.*,Caption,/m); // a linha de karaokê continua lá
  });

  it("sem nenhum diálogo de Hook quando a chamada está em branco", () => {
    const ass = buildCaptionAss([w("olá", 0, 1)], 0, VERTICAL_LAYOUT, "karaoke", {
      openingHook: { text: "   ", durationSec: 2.2 },
    });
    expect(ass).not.toMatch(/,Hook,,/);
  });

  it("quebra uma chamada longa em duas linhas", () => {
    const ass = buildCaptionAss([w("olá", 0, 1)], 0, VERTICAL_LAYOUT, "karaoke", {
      openingHook: { text: "esta é uma frase de suspense bem bem comprida que precisa quebrar em duas", durationSec: 2.2 },
    });
    const hookLine = ass.split("\n").find((l) => l.includes(",Hook,")) ?? "";
    expect(hookLine).toContain("\\N");
  });
});

describe("os estilos de buildCaptionAss", () => {
  const words = IDEO.map((ch, i) => w(ch, i, i + 1));

  it("estilo keyword: cor principal branca, sem etiqueta \\k, e com a sobrescrita da palavra-chave presente", () => {
    const ass = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "keyword", { keywords: [IDEO[2] + IDEO[3]] });
    expect(ass).toContain(",&H00FFFFFF,&H00FFFFFF,"); // principal = branco
    expect(ass).not.toContain("\\k");
    expect(ass).toContain(`{\\c&H0D6EFF&\\fscx108\\fscy108}${IDEO[2]}${IDEO[3]}`);
  });

  it("estilo pop: um diálogo por bloco curto, com entrada amortecida e fonte maior", () => {
    const ass = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "pop");
    const dialogues = ass.match(/^Dialogue:/gm) ?? [];
    expect(dialogues.length).toBe(2); // 8 caracteres ideográficos = 16 unidades → dois blocos de 8
    // Entrada amortecida: 0,8 → 1,04 → 1,0, sem mais aquele exagero
    expect(ass).toContain("\\t(0,90,\\fscx104\\fscy104)");
    expect(ass).not.toContain("\\fscx135");
    expect(ass).toContain(`,${Math.round(VERTICAL_LAYOUT.fontSize * 1.45)},`);
    // o bloco 2 começa quando a primeira palavra dele começa
    expect(ass).toContain("Dialogue: 0,0:00:04.00,");
  });

  it("estilo pop: a palavra atual do bloco troca de cor — a primeira já acende, a seguinte assume 80 ms antes, e a última volta ao branco no fim dela", () => {
    const unit = [w(IDEO[0], 10, 11), w(IDEO[1], 11, 12)];
    const s = popText(unit, 10);
    // a antecipação da primeira palavra é presa em 0, então ela já começa destacada; em 1000-80=920 ms a segunda assume e a primeira fica branca
    expect(s).toContain(`{\\c&H0D6EFF&\\t(920,920,\\c&HFFFFFF&)}${IDEO[0]}`);
    // a segunda palavra: acende em 920 ms e volta ao branco no fim dela, em 2000 ms
    expect(s).toContain(`{\\c&HFFFFFF&\\t(920,920,\\c&H0D6EFF&)\\t(2000,2000,\\c&HFFFFFF&)}${IDEO[1]}`);
  });

  it("popText: a cor de destaque da marca substitui o laranja padrão, e o espaço entre palavras latinas é preservado", () => {
    const unit = [w("go", 0, 0.5), w("now", 0.5, 1)];
    const s = popText(unit, 0, "#00ff00");
    expect(s).toContain("\\c&H00FF00&"); // em BGR
    expect(s).toContain("go ");
  });

  it("estilo hormozi: bloco curto, karaokê acendendo, letra enorme, contorno grosso, sombra dura e a linha de 60% da altura", () => {
    const ass = buildCaptionAss(words, 0, VERTICAL_LAYOUT, "hormozi");
    const dialogues = ass.match(/^Dialogue:/gm) ?? [];
    expect(dialogues.length).toBe(2); // 8 caracteres ideográficos = 16 unidades → dois blocos de 10
    // o \k acende palavra por palavra dentro do bloco (diferente do salto puro do pop), com a entrada no nível do bloco
    expect(ass).toContain("\\k");
    expect(ass).toContain("{\\fscx82\\fscy82\\t(0,70,\\fscx100\\fscy100)}");
    // letra enorme mais a cor principal igual à cor de aceso (o laranja de chama)
    const styleLine = ass.split("\n").find((l) => l.startsWith("Style: Caption,")) ?? "";
    expect(styleLine).toContain(`,${Math.round(VERTICAL_LAYOUT.fontSize * 1.5)},`);
    expect(styleLine).toContain("&H000D6EFF");
    // contorno grosso (+3) e sombra dura (3), com a posição em 40% de marginV (por volta da linha de 60% da altura)
    expect(styleLine).toContain(`,1,${VERTICAL_LAYOUT.outline + 3},3,2,`);
    expect(styleLine).toContain(`,${Math.round(VERTICAL_LAYOUT.playResY * 0.4)},`);
  });

  it("estilo hormozi: as palavras latinas vão para maiúsculas, e a escrita ideográfica não é afetada", () => {
    const ass = buildCaptionAss([w(IDEO[0], 0, 1), w("it", 1, 2), w("now", 2, 3)], 0, VERTICAL_LAYOUT, "hormozi");
    expect(ass).toContain("IT");
    expect(ass).toContain("NOW");
    expect(ass).toContain(IDEO[0]);
    expect(ass).not.toMatch(/\}it/);
  });
});

describe("trilha de tradução bilíngue (Trans)", () => {
  const words = [w("olá", 10, 11), w("gente", 11, 12)];

  it("a linha de tradução é renderizada no estilo Trans, com o tempo deslocado por clipStartSec", () => {
    const ass = buildCaptionAss(words, 10, VERTICAL_LAYOUT, "karaoke", {
      translation: [{ startSec: 10, endSec: 12, text: "Hello there" }],
    });
    expect(ass).toContain("Style: Trans,");
    expect(ass).toContain(",Trans,,0,0,0,,Hello there");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Trans");
    // a fonte da tradução é 0,6 vez a da legenda principal
    expect(ass).toContain(`Style: Trans,Source Han Sans SC,${Math.round(VERTICAL_LAYOUT.fontSize * 0.6)},`);
  });

  it("uma tradução longa demais é quebrada à mão pelo limite da fonte menor (com WrapStyle 2 não há quebra automática)", () => {
    const long = "This is a fairly long translated sentence that must wrap onto a second line";
    const ass = buildCaptionAss(words, 10, VERTICAL_LAYOUT, "karaoke", {
      translation: [{ startSec: 10, endSec: 12, text: long }],
    });
    const line = ass.split("\n").find((l) => l.includes(",Trans,"))!;
    expect(line).toContain("\\N");
  });

  it("sem translation não há nenhum evento de Trans; as linhas com texto vazio ou duração zero são puladas", () => {
    const plain = buildCaptionAss(words, 10, VERTICAL_LAYOUT, "karaoke", {});
    expect(plain.split("\n").some((l) => l.startsWith("Dialogue:") && l.includes(",Trans,"))).toBe(false);
    const ass = buildCaptionAss(words, 10, VERTICAL_LAYOUT, "karaoke", {
      translation: [
        { startSec: 10, endSec: 10, text: "zero" },
        { startSec: 10, endSec: 11, text: "  " },
      ],
    });
    expect(ass.split("\n").some((l) => l.startsWith("Dialogue:") && l.includes(",Trans,"))).toBe(false);
  });

  it("conviva na mesma tela com a legenda principal em karaokê (as duas trilhas do bilíngue presentes)", () => {
    const ass = buildCaptionAss(words, 10, VERTICAL_LAYOUT, "karaoke", {
      translation: [{ startSec: 10, endSec: 12, text: "Hi" }],
    });
    expect(ass).toContain("{\\k");
    expect(ass).toContain(",Trans,,0,0,0,,Hi");
  });
});

describe("sinalização explícita de IA (selo Aigc)", () => {
  it("quando ligada, renderiza a frase pequena do canto superior esquerdo, presente do começo ao fim, com estilo próprio", () => {
    const ass = buildCaptionAss([], 0, VERTICAL_LAYOUT, "karaoke", { aigcBadge: { durationSec: 12.5 } });
    expect(ass).toContain("Style: Aigc,");
    expect(ass).toContain("Dialogue: 3,0:00:00.00,0:00:12.50,Aigc,,0,0,0,,Gerado por IA");
    // alinhado ao canto superior esquerdo (Alignment 7) e com fonte bem menor que a da legenda principal
    const style = ass.split("\n").find((l) => l.startsWith("Style: Aigc,"))!;
    expect(style.split(",")[18]).toBe("7");
    expect(Number(style.split(",")[2])).toBeLessThan(VERTICAL_LAYOUT.fontSize / 2);
  });

  it("desligada ou com duração zero, nenhum evento é produzido", () => {
    expect(buildCaptionAss([], 0, VERTICAL_LAYOUT, "karaoke", {})).not.toContain(",Aigc,");
    expect(buildCaptionAss([], 0, VERTICAL_LAYOUT, "karaoke", { aigcBadge: { durationSec: 0 } })).not.toContain("Dialogue: 3");
  });
});
