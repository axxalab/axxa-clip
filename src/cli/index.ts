import { localSpeechUrl } from "../core/transcribe/qwen-local";
/**
 * CLI sem interface do HotClip — sem abrir o desktop, o terminal ou um agente de código
 * dirige a esteira de corte local (a mesma core/pipeline do desktop / do MCP / do vigia de
 * gravações, com resultado idêntico):
 *
 *   pnpm cli transcribe <vídeo>                     transcrição local palavra por palavra (com cache)
 *   pnpm cli highlights <vídeo> [--max-clips N]      a IA acha os estouros (candidatos em JSON)
 *   pnpm cli clip <vídeo> [opções]                   de ponta a ponta: transcrição → estouros → saída + verificação
 *
 * O LLM é configurado por variáveis de ambiente (as mesmas do servidor MCP): HOTCLIP_LLM_BASE_URL /
 * HOTCLIP_LLM_MODEL / HOTCLIP_LLM_API_KEY (num Ollama local a chave não é necessária).
 * A pasta de modelos e o cache de transcrição são compartilhados com o app de desktop — baixa uma vez, serve para os três.
 */
import { join, basename } from "path";
import { transcribeCached, detectForPipeline, autoClip, analyzeReferenceVideo } from "../core/pipeline";
import type { ReferenceProfile } from "../core/reference";
import { loadGlossary } from "../core/glossary-store";
import { describeSubtitleImportError } from "../shared/subtitle-import";
import { userDataDir, modelsRoot, cacheDir, renderCacheDir, evidenceCacheDir, llmFromEnv } from "../core/appenv";
import { runDoctor } from "../core/doctor";
import { ensureModel } from "../core/models";
import { loadReviewMemory } from "../core/review-memory";
import { importPerformanceFile, loadPerformanceMemory, performanceReport } from "../core/performance-memory";

const USAGE = `HotClip CLI — corte com IA local, e o material não sai do computador

Uso:
  pnpm cli transcribe <caminho do vídeo>
      transcrição local palavra por palavra (por padrão SenseVoice, continuando sozinha os trechos já reconhecidos)
      --engine sensevoice|paraformer|fireredasr|parakeet|whisper-turbo|whisper-large-v3|qwen3
      --asr-url http://127.0.0.1:8766   serviço local opcional do Qwen3
      --restart-transcription          descarta o progresso por trecho do motor atual e refaz
      transcribe / highlights / clip aceitam --subtitles <original.srt|original.vtt>
      para importar uma legenda UTF-8 já existente e pular o ASR; o tempo das palavras é estimado e precisa de revisão

  pnpm cli highlights <caminho do vídeo> [--max-clips N] [--reference vídeo de referência] [--json]
      a IA lê o texto inteiro em busca dos estouros e devolve a lista de candidatos (nota / gancho / ponto de corte, para revisar antes de cortar)
      --reference: jogue aqui um corte que viralizou e sirva de referência; o ritmo dele é medido (duração / velocidade da fala / cortes / gancho)
      e vira um perfil, com a escolha dos trechos se aproximando desse ritmo (é preferência, não regra rígida)

  pnpm cli clip <caminho do vídeo> [--max-clips N] [--reference vídeo de referência] [--no-vertical] [--no-captions] [--auto-enhance] [--denoise|--smart-denoise] [--out pasta] [--json]
      tudo de uma vez: transcrição → estouros → saída (vertical / legenda / corte seco / volume vêm ligados por padrão)
      + verificação de qualidade da saída (tela preta / silêncio longo / volume / duração / ponto de corte / palavras de risco nas plataformas), com o relatório no clips.json
      + correção automática do que dá para consertar (aparar o silêncio e a tela preta das pontas / renormalizar o volume, com o registro em qa.repair)
      --auto-enhance: mede a imagem aproveitada na própria máquina e só corrige, com contenção, o que está claramente escuro / acinzentado / saturado demais (desligado por padrão)
      --denoise: redução de ruído por filtro fixo; --smart-denoise: modelo local de 48kHz realçando a voz, com volta ao filtro básico na falha

  pnpm cli doctor [--download]
      diagnóstico da máquina: ffmpeg / estado da instalação dos modelos / endpoint de LLM / disco / cache, com sugestões de conserto
      --download: baixa agora os modelos que a esteira padrão usa (com retomada: se a rede cair, a próxima execução continua de onde parou)

  pnpm cli feedback <CSV ou JSON exportado da plataforma>
      importa os números reais de exibição / curtida / comentário / compartilhamento / salvamento, e a máquina aprende localmente o que rende e o que não rende
      aceita nomes de campo em português e em inglês, além de números como 12 mil / 7,8k; reimportar o mesmo vídeo na mesma plataforma atualiza o registro

  pnpm cli feedback-report [--json]
      mostra os exemplos de alto e de baixo desempenho que o HotClip já aprendeu; daí em diante o desktop / a CLI / o MCP / o vigia usam isso ao buscar estouros

Variáveis de ambiente (highlights / clip precisam delas):
  HOTCLIP_LLM_BASE_URL   endpoint compatível com a OpenAI (Ollama local: http://localhost:11434/v1)
  HOTCLIP_LLM_MODEL      nome do modelo (por exemplo qwen3:8b)
  HOTCLIP_LLM_API_KEY    a chave da API na nuvem (num Ollama local pode ficar de fora)`;

/** Leitura mínima dos parâmetros: chaves booleanas + opções com valor, e o primeiro parâmetro que não é opção é o caminho do vídeo. */
export interface CliArgs {
  command: string;
  videoPath: string;
  maxClips?: number;
  vertical: boolean;
  captions: boolean;
  autoEnhance: boolean;
  denoiseMode?: "basic" | "smart";
  outDir?: string;
  /** O caminho do vídeo de referência que viralizou (o perfil de referência guia a escolha dos trechos). */
  referencePath?: string;
  subtitlePath?: string;
  engineId?: string;
  localServiceUrl?: string;
  restart?: boolean;
  json: boolean;
  /** Só para o doctor: baixa agora os modelos da esteira padrão que estão faltando. */
  download: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    throw new Error(USAGE);
  }
  const args: CliArgs = { command, videoPath: "", vertical: true, captions: true, autoEnhance: false, json: false, download: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--no-vertical") args.vertical = false;
    else if (a === "--no-captions") args.captions = false;
    else if (a === "--auto-enhance") args.autoEnhance = true;
    else if (a === "--denoise") args.denoiseMode = "basic";
    else if (a === "--smart-denoise") args.denoiseMode = "smart";
    else if (a === "--json") args.json = true;
    else if (a === "--download") args.download = true;
    else if (a === "--restart-transcription") args.restart = true;
    else if (a === "--engine") {
      const value = rest[++i];
      if (!["sensevoice", "paraformer", "fireredasr", "parakeet", "whisper-turbo", "whisper-large-v3", "qwen3"].includes(value)) throw new Error("--engine: sensevoice | paraformer | fireredasr | parakeet | whisper-turbo | whisper-large-v3 | qwen3");
      args.engineId = value;
    } else if (a === "--asr-url") {
      const value = rest[++i];
      if (!value) throw new Error("--asr-url requires a loopback URL");
      args.localServiceUrl = localSpeechUrl(value);
    }
    else if (a === "--max-clips") {
      const v = Number(rest[++i]);
      if (!Number.isFinite(v)) throw new Error("--max-clips precisa de um número");
      args.maxClips = Math.max(1, Math.min(12, Math.round(v)));
    } else if (a === "--out") {
      const v = rest[++i];
      if (!v) throw new Error("--out precisa do caminho de uma pasta");
      args.outDir = v;
    } else if (a === "--reference") {
      const v = rest[++i];
      if (!v) throw new Error("--reference precisa do caminho de um vídeo de referência");
      args.referencePath = v;
    } else if (a === "--subtitles") {
      const v = rest[++i];
      if (!v?.trim() || v.startsWith("--")) throw new Error("--subtitles precisa do caminho de um arquivo SRT ou WebVTT");
      args.subtitlePath = v;
    } else if (a.startsWith("--")) {
      throw new Error(`opção desconhecida: ${a}\n\n${USAGE}`);
    } else if (!args.videoPath) {
      args.videoPath = a;
    }
  }
  // doctor/feedback-report não recebem caminho; no feedback, o parâmetro de posição é o caminho do arquivo de números
  if (!args.videoPath && !["doctor", "feedback-report"].includes(args.command)) throw new Error(`falta o caminho do vídeo ou do arquivo de dados\n\n${USAGE}`);
  if (args.subtitlePath && !["transcribe", "highlights", "clip"].includes(args.command)) throw new Error("--subtitles serve só para transcribe / highlights / clip");
  return args;
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

async function main(signal?: AbortSignal): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.command === "doctor") {
    // LLM sem configuração não é erro (transcribe não usa), então aparece como «não configurado»
    let llm = null;
    try {
      llm = llmFromEnv();
    } catch {
      // segue null
    }
    const report = await runDoctor({ modelsRoot: modelsRoot(), cacheDir: cacheDir(), renderCacheDir: renderCacheDir(), evidenceCacheDir: evidenceCacheDir(), llm });
    const icon = { ok: "✅", warn: "⚠️", fail: "❌" } as const;
    for (const c of report.checks) {
      process.stdout.write(`${icon[c.status]} ${c.name}:${c.detail}\n`);
      if (c.fix) process.stdout.write(`   ↳ ${c.fix}\n`);
    }
    if (args.download && report.missingCoreModels.length > 0) {
      const mb = (n: number): number => Math.round(n / (1024 * 1024));
      for (const asset of report.missingCoreModels) {
        await ensureModel(modelsRoot(), asset, (p) => {
          const pct = Math.min(100, Math.round((p.downloadedBytes / p.totalBytes) * 100));
          const verb = p.phase === "extract" ? "descompactando" : "baixando";
          process.stderr.write(`\r${verb} ${asset.id}:${pct}%(${mb(p.downloadedBytes)}/${mb(p.totalBytes)}MB)   `);
        });
        process.stderr.write(`\r✅ ${asset.id} pronto${" ".repeat(24)}\n`);
      }
      process.stdout.write("Todos os modelos da esteira padrão estão prontos.\n");
    } else if (report.missingCoreModels.length > 0) {
      process.stdout.write(`${report.missingCoreModels.length} modelo(s) da esteira padrão não está(ão) instalado(s); use --download para baixar agora.\n`);
    }
    if (report.checks.some((c) => c.status === "fail")) process.exitCode = 1;
    return;
  }

  if (args.command === "feedback") {
    const result = await importPerformanceFile(userDataDir(), args.videoPath);
    process.stdout.write(`${result.imported} registro(s) de desempenho importado(s), ${result.skipped} registro(s) inválido(s) pulado(s); ${result.total} no total aprendidos localmente.\n`);
    process.stdout.write(`${performanceReport(result.entries)}\n`);
    return;
  }

  if (args.command === "feedback-report") {
    const entries = await loadPerformanceMemory(userDataDir());
    process.stdout.write(args.json ? `${JSON.stringify(entries, null, 2)}\n` : `${performanceReport(entries)}\n`);
    return;
  }

  const glossary = await loadGlossary(userDataDir());

  // Perfil de referência: é entrada dada explicitamente pelo usuário, então a falha da análise precisa ser dita e o trabalho segue sem referência (nada é descartado em silêncio)
  const loadReference = async (): Promise<ReferenceProfile | undefined> => {
    if (!args.referencePath) return undefined;
    process.stderr.write("Analisando o ritmo do vídeo de referência…\n");
    try {
      const p = await analyzeReferenceVideo(args.referencePath, {
        modelsRoot: modelsRoot(),
        cacheDir: cacheDir(),
        evidenceCacheDir: evidenceCacheDir(),
        glossary,
        signal,
      });
      const cuts = p.cutsPerMin !== null ? ` · ${p.cutsPerMin} cortes/min` : "";
      const unit = p.charUnits ? "caracteres" : "palavras";
      process.stderr.write(
        `Perfil de referência: duração ${Math.round(p.durationSec)}s · fala a ${p.speechRate} ${unit}/s · frases de ${p.avgSentenceLen} ${unit}${cuts} · gancho «${p.hookLine.slice(0, 20)}»\n`
      );
      return p;
    } catch (e) {
      process.stderr.write(`⚠ a análise do vídeo de referência falhou; seguindo sem referência: ${e instanceof Error ? e.message : String(e)}\n`);
      return undefined;
    }
  };

  if (args.command === "transcribe") {
    const t = await transcribeCached(args.videoPath, modelsRoot(), cacheDir(), glossary, signal, args.subtitlePath, { engineId: args.engineId, localServiceUrl: args.localServiceUrl, restart: args.restart });
    if (args.json) process.stdout.write(`${JSON.stringify(t, null, 2)}\n`);
    else for (const s of t.segments) process.stdout.write(`[${fmtClock(s.startSec)}] ${s.text}\n`);
    if (args.subtitlePath) process.stderr.write("Legenda importada; o tempo das palavras dentro da frase é estimado, então revise o tempo da legenda e os pontos de corte automáticos.\n");
    process.stderr.write(`Idioma: ${t.language} · duração: ${fmtClock(t.durationSec)} · ${t.segments.length} frases\n`);
    return;
  }

  if (args.command === "highlights") {
    const llm = llmFromEnv();
    const reference = await loadReference();
    process.stderr.write(args.subtitlePath ? "Importando a legenda (o tempo das palavras é estimado)…\n" : "Transcrevendo (com cache)…\n");
    const transcript = await transcribeCached(args.videoPath, modelsRoot(), cacheDir(), glossary, signal, args.subtitlePath, { engineId: args.engineId, localServiceUrl: args.localServiceUrl, restart: args.restart });
    process.stderr.write("A IA está procurando os estouros…\n");
    const candidates = await detectForPipeline(args.videoPath, transcript, {
      modelsRoot: modelsRoot(),
      evidenceCacheDir: evidenceCacheDir(),
      llm,
      maxClips: args.maxClips,
      reference,
      // As preferências desta máquina, acumuladas na mesa de revisão do desktop, valem também para a detecção pela CLI (somente leitura)
      reviewMemory: await loadReviewMemory(userDataDir()),
      performanceMemory: await loadPerformanceMemory(userDataDir()),
      signal,
    });
    if (candidates.length === 0) {
      process.stderr.write("Nenhum candidato de estouro que valha cortar foi encontrado.\n");
      return;
    }
    const rows = candidates.map((c) => ({
      id: c.id,
      start: fmtClock(c.startSec),
      end: fmtClock(c.endSec),
      startSec: c.startSec,
      endSec: c.endSec,
      title: c.title,
      hook: c.hook,
      score: c.score,
      reason: c.reason,
      recommended: c.recommended,
      reviewNote: c.reviewNote || undefined,
      visualEvidence: c.visualEvidence,
    }));
    if (args.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    } else {
      for (const r of rows) {
        const mark = r.recommended ? "✅" : "⚠️ não vale publicar";
        process.stdout.write(`#${r.id} [${r.start}-${r.end}] nota ${r.score} ${mark}\n  ${r.title}\n  Gancho: ${r.hook}\n`);
      }
    }
    return;
  }

  if (args.command === "clip") {
    const llm = llmFromEnv();
    const reference = await loadReference();
    const outcome = await autoClip(args.videoPath, {
      modelsRoot: modelsRoot(),
      cacheDir: cacheDir(),
      renderCacheDir: renderCacheDir(),
      evidenceCacheDir: evidenceCacheDir(),
      llm,
      maxClips: args.maxClips,
      vertical: args.vertical,
      captions: args.captions,
      autoEnhance: args.autoEnhance,
      denoiseMode: args.denoiseMode,
      subtitlePath: args.subtitlePath,
      asr: { engineId: args.engineId, localServiceUrl: args.localServiceUrl, restart: args.restart },
      signal,
      outDir: args.outDir,
      reference,
      reviewMemory: await loadReviewMemory(userDataDir()),
      performanceMemory: await loadPerformanceMemory(userDataDir()),
      fontsDir: join(__dirname, "..", "..", "resources", "fonts"),
      glossary,
      onStage: (stage) => {
        const label = { transcribing: args.subtitlePath ? "Importando a legenda (o tempo das palavras é estimado)…" : "Transcrevendo (com cache)…", detecting: "A IA está procurando os estouros…", exporting: "Exportando os cortes…" }[stage];
        process.stderr.write(`${label}\n`);
      },
    });
    if (outcome.exported.length === 0) {
      process.stderr.write("Depois da revisão da IA não sobrou trecho recomendado para publicar (todos os candidatos foram julgados de gancho fraco). Use o comando highlights para ver todos os candidatos e o parecer da revisão.\n");
      return;
    }
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            outDir: outcome.outDir,
            clips: outcome.exported.map((r) => ({
              file: basename(r.path),
              path: r.path,
              durationSec: Math.round(r.durationSec * 1000) / 1000,
              colorConverted: Boolean(r.colorConverted),
              colorConversionSkipped: Boolean(r.colorConversionSkipped),
              colorInspectionFailed: Boolean(r.colorInspectionFailed),
              audioEnhancement: r.audioEnhancement ?? null,
              qa: r.qa ?? null,
            })),
          },
          null,
          2
        )}\n`
      );
      return;
    }
    process.stdout.write(`${outcome.exported.length} trecho(s) exportado(s) para ${outcome.outDir}\n`);
    for (const r of outcome.exported) {
      const c = outcome.candidates.find((x) => x.id === r.id);
      const colorNote = r.colorConverted
        ? " · HDR→SDR"
        : r.colorConversionSkipped
          ? " · o caminho de cor HDR não é suportado, sem conversão"
          : r.colorInspectionFailed
            ? " · a checagem da informação de cor falhou"
            : "";
      const audioNote = r.audioEnhancement ? ` · áudio: ${r.audioEnhancement}` : "";
      process.stdout.write(`- ${basename(r.path)} (${Math.round(r.durationSec)}s, nota ${c?.score ?? "?"}${colorNote}${audioNote}) ${c?.title ?? ""}\n`);
      if (r.qa && r.qa.status === "warn") {
        process.stdout.write(`  ⚠ verificação: ${r.qa.issues.join("; ")}\n`);
      }
      if (r.qa?.repair?.applied) {
        process.stdout.write(`  🔧 corrigido sozinho: ${r.qa.repair.actions.join(", ")}\n`);
      }
    }
    const warned = outcome.exported.filter((r) => r.qa?.status === "warn").length;
    process.stdout.write(
      warned > 0
        ? `Verificação de qualidade: ${warned} com aviso (veja o campo qa do clips.json)\n`
        : "Verificação de qualidade: tudo passou (tela preta / silêncio longo / volume / duração / ponto de corte / palavras de risco)\n"
    );
    process.stdout.write("Vão junto o clips.json (título / nota / marca de tempo / recibo / verificação) e a capa JPG de cada trecho.\n");
    return;
  }

  throw new Error(`comando desconhecido: ${args.command}\n\n${USAGE}`);
}

// O fluxo principal só roda quando este arquivo é o ponto de entrada (o teste unitário só importa parseCliArgs)
if (require.main === module) {
  const abort = new AbortController();
  const cancel = (): void => abort.abort();
  const speechCommand = ["transcribe", "highlights", "clip"].includes(process.argv[2]);
  if (speechCommand) { process.once("SIGINT", cancel); process.once("SIGTERM", cancel); }
  main(abort.signal).catch((e) => {
    process.stderr.write(abort.signal.aborted ? "Stopped. Completed local transcription windows can resume on the next run.\n" : `${describeSubtitleImportError(e)}\n`);
    process.exitCode = abort.signal.aborted ? 130 : 1;
  }).finally(() => { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); });
}
