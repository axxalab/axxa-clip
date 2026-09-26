/**
 * Sinal de euforia do chat ao vivo: os picos de densidade do chat delimitam os
 * trechos de "reação intensa do público em tempo real", que entram no julgamento do
 * destaque — o chat é o voto que o público dá segundo a segundo, e é mais direto que
 * qualquer dedução de modelo.
 *
 * Dois formatos de arquivo são descobertos sozinhos, sem configuração (o arquivo de
 * mesmo nome ao lado do vídeo; o que estiver lá é o que é lido):
 *  - o .xml do formato do Bilibili: é o que o BililiveRecorder grava junto com a
 *    gravação, e é compatível com a exportação do site;
 *  - o .jsonl da gravação de live do Douyin: uma linha por mensagem, no formato
 *    {type,content,recvTimeSec,…}, que é o produto comum das ferramentas de gravação
 *    daquele ecossistema — quem transmite ou faz locução por lá (justamente o público
 *    ideal para cortes) tem esse arquivo ao lado da gravação, e não reconhecê-lo
 *    equivale a jogar fora toda a evidência de chat desse grupo de pessoas.
 *
 * As palavras de euforia (kkkk, chorei, morri, caraca…) têm peso dobrado, e o limite
 * de densidade se adapta em relação à linha de base da transmissão inteira — assim
 * tanto o mar de mensagens de quem tem muita audiência quanto o riacho de quem tem
 * pouca produzem os seus próprios picos. São três proteções contra falsificação:
 *  - antispam: a contribuição de um mesmo remetente numa janela tem teto (uma pessoa
 *    mandando cem mensagens não é a transmissão inteira fervendo);
 *  - bônus de subida: o salto de intensidade em relação à janela anterior entra na
 *    nota — um destaque "explode de repente", enquanto um calor constante sobe junto o
 *    limite da linha de base e não é marcado por engano;
 *  - eventos de interação (mensagem paga, assinatura, presente, novo seguidor, pico de
 *    curtidas): é o público votando com dinheiro ou com ação, e o peso é por tipo de
 *    evento, mais forte que uma mensagem comum.
 * São funções puras, testáveis.
 *
 *
 * São funções puras, testáveis.
 */
import { readFile } from "fs/promises";
import type { TimeRange } from "./signals";

/** Palavras de reação intensa do público (uma ocorrência dobra o peso). */
const HYPE_RE = /k{3,}|(?:ha){2,}|(?:rs){2,}|chorei|morri|mito|top demais|caraca|eita|slk|ai sim|aí sim|que isso|meu deus|nossa|sensacional|absurdo|vergonha alheia|passei mal|n[ãa]o acredito|[?!?!]{3,}/i

/** Largura e passo da janela deslizante (em segundos). */
export const DANMAKU_WINDOW_SEC = 10;
export const DANMAKU_HOP_SEC = 5;
/** Quantidade mínima de mensagens ponderadas que uma janela de pico precisa ter (filtra os picos falsos de uma transmissão morna). */
const MIN_PEAK_WEIGHT = 8;
/** Quando o intervalo entre duas janelas de pico é menor que este valor, elas são fundidas. */
const MERGE_GAP_SEC = 12;
/** Teto de trechos delimitados no material inteiro (para não estourar o prompt). */
const MAX_PEAKS = 12;
/** Peso dos eventos de interação: uma mensagem paga ou uma assinatura valem uma onda
 * de mensagens; presente (o pequeno e gratuito é mandado muito) vale um voto só;
 * seguir é um gesto claro de aprovação, mais forte que uma mensagem; e as curtidas em
 * sequência viram uma série de mensagens, em que a própria densidade já é o sinal. */
const SC_WEIGHT = 6;
const GUARD_WEIGHT = 6;
const GIFT_WEIGHT = 1;
const FOLLOW_WEIGHT = 2;
const LIKE_WEIGHT = 1;
/**
 * Antispam: o quanto um mesmo remetente pode contribuir, no máximo, dentro de uma
 * janela (cerca de duas mensagens de euforia).
 * Uma pessoa mandando cem mensagens não é a transmissão inteira fervendo; isto é mais
 * firme que "descontar por proporção", porque desconto não contém spam extremo.
 */
const SPAM_SENDER_CAP = 4;
/** Coeficiente do bônus de subida: o salto de intensidade em relação à janela anterior entra na nota nesta proporção. */
const SURGE_GAIN = 0.5;

export interface DanmakuItem {
  /** O segundo em relação ao começo do vídeo. */
  t: number;
  text: string;
  /** Identificação do remetente (o hash do uid); sem ela, a mensagem não entra no julgamento de spam. */
  uid?: string;
  /** Peso fixo dos eventos pagos (mensagem paga, assinatura, presente); as mensagens comuns passam por danmakuWeight. */
  boost?: number;
}

export interface DanmakuStats {
  /** Quantas mensagens foram lidas. */
  count: number;
  peakCount: number;
}

export interface DanmakuOutcome {
  danmakuPeaks: TimeRange[];
  stats: DanmakuStats;
}

/** Restaura o texto do XML: remove as etiquetas e resolve as entidades comuns. */
function xmlText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}

/** Pega o valor de um atributo dentro da string de atributos; sem ele, devolve string vazia. */
function xmlAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : "";
}

/** Lê o XML de chat no formato do Bilibili (<d p="segundos,…">texto</d> mais as extensões sc/gift/guard do BililiveRecorder); é tolerante e pula as entradas quebradas. */
export function parseBiliDanmakuXml(xml: string): DanmakuItem[] {
  const out: DanmakuItem[] = [];
  const re = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;
  for (const m of xml.matchAll(re)) {
    const parts = m[1].split(",");
    const t = Number(parts[0]);
    const text = xmlText(m[2]);
    // O sétimo campo do atributo p é o hash do uid do remetente (existe tanto no site quanto no BililiveRecorder); "0" é um preenchimento e não conta
    const uid = parts[6] && parts[6] !== "0" ? parts[6] : undefined;
    if (Number.isFinite(t) && t >= 0 && text) out.push({ t, text, ...(uid ? { uid } : {}) });
  }
  // Eventos pagos (só existem quando a gravação avançada de chat está ligada no
  // BililiveRecorder, e sem ela ficam naturalmente vazios):
  // o tempo vem do atributo ts (o segundo relativo ao vídeo) e o remetente de uid ou
  // user — os nomes de atributo têm uma reserva tolerante
  const paid = /<(sc|gift|guard)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of xml.matchAll(paid)) {
    const kind = m[1];
    const tsRaw = xmlAttr(m[2], "ts");
    if (!tsRaw) continue; // um evento sem marcação de tempo não pode ser alinhado à linha do tempo, então é pulado
    const t = Number(tsRaw);
    if (!Number.isFinite(t) || t < 0) continue;
    const uid = xmlAttr(m[2], "uid") || xmlAttr(m[2], "user") || undefined;
    const boost = kind === "sc" ? SC_WEIGHT : kind === "guard" ? GUARD_WEIGHT : GIFT_WEIGHT;
    const text = kind === "sc" ? xmlText(m[3] ?? "") || "SC" : xmlAttr(m[2], "giftname") || kind;
    out.push({ t, text, boost, ...(uid ? { uid } : {}) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Teto razoável do tempo relativo (48h): evita tratar uma marcação de época como segundo relativo e desalinhar a linha do tempo inteira. */
const MAX_REL_SEC = 48 * 3600;

/** Leitura tolerante de um campo de texto (um id int64 de protobuf pode vir como número depois de serializado). */
function strField(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Pega o tempo relativo de uma linha de mensagem. A prioridade dos campos é
 * recvTimeSec > timestamp > _time (o mesmo critério de gravação das ferramentas do
 * Douyin); o que está fora da faixa razoável (um segundo de época, por exemplo) não é
 * aceito — uma mensagem que não casa com a linha do tempo é descartada, porque é
 * melhor perdê-la do que deixá-la cair no segundo 0 e sujar o começo.
 */
function pickTime(msg: Record<string, unknown>): number | null {
  for (const key of ["recvTimeSec", "timestamp", "_time"]) {
    const v = msg[key];
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= MAX_REL_SEC) return n;
  }
  return null;
}

/**
 * Lê o JSONL de chat da gravação de live do Douyin (uma linha por mensagem): chat
 * conta como mensagem, gift/social/like entram com o peso do tipo de evento de
 * interação, e member (entrada na sala) e roomStats (quantidade de pessoas online) não
 * são reação do público e não contam.
 * É tolerante: as linhas quebradas são puladas (quando o processo de gravação é morto,
 * a última linha costuma estar pela metade). Função pura.
 */
export function parseDouyinDanmakuJsonl(jsonl: string): DanmakuItem[] {
  const out: DanmakuItem[] = [];
  for (const line of jsonl.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(s) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!msg || typeof msg !== "object") continue;
    const t = pickTime(msg);
    if (t === null) continue;
    const type = strField(msg.type);
    const uid = strField(msg.userId) || strField(msg.userName) || undefined;
    if (type === "chat") {
      const text = strField(msg.content);
      if (text) out.push({ t, text, ...(uid ? { uid } : {}) });
    } else if (type === "gift") {
      out.push({ t, text: strField(msg.giftName) || "presente", boost: GIFT_WEIGHT, ...(uid ? { uid } : {}) });
    } else if (type === "social") {
      // Seguir e compartilhar: o público vota com uma ação, e isso é mais forte que uma mensagem comum
      out.push({ t, text: "seguiu", boost: FOLLOW_WEIGHT, ...(uid ? { uid } : {}) });
    } else if (type === "like") {
      // Curtidas em sequência viram uma série de mensagens, e o pico de densidade em si já é "o público aplaudindo"
      out.push({ t, text: "curtiu", boost: LIKE_WEIGHT, ...(uid ? { uid } : {}) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Peso de uma mensagem: uma palavra de reação intensa dobra. */
export function danmakuWeight(text: string): number {
  return HYPE_RE.test(text) ? 2 : 1;
}

/** Peso de uma entrada: os eventos pagos têm o peso fixo do tipo, e as mensagens comuns dependem da palavra de euforia. */
function itemWeight(item: DanmakuItem): number {
  return item.boost ?? danmakuWeight(item.text);
}

/**
 * Delimitação dos trechos por pico de densidade: contagem ponderada em janela
 * deslizante → desconto antispam → bônus de subida, com o limite sendo
 * max(mediana da transmissão inteira × 2,5, MIN_PEAK_WEIGHT); as janelas acima do
 * limite são fundidas; a ordenação é pela nota da janela, os MAX_PEAKS primeiros são
 * mantidos, e a saída volta para a ordem de tempo. Função pura.
 */
export function danmakuPeaks(
  items: DanmakuItem[],
  durationSec: number,
  windowSec = DANMAKU_WINDOW_SEC,
  hopSec = DANMAKU_HOP_SEC
): TimeRange[] {
  if (items.length === 0 || !(durationSec > windowSec)) return [];
  const windows: Array<{ startSec: number; endSec: number; weight: number }> = [];
  let lo = 0;
  for (let start = 0; start + windowSec <= durationSec + hopSec; start += hopSec) {
    const end = start + windowSec;
    while (lo < items.length && items[lo].t < start) lo++;
    let weight = 0;
    // Antispam: a contribuição de um mesmo remetente tem teto — o formato antigo, sem uid, não é prejudicado (fail-open)
    const spent = new Map<string, number>();
    for (let i = lo; i < items.length && items[i].t < end; i++) {
      const w = itemWeight(items[i]);
      const uid = items[i].uid;
      if (!uid) {
        weight += w;
        continue;
      }
      const used = spent.get(uid) ?? 0;
      const grant = Math.min(w, SPAM_SENDER_CAP - used);
      if (grant > 0) {
        weight += grant;
        spent.set(uid, used + grant);
      }
    }
    windows.push({ startSec: start, endSec: Math.min(end, durationSec), weight });
  }
  // Bônus de subida: o salto em relação à janela anterior entra na nota, porque um
  // destaque "explode de repente"; quando a transmissão inteira fica mornamente
  // constante, o salto de cada janela é zero e o limite da mediana sobe junto com a
  // linha de base, então nada é marcado por engano
  const scored = windows.map((w, i) => ({
    ...w,
    weight: i === 0 ? w.weight : w.weight + SURGE_GAIN * Math.max(0, w.weight - windows[i - 1].weight),
  }));
  const weights = scored.map((w) => w.weight).sort((a, b) => a - b);
  const median = weights[Math.floor(weights.length / 2)] ?? 0;
  const threshold = Math.max(median * 2.5, MIN_PEAK_WEIGHT);
  const hot = scored.filter((w) => w.weight >= threshold);
  if (hot.length === 0) return [];
  // Fusão dos trechos (guardando o maior peso de janela de cada um, para que o corte preserve os mais intensos)
  const merged: Array<TimeRange & { weight: number }> = [];
  for (const w of hot) {
    const last = merged[merged.length - 1];
    if (last && w.startSec - last.endSec < MERGE_GAP_SEC) {
      last.endSec = Math.max(last.endSec, w.endSec);
      last.weight = Math.max(last.weight, w.weight);
    } else {
      merged.push({ startSec: w.startSec, endSec: w.endSec, weight: w.weight });
    }
  }
  return merged
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_PEAKS)
    .sort((a, b) => a.startSec - b.startSec)
    .map(({ startSec, endSec }) => ({ startSec, endSec }));
}

/** O caminho do .xml de mesmo nome ao lado do vídeo (a convenção do BililiveRecorder). */
export function danmakuPathFor(videoPath: string): string {
  return videoPath.replace(/\.[^./\\]+$/, "") + ".xml";
}

/**
 * Os arquivos de chat que podem estar ao lado do vídeo, por ordem de prioridade: o
 * .xml de mesmo nome (BililiveRecorder) → o .jsonl de mesmo nome →
 * {primeiro trecho}_danmaku.jsonl (a convenção das ferramentas de gravação do Douyin:
 * o vídeo se chama {número da sala}_merged.mp4 ou
 * {número da sala}_qualidade_hora.flv, e o chat se chama
 * {número da sala}_danmaku.jsonl). Função pura.
 */
export function danmakuPathsFor(videoPath: string): string[] {
  const base = videoPath.replace(/\.[^./\\]+$/, "");
  const out = [base + ".xml", base + ".jsonl"];
  const m = base.match(/^(.*[/\\])?([^/\\_]+)_[^/\\]*$/);
  if (m) out.push((m[1] ?? "") + m[2] + "_danmaku.jsonl");
  return [...new Set(out)];
}

/**
 * Lê o arquivo de chat ao lado do vídeo (tentando um a um pela prioridade de
 * danmakuPathsFor) e interpreta as entradas.
 * Se todos falharem, devolve null. A curva da linha do tempo e o sinal de pico usam
 * esta mesma entrada.
 */
export async function readDanmakuItems(videoPath: string): Promise<DanmakuItem[] | null> {
  for (const path of danmakuPathsFor(videoPath)) {
    try {
      const raw = await readFile(path, "utf8");
      const items = path.endsWith(".xml") ? parseBiliDanmakuXml(raw) : parseDouyinDanmakuJsonl(raw);
      if (items.length >= 20) return items; // pouco demais não forma sinal, então o próximo candidato é tentado
    } catch {
      // Este candidato não pôde ser lido ou interpretado, então o próximo é tentado
    }
  }
  return null;
}

/**
 * Curva de euforia do chat: a contagem ponderada de cada célula (com o mesmo peso por
 * entrada do sinal de pico), normalizada de 0 a 1 pelo valor máximo da transmissão
 * inteira — é o que a linha do tempo da bancada usa. Função pura.
 */
export function danmakuHeatCurve(items: DanmakuItem[], durationSec: number, bins: number): number[] {
  if (!(durationSec > 0) || bins < 1 || items.length === 0) return [];
  const out = new Float64Array(bins);
  for (const item of items) {
    if (item.t < 0 || item.t > durationSec) continue;
    const i = Math.min(bins - 1, Math.floor((item.t / durationSec) * bins));
    out[i] += itemWeight(item);
  }
  const max = Math.max(...out);
  if (max <= 0) return [...out];
  return [...out].map((v) => v / max);
}

/**
 * Coleta sem configuração: lê o chat → delimita os picos. Qualquer falha devolve null e nunca derruba a detecção.
 */
export async function collectDanmakuSignal(videoPath: string, durationSec: number): Promise<DanmakuOutcome | null> {
  const items = await readDanmakuItems(videoPath);
  if (!items) return null;
  const peaks = danmakuPeaks(items, durationSec);
  return { danmakuPeaks: peaks, stats: { count: items.length, peakCount: peaks.length } };
}
