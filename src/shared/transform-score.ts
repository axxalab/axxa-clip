/**
 * Nota de transformação (v0.14): a medida de "quanto mudou" um clipe em relação
 * à imagem original da transmissão.
 *
 * Por que ela existe: em 2026 as plataformas passaram a tratar a "quantidade de
 * transformação" como indicador rígido de sobrevivência — o Reels usa impressão
 * digital visual para julgar reupload quando "70% ou mais dos elementos
 * audiovisuais originais de outra pessoa foram preservados" (10 repostagens em
 * 30 dias tiram a conta inteira das recomendações), o YouTube pune conteúdo
 * inautêntico produzido em massa, e o Douyin julga originalidade pela "mudança
 * de entropia da informação e pela autoria da expressão". Um clipe com pouca
 * transformação não é "menos bonito", é "impublicável".
 *
 * Critério: cada item de transformação é ponderado pela contribuição que dá à
 * mudança da impressão digital visual e da entropia da informação, com o total
 * limitado a 100.
 * Os pesos são uma heurística de direção (as plataformas não divulgam limites), e
 * servem como **aviso relativo** — abaixo da linha de alerta o sistema mostra um
 * cartão amarelo e diz quais opções ligar para compensar, sem nenhuma promessa de
 * "aprovação garantida".
 * São funções puras, compartilhadas pela camada de renderização (a estimativa ao
 * vivo no painel de exportação) e pelo lado da exportação (o comprovante no
 * clips.json); este arquivo não pode ter nenhuma dependência de Node.
 */

/** Itens de transformação que entram na nota (a camada de renderização estima pelas chaves, e o lado da exportação usa o comprovante real). */
export interface TransformInputs {
  /** Reconstrução vertical (o recorte 9:16 muda a composição, e é a maior contribuição). */
  vertical: boolean;
  /** Legenda queimada (uma camada de informação sobreposta). */
  captions: boolean;
  /** Corte seco, vícios de linguagem ou corte de repetições, qualquer um deles em ação (reconstrução da linha do tempo). */
  recut: boolean;
  /** Reconstrução da abertura (abertura fria ou antecipação do pico, mudando a ordem da narrativa). */
  reopened: boolean;
  /** Cartela de título ou o gancho de abertura em letras grandes. */
  titleOverlay: boolean;
  /** Movimento automático de câmera (mudança na trajetória do movimento da imagem). */
  autoZoom: boolean;
  /** Trilha de fundo mixada (refaz o ambiente sonoro — item explicitamente reconhecido no julgamento de originalidade). */
  bgm: boolean;
  /** Acentos sonoros. */
  sfx: boolean;
  /** Costura de vários trechos (2 ou mais, reconstrução da narrativa). */
  stitched: boolean;
  /** Legenda bilíngue (camada de informação da tradução). */
  translated: boolean;
  /** Marca d'água ou camada da marca. */
  watermark: boolean;
}

/** Peso de cada item (a soma pode passar de 100, e a nota é limitada; o comentário é a própria justificativa). */
export const TRANSFORM_WEIGHTS: Array<{ key: keyof TransformInputs; weight: number }> = [
  { key: "vertical", weight: 26 }, // proporção e composição mudam por inteiro, e é a maior fonte de diferença na impressão digital visual
  { key: "captions", weight: 20 }, // uma camada de informação sobreposta do começo ao fim
  { key: "recut", weight: 15 }, // reconstrução da linha do tempo (corte seco, vícios de linguagem, repetições)
  { key: "reopened", weight: 10 }, // reordenação da narrativa (abertura fria ou antecipação do pico)
  { key: "titleOverlay", weight: 8 }, // cartela de título ou gancho de abertura em letras grandes
  { key: "autoZoom", weight: 7 }, // mudança no movimento da imagem
  { key: "bgm", weight: 6 }, // refaz o ambiente sonoro (item reconhecido no julgamento de originalidade)
  { key: "stitched", weight: 6 }, // costura de vários trechos é reconstrução da narrativa
  { key: "sfx", weight: 3 },
  { key: "translated", weight: 3 },
  { key: "watermark", weight: 2 },
];

/** Linha de alerta: abaixo desta nota o clipe se aproxima de "um corte e já publica", e o risco de ser julgado reupload é alto. */
export const TRANSFORM_WARN_BELOW = 40;

export interface TransformScore {
  /** De 0 a 100. */
  score: number;
  /** warn significa abaixo da linha de alerta, com recomendação de acrescentar itens de transformação. */
  level: "warn" | "ok" | "strong";
  /** Os itens de maior peso que não foram ligados (é a dica de "qual ligar para subir a nota" mostrada à pessoa). */
  missingTop: Array<keyof TransformInputs>;
}

/** Calcula a nota (função pura): soma ponderada dos itens acertados, limitada a 100; 70 ou mais conta como strong. */
export function transformScore(inputs: TransformInputs): TransformScore {
  let score = 0;
  const missing: Array<{ key: keyof TransformInputs; weight: number }> = [];
  for (const { key, weight } of TRANSFORM_WEIGHTS) {
    if (inputs[key]) score += weight;
    else missing.push({ key, weight });
  }
  score = Math.min(100, score);
  return {
    score,
    level: score < TRANSFORM_WARN_BELOW ? "warn" : score >= 70 ? "strong" : "ok",
    missingTop: missing
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((m) => m.key),
  };
}
