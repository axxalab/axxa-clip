/**
 * Prompts da detecção de destaques: o LLM lê uma transcrição com marcação de tempo
 * e indica os trechos que valem um corte CITANDO O TEXTO — ele nunca inventa
 * marcações de tempo (elas são encontradas depois, por busca reversa).
 *
 * É bilíngue por desenho: transcrições em português recebem o prompt pt, todo o
 * resto recebe o prompt en, e o título, o gancho e a justificativa seguem sempre o
 * idioma da própria transcrição. Construtores puros, testáveis.
 * timestamps (they are reverse-matched later).
 *
 * transcript's own language. Pure builders, testable.
 */
import type { Transcript } from "../transcribe/types";
import type { ClipLength } from "../../shared/api-types";
import type { MediaSignals } from "../signals";
import { referencePromptSection, type ReferenceProfile } from "../reference";
import { reviewMemorySection, type ReviewRecord } from "../review-memory";
import { performanceMemorySection, type PerformanceEntry } from "../performance-memory";
import { genreSection } from "../genre";
import { clipDurationSec, isStitched, type ClipPiece } from "../../shared/pieces";

export const HIGHLIGHT_SYSTEM_PROMPT_PT = `Você é um estrategista de primeira linha em cortes para vídeo curto. Recebendo a transcrição frase a frase de um vídeo longo, escolha os trechos com mais chance de viralizar no TikTok / Reels / Shorts / Kwai.

[Antes de tudo: conteúdo que viraliza é raríssimo]
Numa live de duas horas, normalmente há menos de cinco minutos que realmente valem um corte. A imensa maioria é passagem sem graça. É melhor entregar só dois ou três destaques de verdade do que empacotar conteúdo mediano como destaque para encher lista — clipe fraco publicado derruba o alcance da conta inteira.

[Antes de agir, descubra que tipo de conteúdo é este e só então decida em que evidência confiar]
O material pode ser venda ao vivo, jogos, dança/talento, bate-papo com convidados, aula, rua/viagem, entrevista, narração de partida, unboxing… os destaques ficam em lugares completamente diferentes. Julgue o tipo primeiro e depois aplique estes pesos:
- **Conteúdo que está nas palavras** (venda / aula / entrevista / narração / análise): o destaque é o que foi dito; julgue pela transcrição
- **Conteúdo de reação** (jogos / bate-papo / rua / esportes): o texto do momento incrível costuma ser só "caraca/vixe/acabou", sem nenhuma informação. Aqui pesam os trechos de tom exaltado e os picos do chat ao vivo; use a transcrição só para confirmar o que aconteceu
- **Conteúdo de imagem** (talento / dança / canto / paisagem): a transcrição é praticamente vazia — nunca escolha um momento só porque a frase "lê bem", porque não é isso que o público está assistindo. Vá pelas janelas de alta energia visual, pelo andamento da música e pelo chat
Se não der para decidir, trate como conteúdo nas palavras — mas não transforme conversa fiada evidente em frase marcante.

[Procure estes momentos, da maior para a menor chance de viralizar]
1. Contradição e desmentido: a mesma pessoa dizendo uma coisa antes e outra depois — jurar que "nunca vou baixar o preço" e baixar logo em seguida, elogiar e depois detonar, prometer e fazer diferente, dois pesos e duas medidas. É o destaque mais forte que existe, e vale garimpar em dois pontos bem distantes da transcrição
2. Conflito e tensão: a pergunta que a pessoa não queria responder, contestar alguém ao vivo, dar errado, imprevisto, briga de verdade
3. Frases que contrariam o senso comum: uma única frase que vira a cabeça ("quanto mais você se esforça, mais pobre fica") e viaja sozinha, fora de contexto
4. Picos de emoção: a pessoa se exaltando, se quebrando, se abrindo de verdade, desabando de repente — o tom em si já é o conteúdo
5. Piadas: só como uma unidade completa de preparação → desfecho. Um trecho em que o público ri mas a piada ficou de fora NUNCA serve
6. Conteúdo denso que dá vontade de salvar: métodos, listas, números concretos (as plataformas hoje dão o maior peso ao salvamento)
7. Específicos de venda ao vivo: o produto reagindo de um jeito inesperado, o instante em que o preço cai, a demonstração dando errado, a pessoa sendo pressionada sobre composição ou pós-venda

[A primeira frase é a linha entre a vida e a morte]
A frase de abertura do trecho precisa carregar o gancho. Padrões que fazem o dedo parar:
- Contra o senso comum / desmentido (o mais forte): "você acha que é X, na verdade é Y", "pare de acreditar em X", "o X de verdade não é Y", "quanto mais X, mais Y"
- Contraste de resultado: "fiz Y em X meses", "de X para Y", "nem imaginei que X"
- Suspense: "descobri um segredo", "nunca faça X", "é por isso que X"
- Dor: "você também não faz X?", "90% das pessoas não sabem que X"
Cumprimento, apresentação pessoal, "agora vamos para o próximo", preparação arrastada — nada disso pode abrir um trecho.

[Duração]
Duração de 8 a 40 segundos (cerca de 2 a 8 frases da transcrição).

[Dois momentos distantes? Então "parts" é OBRIGATÓRIO]
Quase todo corte é um trecho contínuo — basta usar quoteStart/quoteEnd.
Mas sempre que os dois momentos que você quer estiverem **separados por um longo trecho de assunto sem relação** (a categoria 1, a contradição, quase sempre é assim: a promessa no começo, o desmentido quinze minutos depois), você **precisa** emitir um array "parts" delimitando cada um deles.
⚠ Isso não é opcional: se você apenas colocar startSegmentId na frase anterior e endSegmentId na posterior, o sistema corta TUDO o que está no meio para dentro do clipe — a duração estoura o limite, o candidato é descartado e o destaque que você achou vai para o lixo.
Como escrever parts:
- Liste de 2 a 3 trechos na ordem de tempo do vídeo original; essa ordem É a ordem de reprodução — nunca inverta
- Cada trecho precisa ser um pensamento completo, não cortado ao meio (pelo menos 2 segundos); a SOMA dos trechos ainda precisa respeitar a duração exigida acima (a distância entre eles não conta, só o que de fato entra no corte)
- Ao usar parts, preencha mesmo assim os campos de topo: startSegmentId/quoteStart com o início do primeiro trecho, endSegmentId/quoteEnd com o fim do último
- A costura nunca pode fabricar um sentido que não existia — é onde mais se erra. Se o intervalo contiver um "mas/porém" que inverte tudo, ou se o segundo trecho na verdade fala de outra coisa, não costure e simplesmente descarte o candidato; na dúvida, corte um trecho contínuo
[Regras de ferro]
1. Selecione APENAS a partir da transcrição, literalmente: quoteStart/quoteEnd precisam ser copiados caractere por caractere (com pontuação) — nunca parafraseie, nunca invente
2. quoteStart = as palavras iniciais da primeira frase do trecho (6 palavras ou mais); quoteEnd = as palavras finais da última frase (6 palavras ou mais)
3. startSegmentId/endSegmentId precisam ser os **números [id] que realmente existem na transcrição** (se a primeira frase for [21], coloque 21) — nunca -1, 0 ou vazio; score precisa ser um inteiro de 0 a 100, e igualmente nunca -1
4. Não escreva marcações de relógio (hh:mm:ss) — o sistema localiza o tempo a partir do texto que você citou; mas os dois ids de frase e o score acima SÃO obrigatórios, não os omita junto
5. Os trechos não podem se sobrepor; qualidade acima de quantidade — não force escolhas fracas
6. Nunca tire da frase o sentido original: o significado do corte precisa bater com o que foi realmente dito. Um "gancho" fabricado cortando meia frase se volta contra a conta
7. Escreva title/hook/reason no MESMO idioma da transcrição`;

export const HIGHLIGHT_SYSTEM_PROMPT_EN = `You are a top short-form clipping strategist. Given the sentence-level transcript of a long video, pick the segments most likely to go viral on TikTok / Reels / Shorts.

[Viral material is RARE]
In a two-hour stream, under five minutes is usually worth clipping. Most of it is filler. Returning two or three genuine hits beats padding the list — weak clips published to a channel drag the whole account down.

[First work out what this footage IS, then decide which evidence to trust]
It could be live selling, gaming, a dance/music performance, a chat stream, a lecture, an outdoor walk-and-talk, an interview podcast, sports commentary, an unboxing… the highlights sit in completely different places. Judge the type first, then weight accordingly:
- **Content-in-the-words** (selling / lecture / interview / commentary / review): the highlight is what was said — judge from the transcript
- **Reaction-driven** (gaming / chat / outdoor / sports): at a peak moment the text is often just "holy—" with zero information. Lean on vocal-emotion peaks and live-chat spikes; use the transcript only to confirm what happened
- **Visual-driven** (dance / singing / scenery): the transcript is essentially empty — never pick a moment just because a line reads well. Go by visual-energy windows, musical phrasing and chat
If you can't tell, default to content-in-the-words — but don't dress up filler chatter as a quotable.

[Hunt these, in descending order of viral odds]
1. Self-contradiction / getting caught out: the same person saying opposite things — "we'll never discount" followed by a discount, hyping then trashing, promises that don't match what they did, double standards. The strongest hook there is; worth digging out of two far-apart parts of the transcript
2. Conflict and friction: a question they don't want to answer, pushing back on someone live, a fail, an accident, a real argument
3. Counterintuitive one-liners: a single sentence that flips conventional wisdom ("the harder you work, the poorer you get") and travels on its own
4. Emotional peaks: worked up, breaking down, raw sincerity, a sudden drop — tone itself is the content
5. Jokes: only as a complete setup→punchline unit. A clip where the audience laughs but the punchline itself is missing is NEVER acceptable
6. Dense, saveable value: methods, checklists, concrete numbers (platforms now weight saves highest)
7. Live-selling specifics: a product behaving unexpectedly, the moment the price drops, a demo going wrong, being pressed on ingredients or returns

[The first line decides everything]
A clip's opening sentence must carry the hook. Patterns that stop the scroll:
- Counterintuitive / caught-out (strongest): "you think X, actually Y", "stop believing X", "real X isn't Y", "the more X the more Y"
- Result-gap: "I did Y in X months", "from X to Y", "turns out X"
- Suspense: "I found a secret", "never do X", "this is why X"
- Pain point: "are you also X?", "90% of people don't know X"
Greetings, self-introductions, "next up let's look at…", slow build-ups — never open a clip on these.

[Length]
Length 8–40 seconds (roughly 2–8 transcript sentences).

[Two far-apart moments? Then "parts" is REQUIRED]
Almost every clip is one continuous stretch — just use quoteStart/quoteEnd.
But whenever the two moments you want are **separated by a long stretch of unrelated talk** (category 1, getting caught out, almost always is: the promise early on, the contradiction ten minutes later), you MUST emit a "parts" array framing each one.
⚠ This is not optional: if you instead set startSegmentId to the earlier line and endSegmentId to the later one, the system cuts EVERYTHING in between into the clip — it blows past the length limit and the candidate gets dropped, so the hook you found is wasted.
How to write parts:
- List 2–3 parts in source-time order; that order IS the playback order — never reverse it
- Each part must be a complete, un-truncated thought (≥2 seconds); the SUM of the parts must still satisfy the length requirement above (the span between them doesn't count — only what actually gets cut in)
- With "parts", still fill the top-level fields: startSegmentId/quoteStart from the first part, endSegmentId/quoteEnd from the last
- Stitching must never manufacture a meaning that was not there. If the gap contains a "but/however" that reverses it, or the second part is actually about something else, don't stitch — drop the candidate. When in doubt, cut one continuous clip

[Hard rules]
1. Select ONLY from the transcript verbatim: quoteStart/quoteEnd must be copied character-for-character (punctuation included) — never paraphrase, never invent
2. quoteStart = the opening words of the clip's first sentence (≥6 words/characters); quoteEnd = the closing words of its last sentence (≥6 words/characters)
3. startSegmentId/endSegmentId must be the **actual [id] numbers from the transcript** (if the first line is [21], put 21) — never -1, 0 or blank; score must be an integer 0-100, likewise never -1
4. Do not output clock timestamps (hh:mm:ss) — the system reverse-matches the text you quoted; but the two sentence ids and score above ARE required, don't drop them too
5. Clips must not overlap; quality over quantity — do not force weak picks
6. Never quote-mine: the clipped meaning must match what was actually said. A "hook" manufactured by cutting a sentence in half will backfire on the account
7. Write title/hook/reason in the SAME language as the transcript`;

/**
 * Português quando o motor diz que é, ou quando o próprio texto se lê como
 * português.
 * Uma etiqueta de idioma decide na hora; só "auto" ou vazio recorre a farejar no
 * texto as palavras funcionais das quais o português não consegue passar.
 */
export function isPortugueseTranscript(transcript: Transcript): boolean {
  const lang = transcript.language.toLowerCase();
  if (lang.startsWith("pt")) return true;
  if (lang && lang !== "auto") return false;
  const sample = transcript.segments
    .slice(0, 10)
    .map((s) => s.text)
    .join(" ")
    .toLowerCase();
  if (!sample) return false;
  const words = sample.split(/[^a-zà-ÿ]+/).filter(Boolean);
  if (words.length === 0) return false;
  // Palavras funcionais de alta frequência que o português não dispensa. Só
  // entram aqui as que não colidem com o inglês, que é o outro ramo possível:
  // "a", "as", "no" e "me" ficaram de fora justamente por isso.
  const markers = new Set([
    "de", "em", "um", "uma", "que", "não", "com", "para", "você", "isso",
    "como", "está", "estão", "então", "muito", "aqui", "porque", "também",
    "já", "são", "das", "dos", "num", "numa", "pra", "mas", "seu", "sua",
    "nós", "ele", "ela", "é", "por", "mais", "quando", "até", "foi", "ter",
    "vai", "vou", "vamos", "gente", "coisa", "só", "dele", "dela", "pelo",
    "pela", "sem", "mesmo", "ainda", "agora", "depois", "tudo", "quem",
    "onde", "qual", "esse", "essa", "este", "esta", "eu", "meu", "minha",
    "tem", "fazer", "falar", "sobre", "entre", "cada", "todo", "toda",
    "hoje", "ser", "era", "fica", "bem", "pode", "sempre", "nunca",
  ]);
  const hits = words.filter((w) => markers.has(w)).length;
  return hits / words.length > 0.12;
}

/** Three length tiers: short = fast vertical pace (watch-through friendly), standard = today's default, long = podcast/long-form quotable segments. */
export const CLIP_LENGTH_RANGES: Record<ClipLength, { minSec: number; maxSec: number }> = {
  short: { minSec: 10, maxSec: 30 },
  standard: { minSec: 8, maxSec: 40 },
  long: { minSec: 40, maxSec: 90 },
};

export function highlightSystemPrompt(
  transcript: Transcript,
  length: ClipLength = "standard",
  products: string[] = [],
  reference?: ReferenceProfile,
  reviewMemory?: ReviewRecord[],
  genre?: { id?: string; custom?: string },
  brief?: { focus?: string; exclude?: string },
  performanceMemory?: PerformanceEntry[]
): string {
  const pt = isPortugueseTranscript(transcript);
  let base = pt ? HIGHLIGHT_SYSTEM_PROMPT_PT : HIGHLIGHT_SYSTEM_PROMPT_EN;
  if (length !== "standard") {
    // Reescreve a linha de duração conforme a faixa (é uma restrição rígida dentro
    // do system prompt, então a seleção já mira o ritmo pretendido)
    const { minSec, maxSec } = CLIP_LENGTH_RANGES[length];
    base = base
      .replace("Duração de 8 a 40 segundos", `Duração de ${minSec} a ${maxSec} segundos (exigência rígida, melhor ficar abaixo do que passar)`)
      .replace("Length 8–40 seconds", `Length ${minSec}–${maxSec} seconds (hard requirement)`);
  }
  // Critérios do gênero: os gêneros diferem até em "qual evidência confiar", então
  // isto vem depois dos critérios genéricos e passa por cima deles
  if (genre) base += genreSection(genre.id, pt, genre.custom);
  if (products.length > 0) base += productSection(products, pt);
  // User brief: explicit human intent, outranking the generic criteria
  // (mirrors OpusClip's contextual prompting)
  base += briefSection(brief, pt);
  // Perfil do corte de referência: o bloco de preferência de ritmo (só existe quando
  // a pessoa entregou um corte para servir de espelho)
  if (reference) base += referencePromptSection(reference, pt);
  // Review-preference feedback: this machine's own accepted/rejected examples
  // (an empty memory returns "")
  if (reviewMemory && reviewMemory.length > 0) base += reviewMemorySection(reviewMemory, pt);
  // Desempenho real das publicações: o resultado do público vale mais do que o
  // modelo adivinhando o que está em alta, mas ainda assim conta apenas como
  // evidência de tendência
  if (performanceMemory && performanceMemory.length > 0) base += performanceMemorySection(performanceMemory, pt);
  return base;
}

/**
 * Preferências de seleção do modo de apresentação de produto (os critérios vêm de
 * pesquisa prática sobre cortes de venda): na conversão, a ordem é demonstração e
 * prova real > explicação dos diferenciais > mecânica de preço > chamada para compra
 * > perguntas e respostas. Enrolação e chamada de alta pressão carregam risco de
 * infração na plataforma e ficam de fora por completo.
 * As frases que marcam o script ajudam o LLM a achar onde uma apresentação começa e
 * onde termina.
 * research into selling clips): conversion ranks demo/live test > selling
 */
export function productSection(products: string[], pt: boolean): string {
  const list = products.join(", ");
  if (pt) {
    return (
      `\n\n[Modo de apresentação de produto] A pessoa indicou estes produtos: ${list}. Esta é uma transmissão de venda ao vivo; escolha apenas os trechos diretamente ligados a esses produtos, em ordem de valor de conversão: ` +
      `(1) prova, vestir, demonstração real (ver para crer, é a prioridade máxima) (2) explicação dos diferenciais (material/composição/comparação, "esse tecido é tal", "o caimento fica assim") ` +
      `(3) preço e mecânica ("de X por só Y hoje", "compre um e leve dois", "some com o cupom") (4) chamada para compra só quando estiver colada na demonstração ou na liberação do link ("três, dois, um, link no ar" é um encerramento natural), nunca sozinha (5) respostas que derrubam objeções (tamanho/composição/pós-venda). ` +
      `O bloco de apresentação costuma começar com "agora vamos/o próximo/vou falar do link número X" e terminar com "vamos para o próximo"; use isso para localizá-lo. ` +
      `Nunca escolha: conversa solta sem relação com o produto, enrolação esperando gente chegar, pura isca de engajamento ("chega a X mil curtidas e eu solto o link" — as plataformas tratam como infração e derrubam o alcance), repetição mecânica da mesma frase de mecânica, ou pedaços em que a apresentação foi interrompida e o produto ficou incompleto. ` +
      `As keywords de cada candidato precisam conter o produto que ele acertou.` +
      `\n[Costura em três atos para venda] A estrutura de corte de venda que mais converte em 2026 é a de três atos "dor → demonstração → preço": abra com uma frase que acerte por que a pessoa precisa daquilo, emende a prova real e termine no preço/condição, que é a razão para comprar. ` +
      `Esses três tipos de conteúdo do mesmo produto costumam estar bem distantes dentro da live — sempre que der para juntar dois ou três deles, prefira costurar com parts na ordem dor → demonstração → preço (cada trecho completo, sem cortar no meio, e a duração total dentro do limite) e escreva em reason quais elementos você costurou; ` +
      `se os elementos não estiverem todos lá, não force: escolha um trecho contínuo. A costura nunca pode mudar o sentido — a dor e a demonstração precisam falar mesmo do mesmo produto.`
    );
  }
  return (
    `\n\n[Product mode] The user specified product keywords: ${list}. This is a live-selling stream — only pick segments directly about these products, ranked by conversion value: ` +
    `(1) try-on/live-demo moments (seeing is believing), (2) key selling-point explanations, (3) price & bundle mechanics, (4) call-to-action lines only when adjacent to a demo/link drop (never standalone), (5) objection-handling Q&A. ` +
    `Skip idle chat, stalling-for-engagement segments (platforms flag these as violations), repeated price-script loops, and fragments where the pitch is cut off. ` +
    `Each candidate's keywords must include the product words it matches.` +
    `\n[Selling three-act stitch] The highest-converting selling clip in 2026 is a "pain point → demo → price" three-act cut: open on why the viewer needs it, show the live demo, land on the price/deal. ` +
    `These three beats for one product usually sit far apart in the stream — whenever you can gather two or three of them, prefer a "parts" stitch in pain→demo→price order (each part complete, total length within the limit) and say in reason which beats you stitched; ` +
    `if the beats aren't all there, don't force it — pick a single continuous segment instead. Stitching must never change meaning: the pain point and the demo must genuinely be about the same product.`
  );
}

/** Teto de tamanho do texto do briefing (uma injeção grande demais só dilui os critérios). */
export const BRIEF_MAX_CHARS = 300;

/**
 * O bloco de briefing do usuário (v0.13): a pessoa diz em linguagem simples o que
 * procurar e o que deixar de fora. É a única intenção genuinamente humana dentro do
 * prompt, então ela passa por cima de todo critério automático — mas excluir algo não
 * é o mesmo que fazer aparecer: quando o conteúdo pedido realmente não está no
 * material, é melhor devolver menos do que encher a lista.
 */
export function briefSection(brief: { focus?: string; exclude?: string } | undefined, pt: boolean): string {
  const focus = brief?.focus?.trim().slice(0, BRIEF_MAX_CHARS) ?? "";
  const exclude = brief?.exclude?.trim().slice(0, BRIEF_MAX_CHARS) ?? "";
  if (!focus && !exclude) return "";
  if (pt) {
    const lines = [
      "\n\n[Briefing do usuário] A pessoa deu instruções explícitas para esta sessão de cortes, e elas têm prioridade sobre os critérios gerais acima:",
      ...(focus ? [`- Procure especialmente: ${focus}`] : []),
      ...(exclude ? [`- Exclua explicitamente: ${exclude} (não escolha esse tipo de conteúdo, por melhor que seja)`] : []),
      "O briefing muda O QUE procurar, não o padrão de qualidade — se o que a pessoa pediu realmente não existir no material, entregue menos ou nada, e nunca encha a lista com trechos sem relação.",
    ];
    return lines.join("\n");
  }
  const lines = [
    "\n\n[User brief] The user gave explicit instructions for this session — they override the general criteria above:",
    ...(focus ? [`- Focus on: ${focus}`] : []),
    ...(exclude ? [`- Explicitly exclude: ${exclude} (skip these even if they are strong)`] : []),
    "The brief changes WHAT to hunt, not the quality bar — if the requested content simply isn't in the footage, return fewer clips rather than padding with unrelated picks.",
  ];
  return lines.join("\n");
}

/** Verdadeiro quando a transcrição traz separação de falantes com mais de uma pessoa. */
export function isMultiSpeaker(transcript: Transcript): boolean {
  const ids = new Set<number>();
  for (const s of transcript.segments) if (s.speaker !== undefined) ids.add(s.speaker);
  return ids.size > 1;
}

/**
 * Transforma os trechos da transcrição em linhas "[id] MM:SS texto" que o LLM pode
 * citar.
 * Com a separação de falantes feita, cada linha ganha o falante como prefixo ("S1:"),
 * para o LLM poder atribuir as citações e evitar costurar duas pessoas num mesmo
 * "destaque".
 */
export function renderTranscriptLines(transcript: Transcript): string {
  const multi = isMultiSpeaker(transcript);
  return transcript.segments
    .map((s) => {
      const m = Math.floor(s.startSec / 60);
      const sec = Math.floor(s.startSec % 60);
      const clock = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
      const spk = multi && s.speaker !== undefined ? `S${s.speaker + 1}: ` : "";
      return `[${s.id}] ${clock} ${spk}${s.text}`;
    })
    .join("\n");
}

const OUTPUT_SHAPE = `{
  "clips": [
    {
      "title": "...",
      "hook": "...",
      "score": 85,
      "reason": "...",
      "startSegmentId": 3,
      "endSegmentId": 6,
      "quoteStart": "...",
      "quoteEnd": "...",
      "keywords": ["...", "..."]
    }
  ]
}`;

/**
 * Descrição do campo opcional de costura de vários trechos. Ele fica de fora do
 * OUTPUT_SHAPE de propósito: mostrar "parts" no exemplo faz o modelo achar que todo
 * clipe deve ser costurado, quando a costura é para ser a exceção.
 */
const PARTS_SHAPE_PT = `Quando um clipe realmente precisar de costura (apenas aquele que depende do contraste entre o antes e o depois), acrescente o campo parts NAQUELE clipe; se não precisar de costura, o campo não deve aparecer de jeito nenhum:
"parts": [
  {"startSegmentId": 12, "endSegmentId": 13, "quoteStart": "...", "quoteEnd": "..."},
  {"startSegmentId": 88, "endSegmentId": 90, "quoteStart": "...", "quoteEnd": "..."}
]`;

const PARTS_SHAPE_EN = `When a clip genuinely needs stitching (only the one that requires the before/after contrast), add a "parts" field to THAT clip; omit the field entirely otherwise:
"parts": [
  {"startSegmentId": 12, "endSegmentId": 13, "quoteStart": "...", "quoteEnd": "..."},
  {"startSegmentId": 88, "endSegmentId": 90, "quoteStart": "...", "quoteEnd": "..."}
]`;

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Monta a evidência de imagem e som de nível 0 para injetar no prompt ("" quando não há nada). */
export function renderSignals(signals: MediaSignals | undefined, pt: boolean): string {
  if (!signals) return "";
  const fmt = (rs: Array<{ startSec: number; endSec: number }>): string =>
    rs.map((r) => `${fmtClock(r.startSec)}-${fmtClock(r.endSec)}`).join(", ");
  const lines: string[] = [];
  if (signals.loudPeaks.length > 0) {
    lines.push(pt ? `- Picos de volume (explosão emocional/risada/grito): ${fmt(signals.loudPeaks)}` : `- Loudness peaks (bursts/laughter/shouting): ${fmt(signals.loudPeaks)}`);
  }
  if (signals.cutDense.length > 0) {
    lines.push(pt ? `- Trechos com troca densa de planos (alta energia visual): ${fmt(signals.cutDense)}` : `- Dense scene-cut windows (visual action): ${fmt(signals.cutDense)}`);
  }
  if (signals.motionPeaks && signals.motionPeaks.length > 0) {
    lines.push(pt ? `- Trechos com muito movimento na imagem (diferença entre quadros em baixa resolução; pista de ação/deslocamento): ${fmt(signals.motionPeaks)}` : `- Motion-active windows (low-resolution frame differences; action/movement cue): ${fmt(signals.motionPeaks)}`);
  }
  if (signals.visualPeaks && signals.visualPeaks.length > 0) {
    lines.push(pt ? `- Picos visuais apontados pelo modelo de visão (expressão exagerada/ação intensa/cena impactante): ${fmt(signals.visualPeaks)}` : `- Vision-model visual peaks (expressions/action/spectacle): ${fmt(signals.visualPeaks)}`);
  }
  if (signals.emotionPeaks && signals.emotionPeaks.length > 0) {
    lines.push(pt ? `- Picos de expressão facial (gargalhada/surpresa/empolgação): ${fmt(signals.emotionPeaks)}` : `- Facial-emotion peaks (laughter/surprise/excitement): ${fmt(signals.emotionPeaks)}`);
  }
  if (signals.voiceEmotionPeaks && signals.voiceEmotionPeaks.length > 0) {
    lines.push(pt ? `- Trechos em que o tom de voz se exalta (falando e rindo / gritando / assustado — a emoção que o texto da frase não mostra): ${fmt(signals.voiceEmotionPeaks)}` : `- Vocal-emotion peaks (said while laughing / shouted / startled — tone the text cannot show): ${fmt(signals.voiceEmotionPeaks)}`);
  }
  if (signals.audioEventPeaks && signals.audioEventPeaks.length > 0) {
    // O riso é um resultado atrasado: a piada cai antes dele. Explicar como usar
    // isso é obrigatório, senão o LLM corta justamente o trecho da gargalhada
    // (onde ninguém está falando)
    // (where nobody is actually speaking)
    lines.push(
      pt
        ? `- Trechos de riso/aplauso do público: ${fmt(signals.audioEventPeaks)}\n  ⚠ O riso é o "resultado", não o destaque em si — a piada que o provocou cai ANTES de o riso começar. Volte até aquela frase, inclua a preparação dela e deixe só um pedacinho do riso como encerramento; nunca corte apenas os segundos de gargalhada (ali ninguém está falando)`
        : `- Audience laughter / applause: ${fmt(signals.audioEventPeaks)}\n  ⚠ Laughter is the RESULT, not the highlight — the punchline that triggered it lands BEFORE the laughter starts. Walk back to that line, include its setup, and keep only a beat of laughter as the tail; never clip just the laughing seconds (nobody is speaking there)`
    );
  }
  if (signals.danmakuPeaks && signals.danmakuPeaks.length > 0) {
    lines.push(pt ? `- Picos de movimento no chat ao vivo (reação do público em tempo real, a evidência mais forte): ${fmt(signals.danmakuPeaks)}` : `- Live-chat density peaks (real-time audience hype, strongest evidence): ${fmt(signals.danmakuPeaks)}`);
  }
  if (signals.clipCommandMarks && signals.clipCommandMarks.length > 0) {
    const marks = signals.clipCommandMarks.map(fmtClock).join(", ");
    // Como o riso, o pedido de corte é uma marca atrasada: o que ele certifica
    // aconteceu antes dele. Como usar isso precisa estar escrito no prompt.
    lines.push(
      pt
        ? `- Momentos em que quem transmite pediu o corte (a pessoa disse com todas as letras "corta esse pedaço" — um destaque certificado por ela mesma em tempo real, a evidência de maior valor): ${marks}\n  ⚠ O pedido se refere ao que **acabou de acontecer antes dele**: volte a partir da marca até o trecho completo a que ela se referia; nunca corte a própria frase do pedido (no máximo mantenha-a como encerramento)`
        : `- Streamer clip commands (the host literally said "clip that" — self-certified highlights, highest-value evidence): ${marks}\n  ⚠ The command points at what JUST happened **before** it: walk back from the mark to the complete moment being referenced; never clip the command line itself (at most keep it as the tail)`
    );
  }
  if (signals.visualNotes && signals.visualNotes.length > 0) {
    const notes = signals.visualNotes
      .map((n) => {
        const text = n.visibleText?.length
          ? (pt ? ` [texto na tela: ${n.visibleText.join(" / ")}]` : ` [visible text: ${n.visibleText.join(" / ")}]`)
          : "";
        return `${fmtClock(n.t)} ${n.note || (pt ? "pico visual" : "visual peak")} (${n.energy}/10)${text}`;
      })
      .join("; ");
    lines.push(
      pt
        ? `- Linha do tempo visual da transmissão inteira (um modelo de visão varreu tudo — os acontecimentos em tela que a transcrição não mostra estão aqui): ${notes}\n  O conteúdo que coincide com as observações de nota alta realmente tem algo na tela; um momento de texto banal com descrição visual impactante vale ser escolhido`
        : `- Full-stream visual timeline (a vision model swept the whole stream — on-screen events the transcript cannot show): ${notes}\n  Moments overlapping high-energy notes really have something on screen; flat text + explosive visuals is still a pick`
    );
  }
  if (lines.length === 0) return "";
  return pt
    ? `\n[Sinais de imagem e som] (evidência auxiliar — o conteúdo que coincide com estas janelas tem mais chance de ter um pico real de emoção ou de imagem, mas a qualidade do texto continua mandando)\n${lines.join("\n")}\n`
    : `\n[Audiovisual signals] (supporting evidence — content overlapping these windows likely has real emotional/visual peaks; text quality still rules)\n${lines.join("\n")}\n`;
}

/** Orientação de atribuição em conversa com várias pessoas, injetada só quando a separação identificou 2 ou mais falantes. */
function speakerNote(transcript: Transcript, pt: boolean): string {
  if (!isMultiSpeaker(transcript)) return "";
  return pt
    ? `\n[Conversa com várias pessoas] O S1/S2… antes de cada frase marca quem está falando. Ao escolher trechos, prefira "uma fala completa da mesma pessoa"; se for um ótimo par de pergunta e resposta, pode atravessar falantes, mas inclua a troca inteira e nunca junte meia frase de um com meia frase do outro, porque isso distorce o sentido.\n`
    : `\n[Multi-speaker] The S1/S2… prefix on each line marks who is speaking. Prefer a single speaker's complete thought; for a great Q&A you may span speakers but keep the full exchange — never stitch two half-sentences into a misleading clip.\n`;
}

export function buildHighlightPrompt(transcript: Transcript, maxClips = 6, signals?: MediaSignals): string {
  if (isPortugueseTranscript(transcript)) {
    return `Escolha, na transcrição frase a frase abaixo, no máximo ${maxClips} trechos com maior potencial de viralizar.

[Transcrição] (formato: [id da frase] horário de início conteúdo)
${renderTranscriptLines(transcript)}
${speakerNote(transcript, true)}${renderSignals(signals, true)}
[Formato de saída] Responda com JSON estrito, sem nenhum texto a mais:
${OUTPUT_SHAPE}

${PARTS_SHAPE_PT}

Campos: title = título curto pronto para publicar (até 12 palavras); hook = a frase de gancho de abertura, literal; score = nota relativa de 0 a 100; reason = uma frase sobre por que isso pode viralizar; quoteStart/quoteEnd = as palavras iniciais da primeira frase e finais da última, copiadas literalmente; keywords = as 3 a 5 palavras de maior impacto dentro do trecho, copiadas literalmente do original (usadas para destacar palavras na legenda).
Ordene do maior para o menor score; os trechos não podem se sobrepor.`;
  }
  return `Pick at most ${maxClips} clip candidates with the highest viral potential from the transcript below.

[Transcript] (format: [sentenceId] startTime text)
${renderTranscriptLines(transcript)}
${speakerNote(transcript, false)}${renderSignals(signals, false)}
[Output format] Respond with STRICT JSON only, no extra text:
${OUTPUT_SHAPE}

${PARTS_SHAPE_EN}

Fields: title = a post-ready short title (≤ 12 words); hook = the verbatim opening hook line; score = 0-100 relative ranking; reason = one line on why it can go viral; quoteStart/quoteEnd = verbatim opening/closing words of the clip; keywords = the 3-5 punchiest words/phrases inside the clip, copied verbatim (used to emphasize caption keywords).
Sort by score descending; clips must not overlap.`;
}

// ---------- Canal guiado por sinal: escolher por "momento" quando a transcrição não tem nada ----------

export const MOMENT_SYSTEM_PROMPT_PT = `Você é um estrategista de primeira linha em cortes para vídeo curto e está diante de uma transmissão cuja **transcrição praticamente não tem informação** — dança, talento, canto, rua, jogos, esse tipo de conteúdo em que o público assiste pela imagem e pela reação, não pelas falas.

Por isso, desta vez não se pede que você cite nenhuma frase. O sistema já usou sinais de imagem e de som para delimitar e numerar vários "momentos de alta energia". Seu trabalho é escolher, entre eles, os que de fato valem virar vídeo curto, e dar título e gancho a cada um.

[Como julgar se um momento vale o corte]
- A evidência traz "alta energia visual / troca densa de planos" → é bem provável que seja o auge de uma ação, de uma cena ou de uma apresentação
- Aparece "pico do chat" → o público reagiu de verdade nesse instante, e essa é a evidência mais dura que existe (o público votando ao vivo em qual parte é boa)
- Aparece "tom exaltado / riso / aplauso" → quem transmite ou quem está no ambiente explodiu de emoção nesse ponto
- Só "pico de volume", isolado → provavelmente é só a música de fundo subindo ou ruído do ambiente; desconfie
- Quanto mais tipos de evidência se confirmarem entre si, mais confiável é o momento; tenha coragem de descartar os que têm um sinal só

[Regras de ferro]
1. Escolha somente entre os momentos fornecidos; momentId precisa ser um número que realmente exista, e nunca invente um horário
2. Qualidade acima de quantidade: uma transmissão costuma ter só dois ou três momentos que realmente valem o corte; não chame um trecho comum de alta energia só para encher lista
3. A transcrição anexada é apenas referência: pode estar vazia, pode estar cheia de erros (a captação na rua é ruim) — **nunca escolha um momento só porque "a frase lê bem"**, e não trate uma transcrição ilegível como conteúdo
4. Escreva um title que faça a pessoa tocar na tela quando passar por ele, e não "Melhor momento 1"; sem fala aproveitável, descreva o que vai acontecer na imagem
5. Em hook, escreva a imagem ou o movimento com que o vídeo vai abrir (uma frase); não invente falas
6. score é um inteiro de 0 a 100, obrigatório, nunca -1
7. Escreva title/hook/reason no mesmo idioma da transcrição anexada (em português quando ela estiver vazia)`;

export const MOMENT_SYSTEM_PROMPT_EN = `You are a top short-form clipping strategist. This stream's transcript carries almost no information — dance, performance, singing, outdoor or gaming content, where viewers come for the picture and the reactions, not the words.

So you are NOT asked to quote anything. The system has already used audio and visual signals to mark numbered "high-energy moments". Your job: pick the ones genuinely worth cutting, and title them.

[How to judge a moment]
- Visual-energy / dense scene cuts → likely the peak of an action, a spectacle or a performance
- Live-chat spike → the audience actually reacted here; this is the hardest evidence there is
- Vocal-emotion peak / laughter / applause → the host or the room broke out at this instant
- Loudness alone, with nothing else → often just louder music or ambient noise. Be skeptical
- The more signal types corroborate each other, the more trustworthy. Drop single-signal moments freely

[Hard rules]
1. Pick ONLY from the given moments; momentId must be a real number from the list — never invent times
2. Quality over quantity: a stream usually has two or three moments truly worth clipping
3. The attached transcript is reference only — it may be empty or full of garbled ASR (outdoor audio is poor). NEVER pick a moment just because a line reads well, and don't treat unreadable transcription as content
4. Write a title someone would actually tap, not "Highlight 1". With no usable dialogue, describe what happens on screen
5. hook = the image or the beat this clip opens on, in one line. Do not invent dialogue
6. score is an integer 0-100, required, never -1
7. Write title/hook/reason in the same language as the attached transcript (Portuguese when it is empty)`;

const MOMENT_SHAPE = `{
  "clips": [
    { "momentId": 3, "title": "...", "hook": "...", "score": 88, "reason": "...", "keywords": ["...", "..."] }
  ]
}`;

/** Tipo de sinal → rótulo legível (a cadeia de evidências é mostrada tanto ao LLM quanto à pessoa). */
export const EVIDENCE_LABELS: Record<string, { pt: string; en: string }> = {
  loud: { pt: "pico de volume", en: "loudness peak" },
  cut: { pt: "troca densa de planos", en: "dense scene cuts" },
  motion: { pt: "movimento na imagem", en: "motion activity" },
  visual: { pt: "alta energia visual (modelo de visão)", en: "visual energy (vision model)" },
  emotion: { pt: "pico de expressão facial", en: "facial-emotion peak" },
  voice: { pt: "tom de voz exaltado", en: "vocal-emotion peak" },
  audioEvent: { pt: "riso/aplauso", en: "laughter/applause" },
  danmaku: { pt: "pico do chat ao vivo", en: "live-chat spike" },
};

/**
 * Até onde a transcrição de referência anexada a cada momento é truncada. O prompt
 * já diz que ela é só referência, e para esse tipo de material a transcrição é
 * geralmente ruído (captação ruim na rua, palavras esparsas durante uma música ou
 * uma dança): colar tudo só afoga as linhas de evidência — na prática, empurra o
 * modelo de volta para respostas de template.
 * transcription is usually noise (poor outdoor audio, scattered words during a
 */
export const MOMENT_TEXT_MAX_CHARS = 120;

export interface PromptMoment {
  id: number;
  startSec: number;
  endSec: number;
  evidence: string[];
  /** O que foi dito naquela janela (pode vir vazio ou sem sentido — o prompt já diz para não se apoiar nisso). */
  text: string;
}

export function buildMomentPrompt(moments: PromptMoment[], maxClips: number, pt: boolean): string {
  const lines = moments
    .map((m) => {
      const ev = m.evidence.map((e) => EVIDENCE_LABELS[e]?.[pt ? "pt" : "en"] ?? e).join(", ");
      const dur = Math.round(m.endSec - m.startSec);
      const raw = m.text.trim().replace(/\s+/g, " ");
      const text = raw.length > MOMENT_TEXT_MAX_CHARS ? `${raw.slice(0, MOMENT_TEXT_MAX_CHARS)}…` : raw;
      return pt
        ? `[${m.id}] ${fmtClock(m.startSec)}-${fmtClock(m.endSec)} (${dur}s)\n  Evidências: ${ev || "(nenhuma)"}\n  O que é dito nesse trecho: ${text || "(sem fala)"}`
        : `[${m.id}] ${fmtClock(m.startSec)}-${fmtClock(m.endSec)} (${dur}s)\n  Evidence: ${ev || "(none)"}\n  Transcript here: ${text || "(no dialogue)"}`;
    })
    .join("\n");
  return pt
    ? `Abaixo estão os momentos de alta energia que o sistema delimitou a partir dos sinais de imagem e de som. Escolha no máximo ${maxClips} que valham virar vídeo curto.

[Lista de momentos de alta energia]
${lines}

[Formato de saída] Responda com JSON estrito, sem nenhum texto a mais:
${MOMENT_SHAPE}

Campos: momentId = um número que exista de fato na lista acima; title = título curto pronto para publicar (até 12 palavras); hook = a imagem ou o movimento da abertura, em uma frase; score = nota relativa de 0 a 100; reason = uma frase sobre por que vale o corte (dizendo em qual evidência você confiou); keywords = de 2 a 5 palavras que descrevam este conteúdo (usadas nas hashtags do texto de publicação).
Ordene do maior para o menor score; é melhor entregar poucos e fortes do que chamar um momento sem graça de alta energia.`
    : `Below are high-energy moments marked by audio and visual signals. Pick at most ${maxClips} worth cutting.

[Moments]
${lines}

[Output format] STRICT JSON only, no extra text:
${MOMENT_SHAPE}

Fields: momentId = a real number from the list; title = post-ready short title (≤12 words); hook = the opening image or beat, one line; score = 0-100 relative ranking; reason = one line on why it's worth cutting (say which evidence you trusted); keywords = 2-5 descriptive words for post hashtags.
Sort by score descending; returning fewer, stronger picks beats padding the list.`;
}

/** Extrai o primeiro objeto ou array JSON da saída do LLM (lidando com as cercas \`\`\`json). */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) return fenced[1].trim();
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) return brace[0].trim();
  return text.trim();
}

// ---------- Stage 2: adversarial review ----------

export const REVIEW_SYSTEM_PROMPT_PT = `Você é um avaliador extremamente rigoroso de conteúdo para vídeo curto. Você recebe alguns trechos já cortados e avalia cada um às cegas, do ponto de vista de um estranho que acabou de esbarrar no vídeo, dando nota (0-100) em quatro dimensões e uma frase de justificativa em cada uma:
- hook (gancho): os 3 primeiros segundos (a primeira frase) fazem a pessoa parar de rolar a tela? Abertura sem graça já é reprovação
- flow (estrutura): o sentido foi distorcido? A abertura parece meia frase? O final fecha? A lógica corre bem? Um "……" dentro do texto do trecho indica que ele foi costurado a partir de dois momentos bem distantes; nesse caso o critério é mais duro: o sentido depois da costura continua sendo o sentido original? Foi fabricada uma contradição que não existia, pulando o que estava no meio? Qualquer costura forçada recebe keep=false
- value (valor): sem assistir ao vídeo original, este trecho tem informação ou valor emocional? Vale assistir até o fim?
- trend (tendência): o assunto e a emoção conversam com o que está bombando agora nas plataformas?
Escreva também um teaser para cada trecho: uma frase de suspense de até 8 palavras, que possa ser impressa na abertura do vídeo como gancho de texto — instigante, mas sem entregar o final.
Cada trecho recebe ainda um julgamento final de "compreensão sem contexto nenhum": finja que você nunca assistiu a esta transmissão e viu só este trecho. Dá para entender? O final parece um final? A partir disso, dê um verdict de três níveis:
- "publish": pode publicar como está — se entende sozinho, a abertura segura o dedo, o final fecha
- "review": tem um defeito sério, mas com conserto, e precisa de conferência humana (abertura parecendo meia frase / final que não fecha / precisa de um pouco de contexto / costura um pouco forçada) — diga em note exatamente qual é o defeito
- "drop": não vale publicar — pensamento incompleto, conteúdo medíocre de encher lista, sentido distorcido, ou simplesmente incompreensível sozinho
Tenha coragem de dar drop: é a realidade do mercado que de 30% a 45% das escolhas de uma IA sejam descartáveis, e o preço de publicar clipe ruim é a conta inteira perder alcance. Você é a última porta de qualidade antes da publicação. Continue preenchendo o campo keep (true para publish, false para os demais).`;

export const REVIEW_SYSTEM_PROMPT_EN = `You are a ruthless short-form content reviewer. You receive pre-cut clip candidates and judge each one blind, as a stranger scrolling past, scoring FOUR dimensions (0-100 each) with a one-line reason per dimension:
- hook: does the FIRST line stop the scroll within 3 seconds? Flat openings fail.
- flow: is it quote-mined? Does it start mid-thought or end without landing? Does it flow? A "……" inside the clip text means it was stitched from two far-apart moments — hold those to a stricter bar: does the stitched meaning match what was actually said, or was a contradiction manufactured by skipping what sat in between? Any strained stitch gets keep=false
- value: without the source video, is it informative or emotionally worth watching to the end?
- trend: does the topic/emotion ride what is currently hot on the platforms?
Also write a teaser per clip: a suspense line of ≤8 words that could be printed at the top of the video as a text hook — intriguing, no spoilers.
Finish each clip with a ZERO-CONTEXT verdict — pretend you never saw the stream and only watch this clip: can you follow it, and does the ending land? Emit one of three tiers:
- "publish": safe to post as-is — stands alone, the opening stops the scroll, the ending lands
- "review": has a fixable flaw and needs a human look (opens mid-thought / ending doesn't land / needs a little context / stitch is slightly strained) — name the flaw in note
- "drop": not worth publishing — incomplete thought, filler, quote-mined, or incomprehensible on its own
Judge "drop" without mercy: 30-45% of AI picks being duds is the industry reality, and posting duds throttles the whole account. You are the final quality gate. Keep filling keep (true for publish, false otherwise).`;

export function reviewSystemPrompt(transcript: Transcript): string {
  return isPortugueseTranscript(transcript) ? REVIEW_SYSTEM_PROMPT_PT : REVIEW_SYSTEM_PROMPT_EN;
}

const REVIEW_SHAPE = `{
  "reviews": [
    {
      "id": 1, "keep": true, "verdict": "publish",
      "hook": 82, "hookNote": "...",
      "flow": 74, "flowNote": "...",
      "value": 88, "valueNote": "...",
      "trend": 60, "trendNote": "...",
      "teaser": "...",
      "note": "..."
    }
  ]
}`;

interface ReviewableClip {
  id: number;
  title: string;
  startSec: number;
  endSec: number;
  text: string;
  /** Os trechos de uma costura de vários trechos; quando existem, a duração informada é a soma deles, e não o intervalo. */
  pieces?: ClipPiece[];
}

/** Uma frase de contexto de cada lado, para quem revisa conseguir notar uma distorção de sentido. */
function contextAround(transcript: Transcript, startSec: number, endSec: number): { before: string; after: string } {
  const segs = transcript.segments;
  const firstIdx = segs.findIndex((s) => s.endSec > startSec);
  const lastIdx = segs.findLastIndex((s) => s.startSec < endSec);
  return {
    before: firstIdx > 0 ? segs[firstIdx - 1].text : "",
    after: lastIdx >= 0 && lastIdx + 1 < segs.length ? segs[lastIdx + 1].text : "",
  };
}

export function buildReviewPrompt(transcript: Transcript, clips: ReviewableClip[]): string {
  const pt = isPortugueseTranscript(transcript);
  const blocks = clips
    .map((c) => {
      const ctx = contextAround(transcript, c.startSec, c.endSec);
      const dur = Math.round(clipDurationSec(c));
      const stitched = isStitched(c.pieces)
        ? pt
          ? ` (costura de ${c.pieces!.length} partes)`
          : ` (${c.pieces!.length}-part stitch)`
        : "";
      return pt
        ? `[Candidato ${c.id}] "${c.title}" — ${dur}s${stitched}\nAntes: ${ctx.before || "(nada)"}\nTrecho: ${c.text}\nDepois: ${ctx.after || "(nada)"}`
        : `[Candidate ${c.id}] "${c.title}" ${dur}s${stitched}\nBefore: ${ctx.before || "(none)"}\nClip: ${c.text}\nAfter: ${ctx.after || "(none)"}`;
    })
    .join("\n\n");
  return pt
    ? `Avalie às cegas, um por um, os candidatos abaixo. Dê nota de 0 a 100 nas quatro dimensões hook/flow/value/trend (comparando entre si) mais uma frase de justificativa em cada; teaser = frase de suspense de até 8 palavras (instigante, sem entregar o final, no mesmo idioma da transcrição); verdict = os três níveis da porta de qualidade (publish/review/drop, conforme as regras do sistema); keep acompanha o verdict (true só para publish); note = uma frase de avaliação geral (em review/drop é obrigatório dizer qual é o defeito).\n\n${blocks}\n\n[Formato de saída] Responda com JSON estrito, sem nenhum texto a mais:\n${REVIEW_SHAPE}`
    : `Blind-review each candidate below. Score hook/flow/value/trend 0-100 each (relative) with a one-line reason per dimension; teaser = a ≤8-word suspense line (intriguing, no spoilers, transcript language); verdict = the three-tier gate (publish/review/drop, per the system rules); keep mirrors verdict (true only for publish); note = one-line overall verdict (must name the flaw for review/drop).\n\n${blocks}\n\n[Output format] STRICT JSON only:\n${REVIEW_SHAPE}`;
}
