/**
 * Tabela de especificações de publicação por plataforma: proporção da capa e
 * limites de título, hashtags e descrição de cada uma.
 * O "pacote por plataforma" usa esta tabela para adaptar o mesmo lote de vídeos
 * em conjuntos prontos para subir em cada lugar — o RedNote quer capa 3:4, o
 * Bilibili quer capa em formato horizontal, no Douyin os primeiros 55
 * caracteres decidem o que aparece na listagem… Essas regras ficam espalhadas
 * pelos painéis de criador de cada plataforma, e quem faz cortes precisa
 * procurá-las toda vez; aqui elas são escritas uma vez e reaproveitadas em
 * todo lugar.
 *
 * O id acompanha o id de plataforma de safe-zones.ts (a plataforma escolhida na
 * máscara da bancada de revisão é a mesma que aparece no pacote de publicação).
 * Os limites são conservadores de propósito: o que estiver marcado como
 * "recomendado" é consenso de quem publica, não um limite rígido da plataforma.
 * Só dados e funções puras, compartilhados entre o renderer e o core.
 */

export interface PlatformSpec {
  /** Id da plataforma (acompanha safe-zones.ts, entra no manifest e no armazenamento de preferências; é estável e não muda). */
  id: string;
  name: { pt: string; en: string };
  /** Pixels de exportação da capa (largura × altura), na proporção recomendada pela plataforma. */
  cover: { w: number; h: number };
  /** Limite de caracteres do título de publicação (o que passar é cortado e marcado no manifest). */
  titleMax: number;
  /** Limite de hashtags (regra da plataforma ou recomendação de quem publica). */
  tagsMax: number;
  /** Observação (vai para o manifest, lembrando as particularidades da plataforma na hora de publicar). */
  notePt: string;
  /** Instrução de como sinalizar conteúdo gerado por IA (entra no texto de publicação e no manifest quando o selo de IA está ligado; pelas regras de julho de 2026, três infrações derrubam a conta). */
  aigcNotePt: string;
}

// Base das proporções de capa (conferido em agosto de 2026): Douyin, Kuaishou,
// TikTok e Reels em vertical 9:16; a primeira imagem do RedNote recomenda 3:4
// (1080×1440); a capa de vídeo do Bilibili recomenda 16:10; o cartão do feed do
// WeChat Channels fica em torno de 6:7; o Shorts usa a miniatura do YouTube, em
// 16:9 (1280×720).
export const PLATFORM_SPECS: PlatformSpec[] = [
  {
    id: "douyin",
    name: { pt: "Douyin", en: "Douyin" },
    cover: { w: 1080, h: 1920 },
    // Título e descrição dividem o mesmo campo: os primeiros 55 caracteres
    // decidem o que aparece na listagem e na busca, e é aí que fica o corte
    titleMax: 55,
    tagsMax: 5, // Recomendação: hashtag demais dilui o alcance
    notePt: "Título e descrição no mesmo campo; os primeiros 55 caracteres decidem o que aparece na listagem; recomendam-se no máximo 5 hashtags",
    aigcNotePt: "Marque a declaração \"conteúdo gerado por IA\" ao publicar; a plataforma exige sinalização visível nos 5 primeiros segundos (o selo no canto superior esquerdo já vem queimado no vídeo)",
  },
  {
    id: "kuaishou",
    name: { pt: "Kuaishou", en: "Kuaishou" },
    cover: { w: 1080, h: 1920 },
    titleMax: 50,
    tagsMax: 4, // Recomendação
    notePt: "A área de descrição mostra poucas linhas: coloque o gancho logo no começo; recomendam-se no máximo 4 hashtags",
    aigcNotePt: "Marque a declaração de conteúdo gerado por IA ao publicar (a plataforma exige, e três infrações derrubam a conta)",
  },
  {
    id: "bilibili",
    name: { pt: "Bilibili", en: "Bilibili" },
    cover: { w: 1146, h: 717 }, // 16:10, o recomendado oficialmente
    titleMax: 80,
    tagsMax: 10, // Limite rígido da plataforma
    notePt: "Capa horizontal 16:10; o vídeo vertical pode ir como story, e a versão horizontal fica na pasta \"horizontal/\"; limite de 10 etiquetas",
    aigcNotePt: "Marque a declaração \"contém conteúdo gerado por IA\" ao enviar",
  },
  {
    id: "channels",
    name: { pt: "WeChat Channels", en: "WeChat Channels" },
    cover: { w: 1080, h: 1260 }, // O cartão do feed fica em torno de 6:7
    titleMax: 60,
    tagsMax: 3, // Recomendação: hashtag demais atrapalha a leitura
    notePt: "O cartão do feed fica em torno de 6:7, então deixe o assunto principal no centro da capa; as hashtags usam o formato #tema# e recomendam-se no máximo 3",
    aigcNotePt: "Declare \"o conteúdo contém material gerado por IA\" ao publicar",
  },
  {
    id: "xiaohongshu",
    name: { pt: "RedNote", en: "RedNote" },
    cover: { w: 1080, h: 1440 }, // A primeira imagem recomenda 3:4
    titleMax: 20, // Limite rígido da plataforma: 20 caracteres no título da publicação
    tagsMax: 10, // Recomendação
    notePt: "O título da publicação tem limite rígido de 20 caracteres; a primeira imagem é 3:4; a taxa de cliques de capa mais título é o que mais pesa",
    aigcNotePt: "Marque a sinalização de conteúdo gerado por IA ao publicar; a plataforma exige um mínimo de conteúdo com pessoas reais para recomendar, e conteúdo puramente de IA em massa perde alcance",
  },
  {
    id: "tiktok",
    name: { pt: "TikTok", en: "TikTok" },
    cover: { w: 1080, h: 1920 },
    titleMax: 90, // A legenda vai até 2200, mas a listagem corta por volta de 90 caracteres
    tagsMax: 5, // Recomendação
    notePt: "A legenda vai até 2200 caracteres, mas a exibição corta por volta de 90; recomendam-se de 3 a 5 hashtags",
    aigcNotePt: "Ative a etiqueta \"AI-generated content\"",
  },
  {
    id: "shorts",
    name: { pt: "YouTube Shorts", en: "YouTube Shorts" },
    cover: { w: 1280, h: 720 }, // Miniatura do YouTube, 16:9
    titleMax: 100, // Limite rígido da plataforma
    tagsMax: 3, // Recomendação de hashtags dentro do título
    notePt: "Título com limite de 100 caracteres; recomendam-se no máximo 3 hashtags dentro dele",
    aigcNotePt: "Ative a declaração de conteúdo sintético (Altered content) no YouTube Studio; a etiqueta é só um sinal de transparência e não reduz o alcance",
  },
  {
    id: "reels",
    name: { pt: "Instagram Reels", en: "Instagram Reels" },
    cover: { w: 1080, h: 1920 },
    titleMax: 90, // A legenda vai até 2200, e a listagem corta
    tagsMax: 5, // Recomendação
    notePt: "A legenda vai até 2200 caracteres; na grade, só a área central 4:5 da capa fica visível, então deixe o assunto principal no meio",
    aigcNotePt: "Ative a etiqueta \"Made with AI\"",
  },
];

const SPEC_BY_ID = new Map(PLATFORM_SPECS.map((p) => [p.id, p]));

/** Busca a especificação pelo id; um id desconhecido devolve undefined (quem chamou filtra, sem adivinhar). */
export function platformSpec(id: string): PlatformSpec | undefined {
  return SPEC_BY_ID.get(id);
}

/** Filtra os ids de plataforma válidos (sem repetição, mantendo a ordem recebida). */
export function validPlatformIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (SPEC_BY_ID.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
