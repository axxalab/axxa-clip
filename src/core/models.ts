/**
 * Gestão dos modelos de IA locais: o registro + o download da primeira execução com espelhos de reserva
 * (o GitHub é lento ou inalcançável para muita gente, então cada modelo lista espelhos tentados em ordem).
 *
 * Os modelos moram FORA do pacote do aplicativo (na pasta de dados do usuário), de modo que uma
 * atualização do app nunca os baixe de novo e o instalador continue pequeno.
 */
import { mkdir, open, readFile, rename, rm, stat } from "fs/promises";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { join, dirname } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { x as tarExtract } from "tar";
import unbzip2 from "unbzip2-stream";
import { ffmpegAudioStreamSpecifier } from "./probe";

const execFileAsync = promisify(execFile);

export interface ModelAsset {
  id: string;
  /** A URL principal de download (o arquivo anexado a um release do GitHub). */
  url: string;
  /** Os prefixos de espelho tentados antes da URL principal, para alcançar quem está em rede difícil. */
  mirrors: string[];
  /** O nome da pasta em que o arquivo compactado é extraído (a pasta de primeiro nível do tar.bz2). */
  extractedDir: string;
  /** O tamanho aproximado, para a barra de progresso. */
  approxBytes: number;
  /**
   * Um arquivo cru e único em vez de um tar.bz2 — baixado direto para
   * `<modelsRoot>/<extractedDir>/<singleFile>`.
   */
  singleFile?: string;
  /** O SHA-256 exato, em minúsculas, dos arquivos crus e únicos, quando o projeto de origem o publica. */
  sha256?: string;
  /**
   * URLs alternativas completas (um espelho que troca o host inteiro, como o hf-mirror.com) — `mirrors`
   * só sabe fazer proxy de prefixo, o que não serve para espelhos que trocam o domínio, como os do
   * HuggingFace; as altUrls são tentadas antes da URL principal, mantendo a ordem de «espelho mais perto primeiro».
   */
  altUrls?: string[];
}

/**
 * SenseVoice-Small int8 (ASR de zh/yue/en/ja/ko, Apache-2.0) pelo sherpa-onnx.
 * Um modelo só cobre o conjunto de idiomas do MVP, com marca de tempo por token.
 */
export const SENSEVOICE_MODEL: ModelAsset = {
  id: "sensevoice-2024-07-17",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2",
  mirrors: [
    // Serviços de proxy do gh normalmente alcançáveis de redes difíceis; tentados em ordem
    "https://ghfast.top/",
    "https://gh-proxy.com/",
  ],
  extractedDir: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
  // O tamanho medido do arquivo compactado (conferido baixando na máquina em 07/2026): 999MB, muito maior que o modelo em si — só com este número a barra de progresso fica correta.
  approxBytes: 1_047_870_769,
};

/**
 * Paraformer-large zh/en int8 (Apache-2.0) pelo sherpa-onnx — a edição local «mais precisa»:
 * taxa de erro por caractere em mandarim bem menor que a do SenseVoice-Small, com marca de tempo por
 * token, em ~230MB.
 */
export const PARAFORMER_MODEL: ModelAsset = {
  id: "paraformer-zh-2023-09-14",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-2023-09-14.tar.bz2",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "sherpa-onnx-paraformer-zh-2023-09-14",
  approxBytes: 240 * 1024 * 1024,
};

/**
 * FireRedASR2-CTC int8 (mandarim + dialetos + inglês, Apache-2.0, XiaoHongShu 02/2026) pelo sherpa-onnx
 * — a edição local de maior precisão: cerca de metade do erro relativo do SenseVoice-Small, com marca
 * de tempo por token. Exige sherpa-onnx >= 1.12.27.
 */
export const FIRERED_MODEL: ModelAsset = {
  id: "fireredasr2-ctc-2026-02-25",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25.tar.bz2",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25",
  approxBytes: 520 * 1024 * 1024,
};

/**
 * Parakeet TDT 0.6B v3 int8 (NVIDIA, CC-BY-4.0) pelo sherpa-onnx — a edição local de português.
 * É um transducer, e por isso traz marca de tempo por token NATIVA, que é do que a legenda palavra a
 * palavra e o alinhamento reverso dependem; cobre 25 idiomas europeus, entre eles o português.
 * Exige sherpa-onnx >= 1.13 (o tipo de modelo nemo_transducer).
 */
export const PARAKEET_MODEL: ModelAsset = {
  id: "nemo-parakeet-tdt-0.6b-v3-int8",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  // Content-Length real do anexo do release (conferido em 26/09/2026): sem este número a barra de progresso mente
  approxBytes: 487_170_055,
};

/**
 * Whisper large-v3 int8 (OpenAI, MIT) pelo sherpa-onnx — a edição local de maior cobertura de idiomas
 * (99), útil em material com troca de idioma ou sotaque difícil.
 * Atenção ao que ele NÃO faz: o Whisper é encoder-decoder e o sherpa-onnx não devolve marca de tempo
 * por token nenhuma, então o tempo das palavras sai estimado dentro da janela e precisa do alinhamento
 * para virar palavra a palavra. Para legenda karaokê, prefira o Parakeet.
 */
export const WHISPER_LARGE_V3_MODEL: ModelAsset = {
  id: "whisper-large-v3",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-large-v3.tar.bz2",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "sherpa-onnx-whisper-large-v3",
  approxBytes: 1_068_482_488,
};

/**
 * Whisper large-v3-turbo int8 (OpenAI, MIT) pelo sherpa-onnx — o mesmo encoder do large-v3 com um
 * decoder podado: bem mais rápido em CPU, com perda pequena de qualidade. Mesma ressalva de tempo.
 */
export const WHISPER_TURBO_MODEL: ModelAsset = {
  id: "whisper-large-v3-turbo",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "sherpa-onnx-whisper-turbo",
  approxBytes: 563_790_207,
};

/**
 * Detector de rosto YuNet (233KB, MIT, do zoo da OpenCV) — é ele que move o reenquadramento vertical
 * ciente de rosto. A variante de entrada fixa em 640×640 (com decodificação conferida); é tão pequeno
 * que o download é instantâneo mesmo sem espelho.
 */
export const YUNET_MODEL: ModelAsset = {
  id: "yunet-2023mar",
  url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "yunet-2023mar",
  approxBytes: 233 * 1024,
  singleFile: "model.onnx",
};

/**
 * Reconhecimento de expressão FER+ (VGG13, MIT, validado oficialmente no onnx/models) — usado pelo sinal
 * de pico de expressão: entrada 1×1×64×64 em tons de cinza (valores crus de 0 a 255) e saída com os
 * logits de 8 emoções.
 */
export const EMOTION_MODEL: ModelAsset = {
  id: "emotion-ferplus-8",
  url: "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-8.onnx",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "emotion-ferplus-8",
  approxBytes: 34 * 1024 * 1024,
  singleFile: "model.onnx",
};

/**
 * Pontuação CT-Transformer (zh/en, int8, Apache-2.0) — o Paraformer e o FireRed não emitem pontuação,
 * o que deixa a divisão em frases sem base; este modelo a recupera.
 */
export const PUNCT_MODEL: ModelAsset = {
  id: "punct-ct-transformer-2024-04-12",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8",
  approxBytes: 65 * 1024 * 1024,
};

/**
 * pyannote segmentation-3.0 em ONNX (MIT) — a frente de detecção de troca de falante da diarização.
 * Distribuído pelos releases do sherpa-onnx (sem precisar de login no HF).
 */
export const SEGMENTATION_MODEL: ModelAsset = {
  id: "pyannote-segmentation-3-0",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "sherpa-onnx-pyannote-segmentation-3-0",
  approxBytes: 7 * 1024 * 1024,
};

/**
 * Embedding 3D-Speaker ERes2Net base zh (Apache-2.0) — as impressões vocais que agrupam os trechos da
 * diarização por falante. ATENÇÃO: a etiqueta do release de origem é mesmo escrita
 * "speaker-recongition-models".
 */
export const SPEAKER_EMBEDDING_MODEL: ModelAsset = {
  id: "3dspeaker-eres2net-base-zh",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "3dspeaker-eres2net-base-zh",
  approxBytes: 39 * 1024 * 1024,
  singleFile: "model.onnx",
};

/**
 * Detecção da borda entre cortes de câmera TransNetV2 em ONNX (MIT, ~31MB) — devolve, quadro a quadro,
 * a probabilidade de troca de câmera, e é o que move o «encaixe do ponto de corte na borda do corte».
 * Entrada float32 [1,100,27,48,3] (RGB de 0 a 255), e a saída "534" é a probabilidade de troca no quadro
 * já passada por sigmoide (na prática, um corte seco dá 0,98, e o limite é 0,5).
 */
export const TRANSNETV2_MODEL: ModelAsset = {
  id: "transnetv2-onnx",
  url: "https://huggingface.co/elya5/transnetv2/resolve/main/transnetv2.onnx",
  mirrors: [],
  altUrls: ["https://hf-mirror.com/elya5/transnetv2/resolve/main/transnetv2.onnx"],
  extractedDir: "transnetv2-onnx",
  approxBytes: 31_250_929,
  singleFile: "model.onnx",
};

/**
 * Silero VAD v6 em ONNX (MIT, <1MB) — a evidência de fala e não-fala para bordas de trecho seguras e para
 * o corte seco. Roda pelo runtime do sherpa-onnx que já vem empacotado.
 */
export const SILERO_VAD_MODEL: ModelAsset = {
  id: "silero-vad-v6",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "silero-vad-v6",
  approxBytes: 643_854,
  singleFile: "model.onnx",
  sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
};

/**
 * Realce de voz em alta resolução DPDFNet2 (Apache-2.0, 48 kHz).
 * Diferente da exportação minúscula do GTCRN, este modelo mantém a saída de banda cheia em 48 kHz, o que
 * o torna adequado a uma passada explícita de realce do áudio de publicação, e não só a um
 * pré-processamento para ASR. Roda pelo runtime do sherpa-onnx que já vem empacotado.
 */
export const DPDFNET_SPEECH_ENHANCEMENT_MODEL: ModelAsset = {
  id: "dpdfnet2-48khz-hr",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/dpdfnet2_48khz_hr.onnx",
  mirrors: ["https://ghfast.top/", "https://gh-proxy.com/"],
  extractedDir: "dpdfnet2-48khz-hr",
  approxBytes: 10_596_848,
  singleFile: "model.onnx",
  sha256: "0b399f8a58dc4d70d8cd97541f5c39869406145193b957d00a03b66070944928",
};

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  /**
   * "download" enquanto os bytes vêm da rede; "extract" enquanto o arquivo é descompactado localmente.
   * A reserva de bz2 em processo pode levar minutos num arquivo de 1GB, então a interface precisa
   * mostrar isso como uma etapa própria, e não como um 100% travado.
   */
  phase?: "download" | "extract";
}

/** As URLs candidatas na ordem de tentativa: os espelhos primeiro (o mais perto antes) e a origem depois. */
export function candidateUrls(asset: ModelAsset): string[] {
  return [...asset.mirrors.map((m) => `${m}${asset.url}`), ...(asset.altUrls ?? []), asset.url];
}

/** O caminho absoluto em que um modelo é extraído, dada a raiz de modelos. */
export function modelDir(modelsRoot: string, asset: ModelAsset): string {
  return join(modelsRoot, asset.extractedDir);
}

/** Verdadeiro quando o modelo já está presente no disco. */
export async function isModelInstalled(modelsRoot: string, asset: ModelAsset): Promise<boolean> {
  try {
    if (asset.singleFile) {
      const path = join(modelDir(modelsRoot, asset), asset.singleFile);
      const s = await stat(path);
      if (!s.isFile() || s.size <= 0) return false;
      if (asset.sha256) {
        const actual = createHash("sha256").update(await readFile(path)).digest("hex");
        return actual === asset.sha256.toLowerCase();
      }
      return true;
    }
    const s = await stat(modelDir(modelsRoot, asset));
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** Quantas vezes a retomada é tentada em cada URL — um arquivo grande que cai continua por Range, em vez de começar do zero. */
const RESUME_ATTEMPTS_PER_URL = 3;
/** O intervalo entre tentativas: um respiro para a rede que caiu num instante, sem deixar a pessoa esperando de graça. */
const RETRY_DELAY_MS = 1500;

/** Lê o Content-Range "bytes início-fim/total"; na falha devolve null. */
export function parseContentRange(header: string | null): { start: number; total: number } | null {
  const m = /bytes\s+(\d+)-\d+\/(\d+)/.exec(header ?? "");
  if (!m) return null;
  return { start: Number(m[1]), total: Number(m[2]) };
}

/**
 * Download com retomada numa URL só: na falha os bytes já baixados ficam, e a rodada seguinte continua
 * com Range. O fetch cair no meio de um arquivo grande do GitHub (o pacote do SenseVoice tem 1GB) é o
 * normal, e sem retomada o resultado é falhar em todos os espelhos, um a um (medido na máquina em
 * 07/2026). A resposta 206 confere o ponto de partida, e um espelho que mentir zera tudo e recomeça,
 * garantindo que o arquivo parcial nunca seja contaminado; no fim, o pacote ainda tem a descompactação
 * do tar e a guarda de tamanho como rede de segurança.
 */
async function downloadResumable(
  url: string,
  archivePath: string,
  asset: ModelAsset,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < RESUME_ATTEMPTS_PER_URL; attempt++) {
    if (signal?.aborted) throw lastError ?? new Error("aborted");
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      let existing = 0;
      try {
        existing = (await stat(archivePath)).size;
      } catch {
        // Não há arquivo parcial: começa do zero
      }
      const headers: Record<string, string> = existing > 0 ? { Range: `bytes=${existing}-` } : {};
      const res = await fetch(url, { signal, redirect: "follow", headers });
      // 416: os bytes já baixados ≥ o tamanho do arquivo no servidor, o que conta como download concluído, e a validação da camada de cima decide o resto
      if (res.status === 416) return;
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      let offset = existing;
      let exactTotal: number | null = null;
      if (res.status === 206) {
        const range = parseContentRange(res.headers.get("content-range"));
        if (!range || range.start !== existing) {
          // O espelho mentiu sobre o ponto de retomada: o arquivo parcial não é confiável, então zera e recomeça
          await rm(archivePath, { force: true });
          throw new Error("bad content-range on resume");
        }
        exactTotal = range.total;
      } else {
        // O servidor não suporta Range (devolveu 200 com o arquivo inteiro): sobrescreve e conta do começo
        offset = 0;
      }
      const remaining = Number(res.headers.get("content-length") ?? NaN);
      const totalBytes = exactTotal ?? (Number.isFinite(remaining) ? offset + remaining : asset.approxBytes);

      // Cada bloco é escrito explicitamente no disco (em vez de pipeline+WriteStream): se a conexão cair,
      // nenhum byte já recebido se perde, e é só assim que o ponto de retomada bate exatamente com o disco.
      let downloadedBytes = offset;
      const fh = await open(archivePath, offset > 0 ? "a" : "w");
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await fh.write(value);
          downloadedBytes += value.byteLength;
          onProgress?.({ downloadedBytes, totalBytes, phase: "download" });
        }
      } finally {
        await fh.close();
      }
      return;
    } catch (e) {
      lastError = e;
      if (signal?.aborted) throw e;
      // O arquivo parcial fica: a rodada seguinte (ou o espelho seguinte, do mesmo arquivo de release) continua de onde parou
    }
  }
  throw lastError;
}

/**
 * Extrai um .tar.bz2 em destDir. O tar do sistema primeiro (o caminho nativo rápido no macOS/Linux); a
 * reserva em JavaScript puro entra quando ele falha — o Windows 10/11 vem com um bsdtar compilado
 * SOMENTE com gzip, então `tar -xjf` precisa de um programa bzip2 externo que não existe → falha
 * determinística em toda máquina Windows (issue #17: o download de 1GB chegava a 100%, o pacote era
 * apagado como «corrompido», o espelho seguinte baixava do zero, para sempre). Só quando os DOIS
 * extratores falham é que o pacote está de fato corrompido.
 *
 * `systemTar` é injetável nos testes (para forçar o caminho de reserva); passe null para pular o tar do
 * sistema por completo.
 */
export async function extractTarBz2(
  archivePath: string,
  destDir: string,
  onProgress?: (p: DownloadProgress) => void,
  systemTar: string | null = "tar"
): Promise<void> {
  const totalBytes = (await stat(archivePath)).size;
  onProgress?.({ downloadedBytes: 0, totalBytes, phase: "extract" });
  if (systemTar) {
    try {
      await execFileAsync(systemTar, ["-xjf", archivePath, "-C", destDir], { maxBuffer: 8 * 1024 * 1024 });
      onProgress?.({ downloadedBytes: totalBytes, totalBytes, phase: "extract" });
      return;
    } catch {
      // segue para o extrator em processo
    }
  }
  // bz2 → tar em processo. O progresso conta os bytes compactados consumidos, então a barra anda de
  // forma honesta ao longo de uma descompactação de 1GB que leva minutos.
  let read = 0;
  const source = createReadStream(archivePath);
  source.on("data", (chunk) => {
    read += chunk.length;
    onProgress?.({ downloadedBytes: read, totalBytes, phase: "extract" });
  });
  await pipeline(source, unbzip2(), tarExtract({ cwd: destDir }));
}

/**
 * Baixa e extrai o pacote de um modelo. Cada URL candidata é tentada até uma dar certo; o arquivo é
 * escrito num temporário, extraído com o tar do sistema (com a reserva de bz2+tar em processo onde o tar
 * do sistema não sabe fazer bzip2 — notadamente no Windows) e renomeado de forma atômica.
 * O arquivo parcial de uma conexão que caiu é preservado entre espelhos para a retomada (todas as URLs
 * candidatas apontam para o mesmo arquivo); se a pessoa cancelar no meio, ele também fica, e a próxima
 * inicialização continua de onde parou.
 */
export async function ensureModel(
  modelsRoot: string,
  asset: ModelAsset,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const target = modelDir(modelsRoot, asset);
  if (await isModelInstalled(modelsRoot, asset)) return target;
  await mkdir(modelsRoot, { recursive: true });

  const archivePath = join(modelsRoot, `${asset.id}.download.tar.bz2`);
  let lastError: unknown = null;

  for (const url of candidateUrls(asset)) {
    try {
      await downloadResumable(url, archivePath, asset, onProgress, signal);
    } catch (e) {
      lastError = e;
      if (signal?.aborted) throw e;
      continue; // falha de rede: o arquivo parcial fica para o espelho seguinte retomar
    }

    try {
      if (asset.singleFile) {
        // protege contra um arquivo de ponteiro do Git-LFS se passando pelo modelo
        const dl = await stat(archivePath);
        if (dl.size < asset.approxBytes * 0.5) {
          throw new Error(`downloaded file too small (${dl.size}B) — likely an LFS pointer`);
        }
        if (asset.sha256) {
          const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
          if (actual !== asset.sha256.toLowerCase()) throw new Error(`checksum mismatch for ${asset.id}`);
        }
        // arquivo cru: movido para o lugar de forma atômica
        await mkdir(target, { recursive: true });
        const installedPath = join(target, asset.singleFile);
        await rm(installedPath, { force: true });
        await rename(archivePath, installedPath);
      } else {
        // A extração vai para uma pasta de preparo e só então um rename atômico acontece: nem um processo
        // morto nem uma extração que falha deixam atrás uma pasta de modelo incompleta que o isModelInstalled tomaria por «instalado».
        const staging = join(modelsRoot, `${asset.id}.extracting`);
        await rm(staging, { recursive: true, force: true });
        await mkdir(staging, { recursive: true });
        try {
          await extractTarBz2(archivePath, staging, onProgress);
          const produced = join(staging, asset.extractedDir);
          if (!(await stat(produced).catch(() => null))?.isDirectory()) {
            throw new Error(`archive did not contain expected dir ${asset.extractedDir}`);
          }
          await rm(target, { recursive: true, force: true });
          await rename(produced, target);
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
        await rm(archivePath, { force: true });
      }
      if (!(await isModelInstalled(modelsRoot, asset))) {
        throw new Error(`archive did not contain expected dir ${asset.extractedDir}`);
      }
      return target;
    } catch (e) {
      lastError = e;
      // Baixou, mas os dois caminhos de extração falharam: o arquivo está de fato corrompido, então zera e recomeça no espelho seguinte
      await rm(archivePath, { force: true });
      if (signal?.aborted) throw e;
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`model download failed after all mirrors (${asset.id}): ${msg}`);
}

/**
 * Extrai de qualquer mídia um arquivo de amostras raw f32le mono a 16k (que o motor de ASR consome direto).
 * Não se gera um wav para depois o sherpa abrir com readWave: a camada nativa abre o caminho em ANSI no
 * Windows, e uma pasta temporária sob um nome de usuário com acento simplesmente não abre (issue #4). As
 * amostras cruas são lidas para a memória pelo lado do Node (o fs é imune a caminho Unicode), e a camada
 * nativa só vê um Float32Array em memória.
 */
export async function extractPcmF32le16k(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  range?: { startSec: number; durationSec: number },
  audioStreamIndex?: number,
  signal?: AbortSignal
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const tmp = `${outputPath}.tmp.f32le`;
  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner", "-y",
        // Extração por intervalo (o alinhamento fino decodifica só o trecho candidato): -ss antes de -i salta rápido, e -t recorta a duração
        ...(range ? ["-ss", String(Math.max(0, range.startSec))] : []),
        "-i", inputPath,
        ...(range ? ["-t", String(Math.max(0.1, range.durationSec))] : []),
        "-map", ffmpegAudioStreamSpecifier(audioStreamIndex),
        "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-c:a", "pcm_f32le", tmp,
      ],
      { maxBuffer: 32 * 1024 * 1024, signal }
    );
    await rename(tmp, outputPath);
  } finally { await rm(tmp, { force: true }).catch(() => {}); }
}

/** Lê as amostras raw f32le para a memória. O byteOffset de um Buffer não é garantidamente alinhado em 4 bytes, então os dados são copiados para um ArrayBuffer novo antes de virar Float32Array. */
export async function readF32leSamples(path: string): Promise<Float32Array> {
  const buf = await readFile(path);
  const bytes = buf.byteLength - (buf.byteLength % 4);
  const aligned = new ArrayBuffer(bytes);
  new Uint8Array(aligned).set(buf.subarray(0, bytes));
  return new Float32Array(aligned);
}
