/**
 * Camada de protocolo MCP do HotClip (JSON-RPC 2.0 por stdio, escrito à mão, sem dependência):
 * o «cortador MCP local» — um agente como o Claude dirige a esteira de corte local direto:
 * "pega esta gravação de 4 horas e tira 10 estouros" → transcrição/detecção/saída, tudo na máquina da pessoa.
 *
 * Só a superfície mínima que o MCP exige: initialize / tools/list / tools/call / ping.
 * Este arquivo é lógica pura (mensagem entra → resposta sai, e a execução da ferramenta é injetada),
 * testável por inteiro; o stdin/stdout e a esteira de verdade ficam em server.ts.
 */

import { describeSubtitleImportError } from "../shared/subtitle-import";

/** Versão do protocolo MCP (a linha de base 2024-11-05, compatível com praticamente todo cliente). */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Ponto de injeção da execução da ferramenta: o texto que volta para o agente (se lançar → resposta com isError). */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "clip_video",
    description:
      "Corte de ponta a ponta: transcreve um vídeo longo local (podcast / live gravada / aula), a IA acha os estouros e o resultado é exportado como vídeo vertical pronto para publicar (legenda queimada / corte seco / sinal de expressão), devolvendo a pasta de saída e o título/nota/marca de tempo de cada trecho. Sem subtitlePath, a primeira execução baixa sozinha o modelo de ASR local. Exige as variáveis de ambiente HOTCLIP_LLM_BASE_URL/HOTCLIP_LLM_MODEL (e HOTCLIP_LLM_API_KEY quando o endpoint não é local).",
    inputSchema: {
      type: "object",
      properties: {
        videoPath: { type: "string", description: "o caminho absoluto do arquivo de vídeo local" },
        engineId: { type: "string", description: "o motor de ASR local; por padrão sensevoice. O qwen3 exige subir o serviço de voz local à parte.", enum: ["sensevoice", "paraformer", "fireredasr", "qwen3"] },
        localServiceUrl: { type: "string", description: "o endereço do serviço local do Qwen3; só 127.0.0.1 / ::1, por padrão http://127.0.0.1:8766." },
        restart: { type: "boolean", description: "transcrever de novo, sem reaproveitar o progresso por trecho deste material no motor atual; por padrão a transcrição continua de onde parou." },
        subtitlePath: { type: "string", description: "opcional: o caminho absoluto de uma legenda original em UTF-8 SRT/WebVTT, de trilha única, alinhada com este material (até 5 MB, sem sobreposição). O ASR é pulado e o tempo das frases originais é mantido; o tempo das palavras dentro da frase é estimado e precisa de revisão." },
        maxClips: { type: "number", description: "quantos trechos exportar no máximo (de 1 a 12, por padrão 6)" },
        vertical: { type: "boolean", description: "saída vertical 9:16 (por padrão true)" },
        captions: { type: "boolean", description: "queimar a legenda dinâmica no vídeo (por padrão true)" },
        autoEnhance: { type: "boolean", description: "mede a imagem finalmente aproveitada na própria máquina e corrige com contenção o material claramente escuro / acinzentado / saturado demais (por padrão false; não baixa modelo)" },
        denoiseMode: { type: "string", enum: ["basic", "smart"], description: "limpeza de áudio opcional: basic é um filtro fixo; smart é o modelo de voz local de 48kHz (na falha volta para basic sozinho)" },
        outDir: { type: "string", description: "a pasta de saída (por padrão <nome>-hotclip/ ao lado do vídeo de origem)" },
        referencePath: { type: "string", description: "o caminho local de um vídeo de referência que viralizou (opcional): a duração, a velocidade da fala, o tamanho das frases, a frequência dos cortes e a forma do gancho são medidos, e a escolha dos trechos se aproxima desse ritmo (é preferência, não regra rígida); se a análise falhar, segue como se não houvesse referência" },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "detect_highlights",
    description:
      "Só acha os estouros, sem exportar: transcreve e usa o LLM para escolher os candidatos, devolvendo um JSON com a marca de tempo, o título, o gancho, a nota, o motivo e o parecer da revisão da IA de cada um. Serve para o fluxo de revisar antes de cortar. Exige as variáveis de ambiente HOTCLIP_LLM_*.",
    inputSchema: {
      type: "object",
      properties: {
        videoPath: { type: "string", description: "o caminho absoluto do arquivo de vídeo local" },
        engineId: { type: "string", description: "o motor de ASR local; por padrão sensevoice. O qwen3 exige subir o serviço de voz local à parte.", enum: ["sensevoice", "paraformer", "fireredasr", "qwen3"] },
        localServiceUrl: { type: "string", description: "o endereço do serviço local do Qwen3; só 127.0.0.1 / ::1, por padrão http://127.0.0.1:8766." },
        restart: { type: "boolean", description: "transcrever de novo, sem reaproveitar o progresso por trecho deste material no motor atual; por padrão a transcrição continua de onde parou." },
        subtitlePath: { type: "string", description: "opcional: o caminho absoluto de uma legenda original em UTF-8 SRT/WebVTT, de trilha única, alinhada com este material (até 5 MB, sem sobreposição). O ASR é pulado e o tempo das frases originais é mantido; o tempo das palavras dentro da frase é estimado e precisa de revisão." },
        maxClips: { type: "number", description: "quantos candidatos no máximo (de 1 a 12, por padrão 6)" },
        referencePath: { type: "string", description: "o caminho local de um vídeo de referência que viralizou (opcional): o perfil de ritmo dele é medido e os candidatos se aproximam desse ritmo; se a análise falhar, segue como se não houvesse referência" },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "transcribe_video",
    description:
      "Legenda pronta ou transcrição local: com subtitlePath, a legenda existente é importada e o tempo das palavras é estimado; sem ele, o ASR local (SenseVoice, baixado sozinho na primeira vez) transforma o vídeo/áudio numa transcrição frase por frase, com marcas de tempo. O resultado fica em cache, então a segunda chamada do mesmo arquivo volta na hora. Não precisa de LLM configurado.",
    inputSchema: {
      type: "object",
      properties: {
        videoPath: { type: "string", description: "o caminho absoluto do arquivo de vídeo/áudio local" },
        engineId: { type: "string", description: "o motor de ASR local; por padrão sensevoice. O qwen3 exige subir o serviço de voz local à parte.", enum: ["sensevoice", "paraformer", "fireredasr", "qwen3"] },
        localServiceUrl: { type: "string", description: "o endereço do serviço local do Qwen3; só 127.0.0.1 / ::1, por padrão http://127.0.0.1:8766." },
        restart: { type: "boolean", description: "transcrever de novo, sem reaproveitar o progresso por trecho deste material no motor atual; por padrão a transcrição continua de onde parou." },
        subtitlePath: { type: "string", description: "opcional: importa uma legenda original em UTF-8 SRT/WebVTT já existente e pula o ASR (até 5 MB, sem sobreposição). O tempo das palavras dentro da frase é estimado e precisa de revisão." },
      },
      required: ["videoPath"],
    },
  },
];

/** Validação dos parâmetros: obrigatórios e tipo (uma validação rasa basta — a implementação da ferramenta ainda checa as regras de negócio). */
export function validateToolArgs(tool: McpToolDef, args: Record<string, unknown>): string | null {
  const schema = tool.inputSchema as { properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] };
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") return `falta o parâmetro obrigatório ${key}`;
  }
  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties?.[key];
    if (!spec?.type || value === undefined) continue;
    const actual = typeof value;
    if (spec.type === "number" && actual !== "number") return `o parâmetro ${key} deve ser number`;
    if (spec.type === "string" && actual !== "string") return `o parâmetro ${key} deve ser string`;
    if (spec.type === "boolean" && actual !== "boolean") return `o parâmetro ${key} deve ser boolean`;
    if (spec.enum && !spec.enum.includes(value)) return `o parâmetro ${key} deve ser ${spec.enum.join("|")}`;
  }
  return null;
}

function result(id: JsonRpcMessage["id"], payload: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result: payload };
}

function rpcError(id: JsonRpcMessage["id"], code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolText(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Processa uma mensagem JSON-RPC; devolve o objeto de resposta, e null para um aviso
 * (uma notification, que não tem id).
 */
export async function handleMcpMessage(
  msg: JsonRpcMessage,
  execute: ToolExecutor,
  serverVersion: string
): Promise<Record<string, unknown> | null> {
  const method = msg.method ?? "";
  // Aviso não pede resposta (initialized / cancelled e afins)
  if (msg.id === undefined && method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return result(msg.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "hotclip", version: serverVersion },
      });
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return result(msg.id, toolText(`ferramenta desconhecida: ${name}`, true));
      const invalid = validateToolArgs(tool, args);
      if (invalid) return result(msg.id, toolText(invalid, true));
      try {
        return result(msg.id, toolText(await execute(name, args)));
      } catch (e) {
        return result(msg.id, toolText(describeSubtitleImportError(e), true));
      }
    }
    default:
      return rpcError(msg.id, -32601, `method not found: ${method}`);
  }
}
