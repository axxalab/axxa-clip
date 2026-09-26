import { describe, it, expect } from "vitest";
import { FolderWatcher, isVideoFile, isSeen, type WatchedFile, type SeenMap } from "../watch";

const f = (path: string, size: number, mtimeMs = 1000): WatchedFile => ({ path, size, mtimeMs });

describe("isVideoFile", () => {
  it("reconhece os contêineres comuns de gravação e recusa arquivo oculto e o que não é vídeo", () => {
    for (const ok of ["a.mp4", "b.FLV", "c.ts", "d.mkv", "e.webm"]) expect(isVideoFile(ok)).toBe(true);
    for (const no of [".part.mp4", "a.txt", "b.jpg", "clips.json", "noext"]) expect(isVideoFile(no)).toBe(false);
  });
});

describe("isSeen", () => {
  it("mesmo caminho com a mesma impressão conta como processado; arquivo sobrescrito (impressão diferente) conta como novo", () => {
    const seen: SeenMap = { "/r/a.mp4": { size: 100, mtimeMs: 1000 } };
    expect(isSeen(seen, f("/r/a.mp4", 100, 1000))).toBe(true);
    expect(isSeen(seen, f("/r/a.mp4", 200, 2000))).toBe(false);
    expect(isSeen(seen, f("/r/b.mp4", 100, 1000))).toBe(false);
  });
});

describe("FolderWatcher", () => {
  function makeWatcher(overrides: {
    files: () => WatchedFile[];
    seen?: SeenMap;
    onStable?: (file: WatchedFile) => Promise<void>;
  }): { watcher: FolderWatcher; processed: string[] } {
    const processed: string[] = [];
    const seen = overrides.seen ?? {};
    const watcher = new FolderWatcher({
      listDir: async () => overrides.files(),
      isSeen: (file) => isSeen(seen, file),
      onStable:
        overrides.onStable ??
        (async (file) => {
          processed.push(file.path);
          seen[file.path] = { size: file.size, mtimeMs: file.mtimeMs };
        }),
    });
    return { watcher, processed };
  }

  it("arquivo crescendo não dispara; só duas rodadas estáveis seguidas processam, e uma vez só", async () => {
    let size = 100;
    const { watcher, processed } = makeWatcher({ files: () => [f("/r/rec.flv", size)] });
    await watcher.tick(); // visto pela primeira vez
    size = 200; // ainda sendo escrito
    await watcher.tick();
    expect(processed).toEqual([]);
    await watcher.tick(); // 1ª rodada estável
    expect(processed).toEqual([]);
    await watcher.tick(); // 2ª rodada estável → dispara
    await watcher.idle();
    expect(processed).toEqual(["/r/rec.flv"]);
    await watcher.tick(); // já está em seen, não dispara de novo
    await watcher.tick();
    await watcher.idle();
    expect(processed).toEqual(["/r/rec.flv"]);
  });

  it("a gravação antiga que já está em seen nunca dispara (reiniciar não corta de novo)", async () => {
    const { watcher, processed } = makeWatcher({
      files: () => [f("/r/old.mp4", 500, 42)],
      seen: { "/r/old.mp4": { size: 500, mtimeMs: 42 } },
    });
    for (let i = 0; i < 4; i++) await watcher.tick();
    await watcher.idle();
    expect(processed).toEqual([]);
  });

  it("vários arquivos são processados em série e na ordem, e a falha de um não atrapalha os seguintes", async () => {
    const order: string[] = [];
    let concurrent = 0;
    const seen: SeenMap = {};
    const { watcher } = makeWatcher({
      files: () => [f("/r/a.mp4", 1), f("/r/b.mp4", 2), f("/r/c.mp4", 3)],
      seen,
      onStable: async (file) => {
        concurrent += 1;
        expect(concurrent).toBe(1); // a garantia de que é em série
        await new Promise((r) => setTimeout(r, 5));
        seen[file.path] = { size: file.size, mtimeMs: file.mtimeMs };
        concurrent -= 1;
        if (file.path === "/r/b.mp4") throw new Error("este aqui quebrou");
        order.push(file.path);
      },
    });
    await watcher.tick();
    await watcher.tick();
    await watcher.tick(); // estável → os três entram na fila
    await watcher.idle();
    expect(order).toEqual(["/r/a.mp4", "/r/c.mp4"]); // o b falhou e foi pulado
  });

  it("pasta ilegível no momento (oscilação de disco de rede) pula a rodada em silêncio", async () => {
    let fail = true;
    const files = [f("/r/x.mp4", 9)];
    const seen: SeenMap = {};
    const processed: string[] = [];
    const watcher = new FolderWatcher({
      listDir: async () => {
        if (fail) throw new Error("EIO");
        return files;
      },
      isSeen: (file) => isSeen(seen, file),
      onStable: async (file) => {
        processed.push(file.path);
        seen[file.path] = { size: file.size, mtimeMs: file.mtimeMs };
      },
    });
    expect(await watcher.tick()).toBe(0);
    fail = false;
    await watcher.tick();
    await watcher.tick();
    await watcher.tick();
    await watcher.idle();
    expect(processed).toEqual(["/r/x.mp4"]);
  });

  it("arquivo que sumiu (foi movido) deixa de ser acompanhado e não dispara por engano", async () => {
    let present = true;
    const { watcher, processed } = makeWatcher({ files: () => (present ? [f("/r/gone.mp4", 7)] : []) });
    await watcher.tick();
    present = false;
    await watcher.tick();
    await watcher.tick();
    await watcher.tick();
    await watcher.idle();
    expect(processed).toEqual([]);
  });
});
