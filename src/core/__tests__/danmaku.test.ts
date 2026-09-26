import { describe, it, expect } from "vitest";
import {
  parseBiliDanmakuXml,
  parseDouyinDanmakuJsonl,
  danmakuWeight,
  danmakuPeaks,
  danmakuPathFor,
  danmakuPathsFor,
  danmakuHeatCurve,
  type DanmakuItem,
} from "../danmaku";

describe("parseBiliDanmakuXml", () => {
  it("lê o formato do BililiveRecorder e do site, com o tempo vindo do primeiro campo de p, ordenado por tempo", () => {
    const xml = `<?xml version="1.0"?><i>
      <d p="65.3,1,25,16777215,1720000000,0,uid,rid">kkkkkkkk</d>
      <d p="12.5,4,25,65535,1720000001,0,uid,rid">mensagem anterior</d>
      <d p="66.0,1,25,16777215,1720000002,0,uid,rid">666</d>
    </i>`;
    const items = parseBiliDanmakuXml(xml);
    expect(items.map((d) => d.t)).toEqual([12.5, 65.3, 66.0]);
    expect(items[1].text).toBe("kkkkkkkk");
  });

  it("entrada quebrada, texto vazio e tempo negativo são pulados; as entidades HTML são resolvidas", () => {
    const xml = `<i>
      <d p="abc,1">o tempo está quebrado</d>
      <d p="5,1">   </d>
      <d p="-3,1">negativo</d>
      <d p="8,1">a &amp;&lt;b&gt; ok</d>
    </i>`;
    const items = parseBiliDanmakuXml(xml);
    expect(items.length).toBe(1);
    expect(items[0].text).toBe("a &<b> ok");
  });

  it("XML que não é de chat e entrada com lixo devolvem vazio", () => {
    expect(parseBiliDanmakuXml("<html><body>404</body></html>")).toEqual([]);
    expect(parseBiliDanmakuXml("")).toEqual([]);
  });

  it("o sétimo campo do atributo p é lido como remetente; o preenchimento 0 não conta", () => {
    const xml = `<i>
      <d p="10,1,25,16777215,1720000000,0,abc123,rid">com uid</d>
      <d p="20,1,25,16777215,1720000000,0,0,rid">uid de preenchimento</d>
      <d p="30,1">formato antigo, sem uid</d>
    </i>`;
    const items = parseBiliDanmakuXml(xml);
    expect(items[0].uid).toBe("abc123");
    expect(items[1].uid).toBeUndefined();
    expect(items[2].uid).toBeUndefined();
  });

  it("as extensões SC, presente e assinatura do BililiveRecorder são lidas com o peso de evento pago; as sem ts são puladas", () => {
    const xml = `<i>
      <d p="5,1,25,16777215,1720000000,0,u1,rid">mensagem comum</d>
      <sc ts="100.5" uid="u2" price="30">isso foi muito engraçado</sc>
      <gift ts="50" uid="u3" giftname="coraçãozinho" giftcount="10"/>
      <guard ts="70" user="u4" level="3"/>
      <gift uid="u5" giftname="sem marcação de tempo"/>
    </i>`;
    const items = parseBiliDanmakuXml(xml);
    expect(items.map((d) => d.t)).toEqual([5, 50, 70, 100.5]);
    const sc = items.find((d) => d.t === 100.5)!;
    expect(sc.text).toBe("isso foi muito engraçado");
    expect(sc.boost).toBe(6); // uma mensagem paga é o público pagando para falar, e vale uma onda de mensagens
    expect(sc.uid).toBe("u2");
    expect(items.find((d) => d.t === 50)!.boost).toBe(1); // um presente pequeno e gratuito vale um voto só
    expect(items.find((d) => d.t === 70)!.boost).toBe(6);
  });
});

describe("danmakuWeight", () => {
  it("as palavras de reação intensa dobram", () => {
    for (const hype of ["kkkkkkkk", "hahaha", "rsrsrs", "chorei", "morri", "caraca", "eita", "passei mal", "não acredito"]) {
      expect(danmakuWeight(hype)).toBe(2);
    }
    expect(danmakuWeight("o que a pessoa comeu hoje")).toBe(1);
  });
});

describe("danmakuPeaks", () => {
  // Montagem: chat esparso na transmissão inteira (uma mensagem a cada 20s), com uma onda de euforia entre 300 e 315s
  function burstItems(): DanmakuItem[] {
    const items: DanmakuItem[] = [];
    for (let t = 0; t < 1200; t += 20) items.push({ t, text: "conversa comum" });
    for (let i = 0; i < 30; i++) items.push({ t: 300 + i * 0.5, text: i % 2 ? "kkkkkkkk" : "caraca" });
    return items.sort((a, b) => a.t - b.t);
  }

  it("o trecho de explosão do chat é delimitado, e o trecho morno não", () => {
    const peaks = danmakuPeaks(burstItems(), 1200);
    expect(peaks.length).toBe(1);
    expect(peaks[0].startSec).toBeLessThanOrEqual(300);
    expect(peaks[0].endSec).toBeGreaterThanOrEqual(314);
  });

  it("chat uniforme na transmissão inteira (sem pico) não delimita nada — o limite se adapta à linha de base", () => {
    const flat: DanmakuItem[] = [];
    for (let t = 0; t < 1200; t += 2) flat.push({ t, text: "muita mensagem, mas uniforme" });
    expect(danmakuPeaks(flat, 1200)).toEqual([]);
  });

  it("chat esparso demais (com peso insuficiente na janela de pico) não produz pico falso", () => {
    const sparse: DanmakuItem[] = [
      { t: 100, text: "um" },
      { t: 102, text: "dois" },
      { t: 104, text: "três" },
    ];
    expect(danmakuPeaks(sparse, 1200)).toEqual([]);
  });

  it("entrada vazia e vídeo curto devolvem vazio", () => {
    expect(danmakuPeaks([], 1200)).toEqual([]);
    expect(danmakuPeaks([{ t: 1, text: "x" }], 5)).toEqual([]);
  });

  it("antispam: a explosão causada por uma única pessoa é descontada e não conta como a transmissão fervendo", () => {
    // A mesma explosão de 20 mensagens de euforia: todas de uma pessoa, contra 20 pessoas diferentes
    const base: DanmakuItem[] = [];
    for (let t = 0; t < 1200; t += 20) base.push({ t, text: "conversa comum", uid: `bg${t}` });
    const spam = [...base];
    for (let i = 0; i < 20; i++) spam.push({ t: 300 + i * 0.4, text: "kkkkkkkk", uid: "spammer" });
    const crowd = [...base];
    for (let i = 0; i < 20; i++) crowd.push({ t: 300 + i * 0.4, text: "kkkkkkkk", uid: `u${i}` });
    expect(danmakuPeaks(spam.sort((a, b) => a.t - b.t), 1200)).toEqual([]);
    const peaks = danmakuPeaks(crowd.sort((a, b) => a.t - b.t), 1200);
    expect(peaks.length).toBe(1);
    expect(peaks[0].startSec).toBeLessThanOrEqual(300);
  });

  it("o formato antigo, sem uid, não sofre a punição de spam (fail-open)", () => {
    const items: DanmakuItem[] = [];
    for (let t = 0; t < 1200; t += 20) items.push({ t, text: "conversa comum" });
    for (let i = 0; i < 20; i++) items.push({ t: 300 + i * 0.4, text: "kkkkkkkk" });
    expect(danmakuPeaks(items.sort((a, b) => a.t - b.t), 1200).length).toBe(1);
  });

  it("bônus de subida: uma explosão pequena e repentina passa da linha, e a mesma densidade morna na transmissão inteira não é delimitada", () => {
    // Explosão de 6 mensagens por janela: o peso cru de 6 não chega a 8, mas com o bônus de subida (6-0)*0,5 vira 9 e passa
    const burst: DanmakuItem[] = [];
    for (let t = 0; t < 1200; t += 40) burst.push({ t, text: "conversa comum" });
    for (let i = 0; i < 6; i++) burst.push({ t: 500 + i * 0.4, text: "isso é interessante" });
    const peaks = danmakuPeaks(burst.sort((a, b) => a.t - b.t), 1200);
    expect(peaks.length).toBe(1);
    expect(peaks[0].startSec).toBeLessThanOrEqual(500);
    // Com 6 mensagens por janela do começo ao fim: não há salto entre janelas, e o limite da mediana sobe junto com a linha de base → nada é delimitado
    const warm: DanmakuItem[] = [];
    for (let t = 0; t < 1200; t += 1.7) warm.push({ t: Number(t.toFixed(1)), text: "conversando sempre" });
    expect(danmakuPeaks(warm, 1200)).toEqual([]);
  });
});

describe("danmakuPathFor", () => {
  it("o .xml de mesmo nome (a convenção do BililiveRecorder)", () => {
    expect(danmakuPathFor("/rec/gravacao-da-live-2026.flv")).toBe("/rec/gravacao-da-live-2026.xml");
    expect(danmakuPathFor("/rec/a.b.mp4")).toBe("/rec/a.b.xml");
  });
});

describe("parseDouyinDanmakuJsonl", () => {
  it("chat conta como mensagem; gift, social e like entram com o peso de interação; member e roomStats não contam", () => {
    const jsonl = [
      `{"type":"chat","content":"o cara é bom","userId":123456,"recvTimeSec":10.5}`,
      `{"type":"gift","giftName":"coraçãozinho","comboCount":10,"userName":"joao","recvTimeSec":20}`,
      `{"type":"social","userName":"visitante1","action":1,"recvTimeSec":30}`,
      `{"type":"like","count":15,"total":9999,"userName":"visitante2","recvTimeSec":40}`,
      `{"type":"member","userName":"novo espectador","memberCount":50,"recvTimeSec":50}`,
      `{"type":"roomStats","displayLong":"1234 pessoas online","recvTimeSec":60}`,
    ].join("\n");
    const items = parseDouyinDanmakuJsonl(jsonl);
    expect(items.map((d) => d.t)).toEqual([10.5, 20, 30, 40]); // member e roomStats são pulados
    expect(items[0]).toMatchObject({ text: "o cara é bom", uid: "123456" });
    expect(items[0].boost).toBeUndefined(); // uma mensagem comum passa pelo peso das palavras de euforia
    expect(items[1]).toMatchObject({ text: "coraçãozinho", boost: 1, uid: "joao" });
    expect(items[2].boost).toBe(2); // seguir é votar com uma ação
    expect(items[3].boost).toBe(1);
  });

  it("linha quebrada e linha vazia são puladas (quando o processo de gravação é morto, a última linha costuma estar pela metade)", () => {
    const jsonl = `{"type":"chat","content":"completa","recvTimeSec":5}\n\n{"type":"chat","content":"pela met`;
    const items = parseDouyinDanmakuJsonl(jsonl);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("completa");
  });

  it("marcação de época não é aceita — uma mensagem que não casa com a linha do tempo é descartada, em vez de cair no segundo 0 e sujar o começo", () => {
    const jsonl = [
      `{"type":"chat","content":"só com segundo de época","timestamp":1720000000}`,
      `{"type":"chat","content":"o segundo relativo tem prioridade","recvTimeSec":12,"timestamp":1720000000}`,
    ].join("\n");
    const items = parseDouyinDanmakuJsonl(jsonl);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: "o segundo relativo tem prioridade", t: 12 });
  });

  it("entrada com lixo devolve vazio", () => {
    expect(parseDouyinDanmakuJsonl("")).toEqual([]);
    expect(parseDouyinDanmakuJsonl("not json at all")).toEqual([]);
  });
});

describe("danmakuPathsFor", () => {
  it("na ordem de prioridade: o .xml de mesmo nome → o .jsonl de mesmo nome → {primeiro trecho}_danmaku.jsonl", () => {
    expect(danmakuPathsFor("/rec/300294032039_merged.mp4")).toEqual([
      "/rec/300294032039_merged.xml",
      "/rec/300294032039_merged.jsonl",
      "/rec/300294032039_danmaku.jsonl",
    ]);
  });

  it("sem sublinhado no nome do vídeo, só existem os dois primeiros candidatos", () => {
    expect(danmakuPathsFor("/rec/gravacao.flv")).toEqual(["/rec/gravacao.xml", "/rec/gravacao.jsonl"]);
  });
});

describe("danmakuHeatCurve", () => {
  it("a contagem ponderada por célula é normalizada de 0 a 1, e a célula da explosão é a mais intensa", () => {
    const items: DanmakuItem[] = [];
    for (let t = 0; t < 600; t += 10) items.push({ t, text: "conversa comum" });
    for (let i = 0; i < 20; i++) items.push({ t: 300 + i * 0.3, text: "kkkkkkkk" });
    const c = danmakuHeatCurve(items, 600, 120);
    expect(c).toHaveLength(120);
    expect(Math.max(...c)).toBe(1);
    const peakBin = Math.floor((302 / 600) * 120);
    expect(c[peakBin]).toBeGreaterThan(c[10]);
  });

  it("entrada vazia e duração inválida devolvem vazio", () => {
    expect(danmakuHeatCurve([], 600, 120)).toEqual([]);
    expect(danmakuHeatCurve([{ t: 1, text: "x" }], 0, 120)).toEqual([]);
  });
});
