import { describe, it, expect } from "vitest";
import {
  handleMcpMessage,
  validateToolArgs,
  MCP_TOOLS,
  MCP_PROTOCOL_VERSION,
  type ToolExecutor,
} from "../../mcp/protocol";

const noop: ToolExecutor = async () => "ok";

it("exposes and validates the same optional subtitle path on all three tools", async () => {
  for (const tool of MCP_TOOLS) {
    expect((tool.inputSchema.properties as Record<string, unknown>).subtitlePath).toMatchObject({ type: "string" });
    expect(validateToolArgs(tool, { videoPath: "/v.mp4", subtitlePath: 5 })).toContain("subtitlePath");
    const result = await handleMcpMessage({ id: 42, method: "tools/call", params: {
      name: tool.name, arguments: { videoPath: "/v.mp4", subtitlePath: "/original.vtt" },
    } }, async (_name, args) => String(args.subtitlePath), "test");
    expect(result).toMatchObject({ result: { content: [{ text: "/original.vtt" }] } });
  }
});

describe("handleMcpMessage", () => {
  it("o initialize devolve a versão do protocolo, as capacidades e os dados do serviço", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, noop, "0.5.0");
    const r = res as { id: number; result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } } };
    expect(r.id).toBe(1);
    expect(r.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.serverInfo.name).toBe("hotclip");
  });

  it("notifications/initialized não gera resposta", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, noop, "0")).toBeNull();
  });

  it("o tools/list lista as três ferramentas, com schema", async () => {
    const res = await handleMcpMessage({ id: 2, method: "tools/list" }, noop, "0");
    const tools = (res as { result: { tools: typeof MCP_TOOLS } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual(["clip_video", "detect_highlights", "transcribe_video"]);
    for (const t of tools) expect(t.inputSchema).toHaveProperty("properties");
  });

  it("no caminho normal, o tools/call devolve o texto de content", async () => {
    const exec: ToolExecutor = async (name, args) => `${name}:${args.videoPath}`;
    const res = await handleMcpMessage(
      { id: 3, method: "tools/call", params: { name: "transcribe_video", arguments: { videoPath: "/v.mp4" } } },
      exec,
      "0"
    );
    const r = res as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } };
    expect(r.result.content[0].text).toBe("transcribe_video:/v.mp4");
    expect(r.result.isError).toBeUndefined();
  });

  it("faltando um parâmetro obrigatório → isError, e não erro de protocolo", async () => {
    const res = await handleMcpMessage(
      { id: 4, method: "tools/call", params: { name: "clip_video", arguments: {} } },
      noop,
      "0"
    );
    const r = res as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("videoPath");
  });

  it("ferramenta desconhecida ou execução que lança → isError, com a mensagem repassada", async () => {
    const unknown = await handleMcpMessage({ id: 5, method: "tools/call", params: { name: "nope", arguments: {} } }, noop, "0");
    expect((unknown as { result: { isError: boolean } }).result.isError).toBe(true);
    const boom: ToolExecutor = async () => { throw new Error("o arquivo não existe ou não pode ser lido: /x.mp4"); };
    const res = await handleMcpMessage(
      { id: 6, method: "tools/call", params: { name: "transcribe_video", arguments: { videoPath: "/x.mp4" } } },
      boom,
      "0"
    );
    const r = res as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("não existe");
  });

  it("método desconhecido → -32601; ping → resultado vazio", async () => {
    const res = await handleMcpMessage({ id: 7, method: "resources/list" }, noop, "0");
    expect((res as { error: { code: number } }).error.code).toBe(-32601);
    const pong = await handleMcpMessage({ id: 8, method: "ping" }, noop, "0");
    expect((pong as { result: object }).result).toEqual({});
  });
});

describe("validateToolArgs", () => {
  const tool = MCP_TOOLS[0]; // clip_video

  it("quando o tipo não bate, o nome exato do parâmetro é informado", () => {
    expect(validateToolArgs(tool, { videoPath: "/v.mp4", maxClips: "six" })).toContain("maxClips");
    expect(validateToolArgs(tool, { videoPath: "/v.mp4", vertical: "yes" })).toContain("vertical");
  });

  it("parâmetro válido passa", () => {
    expect(validateToolArgs(tool, { videoPath: "/v.mp4", maxClips: 8, vertical: false, autoEnhance: true })).toBeNull();
    expect(validateToolArgs(tool, { videoPath: "/v.mp4", autoEnhance: "yes" })).toContain("autoEnhance");
    expect(validateToolArgs(tool, { videoPath: "/v.mp4", denoiseMode: "smart" })).toBeNull();
    expect(validateToolArgs(tool, { videoPath: "/v.mp4", denoiseMode: "magic" })).toContain("basic|smart");
  });

  it("o referencePath é declarado como string opcional nas duas ferramentas de corte", () => {
    for (const name of ["clip_video", "detect_highlights"]) {
      const t = MCP_TOOLS.find((x) => x.name === name)!;
      const schema = t.inputSchema as { properties: Record<string, { type: string }>; required: string[] };
      expect(schema.properties.referencePath.type).toBe("string");
      expect(schema.required).not.toContain("referencePath");
      expect(validateToolArgs(t, { videoPath: "/v.mp4", referencePath: 3 })).toContain("referencePath");
      expect(validateToolArgs(t, { videoPath: "/v.mp4", referencePath: "/ref.mp4" })).toBeNull();
    }
  });
});
