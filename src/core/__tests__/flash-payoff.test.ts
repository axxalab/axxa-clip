import { describe, it, expect } from "vitest";
import { planFlashForward, FLASH_LEAD_SEC, FLASH_TAIL_SEC, FLASH_MIN_SEC } from "../coldopen";
import { missingHookPayoffs } from "../qa";

describe("planFlashForward (flash do estouro)", () => {
  const kept = [
    { startSec: 100, endSec: 130 },
    { startSec: 140, endSec: 160 },
  ];

  it("a janela do flash é tomada em volta do pico, dentro dos intervalos preservados (preparação antes do pico + o que ecoa depois)", () => {
    const plan = planFlashForward([150], kept);
    expect(plan).not.toBeNull();
    expect(plan!.startSec).toBeCloseTo(150 - FLASH_LEAD_SEC, 5);
    expect(plan!.endSec).toBeCloseTo(150 + FLASH_TAIL_SEC, 5);
  });

  it("com o pico encostado na borda do trecho a janela é aparada, e se ficar curta demais o pico é pulado pelo seguinte", () => {
    // 159,9 encostado no fim do trecho: a janela é aparada para [159,7, 160] = 0,3s, exatamente no limite
    const edge = planFlashForward([159.9], kept);
    expect(edge).not.toBeNull();
    expect(edge!.endSec - edge!.startSec).toBeGreaterThanOrEqual(FLASH_MIN_SEC - 1e-6);
    // 100,02 encostado no começo: janela [100, 100,52]; 140,01 no começo do outro trecho é igual — os dois são válidos
    // Pico fora de qualquer intervalo preservado (135 cai no vão) → é pulado e o seguinte é escolhido
    const skipGap = planFlashForward([135, 150], kept);
    expect(skipGap!.startSec).toBeCloseTo(150 - FLASH_LEAD_SEC, 5);
  });

  it("sem pico utilizável devolve null (melhor não fazer que fazer errado)", () => {
    expect(planFlashForward([], kept)).toBeNull();
    expect(planFlashForward([135], kept)).toBeNull(); // todos caem no vão
  });
});

describe("missingHookPayoffs (conferência do que o gancho promete)", () => {
  it("o número que o gancho promete precisa aparecer na transcrição, e o que falta é reportado", () => {
    const missing = missingHookPayoffs("só 99 reais, economize 3000", "hoje esse aqui sai por noventa e nove e economiza 3000 pra você");
    expect(missing).toEqual(["99 reais"]); // o 3000 está no trecho; o 99 foi transcrito por extenso → reportado como faltando
  });

  it("separador de milhar e espaço na transcrição não atrapalham a conferência", () => {
    expect(missingHookPayoffs("desconto direto de 1999", "eu tiro 1.999 direto pra você")).toEqual([]);
  });

  it("número de um dígito não é conferido (costuma ser transcrito por extenso, o que geraria erro certo)", () => {
    expect(missingHookPayoffs("3 métodos", "três métodos pra você")).toEqual([]);
  });

  it("promessa em porcentagem é conferida pelo núcleo numérico", () => {
    expect(missingHookPayoffs("49% de desconto, 30% mais barato", "quarenta e nove por cento e 30 pontos mais barato")).toEqual(["49%"]);
  });

  it("sem gancho ou sem transcrição, nada é avaliado", () => {
    expect(missingHookPayoffs(undefined, "qualquer coisa dita aí")).toEqual([]);
    expect(missingHookPayoffs("só 99 reais", undefined)).toEqual([]);
  });
});
