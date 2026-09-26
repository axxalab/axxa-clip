import { describe, it, expect } from "vitest";
import { resolveByteRange } from "../media-range";

describe("resolveByteRange", () => {
  const SIZE = 1000;

  it("sem cabeçalho Range → o arquivo inteiro, 200", () => {
    expect(resolveByteRange(null, SIZE)).toEqual({ start: 0, end: 999, status: 200 });
    expect(resolveByteRange("", SIZE)).toEqual({ start: 0, end: 999, status: 200 });
  });

  it("bytes=a-b → a parte no intervalo fechado; um fim além do limite é aparado no fim do arquivo", () => {
    expect(resolveByteRange("bytes=0-499", SIZE)).toEqual({ start: 0, end: 499, status: 206 });
    expect(resolveByteRange("bytes=500-99999", SIZE)).toEqual({ start: 500, end: 999, status: 206 });
  });

  it("bytes=a- → de a até o fim do arquivo (a forma principal de arrastar a linha de tempo)", () => {
    expect(resolveByteRange("bytes=200-", SIZE)).toEqual({ start: 200, end: 999, status: 206 });
  });

  it("bytes=-n → os últimos n bytes (o que o mp4 usa para achar o átomo moov)", () => {
    expect(resolveByteRange("bytes=-100", SIZE)).toEqual({ start: 900, end: 999, status: 206 });
    // n maior que o arquivo → o arquivo inteiro, mas ainda como 206
    expect(resolveByteRange("bytes=-5000", SIZE)).toEqual({ start: 0, end: 999, status: 206 });
  });

  it("intervalo que não dá para atender → null (quem chama responde 416)", () => {
    expect(resolveByteRange("bytes=1000-", SIZE)).toBeNull();
    expect(resolveByteRange("bytes=800-200", SIZE)).toBeNull();
  });

  it("uma forma não reconhecida é tratada como o arquivo inteiro (nada de 5xx)", () => {
    expect(resolveByteRange("bytes=0-499,600-999", SIZE)).toEqual({ start: 0, end: 999, status: 200 });
    expect(resolveByteRange("items=0-1", SIZE)).toEqual({ start: 0, end: 999, status: 200 });
  });
});
