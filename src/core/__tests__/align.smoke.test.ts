/**
 * Fumaça do ponto de corte preciso com os modelos de verdade (guardado por variável de ambiente, a CI não roda):
 *   HOTCLIP_ALIGN_SMOKE=1 pnpm vitest run src/core/__tests__/align.smoke.test.ts
 * O caminho: o say do macOS sintetiza a fala → o SenseVoice (já instalado na máquina) transcreve e dá o
 * vocabulário → todo o vocabulário é deslocado +0,6s de propósito, simulando um «alinhamento ruim» →
 * createClipAligner faz a segunda passada → e a asserção é que o vocabulário voltou para perto do lugar.
 * A primeira execução baixa o modelo Paraformer (~240MB) para a pasta de modelos do aplicativo (a mesma
 * do desktop, então o download não se perde).
 *
 * A fala sintetizada é em mandarim, escrita como escapes Unicode: o SenseVoice e o Paraformer são modelos
 * de mandarim (o Paraformer é a única edição com marca de tempo), e é esse par que este teste exercita.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";

const RUN = process.env.HOTCLIP_ALIGN_SMOKE === "1" && process.platform === "darwin";

describe.runIf(RUN)("fumaça do align com os modelos de verdade", () => {
  it("o vocabulário deslocado é trazido de volta ao lugar pela segunda passada do Paraformer", { timeout: 15 * 60_000 }, async () => {
    const { SenseVoiceEngine } = await import("../transcribe/sensevoice");
    const { createClipAligner } = await import("../align");
    const modelsRoot = join(homedir(), "Library/Application Support/hotclip/models");

    // 1) Sintetiza ~15s de fala (com uma pausa, para o vocabulário sair em vários trechos)
    const wav = join(tmpdir(), "hotclip-align-smoke.wav");
    execFileSync("say", [
      "-v", "Tingting", "-o", wav, "--data-format=LEI16@16000",
      "\u4eca\u5929\u7ed9\u5927\u5bb6\u63a8\u8350\u4e00\u6b3e\u4ea7\u54c1,\u539f\u4ef7\u4e00\u767e\u4e5d\u5341\u4e5d,\u4eca\u5929\u76f4\u64ad\u95f4\u53ea\u8981\u4e5d\u5341\u4e5d\u3002\u7528\u8fc7\u7684\u90fd\u8bf4\u597d,\u5e93\u5b58\u53ea\u5269\u6700\u540e\u4e24\u767e\u4ef6,\u559c\u6b22\u7684\u6293\u7d27\u4e0b\u5355\u3002",
    ]);

    // 2) O SenseVoice transcreve e dá o vocabulário (já instalado na máquina, sem disparar download)
    const sv = new SenseVoiceEngine(modelsRoot);
    const transcript = await sv.transcribe(wav);
    const words = transcript.segments.flatMap((s) => s.words);
    expect(words.length).toBeGreaterThan(10);
    const origFirstStart = words[0].startSec;

    // 3) Todo o vocabulário é deslocado +0,6s, simulando um vocabulário fora de hora
    const shifted = words.map((w) => ({ ...w, startSec: w.startSec + 0.6, endSec: w.endSec + 0.6 }));

    // 4) A segunda passada de alinhamento (na primeira vez, baixa o Paraformer, ~240MB)
    const align = createClipAligner(modelsRoot);
    const refined = await align(wav, {
      startSec: 0,
      endSec: transcript.durationSec,
      words: shifted,
    });

    expect(refined).not.toBeNull();
    // Depois do alinhamento a primeira palavra volta ao lugar com ±0,3s (a marca de tempo CIF do
    // Paraformer deve bater aproximadamente com o tempo original do SenseVoice, e ficar claramente
    // diferente da versão deslocada em +0,6s)
    expect(Math.abs(refined!.words[0].startSec - origFirstStart)).toBeLessThan(0.3);
    expect(Math.abs(refined!.words[0].startSec - shifted[0].startSec)).toBeGreaterThan(0.25);
    expect(refined!.report.matchedFrac).toBeGreaterThanOrEqual(0.5);
    // Monótono, sem andar para trás
    for (let i = 1; i < refined!.words.length; i++) {
      expect(refined!.words[i].startSec).toBeGreaterThanOrEqual(refined!.words[i - 1].endSec - 1e-3);
    }
    rmSync(wav, { force: true });
  });
});

describe.runIf(!RUN)("fumaça do align com os modelos de verdade (pulada)", () => {
  it("só roda com HOTCLIP_ALIGN_SMOKE=1 e no macOS", () => {
    expect(true).toBe(true);
  });
});
