/**
 * A cadeia de entrada de áudio do ASR (a refatoração da issue #4): o ffmpeg entrega raw f32le e o Node lê num
 * Float32Array.
 * Depois de trocar o readWave do sherpa (cuja camada nativa não abre um caminho temporário com acento no
 * Windows), a ordem dos bytes, o alinhamento e o truncamento das amostras ficaram todos na nossa mão — e aqui
 * o ffmpeg de verdade prega a correção byte a byte, de ponta a ponta.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveFfmpegPath } from "../binaries";
import { extractPcmF32le16k, readF32leSamples } from "../models";

const execFileAsync = promisify(execFile);

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "hotclip-pcm-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("readF32leSamples", () => {
  it("lê em float32 little-endian, e o resto de menos de 4 bytes no fim é descartado", async () => {
    const path = join(base, "samples.f32le");
    const f32 = Float32Array.from([0, 0.5, -0.5, 1]);
    // 3 bytes a mais no fim simulam uma escrita truncada
    await writeFile(path, Buffer.concat([Buffer.from(f32.buffer), Buffer.from([1, 2, 3])]));

    const samples = await readF32leSamples(path);
    expect(Array.from(samples)).toEqual([0, 0.5, -0.5, 1]);
  });

  it("arquivo vazio dá zero amostras", async () => {
    const path = join(base, "empty.f32le");
    await writeFile(path, Buffer.alloc(0));
    expect((await readF32leSamples(path)).length).toBe(0);
  });
});

describe("extractPcmF32le16k", () => {
  it("ffmpeg de verdade, de ponta a ponta: 1 segundo de senoide a 440Hz → 16000 amostras, com a faixa de amplitude correta", async () => {
    const ffmpeg = resolveFfmpegPath();
    const src = join(base, "tone.wav");
    await execFileAsync(ffmpeg, [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=44100",
      src,
    ]);

    const out = join(base, "tone.f32le");
    await extractPcmF32le16k(ffmpeg, src, out);
    const samples = await readF32leSamples(out);

    // A borda da reamostragem admite um desvio mínimo, mas tem de ficar perto de 1 segundo a 16k
    expect(Math.abs(samples.length - 16000)).toBeLessThan(64);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    // A fonte sine do lavfi tem amplitude fixa de 1/8≈0,125: o pico tem de ficar perto disso — abaixo indica amostra fora de lugar, e acima indica amplitude estourada
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(0.15);
  });

  it("num material de várias trilhas, a trilha escolhida pelo HotClip é lida explicitamente", async () => {
    const ffmpeg = resolveFfmpegPath();
    const src = join(base, "two-audio.mka");
    await execFileAsync(ffmpeg, [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=16000",
      "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono:d=1",
      "-map", "0:a:0", "-map", "1:a:0", "-c:a", "pcm_s16le", src,
    ]);

    const tonePath = join(base, "tone-track.f32le");
    const silencePath = join(base, "silence-track.f32le");
    await extractPcmF32le16k(ffmpeg, src, tonePath, undefined, 0);
    await extractPcmF32le16k(ffmpeg, src, silencePath, undefined, 1);
    const tone = await readF32leSamples(tonePath);
    const silence = await readF32leSamples(silencePath);
    expect(Math.max(...tone)).toBeGreaterThan(0.1);
    expect(Math.max(...silence.map(Math.abs))).toBe(0);
  });
});
