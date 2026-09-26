/**
 * Presets de gênero de transmissão: o que conta como destaque muda radicalmente de
 * um gênero para outro, então "o que é um destaque" é uma configuração selecionável
 * e editável, em vez de ficar fixa dentro do prompt.
 *
 * **A lista de gêneros vem das categorias reais das plataformas, e não de chute**:
 *  - o `api.live.bilibili.com/room/v1/Area/getList` do Bilibili Live (consultado em
 *    agosto de 2026) tem 11 categorias de primeiro nível: jogos online, jogos de
 *    celular, jogos single-player, entretenimento, rádio, VTuber, sala de bate-papo,
 *    estilo de vida, conhecimento, esports, interação e compras; entre as
 *    subcategorias estão dança, canto, beleza, transmissão em grupo, stand-up, rua,
 *    pets, comida, artesanato e desenho, esporte, sala de estudos, conteúdo de
 *    companhia e experiências de ambiente
 *  - categorias de live do Douyin (fontes públicas): beleza, moda, maternidade,
 *    comida, casa, música, dança, viagem, pets, educação, tecnologia, carros, saúde,
 *    dramaturgia, cinema e TV, jogos, esporte, treino, divulgação científica,
 *    finanças, agricultura…
 *  - Douyu: jogos, rua, beleza, assistir junto, tecnologia
 * Tudo isso foi reunido nos presets abaixo — e é por isso que "VTuber", "rádio",
 * "pets", "comida", "esports" e "artesanato" não ficam de fora só porque ninguém
 * pensou neles.
 *
 * Mais importante ainda, **os pesos de evidência se invertem entre os gêneros**: em
 * venda e em conhecimento o destaque está nas palavras, e ler a transcrição já basta;
 * em jogos e na rua ele está no tom de voz e na reação do público (grito, risada,
 * enxurrada de chat), onde a transcrição costuma ser só um "caraca"; em dança e em
 * pets é ainda mais extremo — a transcrição é praticamente vazia e tudo depende da
 * imagem, da música e do chat. Por isso, além dos critérios, cada preset também
 * declara em que evidência deve confiar (`evidence`), e as classes reaction e visual
 * rodam, além do resto, o canal de sinais de highlight/moments.ts.
 *
 * A pessoa pode editar o texto dos critérios diretamente (custom): os presets
 * internos são um ponto de partida, não um teto. São funções puras, testáveis.
 */

/**
 * Id do preset. Reunido a partir das categorias de primeiro nível das plataformas;
 * ainda não é exaustivo (as plataformas acrescentam subcategorias todo mês). As
 * reservas de verdade são o parágrafo do prompt genérico que diz "descubra primeiro
 * que tipo de conteúdo é este e só então decida em que evidência confiar", o
 * tratamento adaptativo da proporção de fala, e o custom.
 */
export type GenreId =
  | "auto"
  | "shopping"
  | "game"
  | "esports"
  | "vtuber"
  | "show"
  | "looks"
  | "talk"
  | "radio"
  | "knowledge"
  | "outdoor"
  | "food"
  | "pet"
  | "sports"
  | "craft"
  | "cowatch"
  | "interview"
  | "custom";

/**
 * Qual evidência carrega os destaques deste gênero — é isso que decide se o canal
 * de candidatos guiado por sinal roda ou não:
 *  - words: a substância está na fala (venda, conhecimento, entrevista), a
 *    transcrição já basta, então o canal de texto original é usado
 *  - reaction: depende da reação ao vivo (jogos, rua, bate-papo, rádio); o texto de
 *    um momento de pico é, com frequência, só um "não acredito"
 *  - visual: depende da imagem (dança, canto, pets, comida, artesanato); a
 *    transcrição é praticamente vazia
 * As classes reaction e visual PRECISAM rodar também o canal de sinais de
 * highlight/moments.ts — do contrário, "não existe fala para citar" significa que
 * nenhum candidato sai, nunca.
 */
export type EvidenceClass = "words" | "reaction" | "visual";

export interface GenrePreset {
  id: GenreId;
  labelPt: string;
  labelEn: string;
  /** Bloco de critérios injetado no system prompt; vazio no auto (valem os critérios genéricos). */
  criteriaPt: string;
  criteriaEn: string;
  /** O caminho de evidência principal; auto e custom se adaptam ao material (veja moments.shouldRunMoments). */
  evidence: EvidenceClass;
}

/** Presets internos. Os critérios do custom são escritos pela pessoa, e aqui só existe um espaço reservado. */
export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: "auto",
    labelPt: "Geral (sem gênero definido)",
    labelEn: "General",
    criteriaPt: "",
    criteriaEn: "",
    evidence: "words",
  },
  {
    id: "shopping",
    labelPt: "Venda ao vivo / compras",
    labelEn: "Live selling / shopping",
    criteriaPt:
      "Esta é uma transmissão de venda ao vivo (live commerce). Prioridade dos destaques: (1) o produto se comportando de um jeito inesperado ou a demonstração dando errado ao vivo (ver para crer, é o mais explosivo) " +
      "(2) o instante em que o preço é revelado (o ponto de chegada do \"de X por só Y hoje\") (3) as respostas quando a pessoa é pressionada sobre composição, pós-venda ou autenticidade " +
      "(4) provas e comparações genuínas (5) conselhos de compra que contrariam o senso comum. " +
      "Peso das evidências: vá pelo que é dito; tom empolgado conta pouco aqui — quem apresenta live commerce fica eufórico o tempo todo, e isso não marca um destaque. " +
      "A frase da dor, a demonstração e a revelação do preço do mesmo produto costumam estar bem distantes entre si: quando dois ou três desses momentos existirem, prefira costurar com parts na ordem dor → demonstração → preço (nunca force quando faltar algum). " +
      "Nunca escolha: enrolação para gerar engajamento (\"chega a X mil curtidas e eu libero o link\", que as plataformas punem com queda de alcance), repetição mecânica do script de preço ou conversa de encheção de linguiça esperando gente chegar.",
    criteriaEn:
      "Live-selling stream. Priority: (1) a product behaving unexpectedly or a demo going wrong (most explosive), " +
      "(2) the moment the price lands, (3) answers when pressed on ingredients/returns/authenticity, " +
      "(4) genuine try-ons and comparisons, (5) counterintuitive buying advice. " +
      "Evidence weighting: go by what is said; excited tone means little here — these hosts are loud the whole way through. " +
      "The pain-point line, the live demo and the price reveal for one product usually sit far apart — when two or three beats exist, prefer a parts stitch in pain→demo→price order (never force it when they don't). " +
      "Never pick: engagement-baiting stalls, looping price scripts, or idle filler chat.",
    evidence: "words",
  },
  {
    id: "game",
    labelPt: "Jogos (PC / celular / console)",
    labelEn: "Gaming",
    criteriaPt:
      "Esta é uma transmissão de jogos. Prioridade dos destaques: (1) jogadas no limite, viradas de mesa e demonstrações de habilidade " +
      "(2) tomar wipe, perder a base, as tragédias e as crises de nervos (3) atrito com o time ou com os adversários, discussões no microfone (4) as reações mais escandalosas e as tiradas de quem transmite (5) momentos de sorte absurda. " +
      "Peso das evidências: **neste gênero não olhe só a transcrição** — o texto de um momento incrível costuma ser só \"caraca/vixe/acabou\", sem nenhuma informação. " +
      "Apoie-se nos trechos de tom exaltado (gritos/berros/gargalhadas) e nos picos do chat ao vivo, que é onde a jogada acontece; use a transcrição para confirmar o que rolou ali. " +
      "O trecho escolhido precisa conter \"a tensão antes da jogada + a jogada + a reação\"; só o resultado, sem o processo, não funciona.",
    criteriaEn:
      "Gaming stream (PC / mobile / console). Priority: (1) clutch plays and comebacks, (2) wipes and disasters, " +
      "(3) friction with teammates or opponents, (4) the host's biggest reactions and one-liners, (5) absurd luck. " +
      "Evidence weighting: **do not go by the transcript alone** — the text at a peak is often just \"holy—\". " +
      "Lean on vocal-emotion peaks and live-chat spikes to locate the play. " +
      "Include the build-up, the moment itself, and the reaction — the payoff alone doesn't play.",
    evidence: "reaction",
  },
  {
    id: "esports",
    labelPt: "Esports / narração de partidas",
    labelEn: "Esports / match commentary",
    criteriaPt:
      "Esta é uma transmissão ou narração de partida. Prioridade dos destaques: (1) a jogada coletiva, o gol ou o lance decisivo que define o resultado (2) a narração explodindo de emoção " +
      "(3) decisões polêmicas de arbitragem e episódios fora de campo (4) jogadas individuais de brilho (5) as frases marcantes da entrevista pós-jogo. " +
      "Peso das evidências: os picos de voz da narração e do chat praticamente acompanham o placar — confie mais neles do que na transcrição, " +
      "que erra muito na velocidade da narração e nos nomes próprios. Não trate erro de transcrição como conteúdo. " +
      "O trecho precisa sempre conter \"a construção da jogada → o lance → a reação da narração\"; só a imagem do gol, sem a voz, não se sustenta.",
    criteriaEn:
      "Esports / match broadcast. Priority: (1) the decisive teamfight or goal, (2) the caster losing it, " +
      "(3) controversial calls, (4) individual highlight plays, (5) post-match quotables. " +
      "Evidence weighting: caster vocal peaks and chat spikes track the scoreline — trust them over the transcript, " +
      "which is error-prone at commentary speed. Always include setup → moment → reaction.",
    evidence: "reaction",
  },
  {
    id: "vtuber",
    labelPt: "VTuber / apresentador virtual",
    labelEn: "VTuber",
    criteriaPt:
      "Esta é uma transmissão de VTuber. **Atenção: a expressão facial e os gestos vêm de um modelo 3D, então o sinal de emoção facial é praticamente inútil aqui** — não conte com ele. " +
      "Prioridade dos destaques: (1) a pessoa por trás do avatar saindo do personagem, rindo sem conseguir parar ou falando o que não devia (o contraste é o mais forte) " +
      "(2) as cenas antológicas de interpretação e as palhaçadas (3) os trechos de canto, especialmente o refrão " +
      "(4) as interações marcantes com o público ou com colegas (5) falhas do modelo ou acidentes técnicos (o público adora). " +
      "Peso das evidências: a variação de tom de voz e os picos do chat são a evidência principal (o chat é extremamente ativo neste gênero, funcionando quase como uma nota em tempo real); " +
      "a energia da imagem só ajuda nos trechos de canto e de palhaçada. Sempre inclua a preparação da piada junto com ela.",
    criteriaEn:
      "VTuber stream. **Facial-emotion signals are meaningless here — the face is a rigged model.** " +
      "Priority: (1) the person behind the avatar breaking character or corpsing, (2) memorable bits and roleplay, " +
      "(3) song segments, (4) standout interactions, (5) rigging/technical mishaps (audiences love these). " +
      "Evidence weighting: vocal tone and chat spikes dominate — chat is exceptionally active in this category. " +
      "Always include a joke's setup.",
    evidence: "reaction",
  },
  {
    id: "show",
    labelPt: "Talento / dança / canto / grupo",
    labelEn: "Performance / dance / singing",
    criteriaPt:
      "Esta é uma transmissão de apresentação artística (dança, canto, performance em grupo). " +
      "**Atenção: a transcrição deste tipo de live praticamente não tem informação** (são quase só cumprimentos soltos e conversa fiada). " +
      "Não escolha um momento só porque a frase \"lê bem\" — não é isso que o público está assistindo. " +
      "Prioridade dos destaques: (1) o trecho mais marcante da apresentação (o refrão, o movimento difícil, as batidas em que todo mundo acerta junto) " +
      "(2) as melhores reações e interações durante a apresentação (3) uma abertura ou um encerramento com imagem forte. " +
      "Peso das evidências: janelas de alta energia visual, o andamento da música e os picos do chat; use a transcrição apenas para evitar os trechos de conversa solta. " +
      "Corte nos limites naturais da música (entre na introdução, mantenha o refrão inteiro, não corte no meio de um tempo); imagem completa importa mais do que frase terminada.",
    criteriaEn:
      "Performance / dance / singing stream. **The transcript is essentially empty of value here** — " +
      "never pick a moment just because a line reads well. " +
      "Priority: (1) the most memorable passage (the chorus, the hard move, the tightly-hit beats), " +
      "(2) standout reactions during the performance, (3) a strong opening or closing image. " +
      "Evidence weighting: visual-energy windows, musical phrasing and chat spikes. " +
      "Cut on musical phrase boundaries — visual completeness beats finishing a sentence.",
    evidence: "visual",
  },
  {
    id: "looks",
    labelPt: "Bate-papo social / convidados ao vivo",
    labelEn: "Just chatting / social",
    criteriaPt:
      "Esta é uma transmissão social, de conversa com convidados entrando ao vivo. " +
      "Prioridade dos destaques: (1) um convidado dizendo algo inesperado ou se enrolando (2) as respostas afiadas de quem apresenta e as cenas antológicas " +
      "(3) um momento de sinceridade súbita ou de seriedade repentina (4) pegadinhas e contrastes (5) as melhores interações (agradecimento por presente, um número artístico no meio). " +
      "Peso das evidências: variação de tom e picos do chat. Boa parte deste formato é cumprimento sem conteúdo e agradecimento por presente — **seja rigoroso por padrão**: " +
      "é melhor não devolver nenhum clipe do que cortar um \"obrigado pelo presente\".",
    criteriaEn:
      "Just-chatting / social / co-host stream. Priority: (1) a guest saying something unexpected, " +
      "(2) the host's quick comebacks, (3) sudden sincerity, (4) pranks and reversals, (5) standout interactions. " +
      "Evidence weighting: vocal tone and chat spikes. Most of this format is contentless greeting and gift-thanking — " +
      "**be strict by default**; returning nothing beats clipping \"thanks for the gift\".",
    evidence: "reaction",
  },
  {
    id: "talk",
    labelPt: "Conversa / comentário / stand-up",
    labelEn: "Talk / commentary",
    criteriaPt:
      "Esta é uma transmissão de conversa e comentário (papo aberto, desabafo, stand-up). " +
      "Prioridade dos destaques: (1) declarações polêmicas ou fora da curva (contradizer a si mesmo e dois pesos e duas medidas são o mais explosivo) " +
      "(2) sequências densas de piadas e tiradas (sempre com a preparação junto) (3) momentos de sinceridade, de seriedade repentina " +
      "(4) interações antológicas com o público (5) reviravoltas na própria persona. " +
      "Peso das evidências: o tom e a reação do ambiente pesam tanto quanto as palavras; os picos do chat são o público votando em tempo real e valem muito como evidência.",
    criteriaEn:
      "Talk / commentary stream. Priority: (1) controversial or off-the-cuff statements (self-contradiction is strongest), " +
      "(2) dense jokes and bits (always with the setup), (3) moments of sudden sincerity, " +
      "(4) memorable audience exchanges, (5) reversals of persona. " +
      "Evidence weighting: tone and room reaction matter as much as the words; chat spikes are the audience voting live.",
    evidence: "reaction",
  },
  {
    id: "radio",
    labelPt: "Rádio / somente áudio",
    labelEn: "Radio / audio-only",
    criteriaPt:
      "Esta é uma transmissão de rádio, só com áudio — **não há imagem disponível**: " +
      "o vídeo final sai como onda sonora ou capa, então nenhuma evidência visual existe aqui; não procure por ela. " +
      "Prioridade dos destaques: (1) o refrão de uma música (2) o trecho de fala com maior carga emocional (3) a melhor interação com quem ouve (4) as frases marcantes. " +
      "Peso das evidências: variação de tom, riso/aplauso e picos do chat são tudo o que você tem. " +
      "O trecho precisa ser completo do ponto de vista auditivo — sem imagem para segurar a onda, uma frase cortada no meio é especialmente ruim neste gênero.",
    criteriaEn:
      "Radio / audio-only stream. **There is no picture** — output is a waveform or cover art, so visual evidence does not exist. " +
      "Priority: (1) the chorus of a song, (2) the most emotionally dense stretch of talk, (3) standout listener interaction, (4) quotables. " +
      "Evidence weighting: vocal tone, laughter/applause and chat spikes are all you have. " +
      "Clips must be aurally complete — with no picture to carry it, a cut-off sentence is unforgivable here.",
    evidence: "reaction",
  },
  {
    id: "knowledge",
    labelPt: "Conhecimento / educação / divulgação / finanças",
    labelEn: "Knowledge / education",
    criteriaPt:
      "Esta é uma transmissão de conteúdo de conhecimento (ensino, ciência e tecnologia, economia, direito, psicologia, história). " +
      "Prioridade dos destaques: (1) métodos e conclusões que se sustentam sozinhos (com passos, listas, números concretos) (2) afirmações que derrubam o senso comum " +
      "(3) a frase que resolve o assunto de uma vez (4) casos reais e dados (5) a correção de um erro comum, feita ali na hora. " +
      "Peso das evidências: julgue quase inteiramente pelo conteúdo; os sinais de tom valem pouco aqui. " +
      "**O objetivo deste gênero é \"dar vontade de salvar\", não \"dar risada\"** — as plataformas hoje dão o maior peso ao salvamento. " +
      "Por isso o trecho precisa ser autossuficiente em informação: a conclusão, o embasamento e o que fazer na prática precisam estar todos dentro dele, nunca pela metade.",
    criteriaEn:
      "Knowledge / education stream. Priority: (1) self-contained methods and conclusions (steps, checklists, numbers), " +
      "(2) claims that overturn conventional wisdom, (3) one-line summaries that nail it, (4) real cases and data, " +
      "(5) correcting a common mistake. " +
      "Evidence weighting: judge almost entirely on content; tone signals carry little here. " +
      "**Optimize for saves, not laughs.** The clip must be informationally complete.",
    evidence: "words",
  },
  {
    id: "outdoor",
    labelPt: "Rua / viagem / visita a lugares",
    labelEn: "Outdoor / travel / on-location",
    criteriaPt:
      "Esta é uma transmissão externa, na rua ou em viagem. Prioridade dos destaques: (1) imprevistos e situações inesperadas (encontrar alguém, ser barrado, o tempo virar, algo quebrar) " +
      "(2) interações e conversas genuínas com desconhecidos (3) a reação imediata ao ver alguma coisa pela primeira vez (4) a verdade nua e crua sobre valer ou não a pena (5) imagens fortes (paisagem, cena, curiosidade). " +
      "Peso das evidências: é um gênero de reação — o tom e a mudança de imagem são mais confiáveis que a transcrição; **a captação de áudio na rua é ruim e a transcrição erra muito**. " +
      "Não se deixe levar por erros de transcrição: frase que não faz sentido deve ser tratada como ruído, não como conteúdo. " +
      "Inclua um pedacinho do \"antes de ver\": o público precisa descobrir junto para se sentir dentro da cena.",
    criteriaEn:
      "Outdoor / travel / on-location stream. Priority: (1) things going wrong or unexpected encounters, " +
      "(2) genuine interactions with strangers, (3) the instant reaction on first seeing something, " +
      "(4) blunt verdicts on whether a place is worth it, (5) strong imagery. " +
      "Evidence weighting: reaction-driven — tone and visual change beat the transcript; **outdoor audio is poor**, " +
      "so treat garbled lines as noise rather than content. Include a beat of lead-in before the reveal.",
    evidence: "reaction",
  },
  {
    id: "food",
    labelPt: "Culinária / comer ao vivo",
    labelEn: "Food / mukbang",
    criteriaPt:
      "Esta é uma transmissão de comida. **O poder de convencimento aqui está na imagem e no som, não na narração.** " +
      "Prioridade dos destaques: (1) a mordida mais apetitosa (o queijo puxando, o caldo escorrendo, o som da crocância) (2) as ações que dão gosto de assistir, como o preparo e o salteado na frigideira " +
      "(3) a reação genuína a algo inesperadamente apimentado, horrível ou excelente (4) uma informação surpreendente sobre o ingrediente ou o preço. " +
      "Peso das evidências: primeiro a energia visual e os picos de som de mastigação/cozimento, depois o chat; " +
      "a transcrição é quase toda \"hmm, que delícia\", sem informação alguma — nunca trate isso como frase marcante. " +
      "O trecho precisa conter uma ação completa (da panela ao prato, do garfo à boca); cortar no meio é o que mais estraga o apetite.",
    criteriaEn:
      "Food / mukbang stream. **The persuasion is in the picture and the sound, not the narration.** " +
      "Priority: (1) the most appetizing bite (cheese pull, juice, crunch), (2) watchable prep or wok work, " +
      "(3) a genuine reaction to something unexpectedly spicy/awful/great, (4) surprising facts about the ingredient or price. " +
      "Evidence weighting: visual energy and chewing/cooking sound peaks first, chat second; " +
      "the transcript is mostly \"mm, tasty\" — never treat that as a quotable. Always contain one complete action.",
    evidence: "visual",
  },
  {
    id: "pet",
    labelPt: "Pets / bichinhos",
    labelEn: "Pets",
    criteriaPt:
      "Esta é uma transmissão de pets. **O protagonista não fala — a transcrição não serve de critério aqui, de jeito nenhum.** " +
      "Prioridade dos destaques: (1) o instante em que o animal faz algo inesperado ou muito humano (2) as interações antológicas (pedir comida, destruir a casa, passar a perna no dono) " +
      "(3) as imagens paradas de fofura máxima (jeito de dormir, bravura fingida) (4) a reação do dono ao ser passado para trás. " +
      "Peso das evidências: a energia visual e os picos do chat são praticamente a única evidência; a variação de tom do dono ajuda a localizar \"o que acabou de acontecer\". " +
      "Os trechos devem ser curtos e compreensíveis de imediato — o animal precisa estar em tela no primeiro segundo.",
    criteriaEn:
      "Pet stream. **The subject cannot talk — the transcript is not evidence here at all.** " +
      "Priority: (1) the instant the animal does something unexpected or human-like, (2) memorable interactions, " +
      "(3) peak-cuteness stills, (4) the owner's reaction to being outsmarted. " +
      "Evidence weighting: visual energy and chat spikes are effectively the only evidence; the owner's tone helps locate the beat. " +
      "Keep clips short and instantly legible — the animal must be on screen within the first second.",
    evidence: "visual",
  },
  {
    id: "sports",
    labelPt: "Esporte / treino",
    labelEn: "Sports / fitness",
    criteriaPt:
      "Esta é uma transmissão de esporte ou treino. Prioridade dos destaques: (1) o instante em que um movimento difícil sai ou um recorde pessoal cai " +
      "(2) a falha, a lesão ou o acidente (o público também gosta, mas nunca explore uma lesão real) (3) um ponto técnico explicado em uma frase (4) a comparação de antes e depois, de postura ou de resultado. " +
      "Peso das evidências: energia visual e explosões de voz pesam juntas, com o chat como confirmação; " +
      "durante a execução a transcrição é só ofego e contagem, sem informação. " +
      "Os trechos didáticos precisam ser autossuficientes (o que fazer, o que trabalha, onde está o erro); só gritar \"mais cinco\" não vira clipe.",
    criteriaEn:
      "Sports / fitness stream. Priority: (1) landing a hard move or hitting a PR, (2) a failure or mishap " +
      "(popular, but never exploit a real injury), (3) a coaching point stated in one line, (4) before/after comparisons. " +
      "Evidence weighting: visual energy and vocal bursts together, chat as corroboration; " +
      "the transcript during a set is just breathing and counting. Coaching clips must be self-contained.",
    evidence: "reaction",
  },
  {
    id: "craft",
    labelPt: "Artesanato / desenho / ambiente",
    labelEn: "Crafts / drawing / ambient",
    criteriaPt:
      "Esta é uma transmissão de artesanato, desenho ou conteúdo de ambiente. " +
      "**Este formato é lentíssimo e, na maior parte do tempo, não vale corte** — seja rigoroso por padrão. " +
      "Prioridade dos destaques: (1) o passo que transforma tudo (a primeira cor, a revelação do resultado) (2) o erro e o conserto " +
      "(3) um trecho que funciona acelerado (4) uma explicação de técnica de verdade. " +
      "Peso das evidências: primeiro a mudança visual (a revelação é a maior diferença entre um quadro e outro), depois o chat; a narração é dispensável. " +
      "Escolha os momentos de maior mudança, não os longos trechos de trabalho constante.",
    criteriaEn:
      "Crafts / drawing / ambient stream. **This format is slow and mostly not clippable** — be strict by default. " +
      "Priority: (1) the key transformation step (first colour, the reveal), (2) a mistake and the save, " +
      "(3) a stretch that works sped up, (4) an actual technique explanation. " +
      "Evidence weighting: visual change first (the reveal is the biggest frame-to-frame delta), chat second. " +
      "Pick the moments of greatest change, not the long stretches of steady work.",
    evidence: "visual",
  },
  {
    id: "cowatch",
    labelPt: "Assistir junto / estudar junto",
    labelEn: "Co-watching / study-with-me",
    criteriaPt:
      "Esta é uma transmissão de companhia (assistir junto, estudar junto). " +
      "**⚠ Duas restrições rígidas, mais importantes do que escolher bem:** " +
      "(1) o conteúdo que está na tela é obra protegida de outra pessoa — **nunca corte o filme ou a série em si para publicar**: isso é reupload e acaba em remoção por violação de direitos; " +
      "(2) conteúdo de estudar junto simplesmente não tem o que cortar; na maior parte das vezes a resposta certa é não devolver nenhum clipe. " +
      "Se for mesmo escolher, pegue apenas a reação e o comentário **de quem apresenta** (os trechos em que a pessoa está em quadro e é a voz dela), e só quando aquilo se sustentar sem a obra original. " +
      "Peso das evidências: as explosões de voz de quem apresenta e os picos do chat; os sinais de imagem aqui apontam para a obra protegida e **não podem servir de critério**.",
    criteriaEn:
      "Co-watching / study-with-me stream. **Two hard constraints matter more than picking well:** " +
      "(1) the content on screen is someone else's copyright — **never clip the film/show itself**; that is reuploading and gets taken down; " +
      "(2) study-with-me has nothing to clip; most of the time the correct answer is to return nothing. " +
      "If you do pick, only take the **host's own** reaction and commentary, and only where it stands alone without the source. " +
      "Evidence weighting: host vocal bursts and chat spikes; visual signals here point at the copyrighted content — do not use them.",
    evidence: "reaction",
  },
  {
    id: "interview",
    labelPt: "Entrevista / podcast / conversa",
    labelEn: "Interview / podcast",
    criteriaPt:
      "Esta é uma entrevista ou um podcast de conversa. Prioridade dos destaques: (1) uma pergunta incisiva e uma resposta que não foge dela (2) o choque de visões, a discordância assumida ali na hora " +
      "(3) algo que o convidado deixa escapar ou revela pela primeira vez (4) uma opinião marcante que se sustenta sozinha (5) a experiência pessoal contada com sinceridade. " +
      "Peso das evidências: o conteúdo é o que manda. " +
      "**Pergunta e resposta precisam vir em par** — só a resposta, sem a pergunta, deixa o público sem saber do que se trata; ao escolher trechos que atravessam falantes, inclua a pergunta e a resposta completas e nunca junte meia frase de um com meia frase do outro.",
    criteriaEn:
      "Interview / podcast. Priority: (1) a pointed question and an answer that doesn't dodge, (2) genuine disagreement on air, " +
      "(3) something let slip or disclosed for the first time, (4) a standalone quotable take, (5) raw personal story. " +
      "Evidence weighting: content-driven. " +
      "**Keep question and answer together** — never stitch two speakers' half-sentences.",
    evidence: "words",
  },
  {
    id: "custom",
    labelPt: "Personalizado",
    labelEn: "Custom",
    criteriaPt: "",
    criteriaEn: "",
    evidence: "words",
  },
];

/** Busca um preset pelo id; um id desconhecido volta para auto. Função pura. */
export function genrePreset(id: string | undefined): GenrePreset {
  return GENRE_PRESETS.find((g) => g.id === id) ?? GENRE_PRESETS[0];
}

/**
 * Id antigo → id novo. A tabela de gêneros foi reordenada para acompanhar as
 * categorias reais das plataformas, e uma preferência já guardada nesta máquina não
 * pode quebrar por causa disso. O que não casa fica para a reserva auto do
 * genrePreset.
 */
const LEGACY_GENRE_IDS: Record<string, GenreId> = {
  "live-sell": "shopping",
  gaming: "game",
  lecture: "knowledge",
};

/** Mantém funcionando os valores de genreId guardados por preferências mais antigas (a grafia anterior à v0.9.4). */
export function normalizeGenreId(id: string | undefined): string | undefined {
  if (!id) return id;
  return LEGACY_GENRE_IDS[id] ?? id;
}

/**
 * Limite de silêncio do corte seco por gênero (em segundos): só os intervalos entre
 * palavras maiores que isso são cortados.
 * Base de pesquisa para 2026 (RESEARCH-2026-08-CLIP-QUALITY.md, seção 3): narração
 * acelerada em torno de 0,3s, locução de uma pessoa de 0,5 a 0,7s, conversa entre
 * duas pessoas de 0,8 a 1,2s — tirar de uma conversa todo o respiro faz ela soar
 * como metralhadora.
 * Os gêneros que não estão listados aqui usam o padrão de 0,6 (igual ao histórico
 * GAP_THRESHOLD_SEC, então atualizar não muda nada no que já era produzido).
 */
const GENRE_PAUSE_GAP_SEC: Partial<Record<GenreId, number>> = {
  esports: 0.4, // narração é a fala mais rápida que existe; um intervalo ali é tempo morto
  game: 0.45,
  sports: 0.5,
  shopping: 0.55, // o discurso de venda é denso, e as pausas geralmente são enrolação
  looks: 0.7, // a troca com convidados precisa de um tempo para retomar o fio
  vtuber: 0.7,
  talk: 0.8, // bate-papo e stand-up: a pausa muitas vezes é a piada
  radio: 0.8,
  outdoor: 0.7, // na rua a reação vem atrasada e o áudio é ruim
  knowledge: 0.7, // numa aula a pausa existe para o público digerir
  interview: 0.9, // em conversa, o silêncio entre a pergunta e a resposta carrega sentido
};

/** Nível padrão do limite de silêncio do corte seco (igual ao padrão histórico de gaps.ts). */
export const DEFAULT_PAUSE_GAP_SEC = 0.6;

/** Limite de silêncio do corte seco de um gênero; desconhecido ou não configurado volta para o padrão. Função pura. */
export function genrePauseGapSec(id: string | undefined): number {
  const norm = normalizeGenreId(id) as GenreId | undefined;
  return (norm && GENRE_PAUSE_GAP_SEC[norm]) || DEFAULT_PAUSE_GAP_SEC;
}

/** Teto de tamanho dos critérios escritos pela pessoa (evita estourar o prompt). */
export const GENRE_CUSTOM_MAX_CHARS = 1200;

/**
 * Monta o bloco de gênero que é injetado no system prompt.
 * Um `customCriteria` não vazio sempre vence — o que a pessoa escreveu passa sempre
 * por cima do preset interno, e é isso que torna natural o uso de "escolher o preset
 * mais próximo e mudar uma ou duas frases". Devolver "" significa não injetar nada.
 * Função pura.
 */
export function genreSection(
  id: string | undefined,
  pt: boolean,
  customCriteria?: string
): string {
  const custom = (customCriteria ?? "").trim().slice(0, GENRE_CUSTOM_MAX_CHARS);
  const body = custom || (pt ? genrePreset(normalizeGenreId(id)).criteriaPt : genrePreset(normalizeGenreId(id)).criteriaEn);
  if (!body) return "";
  return pt ? `\n\n[Tipo desta transmissão e critérios] ${body}` : `\n\n[Stream type & criteria] ${body}`;
}
