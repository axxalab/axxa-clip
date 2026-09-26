/**
 * Canal de candidatos guiado por sinal: localizar o destaque sem depender da
 * transcrição.
 *
 * Por que isso é indispensável: a cadeia original do HotClip era "o LLM cita a
 * fala → a busca reversa encontra o tempo", o que funciona para venda, aula e
 * entrevista, mas **não funciona de jeito nenhum** para dança, talento e conteúdo
 * de rua — a transcrição de uma live de dança é vazia (só cumprimentos soltos), e
 * na rua a captação é ruim, com a fala do momento de pico sendo muitas vezes só um
 * "caraca".
 * Sem fala para citar, não sai um único candidato, e nenhum critério de gênero,
 * por bem escrito que seja, salva isso.
 *
 * Então aqui o caminho é outro: os oito sinais de imagem e som (volume, troca de
 * plano, movimento por diferença de quadros, modelo de visão, expressão facial,
 * tom de voz, riso e aplauso, chat ao vivo) são fundidos, com pesos por gênero, em
 * uma única curva de intensidade ao longo do tempo, e as janelas são tiradas
 * direto dessa curva.
 * O tempo vem dos sinais, e o LLM só decide quais dessas janelas valem publicar e
 * que título dar — ele não precisa citar nenhuma fala e, por isso, também não
 * entrega folha em branco por "não ter o que citar".
 *
 * São funções puras, testáveis; não tocam no ffmpeg e não fazem requisição de rede.
 */
import type { MediaSignals } from "../signals";
import type { Transcript } from "../transcribe/types";
import type { EvidenceClass } from "../genre";

export interface TimeRange {
  startSec: number;
  endSec: number;
}

/** O peso de cada um dos oito sinais (usado na curva de fusão). */
export interface MomentWeights {
  loud: number;
  cut: number;
  motion: number;
  visual: number;
  emotion: number;
  voice: number;
  audioEvent: number;
  danmaku: number;
}

/**
 * Os pesos por classe de evidência. Os dois conjuntos são quase opostos, e é
 * exatamente assim que a conclusão de pesquisa "os pesos de evidência se invertem
 * entre gêneros" chega ao código:
 *  - visual (dança, talento, canto): quem manda é a imagem e o chat, e o tom de voz
 *    é praticamente inútil (durante a apresentação ninguém fala)
 *  - reaction (jogos, rua, bate-papo): as explosões de voz e o chat são a evidência
 *    principal, e a imagem serve só de referência
 */
export const MOMENT_WEIGHTS: Record<Exclude<EvidenceClass, "words">, MomentWeights> = {
  visual: { loud: 1.2, cut: 2.2, motion: 2.8, visual: 3, emotion: 1.5, voice: 0.5, audioEvent: 1, danmaku: 3 },
  reaction: { loud: 2, cut: 1, motion: 1.5, visual: 1.5, emotion: 2, voice: 3, audioEvent: 2.5, danmaku: 3 },
};

/** Granularidade de amostragem da curva de intensidade. 1 segundo já basta — mais fino que isso passa da resolução dos próprios sinais. */
export const MOMENT_BIN_SEC = 1;
/** Distância mínima entre um pico e outro, para o mesmo auge não ser partido em vários candidatos. */
export const MOMENT_MIN_GAP_SEC = 8;
/** Quantos momentos, no máximo, a fusão produz internamente. */
export const MOMENT_MAX_COUNT = 12;
/**
 * O teto do que de fato entra no prompt (os N mais intensos, recolocados em ordem
 * de tempo).
 * Lição da prática: com 12 momentos de 25 segundos cada e transcrição cheia de
 * ruído empilhados no prompt, o modelo devolve o template sem preencher
 * (`"momentId": x`); reduzir para 8 e truncar a fala de referência resolveu na
 * primeira tentativa. O próprio prompt já diz que "normalmente só dois ou três
 * valem o corte", então oferecer 12 opções era contraditório desde o começo.
 */
export const MOMENT_PROMPT_MAX = 8;

/** Pega os N mais intensos, recoloca em ordem de tempo e renumera (a numeração precisa ser a mesma do prompt). */
export function topMoments(moments: SignalMoment[], max = MOMENT_PROMPT_MAX): SignalMoment[] {
  if (moments.length <= max) return moments;
  return [...moments]
    .sort((a, b) => b.heat - a.heat)
    .slice(0, max)
    .sort((a, b) => a.startSec - b.startSec)
    .map((m, i) => ({ ...m, id: i + 1 }));
}
/**
 * Quando um sinal isolado cobre mais que esta proporção, ele é considerado "está
 * sempre soando" e o peso é descontado.
 * Isto saiu da vez em que a emoção do SenseVoice saturou: locução neutra também era
 * julgada HAPPY, e 62% das janelas de um stand-up tinham riso — um sinal que fica
 * aceso o tempo todo deixa de distinguir qualquer coisa.
 */
export const MOMENT_SATURATION = 0.55;
/**
 * Bônus de ressonância entre sinais: quanto mais tipos de sinal acertam o mesmo
 * segundo, mais confiável — só volume alto pode ser a trilha, só chat alto pode ser
 * spam, e é volume + chat + riso acesos juntos que marcam o destaque de verdade.
 * Cada sinal a mais multiplica por um degrau.
 * O prompt já diz ao LLM que "um sinal isolado pode ser descartado sem medo"; aqui
 * o mesmo julgamento entra na curva, para que os momentos de ressonância passem à
 * frente dos isolados já na ordenação.
 */
export const MOMENT_AGREEMENT_BONUS = 0.25;
/**
 * Quando um pico cai abaixo desta proporção do pico mais forte, a extração de
 * janelas para — uma cauda fraca é ruído (o relance de algum sinal de peso baixo),
 * e entregá-la ao LLM só dilui os candidatos de verdade. A proporção é relativa e
 * não um limite absoluto: material pobre em sinal continua produzindo picos.
 */
export const MOMENT_NOISE_FLOOR = 0.25;
/** Ao tirar a janela, ela se expande para os dois lados até a intensidade cair abaixo desta proporção do pico — a janela acompanha o conteúdo, em vez de ter um tamanho fixo. */
export const MOMENT_WINDOW_REL_HEIGHT = 0.35;

export interface SignalMoment {
  /** Começa em 1, para o LLM citar (ele só precisa informar o número, e não citar a fala). */
  id: number;
  startSec: number;
  endSec: number;
  /** Intensidade da fusão (valor relativo, comparável dentro da mesma transmissão). */
  heat: number;
  /** Os tipos de sinal que acertaram (é a cadeia de evidências mostrada ao LLM e à pessoa). */
  evidence: Array<keyof MomentWeights>;
}

/**
 * Proporção de fala: a soma da duração das frases dividida pela duração total.
 * Independe do idioma (não conta caracteres), então vale igualmente para qualquer
 * língua.
 * Em lives de dança e de canto há longos trechos em que ninguém fala, e esse valor
 * fica bem baixo.
 */
export function speechRatio(transcript: Transcript): number {
  if (transcript.durationSec <= 0) return 0;
  const spoken = transcript.segments.reduce((a, s) => a + Math.max(0, s.endSec - s.startSec), 0);
  return Math.min(1, spoken / transcript.durationSec);
}

/** Abaixo desta proporção de fala, a transcrição é considerada "praticamente vazia", e o canal de sinais roda também, independente do gênero que a pessoa escolheu. */
export const SPARSE_SPEECH_RATIO = 0.35;

/**
 * Se o canal de sinais deve rodar. Basta uma das três condições:
 *  1. o gênero em si depende de reação ou de imagem (a pessoa escolheu
 *     explicitamente jogos, rua ou talento);
 *  2. a proporção de fala é baixa demais — o próprio material está dizendo que a
 *     transcrição não tem conteúdo (o que cobre os gêneros que não foram
 *     enumerados);
 *  3. o canal de texto produziu pouco — é a última proteção para quando não há fala
 *     para citar.
 */
export function shouldRunMoments(
  evidence: EvidenceClass,
  ratio: number,
  textCandidateCount: number
): boolean {
  return evidence !== "words" || ratio < SPARSE_SPEECH_RATIO || textCandidateCount < 2;
}

/** A proporção do tempo total que um sinal cobre — usada no desconto por saturação. */
function coverageRatio(ranges: TimeRange[] | undefined, durationSec: number): number {
  if (!ranges || ranges.length === 0 || durationSec <= 0) return 0;
  const total = ranges.reduce((a, r) => a + Math.max(0, r.endSec - r.startSec), 0);
  return Math.min(1, total / durationSec);
}

/**
 * Acrescenta um sinal ao array de intensidade. Um sinal com cobertura larga demais
 * é descontado na razão inversa da cobertura — um sinal que fica aceso o tempo todo
 * não distingue nada, e sem o desconto ele achataria a curva, degenerando os picos
 * em aleatoriedade.
 */
function addSignal(
  heat: Float64Array,
  hits: Array<Set<keyof MomentWeights>>,
  ranges: TimeRange[] | undefined,
  weight: number,
  kind: keyof MomentWeights,
  binSec: number,
  durationSec: number
): void {
  if (!ranges || ranges.length === 0 || weight <= 0) return;
  const cov = coverageRatio(ranges, durationSec);
  const w = cov > MOMENT_SATURATION ? weight * (MOMENT_SATURATION / cov) : weight;
  for (const r of ranges) {
    const from = Math.max(0, Math.floor(r.startSec / binSec));
    const to = Math.min(heat.length - 1, Math.ceil(r.endSec / binSec));
    for (let i = from; i <= to; i++) {
      heat[i] += w;
      hits[i].add(kind);
    }
  }
}

/** Média móvel de três pontos: elimina o tremor de uma célula só e deixa a posição do pico mais estável. */
function smooth(heat: Float64Array): Float64Array {
  const out = new Float64Array(heat.length);
  for (let i = 0; i < heat.length; i++) {
    const a = heat[Math.max(0, i - 1)];
    const c = heat[Math.min(heat.length - 1, i + 1)];
    out[i] = (a + heat[i] * 2 + c) / 4;
  }
  return out;
}

export interface FuseOptions {
  weights: MomentWeights;
  /** Piso e teto da duração alvo (em segundos), iguais aos da faixa de duração do clipe. */
  minSec: number;
  maxSec: number;
  maxCount?: number;
  binSec?: number;
}

/**
 * Funde os oito sinais → uma lista de momentos ordenada por intensidade.
 *
 * Como as janelas são tiradas: pega-se repetidamente a célula mais intensa do
 * momento e expande-se do pico para os dois lados até a intensidade cair abaixo da
 * proporção definida (a janela acompanha o conteúdo: pico curto dá janela curta,
 * auge prolongado dá janela longa, e as duas ficam dentro da faixa de duração
 * alvo), depois esse trecho (mais o intervalo mínimo) é marcado como usado e a
 * busca segue para o próximo — o que garante que eles não se sobreponham nem se
 * amontoem; quando os picos ficam tão fracos que sobra só uma fração do mais forte,
 * o trabalho encerra, e o ruído da cauda fraca não entra na lista.
 */
export function fuseMoments(
  signals: MediaSignals | undefined,
  durationSec: number,
  options: FuseOptions
): SignalMoment[] {
  const binSec = options.binSec ?? MOMENT_BIN_SEC;
  const maxCount = options.maxCount ?? MOMENT_MAX_COUNT;
  if (!signals || durationSec <= 0) return [];

  const bins = Math.max(1, Math.ceil(durationSec / binSec));
  const heat = new Float64Array(bins);
  const hits: Array<Set<keyof MomentWeights>> = Array.from({ length: bins }, () => new Set<keyof MomentWeights>());
  const w = options.weights;
  addSignal(heat, hits, signals.loudPeaks, w.loud, "loud", binSec, durationSec);
  addSignal(heat, hits, signals.cutDense, w.cut, "cut", binSec, durationSec);
  addSignal(heat, hits, signals.motionPeaks, w.motion, "motion", binSec, durationSec);
  addSignal(heat, hits, signals.visualPeaks, w.visual, "visual", binSec, durationSec);
  addSignal(heat, hits, signals.emotionPeaks, w.emotion, "emotion", binSec, durationSec);
  addSignal(heat, hits, signals.voiceEmotionPeaks, w.voice, "voice", binSec, durationSec);
  addSignal(heat, hits, signals.audioEventPeaks, w.audioEvent, "audioEvent", binSec, durationSec);
  addSignal(heat, hits, signals.danmakuPeaks, w.danmaku, "danmaku", binSec, durationSec);

  // Bônus de ressonância: depois da soma ponderada, o valor é multiplicado por um degrau conforme quantos sinais acertam o mesmo segundo — sinal isolado não é premiado
  for (let i = 0; i < bins; i++) {
    const extra = hits[i].size - 1;
    if (extra > 0) heat[i] *= 1 + MOMENT_AGREEMENT_BONUS * extra;
  }

  const curve = smooth(heat);
  const minBins = Math.max(1, Math.round(options.minSec / binSec));
  const maxBins = Math.max(minBins, Math.round(options.maxSec / binSec));
  const gapBins = Math.max(1, Math.round(MOMENT_MIN_GAP_SEC / binSec));

  const out: SignalMoment[] = [];
  const taken = new Uint8Array(bins);
  let strongest = 0;
  for (let n = 0; n < maxCount; n++) {
    let best = -1;
    let bestVal = 0;
    for (let i = 0; i < bins; i++) {
      if (taken[i]) continue;
      if (curve[i] > bestVal) {
        bestVal = curve[i];
        best = i;
      }
    }
    if (best < 0 || bestVal <= 0) break;
    if (strongest === 0) strongest = bestVal;
    else if (bestVal < strongest * MOMENT_NOISE_FLOOR) break; // o ruído da cauda fraca encerra o trabalho

    // Expande do pico para os dois lados: para quando a intensidade cai abaixo da proporção, quando encosta numa célula já usada ou quando chega na borda do material
    const floor = bestVal * MOMENT_WINDOW_REL_HEIGHT;
    let from = best;
    let to = best;
    while (to - from + 1 < maxBins) {
      const left = from > 0 && !taken[from - 1] && curve[from - 1] >= floor ? curve[from - 1] : -1;
      const right = to < bins - 1 && !taken[to + 1] && curve[to + 1] >= floor ? curve[to + 1] : -1;
      if (left < 0 && right < 0) break;
      if (right >= left) to++;
      else from--;
    }
    // Um pico curto demais é completado até o piso alvo (ainda sem atravessar célula já usada nem borda) — para formar uma janela em que dê para assistir a um conteúdo inteiro
    while (to - from + 1 < minBins) {
      const canLeft = from > 0 && !taken[from - 1];
      const canRight = to < bins - 1 && !taken[to + 1];
      if (!canLeft && !canRight) break;
      if (canRight && (!canLeft || curve[to + 1] >= curve[from - 1])) to++;
      else from--;
    }
    // A evidência reúne todos os tipos de sinal que apareceram dentro da janela (e não apenas o da célula do pico)
    const kinds = new Set<keyof MomentWeights>();
    for (let i = from; i <= to; i++) {
      for (const k of hits[i]) kinds.add(k);
    }
    out.push({
      id: 0, // a numeração é dada de uma vez depois da ordenação
      startSec: Number((from * binSec).toFixed(2)),
      endSec: Number(Math.min(durationSec, (to + 1) * binSec).toFixed(2)),
      // A intensidade guarda a força do pico (e não a soma da janela) — assim uma janela longa não leva vantagem na ordenação por ser longa
      heat: Number(bestVal.toFixed(3)),
      evidence: [...kinds],
    });
    for (let i = Math.max(0, from - gapBins); i <= Math.min(bins - 1, to + gapBins); i++) taken[i] = 1;
  }

  // Na entrega ao LLM a ordem é a de tempo (ele precisa ver o que vem antes e o que vem depois), e a numeração também segue o tempo
  return out
    .sort((a, b) => a.startSec - b.startSec)
    .map((m, i) => ({ ...m, id: i + 1 }));
}
