/**
 * O lugar da exportação (issue #3): se a pessoa mudou, o vídeo vai para onde ela escolheu; se não mudou, vai
 * para «Vídeos/HotClip» do sistema.
 * Um erro neste caminho faz o vídeo «desaparecer» — a pessoa não tem a menor ideia de onde procurar, então
 * todos os valores de borda ficam pregados aqui.
 */
import { describe, expect, it } from "vitest";
import { join } from "path";
import { clipOutDir } from "../appenv";

describe("clipOutDir", () => {
  const videos = join("/Users", "duan", "Movies");

  it("sem nunca ter escolhido o lugar → HotClip/<nome do material> na pasta de vídeos do sistema", () => {
    expect(clipOutDir(undefined, videos, "live-gravada")).toBe(join(videos, "HotClip", "live-gravada"));
    expect(clipOutDir(null, videos, "live-gravada")).toBe(join(videos, "HotClip", "live-gravada"));
  });

  it("com o lugar escolhido → vai para <nome do material> dentro da raiz que a pessoa escolheu, sem acrescentar um HotClip no meio", () => {
    const chosen = join("/Users", "rafael", "Desktop", "meus-cortes");
    expect(clipOutDir(chosen, videos, "live-gravada")).toBe(join(chosen, "live-gravada"));
  });

  it("string vazia ou só espaço conta como nunca escolhido (um valor sujo de um arquivo de preferências antigo não pode jogar o vídeo na raiz)", () => {
    expect(clipOutDir("", videos, "nome-do-material")).toBe(join(videos, "HotClip", "nome-do-material"));
    expect(clipOutDir("   ", videos, "nome-do-material")).toBe(join(videos, "HotClip", "nome-do-material"));
  });

  it("o espaço nas pontas do caminho escolhido é aparado (arrastar ou colar um caminho quase sempre traz)", () => {
    expect(clipOutDir("  /tmp/out  ", videos, "nome-do-material")).toBe(join("/tmp/out", "nome-do-material"));
  });

  it("o nome do material vira uma subpasta como está, e materiais diferentes não se sobrescrevem", () => {
    const a = clipOutDir(undefined, videos, "primeira-sessao");
    const b = clipOutDir(undefined, videos, "segunda-sessao");
    expect(a).not.toBe(b);
    expect(a.endsWith(join("HotClip", "primeira-sessao"))).toBe(true);
  });
});
