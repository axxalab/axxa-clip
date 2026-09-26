/**
 * Endpoint de webhook de gravação: entende o protocolo de aviso do BililiveRecorder e do blrec,
 * e o corte sai sozinho assim que a transmissão termina ou o arquivo acaba de ser escrito — a
 * gravação em si fica terceirizada para ferramentas de comunidade já maduras, e o HotClip cuida
 * apenas do que ele faz bem, que é cortar. É mais imediato que ficar consultando uma pasta, e
 * ninguém precisa adivinhar se o arquivo terminou de ser escrito (a ferramenta de gravação sabe,
 * e é justo isso que o aviso dela diz).
 *
 * Os dois protocolos são aceitos:
 *  - Webhook v2 do BililiveRecorder: { EventType: "FileClosed", EventData: { RelativePath, ... } }
 *    vem com caminho relativo, e só juntando com a pasta de trabalho configurada pelo usuário ele fica absoluto;
 *  - blrec: { type: "VideoPostprocessingCompletedEvent", data: { path, room_id } }
 *    vem com caminho absoluto.
 * Os dois podem mandar vários eventos do mesmo arquivo (escrita concluída + pós-processamento
 * concluído), e a repetição é barrada pelo registro do que já foi processado na camada de cima
 * (o mesmo seen da pasta vigiada).
 *
 * Um webhook é **entrada externa** e é tratado como não confiável: por padrão só escuta em
 * 127.0.0.1, aceita um token, limita o tamanho do corpo, e o caminho lido precisa estar dentro
 * das pastas permitidas — senão um único aviso torto poria o HotClip a mexer em qualquer arquivo.
 * A leitura é função pura e testável.
 */
import { createServer, type Server } from "http";
import { isAbsolute, join, normalize, resolve, sep } from "path";

/** Teto do tamanho do corpo do pedido (um aviso de gravação é um JSON de algumas centenas de bytes; passar disso já é sinal de algo errado). */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

export interface RecorderEvent {
  /** O caminho absoluto do arquivo gravado. */
  path: string;
  source: "bililive-recorder" | "blrec";
  /** Número da sala (vem quando existe, para facilitar a exibição e o nome). */
  room?: string;
  /** Título da transmissão / nome de quem apresenta (vem quando existe). */
  title?: string;
}

/** O evento que, no BililiveRecorder, quer dizer «este arquivo terminou de ser escrito». */
const BILILIVE_FILE_DONE = new Set(["fileclosed"]);
/**
 * O evento que, no blrec, quer dizer «o arquivo está disponível». Os dois são aceitos: sem
 * pós-processamento existe só o primeiro; com pós-processamento, é o segundo que aponta o arquivo
 * finalmente utilizável — a repetição é removida pelo seen.
 */
const BLREC_FILE_DONE = new Set([
  "videofilecompletedevent",
  "videopostprocessingcompletedevent",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Lê o corpo do aviso de gravação → evento unificado; devolve null quando não é um evento do tipo
 * «arquivo escrito» ou quando faltam campos (quem chama responde 200 de qualquer forma, para a
 * ferramenta de gravação não ficar tentando de novo). Função pura.
 *
 * `workDir` é a pasta de trabalho do BililiveRecorder, usada para transformar o caminho relativo em
 * absoluto; sem ela o aviso do BililiveRecorder não dá para tratar (o blrec manda caminho absoluto e não é afetado).
 */
export function parseRecorderWebhook(body: unknown, workDir?: string): RecorderEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  // ---- Webhook v2 do BililiveRecorder ----
  const eventType = str(b.EventType);
  if (eventType) {
    if (!BILILIVE_FILE_DONE.has(eventType.toLowerCase())) return null;
    const data = (typeof b.EventData === "object" && b.EventData !== null ? b.EventData : {}) as Record<string, unknown>;
    const rel = str(data.RelativePath);
    if (!rel) return null;
    // O BililiveRecorder manda caminho relativo: sem pasta de trabalho não há como formar o absoluto, e só resta desistir
    const abs = isAbsolute(rel) ? rel : workDir ? join(workDir, rel) : "";
    if (!abs) return null;
    const room = data.RoomId !== undefined && data.RoomId !== null ? String(data.RoomId) : undefined;
    return {
      path: normalize(abs),
      source: "bililive-recorder",
      room,
      title: str(data.Title) || str(data.Name) || undefined,
    };
  }

  // ---- blrec ----
  const type = str(b.type);
  if (type) {
    if (!BLREC_FILE_DONE.has(type.toLowerCase())) return null;
    const data = (typeof b.data === "object" && b.data !== null ? b.data : {}) as Record<string, unknown>;
    const path = str(data.path);
    if (!path) return null;
    // O blrec manda caminho absoluto; se por acaso mandar um relativo, a pasta de trabalho cobre do mesmo jeito
    const abs = isAbsolute(path) ? path : workDir ? join(workDir, path) : "";
    if (!abs) return null;
    const room = data.room_id !== undefined && data.room_id !== null ? String(data.room_id) : undefined;
    return { path: normalize(abs), source: "blrec", room, title: str(data.title) || undefined };
  }

  return null;
}

/**
 * O caminho precisa estar dentro de alguma das pastas permitidas (a própria pasta raiz conta).
 * O webhook vem de fora e, sem esta checagem, um aviso torto poria o HotClip a processar qualquer
 * arquivo da máquina. roots vazio significa que não há lista de permissão — e aí tudo é recusado. Função pura.
 */
export function isPathAllowed(filePath: string, roots: string[]): boolean {
  if (!filePath || roots.length === 0) return false;
  const target = resolve(filePath);
  return roots.some((root) => {
    if (!root) return false;
    const base = resolve(root);
    return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
  });
}

/** Confere o token: sem token configurado, não há conferência (aceitável apenas escutando no laço local). Função pura. */
export function isTokenValid(configured: string | undefined, provided: string | undefined): boolean {
  const want = (configured ?? "").trim();
  if (!want) return true;
  return (provided ?? "").trim() === want;
}

export interface WebhookServerOptions {
  port: number;
  /** O token de conferência: o pedido traz ?token= ou o cabeçalho X-HotClip-Token. */
  token?: string;
  /** A pasta de trabalho do BililiveRecorder (para formar o caminho absoluto a partir do relativo), que é também uma das pastas permitidas. */
  workDir?: string;
  /** Lista de permissão das pastas raiz que podem ser processadas; na ausência dela, workDir. */
  allowedRoots?: string[];
  /** Endereço de escuta; por padrão só o laço local — não troque isso por 0.0.0.0 sem pensar. */
  host?: string;
  /** Um arquivo gravado tratável chegou (a camada de cima cuida do stat / da remoção de repetidos / da fila). */
  onRecording: (e: RecorderEvent) => void;
  /** Registro de diagnóstico (o motivo de uma recusa, por exemplo). */
  onLog?: (msg: string) => void;
}

export interface WebhookServerHandle {
  /** A porta realmente escutada (com 0, o sistema escolhe). */
  port: number;
  close: () => Promise<void>;
}

/** Lê o corpo do pedido e aborta na hora se passar do teto (sem dar chance a uma bomba de memória). */
function readBody(
  req: NodeJS.ReadableStream & { destroy: () => void },
  maxBytes: number
): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/**
 * Sobe um servidor de webhook local. Por padrão só em 127.0.0.1: a ferramenta de gravação normalmente
 * está na mesma máquina que o HotClip, e o laço local basta; para outra máquina, faça o redirecionamento
 * de porta por conta própria e configure um token, sem falta.
 *
 * A resposta é sempre 200 (exceto 401 quando o token não bate): a ferramenta de gravação repete o aviso
 * sem parar ao ver algo fora do 2xx, e «este evento eu não trato» não é erro.
 */
export async function startWebhookServer(options: WebhookServerOptions): Promise<WebhookServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const roots = options.allowedRoots?.length ? options.allowedRoots : options.workDir ? [options.workDir] : [];
  const log = options.onLog ?? ((): void => {});

  const server: Server = createServer((req, res) => {
    const reply = (code: number, msg: string): void => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: code < 400, msg }));
    };
    if (req.method !== "POST") {
      reply(200, "hotclip webhook ready");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    const header = req.headers["x-hotclip-token"];
    const provided = url.searchParams.get("token") ?? (Array.isArray(header) ? header[0] : header);
    if (!isTokenValid(options.token, provided ?? undefined)) {
      log("recusado: o token não bate");
      reply(401, "bad token");
      return;
    }
    void readBody(req, WEBHOOK_MAX_BODY_BYTES).then((raw) => {
      if (raw === null) {
        log("recusado: o corpo do pedido é grande demais ou não pôde ser lido");
        reply(200, "ignored");
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        log("ignorado: o corpo do pedido não é um JSON válido");
        reply(200, "ignored");
        return;
      }
      const event = parseRecorderWebhook(parsed, options.workDir);
      if (!event) {
        reply(200, "ignored"); // não é um evento de «arquivo escrito»: é o normal, e não é erro
        return;
      }
      if (!isPathAllowed(event.path, roots)) {
        // A entrada externa aponta para fora da lista de permissão: é erro de configuração ou pedido malicioso, e o usuário tem de ver
        log(`recusado: o caminho do aviso não está numa pasta permitida — ${event.path}`);
        reply(200, "path not allowed");
        return;
      }
      options.onRecording(event);
      reply(200, "accepted");
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(options.port, host, () => {
      server.removeListener("error", fail);
      ok();
    });
  });
  const addr = server.address();
  return {
    port: typeof addr === "object" && addr ? addr.port : options.port,
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections?.();
      }),
  };
}
