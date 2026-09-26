/**
 * Resgate de caminho não-ASCII no Windows (issue #4): sob um nome de usuário com acento, a camada nativa
 * do sherpa não abre o arquivo do modelo. A conversão 8.3 de verdade só acontece no win32, e o que fica
 * pregado aqui é o critério do julgamento e a fronteira do «fora do win32 ou em ASCII puro, tudo passa como
 * está» — a lógica da conversão não pode machucar um caminho normal.
 */
import { describe, expect, it } from "vitest";
import { hasNonAscii, psQuote, toAnsiSafeDir } from "../win-ansi-path";

describe("hasNonAscii", () => {
  it("caractere acentuado ou de largura completa é julgado fora do ASCII (é justo o cenário do nome de usuário da issue #4)", () => {
    expect(hasNonAscii("C:\\Users\\Conceição\\AppData\\Roaming\\hotclip\\models")).toBe(true);
    expect(hasNonAscii("C:\\Users\\\uff55\uff53\uff45\uff52\\models")).toBe(true);
  });

  it("caminho em ASCII puro (com espaço e símbolos comuns) é julgado seguro", () => {
    expect(hasNonAscii("C:\\Program Files\\hotclip\\models")).toBe(false);
    expect(hasNonAscii("/Users/dev/Library/Application Support/hotclip")).toBe(false);
    expect(hasNonAscii("E:\\AI-tool\\hotclip_models (v2)")).toBe(false);
  });
});

describe("psQuote", () => {
  it("a aspa simples é duplicada e tudo é embrulhado num literal de aspas simples", () => {
    expect(psQuote("C:\\a b")).toBe("'C:\\a b'");
    expect(psQuote("C:\\it's here")).toBe("'C:\\it''s here'");
  });
});

describe("toAnsiSafeDir", () => {
  it("fora do win32 volta como está; no Windows, mesmo com o PowerShell lento para subir, a reserva cabe no orçamento da função", async () => {
    // No macOS e no Linux um caminho com acento tem de passar direto; a máquina Windows da CI tenta a
    // conversão 8.3 de verdade, e o PowerShell frio às vezes passa dos 5 segundos padrão do Vitest, então o
    // orçamento do teste precisa cobrir o tempo limite de 15 segundos declarado na implementação.
    const dir = "/tmp/Conceição/models";
    expect(await toAnsiSafeDir(dir)).toBe(dir);
  }, 20_000);

  it("caminho em ASCII puro volta como está em qualquer plataforma", async () => {
    const dir = "C:\\Users\\dev\\hotclip\\models";
    expect(await toAnsiSafeDir(dir)).toBe(dir);
  });
});
