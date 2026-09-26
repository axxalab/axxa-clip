/**
 * Exportação de rascunho do JianYing / CapCut: a estrutura de draft_content.json segue o modelo 5.9 do pyJianYingDraft.
 */
import { describe, it, expect } from "vitest";
import { buildDraftContent, buildDraftMetaInfo } from "../jianying";

/** Gerador de id incremental: o teste fica reproduzível. */
const seqIds = (): (() => string) => {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
};

const INPUT = {
  sourcePath: "/v/minha-live-gravada.mp4",
  sourceName: "minha-live-gravada.mp4",
  sourceDurationSec: 5427.5,
  width: 1920,
  height: 1080,
  fps: 30,
  clip: {
    title: "trecho de teste",
    segments: [
      { startSec: 100.2, endSec: 112.8 },
      { startSec: 115.0, endSec: 120.5 },
    ],
  },
};

describe("buildDraftContent", () => {
  const content = buildDraftContent(INPUT, seqIds()) as Record<string, any>;

  it("a tela = o enquadramento original, a duração = a soma dos intervalos preservados (em microssegundos), e há uma trilha de vídeo só", () => {
    expect(content.canvas_config).toEqual({ height: 1080, ratio: "original", width: 1920 });
    expect(content.duration).toBe(Math.round(12.6e6) + Math.round(5.5e6));
    expect(content.tracks).toHaveLength(1);
    expect(content.tracks[0].type).toBe("video");
  });

  it("o source do trecho aponta para o intervalo do original, o target os cola em sequência, e cada pedaço é arrastável de forma independente", () => {
    const segs = content.tracks[0].segments;
    expect(segs).toHaveLength(2);
    expect(segs[0].source_timerange).toEqual({ start: 100_200_000, duration: 12_600_000 });
    expect(segs[0].target_timerange.start).toBe(0);
    expect(segs[1].source_timerange.start).toBe(115_000_000);
    expect(segs[1].target_timerange.start).toBe(segs[0].target_timerange.duration);
    expect(segs[0].speed).toBe(1.0);
    expect(segs[0].visible).toBe(true);
    expect(segs[0].render_index).toBe(0);
  });

  it("o material aponta para o caminho absoluto do original e tem a duração inteira dele; o material de speed corresponde um a um aos trechos e é referenciado", () => {
    const mats = content.materials;
    expect(mats.videos).toHaveLength(1);
    expect(mats.videos[0].path).toBe("/v/minha-live-gravada.mp4");
    expect(mats.videos[0].duration).toBe(5_427_500_000);
    expect(mats.videos[0].type).toBe("video");
    expect(mats.speeds).toHaveLength(2);
    const speedIds = mats.speeds.map((s: { id: string }) => s.id);
    const segs = content.tracks[0].segments;
    expect(segs[0].extra_material_refs).toEqual([speedIds[0]]);
    expect(segs[1].extra_material_refs).toEqual([speedIds[1]]);
    // Todos os trechos apontam para o mesmo material
    expect(new Set(segs.map((s: { material_id: string }) => s.material_id)).size).toBe(1);
    expect(segs[0].material_id).toBe(mats.videos[0].id);
  });

  it("as categorias vazias de materials estão todas presentes (uma chave faltando faz o editor tratar o rascunho como corrompido); o modelo é marcado como 5.9", () => {
    for (const key of ["audios", "texts", "transitions", "canvases", "effects", "masks", "stickers"]) {
      expect(Array.isArray(content.materials[key])).toBe(true);
    }
    expect(content.platform.app_version).toBe("5.9.0");
    expect(content.version).toBe(360000);
    expect(content.new_version).toBe("110.0.0");
  });

  it("pedaço de duração zero ou negativa é filtrado; a duração do material nunca fica abaixo do fim do recorte do trecho", () => {
    const weird = buildDraftContent(
      {
        ...INPUT,
        sourceDurationSec: 0, // a duração do contêiner é desconhecida
        clip: { title: "t", segments: [{ startSec: 5, endSec: 5 }, { startSec: 10, endSec: 20 }] },
      },
      seqIds()
    ) as Record<string, any>;
    expect(weird.tracks[0].segments).toHaveLength(1);
    expect(weird.materials.videos[0].duration).toBeGreaterThanOrEqual(20_000_000);
  });

  it("a mesma sequência do gerador de id → saída reproduzível", () => {
    const a = JSON.stringify(buildDraftContent(INPUT, seqIds()));
    const b = JSON.stringify(buildDraftContent(INPUT, seqIds()));
    expect(a).toBe(b);
  });
});

describe("buildDraftMetaInfo", () => {
  it("o draft_id é um UUID em maiúsculas; draft_materials tem as sete categorias", () => {
    const meta = buildDraftMetaInfo(seqIds()) as Record<string, any>;
    expect(meta.draft_id).toMatch(/^[0-9A-F-]{36}$/);
    expect(meta.draft_materials.map((m: { type: number }) => m.type)).toEqual([0, 1, 2, 3, 6, 7, 8]);
    expect(meta.draft_fold_path).toBe("");
  });
});
