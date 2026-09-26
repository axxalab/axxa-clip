/**
 * Diagnóstico da máquina (doctor): os três culpados de quase toda falha na primeira execução —
 * modelo que não baixou, ffmpeg indisponível e endpoint de LLM sem configuração — são todos
 * verificados por um comando só, e o que dá para consertar vem com a receita do conserto. A lógica
 * da verificação é separada da apresentação (o resultado é dado puro): a CLI usa primeiro, e a
 * página de configurações do desktop reaproveita direto depois.
 */
import { readFile, readdir, stat } from "fs/promises";
import { statfs } from "fs/promises";
import { dirname, join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import type { LlmConfig } from "../shared/api-types";
import { resolveFfmpegPath, resolveFfprobePath } from "./binaries";
import {
  isModelInstalled,
  modelDir,
  type ModelAsset,
  SENSEVOICE_MODEL,
  PARAFORMER_MODEL,
  FIRERED_MODEL,
  YUNET_MODEL,
  EMOTION_MODEL,
  PUNCT_MODEL,
  TRANSNETV2_MODEL,
  SEGMENTATION_MODEL,
  SPEAKER_EMBEDDING_MODEL,
  SILERO_VAD_MODEL,
  DPDFNET_SPEECH_ENHANCEMENT_MODEL,
} from "./models";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  /** Identificador estável de máquina; é por ele que o desktop traduz o nome. */
  id: string;
  /** O nome do item verificado (legível por quem lê). */
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** A sugestão de conserto que dá para seguir (ausente quando não há). */
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** Os modelos que a esteira padrão usa e que ainda não estão instalados — o que o `--download` baixa. */
  missingCoreModels: ModelAsset[];
}

/** A lista de modelos: core = por onde a esteira padrão passa sempre (o clip de ponta a ponta dispara o download sozinho). */
const MODEL_ROWS: Array<{ asset: ModelAsset; label: { pt: string; en: string }; core: boolean }> = [
  { asset: SENSEVOICE_MODEL, label: { pt: "Transcrição SenseVoice (edição padrão)", en: "SenseVoice transcription (default)" }, core: true },
  { asset: YUNET_MODEL, label: { pt: "Detecção de rosto YuNet (enquadramento vertical)", en: "YuNet face detection (vertical framing)" }, core: true },
  { asset: EMOTION_MODEL, label: { pt: "Reconhecimento de expressão FER+ (sinal de estouro)", en: "FER+ facial emotion (highlight signal)" }, core: true },
  { asset: TRANSNETV2_MODEL, label: { pt: "Detecção de corte de câmera TransNetV2 (encaixe do ponto de corte)", en: "TransNetV2 shot detection (cut snapping)" }, core: true },
  { asset: SILERO_VAD_MODEL, label: { pt: "Detecção de atividade de voz (ponto de corte seguro)", en: "Speech activity detection (safe cuts)" }, core: true },
  { asset: PARAFORMER_MODEL, label: { pt: "Transcrição Paraformer (edição mais precisa)", en: "Paraformer transcription (accurate)" }, core: false },
  { asset: FIRERED_MODEL, label: { pt: "Transcrição FireRedASR2 (edição mais precisa de todas)", en: "FireRedASR2 transcription (highest accuracy)" }, core: false },
  { asset: PUNCT_MODEL, label: { pt: "Recuperação de pontuação (as edições mais precisas precisam)", en: "Punctuation restoration" }, core: false },
  { asset: SEGMENTATION_MODEL, label: { pt: "Separação de falantes · divisão em trechos", en: "Speaker diarization segmentation" }, core: false },
  { asset: SPEAKER_EMBEDDING_MODEL, label: { pt: "Separação de falantes · impressão vocal", en: "Speaker diarization embeddings" }, core: false },
  { asset: DPDFNET_SPEECH_ENHANCEMENT_MODEL, label: { pt: "Realce inteligente de voz DPDFNet (48kHz)", en: "DPDFNet smart dialogue enhancement (48kHz)" }, core: false },
];

const MB = 1024 * 1024;
const fmtMB = (bytes: number): string => `${Math.max(1, Math.round(bytes / MB))}MB`;
const fmtGB = (bytes: number): string => `${(bytes / (1024 * MB)).toFixed(1)}GB`;

/** O tamanho total da pasta, recursivo; inexistente conta como 0. */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) {
      try {
        total += (await stat(p)).size;
      } catch {
        // Apagado no meio do caminho: ignora
      }
    }
  }
  return total;
}

/** Sondagem real da versão: roda `bin -version` e pega a primeira linha. */
async function probeVersionReal(bin: string): Promise<string> {
  const { stdout } = await execFileAsync(bin, ["-version"], { maxBuffer: 1024 * 1024 });
  return stdout;
}

/** Disponibilidade do ffmpeg/ffprobe: o caminho é resolvido e o -version roda. */
async function checkBinary(
  name: string,
  resolve: () => string,
  probe: (bin: string) => Promise<string>,
  pt: boolean
): Promise<DoctorCheck> {
  try {
    const bin = resolve();
    const stdout = await probe(bin);
    const firstLine = stdout.split("\n")[0]?.trim() ?? "";
    return { id: `binary:${name}`, name, status: "ok", detail: firstLine || "disponível" };
  } catch (e) {
    return {
      id: `binary:${name}`,
      name,
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
      fix: pt ? "reinstale o aplicativo para recuperar as ferramentas de mídia embutidas" : "Reinstall the app to restore its bundled media tools",
    };
  }
}

/** O estado de um modelo: instalado (tamanho real) / interrompido (o quanto falta retomar) / não instalado (o quanto será baixado sozinho). */
async function checkModel(
  modelsRoot: string,
  row: { asset: ModelAsset; label: { pt: string; en: string }; core: boolean },
  pt: boolean
): Promise<{ check: DoctorCheck; missing: boolean }> {
  const { asset, core } = row;
  const label = row.label[pt ? "pt" : "en"];
  if (await isModelInstalled(modelsRoot, asset)) {
    const size = await dirSize(modelDir(modelsRoot, asset));
    return { check: { id: `model:${asset.id}`, name: label, status: "ok", detail: pt ? `instalado (${fmtMB(size)})` : `Installed (${fmtMB(size)})` }, missing: false };
  }
  let partial = 0;
  try {
    partial = (await stat(join(modelsRoot, `${asset.id}.download.tar.bz2`))).size;
  } catch {
    // Não há arquivo interrompido
  }
  const resume = partial > 0 ? (pt ? `, com ${fmtMB(partial)} já baixados que serão retomados` : `; ${fmtMB(partial)} partial download will resume`) : "";
  if (core) {
    return {
      check: {
        id: `model:${asset.id}`,
        name: label,
        status: "warn",
        detail: pt ? `não instalado (cerca de ${fmtMB(asset.approxBytes)}${resume})` : `Not installed (about ${fmtMB(asset.approxBytes)}${resume})`,
        fix: pt ? "baixe agora, ou deixe o primeiro uso baixar sozinho" : "Prepare it now, or let first use download it automatically",
      },
      missing: true,
    };
  }
  return {
    check: { id: `model:${asset.id}`, name: label, status: "ok", detail: pt ? `não instalado (opcional; é baixado sozinho quando for usado, cerca de ${fmtMB(asset.approxBytes)}${resume})` : `Not installed (optional; downloads on first use, about ${fmtMB(asset.approxBytes)}${resume})` },
    missing: false,
  };
}

/** A configuração do LLM e a conexão com o endpoint: separa o sucesso, a rota de compatibilidade, a credencial e a falha de rede. */
async function checkLlm(llm: LlmConfig | null, pt: boolean): Promise<DoctorCheck> {
  if (!llm) {
    return {
      id: "llm",
      name: pt ? "Configuração do LLM" : "LLM configuration",
      status: "warn",
      detail: pt ? "não configurado (a transcrição não precisa; achar os estouros e exportar precisam)" : "Not configured (transcription works without it; highlights need it)",
      fix: pt ? "escolha um fornecedor e preencha o modelo nas configurações de modelo de IA; na CLI, defina HOTCLIP_LLM_BASE_URL e HOTCLIP_LLM_MODEL" : "Choose a provider and model in AI model settings; CLI users can set HOTCLIP_LLM_BASE_URL and HOTCLIP_LLM_MODEL",
    };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const response = await fetch(`${llm.baseUrl.replace(/\/$/, "")}/models`, {
        signal: ctrl.signal,
        headers: llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : undefined,
      });
      if (response.status === 401 || response.status === 403) {
        return {
          id: "llm",
          name: pt ? "Endpoint de LLM" : "LLM endpoint",
          status: "fail",
          detail: pt ? `o endpoint recusou a credencial (HTTP ${response.status})` : `Endpoint rejected credentials (HTTP ${response.status})`,
          fix: pt ? "atualize ou remova a API Key vencida nas configurações de modelo de IA" : "Update or remove the expired API key in AI model settings",
        };
      }
      if (!response.ok) {
        return {
          id: "llm",
          name: pt ? "Endpoint de LLM" : "LLM endpoint",
          status: "warn",
          detail: pt ? `o endpoint responde, mas a lista de modelos devolveu HTTP ${response.status}` : `Endpoint is reachable, but the model list returned HTTP ${response.status}`,
          fix: pt ? "confira se o endereço da API traz o prefixo compatível com a OpenAI correto" : "Check that the Base URL includes the correct OpenAI-compatible prefix",
        };
      }
    } finally {
      clearTimeout(timer);
    }
    return { id: "llm", name: pt ? "Endpoint de LLM" : "LLM endpoint", status: "ok", detail: pt ? `${llm.model} @ ${llm.baseUrl} responde` : `${llm.model} @ ${llm.baseUrl} is reachable` };
  } catch {
    return {
      id: "llm",
      name: pt ? "Endpoint de LLM" : "LLM endpoint",
      status: "warn",
      detail: pt ? `não foi possível alcançar ${llm.baseUrl}` : `Cannot reach ${llm.baseUrl}`,
      fix: pt ? "confirme que o serviço está no ar e que o endereço e a porta estão certos" : "Confirm the service is running and the address and port are correct",
    };
  }
}

/** Espaço livre em disco: o pacote completo de modelos tem ~1,5GB, mais a área de trabalho da exportação; abaixo de 3GB, avisa. */
async function checkDisk(modelsRoot: string, pt: boolean): Promise<DoctorCheck | null> {
  try {
    const s = await statfs(modelsRoot).catch(() => statfs(dirname(modelsRoot)));
    const free = s.bavail * s.bsize;
    if (free < 3 * 1024 * MB) {
      return {
        id: "disk",
        name: pt ? "Espaço em disco" : "Disk space",
        status: "warn",
        detail: pt ? `só ${fmtGB(free)} livres` : `Only ${fmtGB(free)} available`,
        fix: pt ? "libere espaço: os modelos principais ocupam cerca de 1,5GB, e a exportação ainda precisa de área de trabalho" : "Free disk space; core models need about 1.5GB plus export workspace",
      };
    }
    return { id: "disk", name: pt ? "Espaço em disco" : "Disk space", status: "ok", detail: pt ? `${fmtGB(free)} livres` : `${fmtGB(free)} available` };
  } catch {
    // statfs indisponível (Node antigo / sistema de arquivos incomum): pula em vez de dar um aviso falso
    return null;
  }
}

/** A ferramenta de importação por endereço é opcional: a ausência não gera aviso, mas um cache que não passa na verificação precisa ser dito com clareza. */
async function checkDownloader(toolsDir: string, pt: boolean): Promise<DoctorCheck> {
  const binary = join(toolsDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const checksumFile = `${binary}.sha256`;
  try {
    const [bytes, expected] = await Promise.all([readFile(binary), readFile(checksumFile, "utf8")]);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected.trim().toLowerCase()) {
      return {
        id: "downloader",
        name: pt ? "Baixador de vídeo da web" : "Network video downloader",
        status: "warn",
        detail: pt ? "o cache local não passou na verificação" : "Cached tool failed integrity verification",
        fix: pt ? "na próxima importação por endereço, o cache estragado é apagado e o arquivo é baixado e verificado de novo" : "The next URL import will remove the damaged cache, redownload it, and verify it",
      };
    }
    return { id: "downloader", name: pt ? "Baixador de vídeo da web" : "Network video downloader", status: "ok", detail: pt ? "instalado e verificado" : "Installed and verified" };
  } catch {
    return { id: "downloader", name: pt ? "Baixador de vídeo da web" : "Network video downloader", status: "ok", detail: pt ? "ainda não instalado (a primeira importação por endereço baixa e verifica sozinha)" : "Not installed yet (first URL import downloads and verifies it)" };
  }
}

/**
 * Roda todas as verificações. llm em null quer dizer «não configurado» (a CLI lê das variáveis
 * de ambiente e passa, o que deixa o teste unitário e o desktop ligarem cada um do seu jeito).
 */
export async function runDoctor(opts: {
  modelsRoot: string;
  cacheDir: string;
  /** Cache opcional e limitado da renderização base; o desktop passa para o tamanho e o controle ficarem visíveis. */
  renderCacheDir?: string;
  /** Índice opcional e limitado das evidências da análise do material. */
  evidenceCacheDir?: string;
  /** A pasta da ferramenta de importação por endereço do desktop; sem ela (na CLI) esta verificação opcional é pulada. */
  toolsDir?: string;
  llm: LlmConfig | null;
  /** Ponto de injeção para os testes: troca a resolução do caminho do ffmpeg/ffprobe — o teste unitário não depende dos binários da máquina que roda a CI. */
  resolveBinaries?: { ffmpeg: () => string; ffprobe: () => string };
  /**
   * Ponto de injeção para os testes: troca a sondagem `bin -version` — a máquina Windows da CI não
   * tem um caminho como /bin/echo para servir de binário falso, e com a injeção o teste unitário
   * não toca em processo real nenhum.
   */
  probeBinaryVersion?: (bin: string) => Promise<string>;
  /** Por padrão português; a interface em inglês do desktop passa false. */
  pt?: boolean;
}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const missingCoreModels: ModelAsset[] = [];

  const bins = opts.resolveBinaries ?? { ffmpeg: resolveFfmpegPath, ffprobe: resolveFfprobePath };
  const probe = opts.probeBinaryVersion ?? probeVersionReal;
  const pt = opts.pt !== false;
  checks.push(await checkBinary("ffmpeg", bins.ffmpeg, probe, pt));
  checks.push(await checkBinary("ffprobe", bins.ffprobe, probe, pt));
  if (opts.toolsDir) checks.push(await checkDownloader(opts.toolsDir, pt));

  for (const row of MODEL_ROWS) {
    const { check, missing } = await checkModel(opts.modelsRoot, row, pt);
    checks.push(check);
    if (missing) missingCoreModels.push(row.asset);
  }

  checks.push(await checkLlm(opts.llm, pt));

  const disk = await checkDisk(opts.modelsRoot, pt);
  if (disk) checks.push(disk);

  const cacheBytes = await dirSize(opts.cacheDir);
  checks.push({
    id: "cache",
    name: pt ? "Cache de transcrição" : "Transcript cache",
    status: "ok",
    detail: cacheBytes > 0 ? (pt ? `${fmtMB(cacheBytes)} (reabrir o mesmo arquivo entra na hora)` : `${fmtMB(cacheBytes)} (reopens the same file instantly)`) : (pt ? "vazio (vai se formando depois das transcrições)" : "Empty (builds automatically after transcription)"),
  });

  if (opts.renderCacheDir) {
    const renderCacheBytes = await dirSize(opts.renderCacheDir);
    checks.push({
      id: "render-cache",
      name: pt ? "Cache da renderização base" : "Render cache",
      status: "ok",
      detail: renderCacheBytes > 0
        ? (pt
            ? `${fmtMB(renderCacheBytes)} (a exportação repetida reaproveita direto; o limite automático é 1GB)`
            : `${fmtMB(renderCacheBytes)} (reused for repeat exports; automatically limited to 1GB)`)
        : (pt ? "vazio (vai se formando depois das exportações)" : "Empty (builds as clips are exported)"),
    });
  }

  if (opts.evidenceCacheDir) {
    const evidenceBytes = await dirSize(opts.evidenceCacheDir);
    checks.push({
      id: "evidence-index",
      name: pt ? "Índice de evidências multimodais" : "Multimodal evidence index",
      status: "ok",
      detail: evidenceBytes > 0
        ? (pt
            ? `${fmtMB(evidenceBytes)} (as evidências de movimento/corte/imagem são reaproveitadas entre tarefas; o limite automático é 64MB)`
            : `${fmtMB(evidenceBytes)} (motion/shot/vision evidence reused across jobs; automatically limited to 64MB)`)
        : (pt ? "vazio (vai se formando conforme o material é analisado)" : "Empty (builds as sources are analyzed)"),
    });
  }

  return { checks, missingCoreModels };
}
