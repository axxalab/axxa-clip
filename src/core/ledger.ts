/**
 * Registro de distribuição (v0.14): desde julho de 2026 a revisão de autorização
 * que as plataformas fazem sobre cortes e obras derivadas exige um "registro de
 * distribuição item por item" — quem autorizou precisa conseguir cruzar qual
 * vídeo final veio de qual intervalo de qual arquivo de origem, quando foi
 * exportado e onde foi publicado. Como já temos o arquivo de origem e as
 * marcações de tempo exatas, o registro sai praticamente de graça; as quatro
 * colunas do lado da publicação (plataforma, conta, link e data) ficam em branco
 * para a pessoa preencher, que é exatamente o formato que a revisão pede.
 *
 * O CSV sai com BOM de UTF-8 (para o Excel abrir os acentos corretamente com dois
 * cliques), e os campos com vírgula, aspas ou quebra de linha são escapados
 * conforme a RFC4180. São funções puras, testáveis.
 */

/** Uma linha do registro (a parte que o lado da exportação consegue preencher). */
export interface LedgerRow {
  /** Nome do arquivo do vídeo final. */
  file: string;
  title: string;
  durationSec: number;
  /** Caminho absoluto do arquivo de origem. */
  source: string;
  sourceStartSec: number | null;
  sourceEndSec: number | null;
  /** Quantidade de trechos costurados (1 = clipe contínuo). */
  pieces: number;
  /** Data e hora da exportação, em formato ISO. */
  exportedAt: string;
  /** Se leva o selo de conteúdo gerado por IA. */
  aigcLabel: boolean;
  /** Nota de transformação (de 0 a 100; ausente significa que não foi avaliada). */
  transformScore: number | null;
}

/** Escape de campo conforme a RFC4180: só ganha aspas quem tem vírgula, aspas ou quebra de linha, e as aspas internas são duplicadas. */
export function csvField(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = [
  "Arquivo do vídeo",
  "Título",
  "Duração (s)",
  "Arquivo de origem",
  "Início na origem (s)",
  "Fim na origem (s)",
  "Trechos costurados",
  "Data da exportação",
  "Selo de IA",
  "Nota de transformação (0-100)",
  // As quatro colunas abaixo ficam para a pessoa preencher uma por uma — é o
  // "um registro de distribuição por vídeo" que a revisão de autorização pede
  "Plataforma de publicação",
  "Conta de publicação",
  "Link da publicação",
  "Data da publicação",
];

/** O CSV completo do registro (com BOM e cabeçalho; as quatro colunas de publicação ficam em branco para preencher). */
export function buildLedgerCsv(rows: LedgerRow[]): string {
  const BOM = "﻿"; // para o Excel abrir os acentos corretamente com dois cliques
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.file),
        csvField(r.title),
        csvField(Number(r.durationSec.toFixed(1))),
        csvField(r.source),
        csvField(r.sourceStartSec !== null ? Number(r.sourceStartSec.toFixed(1)) : null),
        csvField(r.sourceEndSec !== null ? Number(r.sourceEndSec.toFixed(1)) : null),
        csvField(r.pieces),
        csvField(r.exportedAt),
        csvField(r.aigcLabel ? "sim" : "não"),
        csvField(r.transformScore),
        "", "", "", "",
      ].join(",")
    );
  }
  return BOM + lines.join("\r\n") + "\r\n";
}
