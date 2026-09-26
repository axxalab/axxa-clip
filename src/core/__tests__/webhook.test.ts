import { describe, it, expect, afterEach } from "vitest";
import {
  parseRecorderWebhook,
  isPathAllowed,
  isTokenValid,
  startWebhookServer,
  WEBHOOK_MAX_BODY_BYTES,
  type RecorderEvent,
  type WebhookServerHandle,
} from "../webhook";
import { normalize } from "path";

/**
 * O caminho esperado é escrito com o separador da plataforma atual. A leitura do webhook usa o path
 * do Node (que depende da plataforma), e no Windows "/rec/a.flv" é normalizado para "\rec\a.flv" —
 * e isso é o **comportamento correto** (o vídeo pronto vai ser aberto nesta máquina), então a asserção
 * precisa acompanhar a plataforma, sem barra fixa no código.
 * Esta foi pega pela CI do Windows: no macOS local tudo verde, no Windows quatro testes vermelhos.
 */
const P = (posix: string): string => normalize(posix);

describe("parseRecorderWebhook — Webhook v2 do BililiveRecorder", () => {
  const fileClosed = {
    EventType: "FileClosed",
    EventTimestamp: "2026-08-05T10:00:00.000Z",
    EventId: "abc",
    EventData: {
      RelativePath: "23058/gravacao-23058-20260805.flv",
      FileSize: 1234567,
      RoomId: 23058,
      Name: "quem apresenta",
      Title: "hoje é dia de jogo",
    },
  };

  it("FileClosed: o caminho relativo mais a pasta de trabalho formam o absoluto", () => {
    const e = parseRecorderWebhook(fileClosed, "/rec")!;
    expect(e.source).toBe("bililive-recorder");
    expect(e.path).toBe(P("/rec/23058/gravacao-23058-20260805.flv"));
    expect(e.room).toBe("23058");
    expect(e.title).toBe("hoje é dia de jogo");
  });

  it("sem pasta de trabalho, o caminho relativo do BililiveRecorder não dá para tratar (nada de adivinhar caminho)", () => {
    expect(parseRecorderWebhook(fileClosed, undefined)).toBeNull();
  });

  it("evento que não é «arquivo escrito» é sempre ignorado (começar a transmitir ou começar um pedaço não deve disparar corte)", () => {
    for (const EventType of ["SessionStarted", "FileOpening", "SessionEnded", "StreamStarted"]) {
      expect(parseRecorderWebhook({ ...fileClosed, EventType }, "/rec")).toBeNull();
    }
  });

  it("sem RelativePath, desiste na hora", () => {
    expect(parseRecorderWebhook({ EventType: "FileClosed", EventData: {} }, "/rec")).toBeNull();
  });
});

describe("parseRecorderWebhook — blrec", () => {
  it("evento de pós-processamento concluído: o caminho absoluto é usado direto", () => {
    const e = parseRecorderWebhook(
      {
        id: "x",
        date: "2026-08-05T10:00:00+08:00",
        type: "VideoPostprocessingCompletedEvent",
        data: { room_id: 12345, path: "/data/blrec/live-gravada.mp4" },
      },
      "/rec"
    )!;
    expect(e.source).toBe("blrec");
    expect(e.path).toBe(P("/data/blrec/live-gravada.mp4"));
    expect(e.room).toBe("12345");
  });

  it("o evento de arquivo escrito também é aceito (sem pós-processamento, só existe ele)", () => {
    const e = parseRecorderWebhook(
      { type: "VideoFileCompletedEvent", data: { room_id: 1, path: "/data/a.flv" } },
      undefined
    );
    expect(e?.path).toBe(P("/data/a.flv"));
  });

  it("os outros tipos de evento são ignorados", () => {
    for (const type of ["LiveBeganEvent", "RecordingStartedEvent", "SpaceNoEnoughEvent"]) {
      expect(parseRecorderWebhook({ type, data: { path: "/data/a.flv" } }, "/rec")).toBeNull();
    }
  });
});

describe("parseRecorderWebhook — entrada lixo", () => {
  it("o que não é objeto, o vazio e a forma desconhecida devolvem null em vez de lançar exceção", () => {
    for (const body of [null, undefined, "", 42, [], {}, { foo: "bar" }, { EventType: 123 }]) {
      expect(parseRecorderWebhook(body, "/rec")).toBeNull();
    }
  });
});

describe("isPathAllowed", () => {
  it("o arquivo dentro da pasta raiz é permitido", () => {
    expect(isPathAllowed("/rec/room/a.flv", ["/rec"])).toBe(true);
    expect(isPathAllowed("/rec", ["/rec"])).toBe(true);
  });

  it("barra a travessia de pasta e o caminho fora da lista de permissão", () => {
    expect(isPathAllowed("/rec/../etc/passwd", ["/rec"])).toBe(false);
    expect(isPathAllowed("/etc/passwd", ["/rec"])).toBe(false);
    // mesmo prefixo, mas não é subpasta (/record não pertence a /rec)
    expect(isPathAllowed("/record/a.flv", ["/rec"])).toBe(false);
  });

  it("sem lista de permissão, tudo é recusado (entrada externa não ganha caminho livre)", () => {
    expect(isPathAllowed("/rec/a.flv", [])).toBe(false);
  });

  it("com várias pastas raiz, acertar qualquer uma basta", () => {
    expect(isPathAllowed("/data/b.mp4", ["/rec", "/data"])).toBe(true);
  });
});

describe("isTokenValid", () => {
  it("sem token configurado, não há conferência", () => {
    expect(isTokenValid(undefined, undefined)).toBe(true);
    expect(isTokenValid("", "whatever")).toBe(true);
  });

  it("configurado, tem de bater", () => {
    expect(isTokenValid("s3cret", "s3cret")).toBe(true);
    expect(isTokenValid("s3cret", "wrong")).toBe(false);
    expect(isTokenValid("s3cret", undefined)).toBe(false);
  });
});

describe("startWebhookServer", () => {
  let handle: WebhookServerHandle | null = null;

  afterEach(async () => {
    await handle?.close();
    handle = null;
  });

  /** Sobe uma instância só no laço local, com porta aleatória. */
  async function serve(opts: Partial<Parameters<typeof startWebhookServer>[0]> = {}) {
    const got: RecorderEvent[] = [];
    const logs: string[] = [];
    handle = await startWebhookServer({
      port: 0,
      workDir: "/rec",
      onRecording: (e) => got.push(e),
      onLog: (m) => logs.push(m),
      ...opts,
    });
    return { got, logs, url: `http://127.0.0.1:${handle.port}/` };
  }

  const post = (url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("um FileClosed do BililiveRecorder chega → o retorno recebe o caminho absoluto", async () => {
    const { got, url } = await serve();
    const res = await post(url, {
      EventType: "FileClosed",
      EventData: { RelativePath: "r/a.flv", RoomId: 7 },
    });
    expect(res.status).toBe(200);
    expect(got).toHaveLength(1);
    expect(got[0].path).toBe(P("/rec/r/a.flv"));
  });

  it("o caminho fora da lista de permissão é barrado, e isso vai para o registro", async () => {
    const { got, logs, url } = await serve();
    const res = await post(url, {
      type: "VideoFileCompletedEvent",
      data: { path: "/etc/passwd" },
    });
    // Ainda assim responde 200: a ferramenta de gravação repete sem parar ao ver algo fora do 2xx
    expect(res.status).toBe(200);
    expect(got).toHaveLength(0);
    expect(logs.some((l) => l.includes("não está numa pasta permitida"))).toBe(true);
  });

  it("token errado responde 401 e não dispara nada", async () => {
    const { got, url } = await serve({ token: "s3cret" });
    const res = await post(url, { EventType: "FileClosed", EventData: { RelativePath: "a.flv" } });
    expect(res.status).toBe(401);
    expect(got).toHaveLength(0);

    const ok = await post(`${url}?token=s3cret`, {
      EventType: "FileClosed",
      EventData: { RelativePath: "a.flv" },
    });
    expect(ok.status).toBe(200);
    expect(got).toHaveLength(1);
  });

  it("o token também pode vir no cabeçalho", async () => {
    const { got, url } = await serve({ token: "s3cret" });
    await post(url, { EventType: "FileClosed", EventData: { RelativePath: "a.flv" } }, { "x-hotclip-token": "s3cret" });
    expect(got).toHaveLength(1);
  });

  it("evento que não é «arquivo escrito» e JSON quebrado respondem 200 sem disparar nada (para a ferramenta de gravação não repetir sem parar)", async () => {
    const { got, url } = await serve();
    expect((await post(url, { EventType: "SessionStarted", EventData: {} })).status).toBe(200);
    expect((await post(url, "{ this is not json")).status).toBe(200);
    expect(got).toHaveLength(0);
  });

  it("corpo de pedido gigante é recusado, e o servidor não estoura", async () => {
    const { got, url } = await serve();
    const huge = "x".repeat(WEBHOOK_MAX_BODY_BYTES + 1024);
    await post(url, JSON.stringify({ EventType: "FileClosed", pad: huge })).catch(() => null);
    expect(got).toHaveLength(0);
    // O servidor continua vivo: o pedido normal seguinte é tratado como sempre
    const res = await post(url, { EventType: "FileClosed", EventData: { RelativePath: "a.flv" } });
    expect(res.status).toBe(200);
    expect(got).toHaveLength(1);
  });

  it("um GET de sondagem devolve a informação de pronto (para a pessoa conferir se a porta responde)", async () => {
    const { url } = await serve();
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ready");
  });
});
