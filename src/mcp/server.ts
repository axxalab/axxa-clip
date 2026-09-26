/**
 * Entrada do servidor MCP do HotClip (stdio):
 *   npx tsx src/mcp/server.ts
 * Registrado no Claude Code / Claude Desktop, o agente chama a esteira de corte local direto
 * (transcrição / busca dos estouros / saída, tudo na máquina, e o material não sai do computador).
 * A lógica do protocolo está em protocol.ts, e a esteira é a mesma core/pipeline.ts do desktop e do vigia de gravações.
 *
 * O LLM é configurado por variáveis de ambiente: HOTCLIP_LLM_BASE_URL / HOTCLIP_LLM_MODEL /
 * HOTCLIP_LLM_API_KEY (num endpoint local do Ollama a chave pode ficar de fora).
 * A pasta de modelos e o cache de transcrição são compartilhados com o app de desktop (baixa uma vez, serve para os dois).
 */
import { createInterface } from "readline";
import { join, basename } from "path";
import { transcribeCached, detectForPipeline, autoClip, analyzeReferenceVideo } from "../core/pipeline";
import type { ReferenceProfile } from "../core/reference";
import { loadGlossary } from "../core/glossary-store";
import { userDataDir, modelsRoot, cacheDir, renderCacheDir, evidenceCacheDir, llmFromEnv } from "../core/appenv";
import { loadReviewMemory } from "../core/review-memory";
import { loadPerformanceMemory } from "../core/performance-memory";
import { handleMcpMessage, type JsonRpcMessage } from "./protocol";

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

function clampClips(n: unknown): number | undefined {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(1, Math.min(12, Math.round(v))) : undefined;
}

/**
 * Perfil de referência (a mesma semântica do --reference da CLI): é uma entrada dada
 * explicitamente pelo usuário, então a falha da análise precisa ser dita no recibo e o
 * trabalho segue como se não houvesse referência — nada é descartado em silêncio.
 * O note é colado direto no começo do recibo da ferramenta.
 */
async function loadReference(refPath: unknown): Promise<{ profile?: ReferenceProfile; note: string }> {
  if (typeof refPath !== "string" || !refPath.trim()) return { note: "" };
  try {
    const p = await analyzeReferenceVideo(refPath, {
      modelsRoot: modelsRoot(),
      cacheDir: cacheDir(),
      evidenceCacheDir: evidenceCacheDir(),
      glossary: await loadGlossary(userDataDir()),
    });
    const cuts = p.cutsPerMin !== null ? ` · ${p.cutsPerMin} cortes/min` : "";
    const unit = p.charUnits ? "caracteres" : "palavras";
    return {
      profile: p,
      note: `Perfil de referência: duração ${Math.round(p.durationSec)}s · fala a ${p.speechRate} ${unit}/s · frases de ${p.avgSentenceLen} ${unit}${cuts} · gancho «${p.hookLine.slice(0, 20)}»\n`,
    };
  } catch (e) {
    return { note: `⚠ a análise do vídeo de referência falhou; seguindo sem referência: ${e instanceof Error ? e.message : String(e)}\n` };
  }
}

/** A implementação das ferramentas: o texto que volta para o agente. */
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const videoPath = String(args.videoPath);

  if (name === "transcribe_video") {
    const t = await transcribeCached(videoPath, modelsRoot(), cacheDir(), await loadGlossary(userDataDir()), undefined, typeof args.subtitlePath === "string" ? args.subtitlePath : undefined, { engineId: typeof args.engineId === "string" ? args.engineId : undefined, localServiceUrl: typeof args.localServiceUrl === "string" ? args.localServiceUrl : undefined, restart: args.restart === true });
    const lines = t.segments.map((s) => `[${fmtClock(s.startSec)}] ${s.text}`).join("\n");
    const capped = lines.length > 60_000 ? `${lines.slice(0, 60_000)}\n…(cortado)` : lines;
    return `Origem: ${t.engine} · idioma: ${t.language} · duração: ${fmtClock(t.durationSec)} · ${t.segments.length} frases\n${args.subtitlePath ? "Legenda importada; o tempo das palavras dentro da frase é estimado e precisa de revisão.\n" : ""}${capped}`;
  }

  if (name === "detect_highlights") {
    const llm = llmFromEnv();
    const ref = await loadReference(args.referencePath);
    const transcript = await transcribeCached(videoPath, modelsRoot(), cacheDir(), await loadGlossary(userDataDir()), undefined, typeof args.subtitlePath === "string" ? args.subtitlePath : undefined, { engineId: typeof args.engineId === "string" ? args.engineId : undefined, localServiceUrl: typeof args.localServiceUrl === "string" ? args.localServiceUrl : undefined, restart: args.restart === true });
    const candidates = await detectForPipeline(videoPath, transcript, {
      modelsRoot: modelsRoot(),
      evidenceCacheDir: evidenceCacheDir(),
      llm,
      maxClips: clampClips(args.maxClips),
      reference: ref.profile,
      // As preferências desta máquina, acumuladas na mesa de revisão do desktop, valem também para a detecção via MCP (somente leitura)
      reviewMemory: await loadReviewMemory(userDataDir()),
      performanceMemory: await loadPerformanceMemory(userDataDir()),
    });
    if (candidates.length === 0) return `${ref.note}Nenhum candidato de estouro que valha cortar foi encontrado.`;
    return ref.note + JSON.stringify(
      candidates.map((c) => ({
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
      })),
      null,
      2
    );
  }

  if (name === "clip_video") {
    const llm = llmFromEnv();
    const ref = await loadReference(args.referencePath);
    const outcome = await autoClip(videoPath, {
      modelsRoot: modelsRoot(),
      cacheDir: cacheDir(),
      renderCacheDir: renderCacheDir(),
      evidenceCacheDir: evidenceCacheDir(),
      llm,
      maxClips: clampClips(args.maxClips),
      vertical: args.vertical !== false,
      captions: args.captions !== false,
      autoEnhance: args.autoEnhance === true,
      denoiseMode: args.denoiseMode === "smart" ? "smart" : args.denoiseMode === "basic" ? "basic" : undefined,
      subtitlePath: typeof args.subtitlePath === "string" ? args.subtitlePath : undefined,
      asr: { engineId: typeof args.engineId === "string" ? args.engineId : undefined, localServiceUrl: typeof args.localServiceUrl === "string" ? args.localServiceUrl : undefined, restart: args.restart === true },
      outDir: typeof args.outDir === "string" && args.outDir.trim() ? args.outDir : undefined,
      fontsDir: join(process.cwd(), "resources", "fonts"),
      glossary: await loadGlossary(userDataDir()),
      reference: ref.profile,
      reviewMemory: await loadReviewMemory(userDataDir()),
      performanceMemory: await loadPerformanceMemory(userDataDir()),
    });
    if (outcome.exported.length === 0) {
      return `${ref.note}Depois da revisão da IA não sobrou trecho recomendado para publicar (todos os candidatos foram julgados de gancho fraco). Use detect_highlights para ver todos os candidatos e o parecer da revisão.`;
    }
    const list = outcome.exported
      .map((r) => {
        const c = outcome.candidates.find((x) => x.id === r.id);
        // O aviso da verificação de qualidade volta junto com o item para o agente — ele só precisa revisar o que foi avisado, sem reassistir a tudo
        const qaNote = r.qa && r.qa.status === "warn" ? `\n  ⚠ verificação: ${r.qa.issues.join("; ")}` : "";
        // Se o laço de reparo fez algo, isso tem de ser dito (aparar a borda / renormalizar o volume: o que a máquina mudou precisa estar visível)
        const fixNote = r.qa?.repair?.applied ? `\n  🔧 corrigido sozinho: ${r.qa.repair.actions.join(", ")}` : "";
        const colorNote = r.colorConverted
          ? " · HDR→SDR"
          : r.colorConversionSkipped
            ? " · o caminho de cor HDR não é suportado, sem conversão"
            : r.colorInspectionFailed
              ? " · a checagem da informação de cor falhou"
              : "";
        const audioNote = r.audioEnhancement ? ` · áudio: ${r.audioEnhancement}` : "";
        return `- ${basename(r.path)} (${Math.round(r.durationSec)}s, nota ${c?.score ?? "?"}${colorNote}${audioNote}) ${c?.title ?? ""}${qaNote}${fixNote}`;
      })
      .join("\n");
    const warned = outcome.exported.filter((r) => r.qa?.status === "warn").length;
    const qaLine =
      warned > 0
        ? `Verificação de qualidade: ${warned} com aviso (veja os itens e o campo qa do clips.json)`
        : "Verificação de qualidade: tudo passou (tela preta / silêncio longo / volume / duração / ponto de corte / palavras de risco)";
    return `${ref.note}${outcome.exported.length} trecho(s) exportado(s) para ${outcome.outDir}\n${list}\n${qaLine}\nVão junto o clips.json (título / nota / marca de tempo / recibo / verificação) e a capa JPG de cada trecho.`;
  }

  throw new Error(`ferramenta não implementada: ${name}`);
}

// ---- Laço principal do stdio: uma linha por mensagem JSON-RPC ----
export function startServer(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const version = (require("../../package.json") as { version: string }).version;
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(text) as JsonRpcMessage;
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`);
      return;
    }
    void handleMcpMessage(msg, executeTool, version).then((res) => {
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    });
  });
  process.stderr.write("hotclip mcp server ready (stdio)\n");
}

startServer();
