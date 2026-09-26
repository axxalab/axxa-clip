/**
 * Verificação de qualidade do próprio vídeo (render QA): depois que o vídeo termina
 * de renderizar, uma passada de decodificação do ffmpeg mais uma conferência dos
 * pontos de corte transformam "a IA cortou bem?" num relatório que a máquina pode
 * conferir — tela preta, silêncio longo, desvio de volume e de duração e ponto de
 * corte no meio de uma palavra (o risco de palavra partida) são todos escritos no
 * campo qa do clips.json e devolvidos ao MCP e à CLI. A pessoa só precisa olhar a
 * faixa de avisos, sem reproduzir cada clipe para verificar.
 *
 * A leitura e o julgamento são inteiramente de funções puras (texto do stderr →
 * intervalos estruturados → relatório) e testáveis; só o runClipQa realmente roda
 * ffmpeg e ffprobe. A falha da própria verificação é coberta por quem chama, que
 * deixa o campo vazio, e nunca derruba a exportação (a mesma semântica da capa, do
 * SRT e dos outros produtos acessórios).
 *
 * e nunca derruba a exportação (a mesma semântica da capa, do SRT e dos outros
 * produtos acessórios).
 */
import { spawn } from "child_process";
import { resolveFfmpegPath } from "./binaries";
import { probeMedia } from "./probe";
import { EDGE_FADE_SEC } from "./cut";
import { formatLintIssue, type LintHit } from "./content-lint";
import type { TranscriptWord } from "../shared/api-types";

/** Um intervalo suspeito encontrado (na linha do tempo de saída do vídeo, em segundos). */
export interface QaSpan {
  startSec: number;
  endSec: number;
}

/** O relatório de verificação de um vídeo (vai para o campo qa do clips.json). */
export interface ClipQaReport {
  /** pass = todas as checagens passaram; warn = há itens de aviso (veja issues). */
  status: "pass" | "warn";
  /** A lista de avisos em linguagem legível (array vazio significa aprovado). */
  issues: string[];
  /** A duração medida do vídeo e a duração prevista pela esteira (em segundos). */
  durationSec: number;
  expectedDurationSec: number;
  /** Intervalos de tela preta (de 0,5s ou mais, com a imagem quase toda escura). */
  blackSpans: QaSpan[];
  /** Intervalos de silêncio longo (de 2s ou mais; com o corte seco ligado, um silêncio longo remanescente é especialmente suspeito). */
  silenceSpans: QaSpan[];
  /** Intervalos congelados, em que os pixels quase não mudam (de 3s ou mais); um comprovante antigo pode não ter este campo. */
  frozenSpans?: QaSpan[];
  /** Volume medido (EBU R128); null quando a varredura de áudio falha. */
  loudness: { integratedLufs: number; truePeakDb: number } | null;
  /** Quantos pontos de corte caíram no meio de uma palavra (0 = todo corte está fora do limite de palavra, sem risco de palavra partida). */
  midWordCuts: number | null;
  /** Palavras proibidas pelas plataformas encontradas (no título, no gancho, no texto e na legenda); null quando a checagem não rodou. */
  contentHits: LintHit[] | null;
  /** O maior intervalo "sem mudança visual" (em segundos); null quando a avaliação de ritmo não foi feita (por já haver legenda ou movimento de câmera cobrindo). */
  pacingGapSec: number | null;
  /** As entidades numéricas que o gancho e o título prometeram mas que não aparecem na transcrição do clipe; null quando não foi avaliado. */
  hookPayoffMissing: string[] | null;
  /** Cobertura das amostras do enquadramento por rosto; null quando o enquadramento por rosto não rodou. */
  subjectCoverage?: SubjectCoverage | null;
  /** Registro da correção automática (só existe quando o laço de correção da verificação rodou); veja repair.ts. */
  repair?: QaRepairRecord;
}

/** Registro da execução do laço de correção da verificação (vai para o clips.json, porque "o que a IA mexeu de novo" precisa ser auditável). */
export interface QaRepairRecord {
  /** Descrição legível da ação de correção (recorte do começo, recorte do fim, nova normalização de volume). */
  actions: string[];
  /** A lista de avisos antes da correção (para comparar com os issues de depois). */
  beforeIssues: string[];
  /** true = o vídeo corrigido foi adotado; false = a correção não melhorou o relatório, e o vídeo original ficou. */
  applied: boolean;
}

/** Julgamento de tela preta: reportado a partir de 0,5s (mais curto que isso é, em geral, transição ou piscada normal). */
const BLACK_MIN_SEC = 0.5;
/** Julgamento de silêncio: reportado a partir de 2s abaixo de -50 dB. */
const SILENCE_MIN_SEC = 2;
/** Julgamento de congelamento: reportado a partir de 3s, para não pegar a permanência padrão de 2,2s do título e do gancho. */
const FREEZE_MIN_SEC = 3;
/** Abaixo desta diferença entre quadros, a imagem é considerada a mesma. */
const FREEZE_NOISE = 0.0005;
/** Tolerância de volume: o aviso só sai quando o desvio do alvo de -14 LUFS passa de ±2 LU (uma passada só de loudnorm já oscila por natureza). */
const LOUDNESS_TOLERANCE_LU = 2;
/** Teto de pico real: acima de -1 dBTP há risco de recorte na recodificação da plataforma. */
const TRUE_PEAK_CEILING_DB = -1;
/** Tolerância de desvio de duração (em segundos): passar disso é, em geral, desalinhamento de costura ou de corte. */
const DURATION_TOLERANCE_SEC = 0.75;
/** Tolerância da distância do ponto de corte ao limite de palavra: a duração da transição amplia um pouco mais, e encostar no limite não conta como cortar dentro da palavra. */
const BOUNDARY_TOLERANCE_SEC = EDGE_FADE_SEC + 0.02;
/**
 * Linha de aviso do ritmo da imagem (em segundos): pelo critério da pesquisa de 2026,
 * "o intervalo entre mudanças visuais significativas deve ser de até 3s, com teto
 * rígido de 5s" (RESEARCH-2026-08-CLIP-QUALITY.md, seção 3). Aqui é usado o teto
 * rígido — o aviso só sai quando o ritmo está claramente lento, sem dar palpite em
 * escolhas estilísticas de ritmo pausado.
 */
export const PACING_MAX_GAP_SEC = 5;

/**
 * Conferência do desfecho do gancho: as **entidades numéricas** prometidas no gancho,
 * na frase de suspense ou no título (preço, porcentagem, quantidade) precisam aparecer
 * de verdade na transcrição do clipe — uma lacuna de informação fabricada e não
 * cumprida derruba a taxa de conclusão, reduz o alcance no algoritmo e, no longo prazo,
 * perde seguidores (é o limite do "título chamativo sem enganar" da pesquisa de 2026).
 * Só são conferidas sequências de 2 dígitos ou mais: um número de um dígito costuma ser
 * transcrito por extenso ("três métodos" / "3 métodos"), e conferir isso geraria falso
 * positivo garantido, então é melhor deixar passar do que errar.
 * Devolve a lista de promessas não cumpridas (vazia = aprovado ou sem nada a conferir).
 * Função pura.
 */
export function missingHookPayoffs(hookText: string | undefined, transcriptText: string | undefined): string[] {
  const hook = (hookText ?? "").trim();
  if (!hook || !transcriptText) return [];
  const claims = hook.match(/\d[\d.,]*\s?(?:%|mil|mi|reais)?/g) ?? [];
  // Normalização da transcrição: depois de tirar os separadores, a busca é pelo "núcleo numérico" ("1.999" → "1999"; 30% procura "30" seguido de %)
  const text = transcriptText.replace(/[,.\s]/g, "");
  const missing: string[] = [];
  for (const claim of [...new Set(claims)]) {
    const core = claim.replace(/[^\d.]/g, "").replace(/\.$/, "");
    if (core.replace(/\./g, "").length < 2) continue; // número de um dígito não é conferido
    if (!text.includes(core)) missing.push(claim);
  }
  return missing;
}

/**
 * Sequência de eventos visuais (emenda da costura, emenda do corte seco, junção da
 * abertura fria e afins, na linha do tempo de saída) → o maior intervalo sem mudança.
 * O começo e o fim do vídeo contam cada um como um evento natural. Função pura; quem
 * chama não precisa chamar isto quando há legenda ou movimento automático de câmera
 * cobrindo (a mudança visual contínua já cobre o ritmo).
 */
export function maxVisualGapSec(eventsSec: number[], durationSec: number): number {
  const pts = [...new Set([0, ...eventsSec.filter((t) => t > 0 && t < durationSec), durationSec])].sort(
    (a, b) => a - b
  );
  let maxGap = 0;
  for (let i = 1; i < pts.length; i++) maxGap = Math.max(maxGap, pts[i] - pts[i - 1]);
  return Number(maxGap.toFixed(2));
}

/** Leitura da saída do blackdetect: `black_start:1.2 black_end:2.0 …` (os pares vêm na mesma linha). */
export function parseBlackSpans(stderr: string): QaSpan[] {
  const spans: QaSpan[] = [];
  const re = /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g;
  for (let m = re.exec(stderr); m; m = re.exec(stderr)) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      spans.push({ startSec: start, endSec: end });
    }
  }
  return spans;
}

/**
 * Leitura da saída do silencedetect: start e end aparecem em linhas separadas e são
 * emparelhados na ordem. Quando no fim só há start e nenhum end (o silêncio atravessa
 * até o fim do vídeo), o fechamento usa streamEndSec; sem ele, o par incompleto é
 * descartado.
 */
export function parseSilenceSpans(stderr: string, streamEndSec?: number): QaSpan[] {
  const spans: QaSpan[] = [];
  let open: number | null = null;
  const re = /silence_(start|end):\s*(-?[\d.]+)/g;
  for (let m = re.exec(stderr); m; m = re.exec(stderr)) {
    const v = Number(m[2]);
    if (!Number.isFinite(v)) continue;
    if (m[1] === "start") {
      open = v;
    } else if (open !== null) {
      if (v > open) spans.push({ startSec: Math.max(0, open), endSec: v });
      open = null;
    }
  }
  if (open !== null && streamEndSec !== undefined && streamEndSec > open) {
    spans.push({ startSec: Math.max(0, open), endSec: streamEndSec });
  }
  return spans;
}

/** Leitura da saída do freezedetect; quando o congelamento vai até o EOF, o fechamento usa streamEndSec. */
export function parseFreezeSpans(stderr: string, streamEndSec?: number): QaSpan[] {
  const spans: QaSpan[] = [];
  let open: number | null = null;
  const re = /lavfi\.freezedetect\.freeze_(start|end):\s*(-?[\d.]+)/g;
  for (let m = re.exec(stderr); m; m = re.exec(stderr)) {
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    if (m[1] === "start") {
      open = value;
    } else if (open !== null) {
      if (value > open) spans.push({ startSec: Math.max(0, open), endSec: value });
      open = null;
    }
  }
  if (open !== null && streamEndSec !== undefined && streamEndSec > open) {
    spans.push({ startSec: Math.max(0, open), endSec: streamEndSec });
  }
  return spans;
}

export interface SubjectCoverage {
  sampledFrames: number;
  clippedFrames: number;
  severeFrames: number;
  clippedRatio: number;
  worstVisibleFraction: number;
}

/** Aggregate crop-planner face visibility after jump-cut filtering. */
export function summarizeSubjectCoverage(
  samples: Array<{ minVisibleFraction: number }>
): SubjectCoverage | null {
  const valid = samples
    .map((sample) => Math.min(1, Math.max(0, sample.minVisibleFraction)))
    .filter(Number.isFinite);
  if (valid.length === 0) return null;
  const clippedFrames = valid.filter((fraction) => fraction < 0.9).length;
  const severeFrames = valid.filter((fraction) => fraction < 0.6).length;
  return {
    sampledFrames: valid.length,
    clippedFrames,
    severeFrames,
    clippedRatio: Number((clippedFrames / valid.length).toFixed(3)),
    worstVisibleFraction: Number(Math.min(...valid).toFixed(3)),
  };
}

/**
 * Leitura do resumo do ebur128: pega o volume do vídeo inteiro e o pico real do
 * Summary final.
 * No formato `I: -14.1 LUFS` e `Peak: -1.3 dBFS` (com peak=true, é o pico real).
 */
export function parseLoudnessSummary(stderr: string): ClipQaReport["loudness"] {
  const iMatches = [...stderr.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)];
  const pMatches = [...stderr.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/g)];
  if (iMatches.length === 0 || pMatches.length === 0) return null;
  const integratedLufs = Number(iMatches[iMatches.length - 1][1]);
  const truePeakDb = Number(pMatches[pMatches.length - 1][1]);
  if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDb)) return null;
  return { integratedLufs, truePeakDb };
}

/**
 * Conferência dos pontos de corte (função pura): se o início e o fim de cada trecho
 * preservado (na linha do tempo da origem) caem no meio de alguma palavra — tanto o
 * corte seco quanto o encaixe na troca de plano já têm proteção de limite de palavra, e
 * isto aqui é a conferência de "confie, mas verifique".
 * Tanto words quanto segments usam o tempo absoluto da origem.
 */
export function countMidWordCuts(
  words: TranscriptWord[],
  segments: QaSpan[],
  toleranceSec = BOUNDARY_TOLERANCE_SEC
): number {
  if (words.length === 0 || segments.length === 0) return 0;
  const cuts = segments.flatMap((s) => [s.startSec, s.endSec]);
  let hits = 0;
  for (const t of cuts) {
    const inside = words.some((w) => w.startSec + toleranceSec < t && t < w.endSec - toleranceSec);
    if (inside) hits += 1;
  }
  return hits;
}

/** Entradas do julgamento (tudo preparado por quem chama, o que facilita o teste). */
export interface QaAssessment {
  durationSec: number;
  expectedDurationSec: number;
  blackSpans: QaSpan[];
  silenceSpans: QaSpan[];
  frozenSpans?: QaSpan[];
  loudness: ClipQaReport["loudness"];
  /** O alvo de -14 LUFS só é conferido quando a normalização de volume estava ligada na exportação. */
  loudnessNormalized: boolean;
  midWordCuts: number | null;
  /** Palavras proibidas pelas plataformas encontradas (quem chama varre com o content-lint e passa aqui); ausente = não foi varrido. */
  contentHits?: LintHit[] | null;
  /** O maior intervalo sem mudança visual (calculado por maxVisualGapSec e passado aqui); ausente = o ritmo não é avaliado. */
  pacingGapSec?: number | null;
  /** As promessas do gancho não cumpridas (calculadas por missingHookPayoffs e passadas aqui); ausente = não é avaliado. */
  hookPayoffMissing?: string[] | null;
  /** Resumo da cobertura do assunto nas amostras do enquadramento por rosto; ausente = o enquadramento por rosto não foi usado. */
  subjectCoverage?: SubjectCoverage | null;
}

const fmtSec = (v: number): string => v.toFixed(1);

/** Julgamento puro: as medições de cada item → a lista de avisos e o estado. */
export function assessClipQa(input: QaAssessment): ClipQaReport {
  const issues: string[] = [];
  const delta = Math.abs(input.durationSec - input.expectedDurationSec);
  if (input.expectedDurationSec > 0 && delta > DURATION_TOLERANCE_SEC) {
    issues.push(`a duração do vídeo, de ${fmtSec(input.durationSec)}s, desvia ${fmtSec(delta)}s da prevista, de ${fmtSec(input.expectedDurationSec)}s`);
  }
  if (input.blackSpans.length > 0) {
    const longest = Math.max(...input.blackSpans.map((s) => s.endSec - s.startSec));
    issues.push(`${input.blackSpans.length} trecho(s) de tela preta detectado(s) (o mais longo com ${fmtSec(longest)}s)`);
  }
  if (input.silenceSpans.length > 0) {
    const longest = Math.max(...input.silenceSpans.map((s) => s.endSec - s.startSec));
    issues.push(`${input.silenceSpans.length} trecho(s) de silêncio longo detectado(s) (o mais longo com ${fmtSec(longest)}s)`);
  }
  if ((input.frozenSpans?.length ?? 0) > 0) {
    const longest = Math.max(...input.frozenSpans!.map((s) => s.endSec - s.startSec));
    issues.push(`${input.frozenSpans!.length} trecho(s) de imagem congelada detectado(s) (o mais longo com ${fmtSec(longest)}s; vale reproduzir para conferir)`);
  }
  if (input.loudnessNormalized && input.loudness) {
    const dev = Math.abs(input.loudness.integratedLufs - -14);
    if (dev > LOUDNESS_TOLERANCE_LU) {
      issues.push(`o volume de ${input.loudness.integratedLufs.toFixed(1)} LUFS desvia ${dev.toFixed(1)} LU do alvo de -14`);
    }
    if (input.loudness.truePeakDb > TRUE_PEAK_CEILING_DB) {
      issues.push(`o pico real de ${input.loudness.truePeakDb.toFixed(1)} dBTP passa do teto de ${TRUE_PEAK_CEILING_DB} (há risco de recorte na recodificação da plataforma)`);
    }
  }
  if ((input.midWordCuts ?? 0) > 0) {
    issues.push(`${input.midWordCuts} ponto(s) de corte caíram no meio de uma palavra (pode aparecer palavra partida; vale reproduzir para conferir)`);
  }
  if ((input.pacingGapSec ?? 0) > PACING_MAX_GAP_SEC) {
    issues.push(
      `a imagem fica ${fmtSec(input.pacingGapSec!)}s sem mudança visual (o ritmo está lento; vale ligar o movimento automático de câmera ou a legenda)`
    );
  }
  if ((input.hookPayoffMissing?.length ?? 0) > 0) {
    issues.push(
      `o que o gancho ou o título prometeram ("${input.hookPayoffMissing!.join(", ")}") não aparece no clipe (não cumprir é título enganoso, o que derruba a taxa de conclusão e o alcance da conta; vale trocar o gancho ou o ponto de corte)`
    );
  }
  if (input.subjectCoverage && (input.subjectCoverage.clippedRatio >= 0.15 || input.subjectCoverage.severeFrames >= 2)) {
    issues.push(
      `no enquadramento vertical, ${(input.subjectCoverage.clippedRatio * 100).toFixed(0)}% dos quadros amostrados não preservam o rosto por inteiro (o pior com ${(input.subjectCoverage.worstVisibleFraction * 100).toFixed(0)}%; vale conferir a composição)`
    );
  }
  const lintIssue = formatLintIssue(input.contentHits ?? []);
  if (lintIssue) issues.push(lintIssue);
  return {
    status: issues.length > 0 ? "warn" : "pass",
    issues,
    durationSec: Number(input.durationSec.toFixed(3)),
    expectedDurationSec: Number(input.expectedDurationSec.toFixed(3)),
    blackSpans: input.blackSpans.map((s) => ({ startSec: Number(s.startSec.toFixed(2)), endSec: Number(s.endSec.toFixed(2)) })),
    silenceSpans: input.silenceSpans.map((s) => ({ startSec: Number(s.startSec.toFixed(2)), endSec: Number(s.endSec.toFixed(2)) })),
    frozenSpans: (input.frozenSpans ?? []).map((s) => ({ startSec: Number(s.startSec.toFixed(2)), endSec: Number(s.endSec.toFixed(2)) })),
    loudness: input.loudness
      ? { integratedLufs: Number(input.loudness.integratedLufs.toFixed(1)), truePeakDb: Number(input.loudness.truePeakDb.toFixed(1)) }
      : null,
    midWordCuts: input.midWordCuts,
    contentHits: input.contentHits ?? null,
    pacingGapSec: input.pacingGapSec ?? null,
    hookPayoffMissing: input.hookPayoffMissing ?? null,
    subjectCoverage: input.subjectCoverage ?? null,
  };
}

/** Teto de coleta do stderr: as linhas de detect mais o resumo do ebur128 são muito menores que isso, e o limite evita que um material anômalo estoure a memória. */
const STDERR_CAP = 4 * 1024 * 1024;

/**
 * Decodifica o vídeo uma vez, coletando o stderr inteiro (as linhas de blackdetect e
 * silencedetect ficam espalhadas do começo ao fim, e o resumo do ebur128 vem no final —
 * então não dá para guardar só o fim, como faz o runFfmpeg).
 */
export async function scanClipMedia(path: string, signal?: AbortSignal): Promise<string> {
  const args = [
    "-hide_banner", "-nostats",
    "-i", path,
    "-vf", `blackdetect=d=${BLACK_MIN_SEC}:pix_th=0.10,freezedetect=n=${FREEZE_NOISE}:d=${FREEZE_MIN_SEC}`,
    "-af", `silencedetect=n=-50dB:d=${SILENCE_MIN_SEC},ebur128=peak=true`,
    "-f", "null", "-",
  ];
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"], signal });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += d.toString();
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`qa scan exited ${code}`));
    });
  });
}

export interface RunClipQaOptions {
  /** Duração do vídeo prevista pela esteira (a duração do clipe mais o trecho curto da abertura fria). */
  expectedDurationSec: number;
  /** Se a normalização de volume estava ligada na exportação (é o que decide se o alvo de -14 LUFS é conferido). */
  loudnessNormalized: boolean;
  /** As palavras que o clipe cobre (em tempo absoluto da origem); ausente, a conferência dos pontos de corte é pulada. */
  words?: TranscriptWord[];
  /** Os trechos da origem de fato preservados (vários, depois do corte seco); em tempo absoluto da origem, como words. */
  segments?: QaSpan[];
  /** Palavras proibidas pelas plataformas encontradas (o resultado da varredura do content-lint no título, no gancho, no texto e na legenda). */
  contentHits?: LintHit[] | null;
  /** O maior intervalo sem mudança visual (calculado por quem chama a partir do plano de edição); ausente = o ritmo não é avaliado. */
  pacingGapSec?: number | null;
  /** As promessas do gancho não cumpridas (calculadas por missingHookPayoffs e passadas aqui); ausente = não é avaliado. */
  hookPayoffMissing?: string[] | null;
  /** Resumo da cobertura de rosto, já filtrado pelos trechos finalmente preservados. */
  subjectCoverage?: SubjectCoverage | null;
  signal?: AbortSignal;
}

/** Roda a verificação completa num vídeo: varredura por decodificação, duração pelo ffprobe e conferência dos pontos de corte → o relatório. */
export async function runClipQa(path: string, opts: RunClipQaOptions): Promise<ClipQaReport> {
  const [stderr, info] = await Promise.all([scanClipMedia(path, opts.signal), probeMedia(path)]);
  return assessClipQa({
    durationSec: info.durationSec,
    expectedDurationSec: opts.expectedDurationSec,
    blackSpans: parseBlackSpans(stderr),
    silenceSpans: parseSilenceSpans(stderr, info.durationSec),
    frozenSpans: parseFreezeSpans(stderr, info.durationSec),
    loudness: parseLoudnessSummary(stderr),
    loudnessNormalized: opts.loudnessNormalized,
    midWordCuts: opts.words && opts.segments ? countMidWordCuts(opts.words, opts.segments) : null,
    contentHits: opts.contentHits,
    pacingGapSec: opts.pacingGapSec,
    hookPayoffMissing: opts.hookPayoffMissing,
    subjectCoverage: opts.subjectCoverage,
  });
}
