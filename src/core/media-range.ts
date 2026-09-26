/**
 * Leitura do cabeçalho Range — o coração da resposta em partes do protocolo de pré-visualização de mídia
 * local (hotclip-media://).
 * Arrastar a linha de tempo de um <video> depende inteiramente do 206 em partes; errar uma borda na leitura
 * é tela preta ou carregamento infinito, e por isso isto virou função pura, coberta por teste.
 */

export interface ByteRange {
  start: number;
  end: number;
  /** 200 = o arquivo inteiro; 206 = uma parte. */
  status: 200 | 206;
}

/**
 * Lê o cabeçalho Range (nas três formas: bytes=a-b, bytes=a- e bytes=-n).
 * Devolver null quer dizer que o intervalo não dá para atender (a resposta deve ser 416); sem cabeçalho Range,
 * ou numa forma não reconhecida, volta o arquivo inteiro.
 */
export function resolveByteRange(rangeHeader: string | null, size: number): ByteRange | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  if (!m || (!m[1] && !m[2])) return { start: 0, end: size - 1, status: 200 };
  let start = 0;
  let end = size - 1;
  if (m[1]) {
    start = Number(m[1]);
    if (m[2]) end = Math.min(Number(m[2]), size - 1);
  } else {
    // bytes=-n: os últimos n bytes
    start = Math.max(0, size - Number(m[2]));
  }
  if (start >= size || start > end) return null;
  return { start, end, status: 206 };
}
