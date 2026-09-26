import { matchingCharacters, paraformerSupportsText } from "../shared/speech-text";
/**
 * Ponto de corte preciso (segunda passada de alinhamento): na exportação, só os candidatos que chegaram
 * à final são decodificados outra vez com o Paraformer (sherpa-onnx-paraformer-zh-2023-09-14, a única
 * edição que dá marca de tempo), e a marca de tempo por palavra integrada do CIF corrige o vocabulário
 * da transcrição principal — o karaokê da legenda, o corte seco, a abertura fria e o SRT se beneficiam todos.
 *
 * Por que o ASR principal não é trocado: as etiquetas de emoção e de evento de áudio do SenseVoice são a
 * fonte da sétima e da oitava trilha de evidência, e o Paraformer não as tem; já a precisão da marca de
 * tempo CIF do Paraformer (que os autores dizem superar o alinhamento forçado do Kaldi, na ordem de ±50ms)
 * é justamente o ponto fraco do lado do SenseVoice — cada um contribui com o que tem de melhor, e como o
 * trecho candidato tem só algumas dezenas de segundos, o custo da segunda decodificação é desprezível.
 * (De onde vem a ideia: pesquisa desmontando o FunClip, 05/08/2026.)
 *
 * refineWordTimings é função pura (alinhamento por LCS de caracteres + remapeamento do tempo) e testável;
 * só createClipAligner toca no modelo e no ffmpeg. Qualquer falha ou taxa de correspondência baixa devolve
 * null e quem chama volta ao vocabulário original — o alinhamento fino é um bônus, e nunca derruba a exportação.
 */
import { join } from "path";
import { tmpdir } from "os";
import { rm } from "fs/promises";
import { resolveFfmpegPath } from "./binaries";
import {
  ensureModel,
  extractPcmF32le16k,
  modelDir,
  readF32leSamples,
  PARAFORMER_MODEL,
} from "./models";
import { toAnsiSafeDir } from "./win-ansi-path";
import { loadSherpa, tokensToWords, type SherpaResult } from "./transcribe/sherpa-offline";
import type { AlignmentQualityReport, TranscriptWord } from "../shared/api-types";
import type { ClipPiece } from "../shared/pieces";
import { summarizeTimingQuality } from "../shared/transcript-quality";

/** Taxa de correspondência abaixo desta não é aceita (alucinação da transcrição / trecho de música de fundo: o alinhamento não é confiável). */
export const ALIGN_MIN_MATCH_FRAC = 0.5;
/** A folga de decodificação dos dois lados do trecho candidato (segundos): a pronúncia inteira da palavra da borda precisa caber dentro. */
const ALIGN_PAD_SEC = 0.4;
/** A janela da segunda decodificação (com os mesmos parâmetros da transcrição principal). */
const ALIGN_WINDOW_SEC = 28;
/** A duração mínima de uma palavra (segundos): depois do remapeamento não pode existir palavra de duração zero. */
const MIN_WORD_SEC = 0.02;

/** A unidade normalizada do alinhamento: um ideograma CJK ou um caractere latino/numérico. */
interface AlignUnit {
  ch: string;
  /** O índice da palavra a que pertence (do lado do destino) ou do token (do lado da referência). */
  idx: number;
}

/** Quebra o fluxo de palavras/tokens em unidades de caractere normalizadas (minúsculas, sem pontuação nem espaço). Função pura. */
export function toAlignUnits(items: Array<{ text: string }>): AlignUnit[] {
  const units: AlignUnit[] = [];
  for (let i = 0; i < items.length; i++) {
    for (const ch of matchingCharacters(items[i].text)) units.push({ ch, idx: i });
  }
  return units;
}

export interface RefineOutcome {
  words: TranscriptWord[];
  /** A proporção dos caracteres do destino que casaram com um tempo da referência (de 0 a 1). */
  matchedFrac: number;
  alignedWords: number;
  interpolatedWords: number;
}

/**
 * Corrige o tempo do vocabulário de destino usando o fluxo de tokens de referência (que tem marca de
 * tempo confiável): a correspondência é achada por LCS de caracteres, a palavra que casou adota o tempo
 * da referência direto, e a que não casou é interpolada entre as âncoras de antes e depois na proporção
 * da sua duração original, com a monotonia preservada do começo ao fim. O texto continua igual — o que
 * se corrige é só o tempo. Função pura.
 */
export function refineWordTimings(
  words: TranscriptWord[],
  refTokens: TranscriptWord[]
): RefineOutcome {
  if (words.length === 0) return { words: [], matchedFrac: 0, alignedWords: 0, interpolatedWords: 0 };
  const tgt = toAlignUnits(words);
  const ref = toAlignUnits(refTokens);
  if (tgt.length === 0 || ref.length === 0) {
    return { words: [...words], matchedFrac: 0, alignedWords: 0, interpolatedWords: words.length };
  }

  // A programação dinâmica clássica do LCS (o trecho candidato tem uns 10^3 caracteres, o que leva milissegundos)
  const n = tgt.length;
  const m = ref.length;
  // Limita tanto a alocação quanto o trabalho de CPU para legendas importadas/editadas patológicas.
  if ((n + 1) * (m + 1) > 4_000_000) return { words: [...words], matchedFrac: 0, alignedWords: 0, interpolatedWords: words.length };
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * (m + 1) + j] =
        tgt[i - 1].ch === ref[j - 1].ch
          ? dp[(i - 1) * (m + 1) + (j - 1)] + 1
          : Math.max(dp[(i - 1) * (m + 1) + j], dp[i * (m + 1) + (j - 1)]);
    }
  }
  // O caminho de volta dá os pares que casaram: unidade do destino → índice do token de referência
  const matchRef = new Int32Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (tgt[i - 1].ch === ref[j - 1].ch && dp[i * (m + 1) + j] === dp[(i - 1) * (m + 1) + (j - 1)] + 1) {
      matchRef[i - 1] = ref[j - 1].idx;
      i--;
      j--;
    } else if (dp[(i - 1) * (m + 1) + j] >= dp[i * (m + 1) + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }

  // Para cada palavra: o min/max dos tempos dos tokens de referência das unidades que casaram
  const out: Array<TranscriptWord & { matched: boolean }> = words.map((w) => ({ ...w, matched: false }));
  let matchedUnits = 0;
  for (let u = 0; u < n; u++) {
    const rIdx = matchRef[u];
    if (rIdx < 0) continue;
    matchedUnits++;
    const w = out[tgt[u].idx];
    const r = refTokens[rIdx];
    if (!w.matched) {
      w.startSec = r.startSec;
      w.endSec = r.endSec;
      w.matched = true;
    } else {
      w.startSec = Math.min(w.startSec, r.startSec);
      w.endSec = Math.max(w.endSec, r.endSec);
    }
  }

  // A palavra que não casou: interpolada entre as âncoras de antes e depois, na proporção da sua duração original; as das pontas encostam na âncora com a duração original
  for (let k = 0; k < out.length; k++) {
    if (out[k].matched) continue;
    // Acha o trecho contínuo que não casou [k, e]
    let e = k;
    while (e + 1 < out.length && !out[e + 1].matched) e++;
    const prev = k > 0 ? out[k - 1] : null;
    const next = e + 1 < out.length ? out[e + 1] : null;
    const origSpan = words[e].endSec - words[k].startSec || MIN_WORD_SEC;
    const from = prev ? prev.endSec : (next ? next.startSec - origSpan : words[k].startSec);
    const to = next ? next.startSec : from + origSpan;
    const scale = Math.max(0, to - from) / origSpan;
    for (let x = k; x <= e; x++) {
      const relStart = words[x].startSec - words[k].startSec;
      const relEnd = words[x].endSec - words[k].startSec;
      out[x].startSec = from + relStart * scale;
      out[x].endSec = Math.max(out[x].startSec + MIN_WORD_SEC, from + relEnd * scale);
    }
    k = e;
  }

  // Guarda de monotonia: o erro de arredondamento do alinhamento e da interpolação não pode fazer o tempo andar para trás
  for (let k = 1; k < out.length; k++) {
    if (out[k].startSec < out[k - 1].endSec - 1e-3) out[k].startSec = out[k - 1].endSec;
    if (out[k].endSec < out[k].startSec + MIN_WORD_SEC) out[k].endSec = out[k].startSec + MIN_WORD_SEC;
  }

  const alignedWords = out.filter((word) => word.matched).length;
  return {
    words: out.map(({ matched, ...word }) => ({
      ...word,
      timingSource: matched ? "aligned" : "interpolated",
    })),
    matchedFrac: matchedUnits / n,
    alignedWords,
    interpolatedWords: out.length - alignedWords,
  };
}

export interface ClipAlignmentResult {
  words: TranscriptWord[];
  report: AlignmentQualityReport;
}

/** A entrada do alinhamento fino (com a mesma forma dos campos correspondentes de ExportClipSpec). */
export interface AlignClipInput {
  startSec: number;
  endSec: number;
  pieces?: ClipPiece[];
  words: TranscriptWord[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cria um alinhador fino de lote: o modelo passa por ensure e é carregado uma única vez, e o lote inteiro
 * de trechos o reaproveita.
 * O align devolvido decodifica um trecho por vez (e, no trecho colado, pedaço por pedaço) e corrige o vocabulário;
 * com a taxa de correspondência abaixo do limite, ou em qualquer erro, devolve null (e quem chama volta ao vocabulário original).
 */
export function createClipAligner(
  modelsRoot: string,
  signal?: AbortSignal
): (filePath: string, clip: AlignClipInput) => Promise<ClipAlignmentResult | null> {
  let recognizer: any = null;
  const ensure = async (): Promise<void> => {
    await ensureModel(modelsRoot, PARAFORMER_MODEL, undefined, signal);
    if (!recognizer) {
      const sh = loadSherpa();
      // O arquivo do modelo é aberto pela camada nativa (ANSI): no Windows, o caminho com acento vira primeiro o caminho curto 8.3 (issue #4)
      const dir = await toAnsiSafeDir(modelDir(modelsRoot, PARAFORMER_MODEL));
      recognizer = new sh.OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          paraformer: { model: join(dir, "model.int8.onnx") },
          tokens: join(dir, "tokens.txt"),
          numThreads: 2,
          provider: "cpu",
          debug: 0,
        },
      });
    }
  };

  /** Decodifica um intervalo do vídeo de origem → um fluxo de tokens com tempo absoluto. */
  const decodeSpan = async (filePath: string, fromSec: number, durationSec: number): Promise<TranscriptWord[]> => {
    const pcmPath = join(tmpdir(), `hotclip-align-${Date.now()}-${Math.round(fromSec * 1000)}.f32le`);
    try {
      await extractPcmF32le16k(resolveFfmpegPath(), filePath, pcmPath, { startSec: fromSec, durationSec }, undefined, signal);
      const samples = await readF32leSamples(pcmPath);
      const sampleRate = 16000;
      const windowSamples = ALIGN_WINDOW_SEC * sampleRate;
      const tokens: TranscriptWord[] = [];
      for (let start = 0; start < samples.length; start += windowSamples) {
        if (signal?.aborted) throw new Error("align cancelled");
        const chunk = samples.subarray(start, Math.min(start + windowSamples, samples.length));
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate, samples: chunk });
        recognizer.decode(stream);
        const result = recognizer.getResult(stream) as SherpaResult;
        const offsetSec = fromSec + start / sampleRate;
        tokens.push(...tokensToWords(result, offsetSec, offsetSec + chunk.length / sampleRate));
        stream.free?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return tokens;
    } finally {
      await rm(pcmPath, { force: true }).catch(() => {});
    }
  };

  return async (filePath, clip) => {
    signal?.throwIfAborted();
    if (!paraformerSupportsText(clip.words.map((w) => w.text).join(""))) return null;
    await ensure();
    const ranges: Array<{ startSec: number; endSec: number }> =
      clip.pieces && clip.pieces.length > 1 ? clip.pieces : [{ startSec: clip.startSec, endSec: clip.endSec }];
    const refined: TranscriptWord[] = [];
    let matched = 0;
    let total = 0;
    for (const r of ranges) {
      const from = Math.max(0, r.startSec - ALIGN_PAD_SEC);
      const spanDur = r.endSec + ALIGN_PAD_SEC - from;
      const tokens = await decodeSpan(filePath, from, spanDur);
      // Guarda de utilidade das marcas de tempo: se o tempo dos tokens quase não se espalha (tudo amontoado
      // num ponto), aquele ambiente/edição de modelo não devolveu tempo de verdade — melhor abandonar tudo que corrigir o vocabulário com tempo falso
      if (tokens.length >= 5) {
        const spread = tokens[tokens.length - 1].startSec - tokens[0].startSec;
        if (spread < Math.min(spanDur, 5) * 0.2) return null;
      }
      // A palavra é atribuída ao pedaço pelo seu ponto médio (a mesma semântica de sliceWords)
      const wordsIn = clip.words.filter((w) => {
        const mid = (w.startSec + w.endSec) / 2;
        return mid >= r.startSec && mid <= r.endSec;
      });
      if (wordsIn.length === 0) continue;
      const res = refineWordTimings(wordsIn, tokens);
      const units = toAlignUnits(wordsIn).length;
      matched += res.matchedFrac * units;
      total += units;
      refined.push(...res.words);
    }
    if (total === 0 || matched / total < ALIGN_MIN_MATCH_FRAC) return null;
    const words = refined.sort((a, b) => a.startSec - b.startSec);
    const timing = summarizeTimingQuality(words);
    return {
      words,
      report: {
        matchedFrac: matched / total,
        alignedWords: timing.sourceCounts.aligned ?? 0,
        interpolatedWords: timing.sourceCounts.interpolated ?? 0,
        uncertainSpans: timing.uncertainSpans,
      },
    };
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
