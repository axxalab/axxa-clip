/**
 * Seleção guiada por vídeo de referência (ideia emprestada da criação
 * reference-driven do OpenMontage): a pessoa entrega um corte viral que quer
 * usar como espelho, o ritmo dele é medido aqui mesmo na máquina — duração,
 * velocidade da fala, tamanho das frases, frequência de troca de plano, gancho
 * de abertura — e vira um "perfil de estilo" que é injetado no prompt de busca
 * de destaques, fazendo a escolha dos trechos pender para aquele ritmo.
 * O perfil é uma preferência, não uma restrição rígida: conteúdo bom continua
 * vindo primeiro pelo potencial de viralizar, para não acabar escolhendo trecho
 * ruim só para bater o ritmo.
 *
 * Este módulo tem apenas funções puras (cálculo do perfil e montagem do bloco
 * do prompt), que são testáveis; a transcrição e a detecção de planos são feitas
 * pela camada de pipeline, reaproveitando a infraestrutura que já existe
 * (transcribeCached / detectShotBoundaries), e só então o resultado é entregue
 * aqui — o material continua, como sempre, sem sair do computador.
 */
import type { Transcript } from "../shared/api-types";

/** Perfil de estilo do corte de referência (tudo medido, nada chutado). */
export interface ReferenceProfile {
  /** Duração do vídeo de referência (segundos). */
  durationSec: number;
  /** Velocidade da fala: caracteres por segundo em idiomas ideográficos, palavras por segundo nos demais. */
  speechRate: number;
  /** Tamanho médio da frase (em caracteres ou em palavras, conforme o idioma). */
  avgSentenceLen: number;
  /** Frequência de troca de plano (por minuto); null quando a detecção falha ou o material é só áudio. */
  cutsPerMin: number | null;
  /** Frase de gancho da abertura (o texto original da primeira frase, truncado por segurança). */
  hookLine: string;
  /** Se a transcrição da referência é contada por caracteres (escritas ideográficas) em vez de palavras. */
  charUnits: boolean;
}

// Faixa de ideogramas unificados CJK. Escrita como escapes Unicode de propósito:
// o código-fonte deste projeto não carrega nenhum caractere ideográfico, mas a
// contagem precisa continuar correta para material gravado nesses idiomas.
const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * Decide a unidade de contagem: escritas ideográficas contam caracteres, as
 * demais contam palavras. (Mesma ideia da verificação feita em highlight, mas
 * implementada à parte para evitar dependência circular.)
 */
function usesCharUnits(transcript: Transcript): boolean {
  const lang = transcript.language.toLowerCase();
  if (lang.startsWith("zh") || lang.startsWith("yue") || lang.startsWith("ja")) return true;
  if (lang && lang !== "auto") return false;
  const sample = transcript.segments.slice(0, 10).map((s) => s.text).join("");
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return sample.length > 0 && cjk / sample.length > 0.3;
}

/** Unidade de contagem de um texto: caracteres ideográficos, ou palavras separadas por espaço. */
function countUnits(text: string, charUnits: boolean): number {
  if (charUnits) {
    let n = 0;
    for (const ch of text) if (CJK_RE.test(ch)) n++;
    return n;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Mede o perfil de estilo a partir da transcrição da referência e dos limites de
 * plano (função pura).
 * A velocidade da fala usa o "tempo em que alguém fala", e não a duração total
 * do vídeo — se a referência tiver trechos de silêncio, a velocidade não deve
 * ser diluída por causa disso.
 */
export function buildReferenceProfile(transcript: Transcript, shotBoundaries: number[] | null): ReferenceProfile {
  const charUnits = usesCharUnits(transcript);
  const segs = transcript.segments;
  const durationSec =
    transcript.durationSec > 0 ? transcript.durationSec : segs.length > 0 ? segs[segs.length - 1].endSec : 0;
  const units = segs.reduce((a, s) => a + countUnits(s.text, charUnits), 0);
  const speakingSec = segs.reduce((a, s) => a + Math.max(0, s.endSec - s.startSec), 0);
  const speechRate = speakingSec > 0 ? Number((units / speakingSec).toFixed(1)) : 0;
  const avgSentenceLen = segs.length > 0 ? Math.round(units / segs.length) : 0;
  const cutsPerMin =
    shotBoundaries !== null && durationSec > 3
      ? Number((shotBoundaries.length / (durationSec / 60)).toFixed(1))
      : null;
  return {
    durationSec: Number(durationSec.toFixed(1)),
    speechRate,
    avgSentenceLen,
    cutsPerMin,
    hookLine: (segs[0]?.text ?? "").trim().slice(0, 50),
    charUnits,
  };
}

/**
 * Perfil → bloco extra do system prompt de busca de destaques (função pura).
 * `pt` segue o idioma da transcrição do material principal (o idioma do prompt
 * como um todo), enquanto a unidade do perfil segue a própria referência
 * (profile.charUnits).
 */
export function referencePromptSection(profile: ReferenceProfile, pt: boolean): string {
  const lo = Math.round(profile.durationSec * 0.7);
  const hi = Math.round(profile.durationSec * 1.3);
  const unit = profile.charUnits ? (pt ? "caracteres" : "chars") : (pt ? "palavras" : "words");
  if (pt) {
    const facts = [
      `duração de ${Math.round(profile.durationSec)} segundos`,
      `velocidade de fala de ${profile.speechRate} ${unit}/segundo`,
      `frase com ${profile.avgSentenceLen} ${unit} em média`,
      ...(profile.cutsPerMin !== null ? [`${profile.cutsPerMin} trocas de plano por minuto`] : []),
      ...(profile.hookLine ? [`gancho de abertura "${profile.hookLine}"`] : []),
    ].join(", ");
    return (
      `\n\n[Perfil do corte de referência] A pessoa forneceu um corte viral para servir de espelho; o que foi medido nele: ${facts}. ` +
      `Puxe a escolha dos trechos para esse ritmo: prefira candidatos com duração alvo de ${lo} a ${hi} segundos, velocidade e densidade de informação parecidas e um gancho de abertura do mesmo formato (pergunta, conflito ou suspense). ` +
      `Isso é uma preferência, não uma restrição rígida — o potencial de viralizar do próprio conteúdo vem sempre antes, e nunca se deve escolher um trecho medíocre só para bater o ritmo.`
    );
  }
  const facts = [
    `duration ${Math.round(profile.durationSec)}s`,
    `speech rate ${profile.speechRate} ${unit}/s`,
    `avg sentence ${profile.avgSentenceLen} ${unit}`,
    ...(profile.cutsPerMin !== null ? [`${profile.cutsPerMin} shot cuts/min`] : []),
    ...(profile.hookLine ? [`opening hook "${profile.hookLine}"`] : []),
  ].join(", ");
  return (
    `\n\n[Reference clip profile] The user supplied a viral clip to model after — measured: ${facts}. ` +
    `Lean toward its rhythm: prefer candidates of ${lo}–${hi}s with similar pacing/density and a similar hook shape (question/conflict/suspense). ` +
    `This is a preference, not a hard rule — genuine viral potential always wins; never pick mediocre segments just to match the rhythm.`
  );
}
