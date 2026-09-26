import { describe, it, expect } from "vitest";
import { sanitizeFilename, clipFilename, summarizeEdit, buildChapters } from "../export";
import { buildConcatList, buildConcatArgs } from "../cut";

describe("summarizeEdit", () => {
  const plan = (durationSec: number, segs: number) => ({
    segments: Array.from({ length: segs }, () => ({})),
    durationSec,
  });

  it("informa as emendas, os segundos preservados e removidos, e a proporção cortada", () => {
    // 4s clip cut down to 2.1s across 2 kept segments → 1.9s removed, 47.5%
    expect(summarizeEdit(4, plan(2.1, 2))).toEqual({
      splices: 2,
      keptSec: 2.1,
      removedSec: 1.9,
      cutRatio: 0.475,
    });
  });

  it("é null quando nada foi emendado", () => {
    expect(summarizeEdit(4, null)).toBeNull();
    expect(summarizeEdit(0, plan(2, 1))).toBeNull(); // guard against divide-by-zero
  });

  it("nunca informa remoção negativa quando o plano preservou mais que o intervalo", () => {
    const out = summarizeEdit(2, plan(2.05, 1)); // rounding slack
    expect(out?.removedSec).toBe(0);
    expect(out?.cutRatio).toBe(0);
  });
});

describe("sanitizeFilename", () => {
  it("mantém letra, dígito, espaço e traço, e tira os caracteres hostis", () => {
    expect(sanitizeFilename('meio copo de água e não passa? o teste/para você ver: ep.1')).toBe("meio copo de água e não passa o testepara você ver ep1");
    expect(sanitizeFilename('a<b>c:"d/e\\f|g?h*i')).toBe("abcdefghi");
    expect(sanitizeFilename("Hello World - Ep 2")).toBe("Hello World - Ep 2");
  });

  it("junta os espaços em branco e apara as pontas", () => {
    expect(sanitizeFilename("  a   b  ")).toBe("a b");
  });

  it("limita o tamanho em 60 e usa a reserva quando fica vazio", () => {
    expect(sanitizeFilename("a".repeat(100))).toHaveLength(60);
    expect(sanitizeFilename("???")).toBe("clip");
    expect(sanitizeFilename("", "video")).toBe("video");
  });
});

describe("clipFilename", () => {
  it("põe na frente o índice preenchido com zero", () => {
    expect(clipFilename(1, "titulo do estouro")).toBe("01-titulo do estouro.mp4");
    expect(clipFilename(12, "t/i:t*le")).toBe("12-title.mp4");
  });
});

describe("compilado dos melhores momentos (concat + capítulos)", () => {
  it("buildConcatList: um file por linha, com a aspa simples escapada conforme a sintaxe do demuxer concat", () => {
    expect(buildConcatList(["/a/01-x.mp4", "/a/02-y.mp4"])).toBe("file '/a/01-x.mp4'\nfile '/a/02-y.mp4'\n");
    expect(buildConcatList(["/a/it's.mp4"])).toBe("file '/a/it'\\''s.mp4'\n");
  });

  it("buildConcatArgs: cópia de fluxo + faststart, sem recodificar", () => {
    const args = buildConcatArgs("/tmp/l.txt", "/out/compilado.mp4");
    expect(args.join(" ")).toContain("-f concat -safe 0 -i /tmp/l.txt");
    expect(args.join(" ")).toContain("-c copy");
    expect(args).toContain("+faststart");
    expect(args.join(" ")).not.toContain("libx264");
  });

  it("buildChapters: os instantes acumulam a partir de 0:00, e passando de uma hora aparece a casa das horas", () => {
    expect(
      buildChapters([
        { title: "estouro de abertura", durationSec: 32.7 },
        { title: "o segundo", durationSec: 41.2 },
        { title: "o de fechamento", durationSec: 3600 },
      ])
    ).toBe("0:00 estouro de abertura\n0:32 o segundo\n1:13 o de fechamento\n");
    expect(buildChapters([{ title: "a", durationSec: 10 }, { title: "b", durationSec: 5 }, { title: "c", durationSec: 1 }]).split("\n")[2]).toBe("0:15 c");
    // Depois de acumular mais de 1 hora, o instante do terceiro traz a casa das horas
    expect(
      buildChapters([
        { title: "x", durationSec: 3599 },
        { title: "y", durationSec: 2 },
        { title: "z", durationSec: 1 },
      ]).split("\n")[2]
    ).toBe("1:00:01 z");
  });
});
