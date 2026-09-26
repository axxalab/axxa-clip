/**
 * Checagem de palavras de risco das plataformas (regras locais, sem nenhuma API):
 * cada clipe tem o seu "material de publicação" — título, gancho, texto de publicação
 * e texto da legenda — varrido em busca das palavras que dão risco nas plataformas, e
 * as ocorrências entram na verificação de qualidade do vídeo (o campo qa do
 * clips.json). O posicionamento é de "aviso de risco antes de publicar", não de
 * censura: a ideia é dizer a quem cria qual frase de qual clipe provavelmente vai
 * perder alcance ou ser recusada no TikTok, no Reels ou no Kwai, e a decisão final é
 * da pessoa.
 *
 * As regras se apoiam nas expressões absolutas vedadas pelo Código de Defesa do
 * Consumidor e pelo CONAR, nas linhas vermelhas de alegação médica e de eficácia, e
 * nas palavras de alta frequência que as normas públicas de comunidade das
 * plataformas listam (com prioridade para o cenário de venda). Tudo em funções puras
 * e testável; a tabela de regras é só dado, então acrescentar ou mudar uma palavra
 * não mexe na lógica.
 */

/** Origem da ocorrência: em qual material a palavra apareceu. */
export type LintSource = "title" | "hook" | "publish" | "caption";

/** Uma ocorrência de palavra de risco. */
export interface LintHit {
  /** A palavra como está no texto (o que a regra de fato encontrou). */
  term: string;
  /** Categoria de risco (legível, e entra direto no texto do aviso). */
  category: string;
  source: LintSource;
}

/** Um grupo de regras: as palavras de alta frequência de uma mesma categoria reunidas numa expressão regular (com busca global). */
interface LintRule {
  category: string;
  re: RegExp;
}

/**
 * Tabela de regras das palavras de risco das plataformas (com prioridade para as
 * palavras de maior risco em texto de venda). Atenção a não gerar falso positivo:
 * as regras usam sempre a expressão completa, e nunca um padrão curto como "melhor"
 * ou "primeiro" sozinho, que apareceria em qualquer fala do dia a dia.
 */
const LINT_RULES: LintRule[] = [
  {
    // Expressões absolutas: uma única ocorrência já basta para a plataforma recusar
    category: "expressão absoluta",
    re: /\b(?:o|a)\s+(?:melhor|maior|mais\s+barat[oa]|mais\s+eficaz|mais\s+avançad[oa]|mais\s+potente)\s+d[oa]\s+(?:mundo|brasil|mercado|internet)\b|\bmenor\s+pre[çc]o\s+d[ao]\s+(?:internet|brasil|mercado)\b|\bpre[çc]o\s+mais\s+baixo\s+d[ao]\s+(?:internet|brasil|mercado)\b|\bn[úu]mero\s*1\s+d[oa]\s+(?:brasil|mundo|mercado)\b|\b(?:o|a)\s+[úu]nic[oa]\s+d[oa]\s+(?:mercado|mundo|brasil)\b|\bl[íi]der\s+absolut[oa]\b|\bimbat[íi]vel\b|\binsuper[áa]vel\b|\bsem\s+igual\b|\b[úu]nico\s+no\s+mundo\b|\bcampe[ãa]o\s+de\s+vendas\s+d[ao]\s+(?:brasil|mundo)\b|\bmelhor\s+do\s+planeta\b/gi,
  },
  {
    // Alimento comum, cosmético ou produto de uso diário alegando efeito médico é linha vermelha em todas as plataformas
    category: "alegação médica",
    re: /\b(?:cura|curar|trata|tratar)\s+(?:a\s+)?(?:doen[çc]a|c[âa]ncer|depress[ãa]o|diabetes|ansiedade|press[ãa]o\s+alta|colesterol)\b|\bcura\s+definitiva\b|\banti-?inflamat[óo]ri[oa]\b|\bbactericida\b|\bantiviral\b|\bcombate\s+o\s+c[âa]ncer\b|\bprevine\s+(?:o\s+)?c[âa]ncer\b|\bbaixa\s+(?:a\s+)?(?:press[ãa]o|glicemia|gl[íi]cose)\b|\bdesintoxica\s+o\s+(?:corpo|f[íi]gado|organismo)\b|\bdetox\s+do\s+f[íi]gado\b|\bemagrece\s+\d+\s*(?:kg|quilos?)\b|\bqueima\s+(?:a\s+)?gordura\s+localizada\b|\bclareia\s+(?:as\s+)?manchas\b|\belimina\s+(?:as\s+)?rugas\b|\bfaz\s+(?:o\s+)?cabelo\s+crescer\b|\bcombate\s+(?:a\s+)?queda\s+de\s+cabelo\b|\baumenta\s+(?:a\s+)?imunidade\b|\bregula\s+(?:o\s+)?horm[ôo]nio\b|\bsem\s+efeitos?\s+colaterais\b|\bn[ãa]o\s+causa\s+depend[êe]ncia\b/gi,
  },
  {
    // Promessa que garante eficácia: devolução, indenização e prazo de resultado são
    // promessas verificáveis, e não cumpri-las é publicidade enganosa
    category: "promessa exagerada",
    re: /\b100\s*%\s*(?:eficaz|garantid[oa]|original|aprovad[oa])\b|\bcem\s+por\s+cento\s+(?:eficaz|garantid[oa])\b|\bresultado\s+garantido\b|\bsatisfa[çc][ãa]o\s+garantida\s+ou\s+(?:seu\s+)?dinheiro\s+de\s+volta\b|\bfunciona\s+em\s+(?:todos|qualquer\s+pessoa)\b|\bresultado\s+em\s+(?:3|tr[êe]s|7|sete)\s+dias\b|\bem\s+\d+\s+dias\s+garantido\b|\bnunca\s+mais\s+volta\b|\belimina\s+de\s+vez\b|\bacaba\s+de\s+uma\s+vez\s+por\s+todas\b|\bresolve\s+qualquer\s+(?:caso|problema)\b/gi,
  },
  {
    // Promessa de renda: a área de maior risco em finanças, renda extra e infoproduto
    category: "promessa de renda",
    re: /\blucro\s+garantido\b|\bganho\s+garantido\b|\brenda\s+garantida\b|\brenda\s+passiva\s+garantida\b|\bdinheiro\s+f[áa]cil\b|\bfique\s+ric[oa]\b|\benriquecer\s+(?:r[áa]pido|do\s+dia\s+para\s+a\s+noite)\b|\bganhe\s+(?:R\$\s*)?\d+[\d.,]*\s*(?:mil|reais)?\s*(?:por|ao|todo)\s+(?:m[êe]s|dia|semana)\b|\b(?:R\$\s*)?\d+[\d.,]*\s*mil\s*(?:por|ao)\s+m[êe]s\s+garantido\b|\bsem\s+risco\s+nenhum\b|\brisco\s+zero\b|\bganha\s+dormindo\b|\bliberdade\s+financeira\s+garantida\b|\bm[ée]todo\s+infal[íi]vel\b/gi,
  },
  {
    // Preço e escassez enganosos: urgência inventada e ancoragem falsa de preço
    category: "preço enganoso",
    re: /\bpre[çc]o\s+de\s+banana\b|\bmetade\s+do\s+pre[çc]o\s+de\s+f[áa]brica\b|\babaixo\s+do\s+custo\b|\bqueima\s+de\s+estoque\s+total\b|\bs[óo]\s+hoje\b|\b[úu]ltimo\s+dia\b|\b[úu]ltimas?\s+(?:horas|unidades)\s+mesmo\b|\bperdeu,?\s+n[ãa]o\s+volta\b|\bnunca\s+mais\s+vai\s+ter\s+esse\s+pre[çc]o\b|\bse\s+n[ãa]o\s+comprar\s+hoje\s+vai\s+esperar\s+um\s+ano\b|\bpromo[çc][ãa]o\s+rel[âa]mpago\s+que\s+nunca\s+volta\b/gi,
  },
  {
    // Desvio para fora da plataforma e indução: TikTok, Reels e Kwai reduzem alcance e
    // podem até derrubar a conta por causa dessas construções
    category: "desvio para fora da plataforma",
    re: /\bchama\s+(?:no|n[oa]s)\s+(?:whats(?:app)?|zap|dm|direct|privado|inbox)\b|\bme\s+chama\s+no\s+(?:whats(?:app)?|zap|direct|privado)\b|\bmeu\s+(?:whats(?:app)?|zap)\b|\bmanda\s+(?:um\s+)?(?:dm|direct|zap)\b|\blink\s+(?:na|da)\s+bio\s+para\s+comprar\b|\bcompra\s+pelo\s+link\s+d[ao]\s+(?:bio|descri[çc][ãa]o)\b|\bcomenta\s+(?:1|um|eu\s+quero)\s+que\s+eu\s+(?:te\s+)?mando\b|\bentra\s+no\s+(?:meu\s+)?grupo\s+d[oe]\s+(?:whats(?:app)?|telegram)\b|\bgrupo\s+vip\s+d[oe]\s+(?:whats(?:app)?|telegram)\b|\bpesquisa\s+na\s+(?:shopee|amazon|mercado\s+livre)\b/gi,
  },
  {
    // Aval de autoridade: certificação que não existe e recomendação impossível de comprovar
    category: "aval de autoridade",
    re: /\baprovado\s+pela\s+anvisa\b|\bregistrado\s+na\s+anvisa\s+como\s+medicamento\b|\brecomendado\s+pel[oa]\s+(?:minist[ée]rio\s+da\s+sa[úu]de|governo|anvisa)\b|\brecomendado\s+por\s+(?:m[ée]dicos|dentistas|nutricionistas)\b|\bm[ée]dicos\s+recomendam\b|\bcomprovado\s+cientificamente\s+que\s+cura\b|\bselo\s+do\s+governo\b|\bqualidade\s+militar\b|\bexclusivo\s+para\s+(?:for[çc]as\s+armadas|governo)\b|\bindicado\s+pela\s+(?:oms|organiza[çc][ãa]o\s+mundial\s+da\s+sa[úu]de)\b/gi,
  },
  {
    // Superstição e beira de aposta: venda de misticismo e o discurso de "ganho garantido"
    category: "superstição e aposta",
    re: /\bamarra[çc][ãa]o\s+amorosa\b|\btrabalho\s+(?:espiritual\s+)?garantido\b|\babre\s+(?:os\s+)?caminhos\s+garantido\b|\bafasta\s+(?:o\s+)?mau\s+olhado\b|\bsimpatia\s+infal[íi]vel\b|\bmuda\s+(?:a\s+)?sua\s+sorte\b|\bjogo\s+do\s+tigrinho\b|\bpadr[ãa]o\s+(?:certeiro|garantido)\s+(?:no|para)\s+(?:jogo|aposta)\b|\bhor[áa]rio\s+pagante\b|\bsinal\s+(?:certeiro|garantido)\b|\baposta\s+sem\s+perder\b|\bganho\s+certo\s+na\s+aposta\b/gi,
  },
];

/** Varre um texto e devolve as ocorrências sem repetição (a mesma palavra aparecendo várias vezes é reportada uma só). */
export function lintText(text: string): Array<{ term: string; category: string }> {
  const out: Array<{ term: string; category: string }> = [];
  if (!text) return out;
  const seen = new Set<string>();
  for (const rule of LINT_RULES) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      const term = m[0];
      const key = term.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ term, category: rule.category });
      }
      // Protege a expressão global contra laço infinito por correspondência vazia
      // (nenhuma regra é vazia, então isto é só defesa)
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }
  return out;
}

/** O material de um clipe a ser varrido (tudo é opcional; o que falta é pulado). */
export interface ClipLintInput {
  title?: string;
  /** O gancho mais a frase de suspense (as letras grandes da abertura e o material do texto, varridos juntos). */
  hook?: string;
  publish?: { title: string; hashtags: string[]; description: string; cta?: string } | null;
  /** O texto da legenda (o text de cada palavra concatenado direto; a junção precisa ser sem emenda para que uma ocorrência que atravessa palavras seja encontrada). */
  captionText?: string;
}

/**
 * Varre todo o material de publicação de um clipe → a lista de ocorrências. A mesma
 * palavra é reportada uma vez em cada material (um "menor preço da internet" no
 * título e outro na legenda precisam ser corrigidos separadamente), e dentro de um
 * mesmo material as repetições são removidas.
 */
export function lintClipContent(input: ClipLintInput): LintHit[] {
  const sources: Array<[LintSource, string | undefined]> = [
    ["title", input.title],
    ["hook", input.hook],
    [
      "publish",
      input.publish
        ? [input.publish.title, input.publish.hashtags.join(" "), input.publish.description, input.publish.cta ?? ""].join("\n")
        : undefined,
    ],
    ["caption", input.captionText],
  ];
  const hits: LintHit[] = [];
  for (const [source, text] of sources) {
    if (!text) continue;
    for (const h of lintText(text)) hits.push({ ...h, source });
  }
  return hits;
}

const SOURCE_LABEL: Record<LintSource, string> = {
  title: "título",
  hook: "gancho",
  publish: "texto de publicação",
  caption: "legenda",
};

/** Quantas palavras, no máximo, são citadas no texto do aviso (as demais entram como "e mais N"; a lista completa está em contentHits). */
const ISSUE_MAX_TERMS = 5;

/** Lista de ocorrências → um aviso legível; sem ocorrências, devolve null. */
export function formatLintIssue(hits: LintHit[]): string | null {
  if (hits.length === 0) return null;
  const shown = hits
    .slice(0, ISSUE_MAX_TERMS)
    .map((h) => `"${h.term}" (${h.category} · ${SOURCE_LABEL[h.source]})`)
    .join(", ");
  const more = hits.length > ISSUE_MAX_TERMS ? `, em ${hits.length} ocorrências no total` : "";
  return `O material de publicação tem palavras de risco nas plataformas: ${shown}${more} (confira as regras de cada plataforma antes de publicar)`;
}
