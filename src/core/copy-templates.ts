/**
 * Templates estruturados para o texto de publicação: 8 ângulos de gancho × 5
 * tipos de chamada final (CTA).
 * Em vez de deixar o LLM inventar livremente "escreva um título com gancho", é
 * melhor colocar na frente dele o menu de ângulos que já foi validado na prática
 * e deixá-lo escolher — cada texto sai com a etiqueta de "qual ângulo e qual tipo
 * de CTA foram usados", o que dá para auditar e rever, e um lote de clipes não
 * fica todo igual, na mesma fórmula.
 *
 * Só dados e funções puras: mudar um ângulo ou acrescentar um CTA mexe na tabela,
 * não na lógica. O menu do prompt conversa com a checagem de palavras proibidas
 * (content-lint.ts): as dicas do ângulo de urgência e do CTA de produto já
 * descartam explicitamente as construções que cairiam na checagem, para o modelo
 * não escrever a palavra proibida e só depois esperar alguém corrigir.
 */

/** Id do ângulo de gancho (entra no clips.json e no prompt; é estável e não muda). */
export type HookAngleId =
  | "question"
  | "suspense"
  | "contrast"
  | "number"
  | "pain"
  | "counter"
  | "identity"
  | "urgency";

interface HookAngle {
  id: HookAngleId;
  pt: string;
  en: string;
  /** Uma frase de explicação mais o formato de exemplo, para o prompt. */
  hintPt: string;
  hintEn: string;
}

const HOOK_ANGLES: HookAngle[] = [
  { id: "question", pt: "pergunta", en: "question", hintPt: "jogue direto a pergunta que incomoda o público (\"por que o seu ××× nunca dá certo?\")", hintEn: "open with the audience's own question ('why does your … never work?')" },
  { id: "suspense", pt: "suspense", en: "suspense", hintPt: "guarde a conclusão para o fim e abra com o suspense (\"quase todo mundo erra o último passo\")", hintEn: "withhold the payoff ('most people get the last step wrong')" },
  { id: "contrast", pt: "contraste", en: "contrast", hintPt: "um contraste forte de antes e depois, de expectativa ou de identidade (\"os mesmos ingredientes, a diferença está neste passo\")", hintEn: "sharp before/after or expectation contrast" },
  { id: "number", pt: "números", en: "number", hintPt: "o número dá sensação de certeza (\"3 métodos\", \"5 erros\")", hintEn: "numbers promise structure ('3 ways', '5 traps')" },
  { id: "pain", pt: "dor em comum", en: "pain", hintPt: "comece nomeando o que está incomodando o público (\"trabalha até tarde todo dia e ainda não consegue guardar dinheiro\")", hintEn: "name the viewer's pain first" },
  { id: "counter", pt: "contra o senso comum", en: "counter", hintPt: "derrube a crença geral (\"quanto mais você economiza, mais pobre fica\")", hintEn: "overturn common belief" },
  { id: "identity", pt: "identidade", en: "identity", hintPt: "chame o grupo pelo nome para a pessoa certa parar (\"se você também é pai ou mãe de primeira viagem\")", hintEn: "call out the audience by identity" },
  { id: "urgency", pt: "urgência real", en: "urgency", hintPt: "use só uma urgência que existe de verdade (mudança de regra, estação do ano, nova versão); é proibido inventar prazo ou usar \"último dia\"", hintEn: "real timeliness only (policy/season/version); never fabricate deadlines" },
];

/** Id do tipo de CTA (entra no clips.json e no prompt; é estável e não muda). */
export type CtaTypeId = "follow" | "comment" | "share" | "save" | "product";

interface CtaType {
  id: CtaTypeId;
  pt: string;
  en: string;
  hintPt: string;
  hintEn: string;
}

const CTA_TYPES: CtaType[] = [
  { id: "follow", pt: "seguir", en: "follow", hintPt: "dê o motivo para seguir e adiante o próximo (\"me segue, no próximo eu destrincho o ×××\")", hintEn: "give a reason to follow, tease the next video" },
  { id: "comment", pt: "comentar", en: "comment", hintPt: "termine com uma pergunta convidando o público a se posicionar ou completar (\"você é de qual time? conta nos comentários\")", hintEn: "end with a question inviting comments" },
  { id: "share", pt: "compartilhar", en: "share", hintPt: "diga para quem mandar (\"manda para aquele amigo que sempre faz ×××\")", hintEn: "name who to share it with" },
  { id: "save", pt: "salvar", en: "save", hintPt: "em conteúdo com muitos passos ou muita informação, peça para salvar primeiro (\"tem bastante detalhe, salva para ver com calma\"), e vale acrescentar \"tem mais conteúdo dessa transmissão na playlist do perfil\" — salvamento e playlist são as duas portas de maior peso em 2026", hintEn: "dense how-to content: suggest saving for later, optionally point to the profile playlist/collection" },
  { id: "product", pt: "produto", en: "product", hintPt: "use só quando o conteúdo é claramente de venda, e sempre pelos componentes da própria plataforma (sacola, link do produto); é proibido levar o público para fora da plataforma ou pedir contato em aplicativo de mensagem", hintEn: "only for clearly commercial clips, in-platform components only; never funnel off-platform" },
];

const ANGLE_IDS = new Set<string>(HOOK_ANGLES.map((a) => a.id));
const CTA_IDS = new Set<string>(CTA_TYPES.map((c) => c.id));

export function isHookAngle(v: unknown): v is HookAngleId {
  return typeof v === "string" && ANGLE_IDS.has(v);
}

export function isCtaType(v: unknown): v is CtaTypeId {
  return typeof v === "string" && CTA_IDS.has(v);
}

/** O menu de ângulos usado no prompt (uma linha por item, no formato "id = nome: como usar"). */
export function hookAngleMenu(pt: boolean): string {
  return HOOK_ANGLES.map((a) => (pt ? `${a.id} = ${a.pt}: ${a.hintPt}` : `${a.id} = ${a.hintEn}`)).join("\n");
}

/** O menu de CTA usado no prompt. */
export function ctaMenu(pt: boolean): string {
  return CTA_TYPES.map((c) => (pt ? `${c.id} = ${c.pt}: ${c.hintPt}` : `${c.id} = ${c.hintEn}`)).join("\n");
}

/** Id do ângulo → nome legível (para o comprovante e a interface); um id desconhecido volta como está. */
export function hookAngleLabel(id: string, pt: boolean): string {
  const a = HOOK_ANGLES.find((x) => x.id === id);
  return a ? (pt ? a.pt : a.en) : id;
}

/** Id do tipo de CTA → nome legível; um id desconhecido volta como está. */
export function ctaTypeLabel(id: string, pt: boolean): string {
  const c = CTA_TYPES.find((x) => x.id === id);
  return c ? (pt ? c.pt : c.en) : id;
}
