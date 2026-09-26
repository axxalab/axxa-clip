/**
 * O contrato de API entre a interface e o backend da esteira, independente de
 * plataforma.
 *
 * O renderer depende APENAS desta interface, nunca do Electron diretamente.
 * Implementações:
 *  - Electron: o preload leva estas chamadas por IPC até src/main (o atual).
 *  - Desenvolvimento no navegador e uma futura plataforma web: uma
 *    implementação em HTTP ou simulada (veja renderer/src/api/provider.ts).
 *    É essa costura que faz de uma futura publicação na web um adaptador novo,
 *    e não uma reescrita.
 */

/** Descrição normalizada de um arquivo de mídia importado. */
export interface MediaInfo {
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
  bitRate: number;
  videoCodec: string;
  /** Índice global da trilha escolhida para renderizar; opcional para pontos de controle e adaptadores antigos. */
  videoStreamIndex?: number;
  audioCodec: string;
  /** Índice global da trilha escolhida para o áudio; opcional para pontos de controle e adaptadores antigos. */
  audioStreamIndex?: number;
  /** Opcional, para compatibilidade com sessões já salvas e com adaptadores. */
  pixelFormat?: string;
  bitDepth?: number;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
  colorRange?: string;
  hdrPeakNits?: number;
}

/** Como o intervalo de tempo de uma palavra foi obtido. Ausente significa uma transcrição antiga. */
export type WordTimingSource = "native" | "aligned" | "interpolated" | "edited" | "estimated";

/** Um token ou palavra com tempo (motores de escritas ideográficas emitem um token por caractere — mesmo formato). */
export interface TranscriptWord {
  text: string;
  startSec: number;
  endSec: number;
  /** Id do falante na separação de falantes (começando em 0); ausente quando a separação não rodou. */
  speaker?: number;
  /** Origem da marcação de tempo, como categoria; nunca apresentada como uma confiança numérica inventada. */
  timingSource?: WordTimingSource;
}

export interface TimingQualitySpan {
  startSec: number;
  endSec: number;
  text: string;
  wordCount: number;
}

export interface AlignmentQualityReport {
  matchedFrac: number;
  alignedWords: number;
  interpolatedWords: number;
  /** Intervalos de tempo absolutos da mídia de origem que ainda dependeram de interpolação. */
  uncertainSpans: TimingQualitySpan[];
}

export type SubtitleQualityIssueCode =
  | "invalid-timing"
  | "overlap"
  | "reading-speed"
  | "short-display"
  | "oversize-token"
  | "uncertain-timing";

export interface SubtitleQualityIssue {
  code: SubtitleQualityIssueCode;
  severity: "warning" | "error";
  startSec: number;
  endSec: number;
  value?: number;
  wordCount?: number;
}

export interface SubtitleQualityReport {
  status: "pass" | "warn" | "error";
  lineCount: number;
  maxCps: number;
  uncertainWords: number;
  issues: SubtitleQualityIssue[];
}

/** Uma unidade mais ou menos do tamanho de uma frase, construída a partir das palavras; é a granularidade que aparece no editor. */
export interface TranscriptSegment {
  id: number;
  startSec: number;
  endSec: number;
  text: string;
  words: TranscriptWord[];
  /** Dominant diarization speaker id (0-based); absent when not diarized. */
  speaker?: number;
  /** Esta frase foi corrigida automaticamente pelo glossário (usado para marcar na transcrição e na bancada de revisão). */
  glossaryApplied?: boolean;
}

/** Entrada do glossário: o erro recorrente do reconhecimento de fala → a grafia correta (nomes de pessoa, marcas, termos técnicos). */
export interface GlossaryEntry {
  wrong: string;
  right: string;
}

export interface Transcript {
  /** Idioma principal detectado ou usado, por exemplo "pt" ou "en". */
  language: string;
  segments: TranscriptSegment[];
  /** Id do motor que produziu isto (por exemplo "sensevoice-local"). */
  engine: string;
  durationSec: number;
}

export type TranscribeStage =
  | "preparing"
  | "downloading-model"
  | "extracting-model"
  | "decoding"
  | "transcribing"
  | "finalizing";

/** Dados de catálogo mais o estado de execução de uma opção de motor de transcrição. */
export interface AsrEngineInfo {
  id: string;
  kind: "local" | "cloud";
  langs: string[];
  sizeMB?: number;
  speed: 1 | 2 | 3;
  accuracy: 1 | 2 | 3;
  uploads: boolean;
  experimental?: boolean;
  /** O modelo local já está em disco (nada para baixar). */
  installed: boolean;
}

export interface TranscribeProgressEvent {
  /** Fração de 0 a 1 do trabalho da etapa atual. */
  fraction: number;
  stage: TranscribeStage;
  downloadedBytes?: number;
  totalBytes?: number;
  completedWindows?: number;
  totalWindows?: number;
  resumedWindows?: number;
}

export interface SpeechRunOptions {
  localServiceUrl?: string;
  restart?: boolean;
  language?: string;
}

export interface AlignmentRequest {
  segmentIds: number[];
  engine: "paraformer" | "qwen3";
  language?: string;
  localServiceUrl?: string;
}

export interface AlignmentPreview {
  segments: TranscriptSegment[];
  skipped: Array<{ id: number; reason: "unsupported-language" | "low-match" | "invalid-timing" }>;
  alignedWords: number;
  uncertainWords: number;
}

/** Configuração de conexão com o LLM (endpoint compatível com OpenAI; a predefinição padrão é o Atlas Cloud). */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Faixa de duração do clipe: o ritmo muda conforme a plataforma e o posicionamento da conta (curta = ritmo vertical acelerado, longa = trechos marcantes de podcast e vídeo longo). */
export type ClipLength = "short" | "standard" | "long";

/** Briefing do usuário (v0.13): em linguagem natural, o que a IA deve procurar e o que não deve nesta sessão. */
export interface DetectBrief {
  /** Procure especialmente: "só a parte em que ele fala de pós-venda", "foque nos trechos sobre fracasso empreendendo". */
  focus?: string;
  /** Exclua explicitamente: "nada de sorteio nem leitura de chat", "tire o aquecimento do começo". */
  exclude?: string;
}

/** Primeiro nível do funil de dois estágios: endpoint de modelo pequeno local (Ollama e outras interfaces compatíveis com OpenAI, em geral sem chave). */
export interface PrefilterConfig {
  baseUrl: string;
  model: string;
  /** Chave de API do endpoint de nuvem (dispensável no Ollama local). */
  apiKey?: string;
}

/** Quanto o funil economizou: o texto completo comparado à parte que chegou à nuvem (para exibir na interface e para auditoria). */
export interface FunnelStats {
  totalSegments: number;
  keptSegments: number;
  totalChars: number;
  keptChars: number;
}

/** Estatística de amostragem de quadros do sinal de pico visual (a interface mostra "quantos quadros foram vistos e quantos trechos foram marcados"). */
export interface VisionStats {
  framesTotal: number;
  framesScored: number;
  peakCount: number;
  /** Esta rodada usou a varredura completa (v0.13; ausente na varredura rápida). */
  fullScan?: boolean;
  /** Quantidade de momentos que a varredura completa descreveu (a linha do tempo visual entrou na evidência de seleção). */
  notedMoments?: number;
  /** Observações da varredura completa, em quantidade limitada, guardadas para a busca por evidência com marcação de tempo. */
  notes?: Array<{ t: number; energy: number; note: string; visibleText?: string[] }>;
  /** Revisão visual dos candidatos: quantos foram revisados (v0.12; ausente quando a revisão não rodou). */
  candidatesReviewed?: number;
  /** Revisão visual dos candidatos: quantos ganharam ou perderam pontos. */
  candidatesAdjusted?: number;
}

/** Estatística do sinal de pico de expressão (roda sozinho, sem configuração; a interface mostra "quantos rostos foram lidos e quantos trechos marcados"). */
export interface EmotionStats {
  framesTotal: number;
  facesScored: number;
  peakCount: number;
}

/** Estatística do sinal de euforia do chat (o arquivo .xml de mesmo nome é descoberto sozinho; a interface mostra "quantas mensagens foram lidas e quantos trechos marcados"). */
export interface DanmakuStats {
  count: number;
  peakCount: number;
}

/** Estatística dos sinais de emoção na voz e de eventos de áudio (nova varredura em janelas curtas com o SenseVoice; a interface mostra "quantas janelas foram ouvidas e quantos trechos marcados"). */
export interface VoiceTagStats {
  windowsPlanned: number;
  windowsScored: number;
  emotionPeakCount: number;
  eventPeakCount: number;
}

/** Lista de modelos que o endpoint do LLM oferece agora (o resultado de GET /models; em caso de falha, ids vem vazio e error traz o motivo). */
export interface ModelListResult {
  ids: string[];
  error: string | null;
}

/** Um intervalo da origem dentro de uma costura de vários trechos (tempo absoluto da origem); os detalhes estão em core/pieces.ts. */
export interface ClipPiece {
  startSec: number;
  endSec: number;
}

/** Um clipe candidato indicado pela IA, com limites precisos no quadro. */
export interface HighlightCandidate {
  id: number;
  /** Início do intervalo: numa costura de vários trechos, é o início do primeiro trecho. */
  startSec: number;
  /** Fim do intervalo: numa costura de vários trechos, é o fim do último trecho (não é a duração do vídeo final). */
  endSec: number;
  /**
   * Lista dos trechos da costura (em ordem de tempo). Ausente, ou com apenas 1
   * trecho, significa um clipe contínuo comum.
   * A duração do vídeo final é a soma dos trechos, e não endSec menos startSec —
   * use sempre clipDurationSec() para obtê-la.
   */
  pieces?: ClipPiece[];
  /** O texto literal da transcrição que o clipe cobre. */
  text: string;
  /** Título sugerido para publicar (no idioma da transcrição). */
  title: string;
  /** A frase de gancho com que o clipe abre. */
  hook: string;
  /** Nota de ordenação por potencial viral, de 0 a 100 — é um ORDENADOR, não uma afirmação de verdade. */
  score: number;
  /** Justificativa em uma linha ("por que este clipe") — a semente da cadeia de evidências. */
  reason: string;
  /**
   * Como os limites foram localizados (sinal de qualidade da correspondência para
   * a interface).
   * "signal" = este clipe não foi cortado a partir da fala, e o tempo vem da fusão
   * dos sinais de imagem e som (é o único jeito possível em gêneros como dança,
   * pets e rua, onde a transcrição não tem conteúdo; veja
   * core/highlight/moments.ts).
   */
  boundary: "exact" | "anchored" | "segment" | "signal";
  /** Tipos de evidência que o candidato vindo de sinal acertou (só existe quando boundary="signal"); a interface e o comprovante mostram a cadeia de evidências. */
  signalEvidence?: string[];
  /** Palavras-chave literais de dentro do clipe (para destacar na legenda); pode vir vazio. */
  keywords: string[];
  /** Detalhamento do potencial viral em quatro dimensões (0 a 100 em cada), vindo da reavaliação da segunda etapa. */
  scoreDims?: { hook: number; flow: number; value: number; trend: number };
  /** Justificativa de uma linha por dimensão, vinda da reavaliação; pode ser string vazia. */
  dimNotes?: { hook: string; flow: string; value: string; trend: string };
  /** Frase curta de suspense (até 15 caracteres), utilizável como gancho de texto sobre o vídeo. */
  teaser?: string;
  /** Julgamento da reavaliação da segunda etapa: false significa que o revisor da IA não recomenda publicar. */
  recommended: boolean;
  /** Observação de uma linha do revisor (por que é fraco ou por que é forte); pode vir vazia. */
  reviewNote: string;
  /** Evidência estruturada opcional, vinda da revisão visual de candidatos já ativada. */
  visualEvidence?: {
    score: number;
    scene: string;
    match: boolean;
    /** Textos curtos que puderam ser lidos com confiança nos quadros amostrados; vazio ou ausente significa incerteza. */
    visibleText?: string[];
  };
  /**
   * Os três níveis da porta de qualidade (v0.13): publish = recomendado publicar /
   * review = tem defeito sério e precisa de conferência humana / drop = não
   * recomendado publicar.
   * Ausente significa que não passou pela porta de qualidade (candidato vindo de
   * sinal, reavaliação que falhou ou dados antigos), e a interface trata como um
   * candidato comum.
   */
  gate?: "publish" | "review" | "drop";
  /** Lista de motivos da porta de qualidade (reavaliação do LLM mais os defeitos da camada de regras; é a cadeia de evidências que a pessoa lê). */
  gateNotes?: string[];
  /** Densidade útil (o décimo caminho, v0.14): passando do limite, o clipe "vale salvar", e o texto de publicação passa a mirar salvamento e busca. */
  utility?: { score: number; hits: string[] };
  /** A pessoa ajustou os pontos de corte à mão (na bancada de revisão ou nos botões de ajuste): a exportação pula o encaixe na troca de plano e respeita a decisão humana. */
  manualBounds?: boolean;
}

/** Retorno das decisões de revisão: as características mínimas de um candidato revisado (arquivo local de preferências; basta o suficiente para o LLM reconhecer "desse tipo"). */
export interface ReviewedCandidate {
  title: string;
  hook: string;
  score: number;
  /** Duração do clipe (em segundos, arredondada) — a duração também é uma preferência. */
  durationSec: number;
  keywords?: string[];
}

/** O resultado de uma publicação numa plataforma; contém só o desempenho do conteúdo, nunca credenciais de conta nem caminhos locais. */
export interface PerformanceEntry {
  /** Identificador de conteúdo estável, gerado pelo HotClip na exportação; é separado do id do vídeo na plataforma. */
  contentId?: string;
  id?: string;
  title: string;
  hook?: string;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  durationSec?: number;
  keywords?: string[];
  publishedAt?: string;
  importedAt: string;
  matchConfidence?: "id" | "title-platform" | "title" | "ambiguous" | "unmatched";
}

export interface PerformanceMatchSummary {
  matched: number;
  unmatched: number;
  ambiguous: number;
  unmatchedTitles: string[];
  ambiguousTitles: string[];
}

export interface PerformanceImportResult {
  imported: number;
  skipped: number;
  total: number;
  correlation: PerformanceMatchSummary;
}

export interface PublishLedgerItem {
  contentId: string;
  filePath: string;
  title: string;
  hook?: string;
  platform: string;
  durationSec: number;
  keywords?: string[];
  exportedAt: string;
  metricsImportedAt?: string;
  /** Presente apenas quando esta exportação faz parte de um teste de embalagem com várias versões. */
  experimentId?: string;
  variantIndex?: number;
  variantTotal?: number;
  variantRole?: "control" | "challenger";
  experimentDimensions?: Array<"packaging" | "opening">;
}

export type PerformanceExperimentStatus =
  | "awaiting-metrics"
  | "incomplete-group"
  | "ambiguous-metrics"
  | "platform-mismatch"
  | "missing-publish-time"
  | "outside-window"
  | "low-sample"
  | "inconclusive"
  | "directional";

export interface PerformanceExperimentVariant {
  contentId: string;
  title: string;
  index: number;
  role: "control" | "challenger";
  views?: number;
  weightedEngagementRate?: number;
  publishedAt?: string;
}

/** Comparação local conservadora; "directional" é evidência, nunca uma afirmação de causa. */
export interface PerformanceExperiment {
  experimentId: string;
  platform: string;
  dimensions: Array<"packaging" | "opening">;
  variantTotal: number;
  measuredVariants: number;
  status: PerformanceExperimentStatus;
  createdAt: string;
  leaderContentId?: string;
  relativeLiftPct?: number;
  absoluteLiftPoints?: number;
  variants: PerformanceExperimentVariant[];
}

/** Resumo dos dados mostrado na central de configurações; os acertos e os pontos fracos usam a mesma nota local de qualidade para ordenar. */
export interface PerformanceSummary {
  total: number;
  platforms: string[];
  winners: PerformanceEntry[];
  laggards: PerformanceEntry[];
  publishing: {
    total: number;
    awaitingMetrics: number;
    measured: number;
    recent: PublishLedgerItem[];
  };
  experiments: {
    total: number;
    ready: number;
    awaiting: number;
    insufficient: number;
    recent: PerformanceExperiment[];
  };
}

/** Escolhas de estilo da legenda queimada (none = sem legenda; bubble = renderizada pelo navegador). */
export type CaptionStyleChoice = "none" | "karaoke" | "keyword" | "pop" | "hormozi" | "minimal" | "bubble";

/** Configuração da marca d'água: um PNG queimado num canto da imagem. */
export interface BrandWatermark {
  /** Caminho absoluto da imagem (o recomendado é um PNG com fundo transparente). */
  path: string;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Opacidade de 0 a 1. */
  opacity: number;
}

/**
 * Predefinição de estilo da marca: configure uma vez e reutilize em cada clipe —
 * os concorrentes trancam isso atrás de um paywall.
 * Tudo é opcional; os campos ausentes usam o padrão interno, e a saída fica byte
 * a byte igual à de quem não configurou nada.
 */
export interface BrandStyle {
  /** Cor principal de destaque, no formato "#RRGGBB": o aceso do karaokê, a ênfase na palavra-chave, o gancho de abertura e o gradiente do balão vêm todos dela. */
  highlightColor?: string;
  /** Escala do tamanho da fonte (três níveis: 0,68 / 1 / 1,18; valores livres também são aceitos). */
  fontScale?: number;
  /** Posição da legenda, mais alta ou mais baixa (três níveis dentro da zona segura). */
  captionPosition?: "low" | "standard" | "high";
  /** Marca d'água com logo; sem isso, nada é queimado. */
  watermark?: BrandWatermark;
}

/** Os três níveis de tamanho da legenda da marca; a camada de renderização e a esteira de exportação usam os mesmos, para que a versão instalada no Windows não sofra desvio de nível. */
export const FONT_SCALE_CHOICES = { small: 0.68, standard: 1, large: 1.18 } as const;

/**
 * Nível de qualidade da exportação → CRF do x264. Quanto menor o número, mais
 * nítido e maior o arquivo;
 * o nível high mantém o padrão histórico (18), e trocar de nível afeta apenas o
 * tamanho e a nitidez, sem alterar nenhuma decisão de edição.
 */
export type ExportQuality = "high" | "standard" | "compact";

export const QUALITY_CRF: Record<ExportQuality, number> = {
  high: 18,
  standard: 23,
  compact: 28,
};

/** Opções de renderização da etapa de exportação (as chaves que aparecem na lista de destaques). */
export interface ExportOptions {
  /** Recorte central para o vertical 9:16 (1080×1920) — pronto para vídeo curto. */
  vertical: boolean;
  /** Estilo de legenda a queimar na imagem. */
  captionStyle: CaptionStyleChoice;
  /** Remove os silêncios de dentro do clipe, para um ritmo mais apertado, de edição feita à mão. */
  jumpCut: boolean;
  /** Manter as respiradas: quando o corte seco remove pausas longas, deixa cerca de 0,25s de ar em cada emenda, em vez de colar tudo sem folga. */
  keepBreath?: boolean;
  /** Marca de falante: em clipes com várias pessoas, a troca de falante coloca um "A:" colorido no começo da linha da legenda (só existe com o modo multi-falante ligado). */
  speakerLabels?: boolean;
  /** Variação controlada do template: desloca levemente a geometria da legenda conforme uma semente por clipe, para que exportações em lote não compartilhem a mesma impressão digital. */
  templateJitter?: boolean;
  /** Remove hesitações ("é…", "ãh", "um", "uh") e repetições de gagueira. */
  cleanFillers?: boolean;
  /** Cortar as tomadas refeitas: quando a mesma frase é dita duas vezes seguidas, só a última fica. */
  cutRetakes?: boolean;
  /** Movimento automático de câmera: os clipes verticais recebem uma camada de aproximação e afastamento lentos, para que o plano fixo não pareça mais engessado. */
  autoZoom?: boolean;
  /** Correção inteligente de imagem: mede a imagem que de fato ficou e corrige com contenção brilho, contraste e saturação; vem desligada. */
  autoEnhance?: boolean;
  /** Acentos sonoros: whoosh na emenda da costura, ding no pico de emoção e pop no gancho de abertura, no máximo 3 por clipe. */
  sfx?: boolean;
  /** Caminho do arquivo de trilha: entra em laço cobrindo o clipe inteiro e é mixado abaixando sob a voz; vazio ou ausente significa sem trilha. */
  bgmPath?: string;
  /** Id do gênero da transmissão (genre.ts): o lado da exportação usa isso para escolher o limite de silêncio do corte seco. */
  genreId?: string;
  /** Pontos de corte precisos: os candidatos passam por um segundo alinhamento com o Paraformer para corrigir a marcação por palavra (o primeiro uso baixa um modelo de ~240 MB). */
  preciseAlign?: boolean;
  /** Recorta sozinho os elementos fixos de uma gravação de tela (barra de status, interface do app, tarjas pretas). */
  trimUi: boolean;
  /** Queima o título de cada clipe na zona segura superior. */
  titleCard: boolean;
  /** Queima a chamada da IA (a frase de suspense) em letras grandes como gancho de abertura sobre os primeiros segundos. */
  openingHook?: boolean;
  /** Ajusta o áudio ao alvo de volume das redes sociais, -14 LUFS (EBU R128). */
  normalizeLoudness?: boolean;
  /** Redução de ruído básica: abaixa o ruído de fundo e o zumbido comuns em gravação de live (dois passa-altas mais afftdn, antes da normalização de volume). */
  denoise?: boolean;
  /** `smart` roda o realce de fala local opcional em 48 kHz; quem chamava antes continua no `basic`. */
  denoiseMode?: "basic" | "smart";
  /** Silencia, no tempo da transcrição, as ocorrências destes termos controlados pela pessoa. */
  muteTerms?: string[];
  /** Compilado dos melhores momentos: os clipes são emendados em ordem de tempo por cópia direta do fluxo, com um arquivo de texto de capítulos. */
  compilation?: boolean;
  /** Abertura fria: a frase de gancho vira um trecho curto emendado no começo do clipe, e depois vem o vídeo inteiro (cold open). */
  coldOpen?: boolean;
  /** Antecipação do pico: de 0,3 a 1s do pico de emoção aparece na abertura e depois volta (é a versão visual da abertura fria). */
  flashForward?: boolean;
  /** Duas proporções: além do vertical, sai também uma versão horizontal na proporção original (o vertical vai para o TikTok e o horizontal para YouTube e Bilibili). */
  alsoLandscape?: boolean;
  /** Predefinição de estilo da marca (cor de destaque, tamanho da fonte, posição, marca d'água); ausente usa o padrão interno. */
  brand?: BrandStyle;
  /** Legenda bilíngue: a tradução da frase inteira é queimada como uma faixa menor abaixo da legenda principal; falhas de tradução são puladas em silêncio. */
  translate?: { targetLang: string; llm: LlmConfig };
  /** Texto de publicação: cada clipe recebe título, hashtags e descrição, salvos em .post.txt e no clips.json; falhas são puladas em silêncio. */
  publishCopy?: { llm: LlmConfig };
  /** Coloca ao lado de cada clipe um arquivo .srt de mesmo nome (para subir a legenda na plataforma ou refinar depois; no modo bilíngue inclui a linha traduzida). */
  subtitleFile?: boolean;
  /** Escreve um timeline.edl na pasta de saída — os cortes da IA vão para o DaVinci ou o Premiere, revinculando a origem para o acabamento. */
  timeline?: boolean;
  /** Rascunho do JianYing: uma pasta de rascunho por clipe, que basta copiar para o diretório de rascunhos do JianYing e abrir para refinar. */
  jianyingDraft?: boolean;
  /** Capa por IA em dois níveis: volume = Seedream econômico / premium = Nano Banana Pro; exige uma chave do nível Atlas. */
  aiCover?: { tier: "volume" | "premium"; llm: LlmConfig };
  /** Selo de conteúdo por IA: sinalização explícita na imagem mais a implícita nos metadados (ativar quando a plataforma exigir declaração de uso de IA). */
  aigcLabel?: boolean;
  /** Pacote de evidências: cada clipe copia da origem, sem recodificar, os 3 minutos antes e depois (guarda a gravação original para uma revisão de autorização). */
  evidencePack?: boolean;
  /** Pacote por plataforma: a lista de ids de plataforma selecionados (platform-specs.ts); cada plataforma ganha uma pasta completa. */
  publishPack?: string[];
  /** Pacote de série por tema: organiza os vídeos originais pelas palavras-chave repetidas e gera uma lista na ordem certa. */
  seriesPack?: boolean;
  /** Várias versões: o mesmo clipe sai em count embalagens diferentes (incluindo a original, 2 ou 3); exige um LLM. */
  variants?: { count: number; llm: LlmConfig };
  /** Pasta raiz de exportação (os vídeos continuam indo para a subpasta <nome>/ dentro dela); vazio ou ausente usa o padrão do sistema, ~/Vídeos/HotClip. */
  outDir?: string;
  /** Nível de qualidade da exportação; o padrão é high, igual ao histórico (CRF 18), então atualizar não muda o vídeo final. */
  quality?: ExportQuality;
  /** Necessário para as legendas e o corte seco: é a origem da marcação por palavra. */
  transcript?: Transcript;
}

/** As chaves de renderização escolhidas na interface (o subconjunto serializável de ExportOptions, sem transcript). */
export type RenderToggles = Omit<ExportOptions, "transcript">;

/**
 * Resultado da detecção: os candidatos ordenados, mais a transcrição com os
 * falantes identificados quando a separação rodou — assim o caminho de
 * exportação leva o id de falante de cada palavra até a cor da legenda.
 */
export interface DetectHighlightsResult {
  candidates: HighlightCandidate[];
  /** Presente apenas quando a separação de falantes identificou a transcrição nesta rodada. */
  transcript?: Transcript;
  /** Estatística do funil quando a triagem local entrou em ação; ausente quando não foi usada ou voltou ao texto completo. */
  funnel?: FunnelStats;
  /** Estatística de amostragem quando o sinal de pico visual entrou em ação; ausente quando não foi usado ou houve recuo. */
  vision?: VisionStats;
  /** Estatística quando o sinal de pico de expressão entrou em ação; ausente quando não há rosto ou o modelo não está disponível. */
  emotion?: EmotionStats;
  /** Estatística quando o sinal de euforia do chat entrou em ação; ausente quando não há um .xml de chat de mesmo nome ao lado do vídeo. */
  danmaku?: DanmakuStats;
  /** Estatística quando os sinais de emoção na voz e de eventos de áudio entraram em ação; ausente quando o modelo local de transcrição não está instalado. */
  voice?: VoiceTagStats;
  /** Perfil do corte de referência (só existe quando referencePath foi informado e a análise deu certo). */
  reference?: ReferenceInfo | null;
  /** Motivo da falha ao analisar o vídeo de referência (o fluxo segue sem referência, mas a falha precisa ser vista pela pessoa). */
  referenceError?: string;
}

/** Perfil do corte de referência (entrada "Clipe de referência" no aplicativo de desktop; mesmo formato do ReferenceProfile de core/reference). */
export interface ReferenceInfo {
  durationSec: number;
  /** Velocidade da fala: caracteres por segundo em idiomas ideográficos, palavras por segundo nos demais. */
  speechRate: number;
  avgSentenceLen: number;
  /** Frequência de troca de plano (por minuto); null quando a detecção falha ou o material é só áudio. */
  cutsPerMin: number | null;
  hookLine: string;
  /** Se a contagem é feita por caracteres (escritas ideográficas) em vez de palavras. */
  charUnits: boolean;
}

/** Uma edição humana reversível. Os resultados de detecção e transcrição da IA, em vez disso, estabelecem uma nova linha de base. */
export type SessionEditCommand =
  | {
      kind: "selection";
      before: number[];
      after: number[];
    }
  | {
      kind: "candidate-update";
      candidateId: number;
      before: HighlightCandidate;
      after: HighlightCandidate;
    }
  | {
      kind: "candidate-add";
      candidate: HighlightCandidate;
      beforeSelected: number[];
      afterSelected: number[];
      beforeFocusedId: number | null;
      afterFocusedId: number | null;
    }
  | {
      kind: "transcript-update";
      changes: Array<{
        segmentId: number;
        before: TranscriptSegment;
        after: TranscriptSegment;
      }>;
    };

/** Duas pilhas seguras para JSON; o último item de cada array é o próximo comando a reexecutar. */
export interface SessionEditHistory {
  undo: SessionEditCommand[];
  redo: SessionEditCommand[];
}

/** Subconjunto estável e à prova de reinício da sessão de edição ativa do renderer. */
export interface SessionCheckpoint {
  file: MediaInfo & { path: string };
  transcript: Transcript | null;
  candidates: HighlightCandidate[] | null;
  selected: number[];
  focusedId: number | null;
  stats: {
    funnel: FunnelStats | null;
    vision: VisionStats | null;
    emotion: EmotionStats | null;
    danmaku: DanmakuStats | null;
    voice: VoiceTagStats | null;
    reference: ReferenceInfo | null;
    referenceError: string | null;
  };
  diarize: boolean;
  referencePath: string | null;
  paramsDirty: boolean;
  /** Opcional, para compatibilidade com projetos e pontos de controle anteriores à v0.16. */
  editHistory?: SessionEditHistory;
  savedAt: string;
}

/** A relação atual entre um projeto salvo e a mídia de origem dele. */
export type ProjectSourceStatus = "ready" | "offline" | "changed" | "corrupt";

/** Metadados leves do projeto, usados pela lista da área de projetos. */
export interface ProjectSummary {
  id: string;
  name: string;
  sourcePath: string;
  sourceName: string;
  status: ProjectSourceStatus;
  hasTranscript: boolean;
  candidateCount: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

/** Abrir um projeto offline, alterado ou danificado devolve os metadados, mas nenhuma sessão ativa. */
export interface ProjectOpenResult {
  project: ProjectSummary;
  checkpoint: SessionCheckpoint | null;
}

/** Carga única de inicialização, incluindo a migração idempotente de sessões antigas. */
export interface ProjectWorkspaceBootstrap {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  active: ProjectOpenResult | null;
}

/** Um arquivo de clipe exportado em disco. */
export interface ExportedClip {
  id: number;
  title: string;
  path: string;
  /** JPG de capa exportado ao lado do clipe (pode estar ausente em caso de falha). */
  coverPath?: string;
  sizeBytes: number;
  durationSec: number;
  /** Uma origem PQ/HLG explícita foi convertida para o SDR BT.709 compatível com as redes sociais. */
  colorConverted?: boolean;
  /** O HDR foi detectado, mas o caminho de cor de entrada estava incompleto ou sem suporte. */
  colorConversionSkipped?: boolean;
  /** A leitura da origem falhou, então a segurança de cor do HDR não pôde ser avaliada. */
  colorInspectionFailed?: boolean;
  /** Nível de limpeza de áudio que valeu de fato; ausente quando desligado ou vindo de adaptadores antigos. */
  audioEnhancement?: "basic" | "learned" | "fallback" | "skipped";
}

/** Dados da onda sonora da linha do tempo da bancada de revisão: a amplitude de pico de cada bloco (de 0 a 1). */
export interface AudioPeaks {
  values: number[];
  /** Tempo absoluto na origem a que o primeiro bloco corresponde. */
  startSec: number;
  /** Duração de cada bloco, em segundos. */
  hopSec: number;
}

/**
 * Dados da linha do tempo da bancada: as curvas de volume, movimento e euforia
 * do chat da transmissão inteira (de 0 a 1 por célula) mais a tira de miniaturas.
 * Com as curvas desenhadas na linha do tempo, "por que este trecho" deixa de ser
 * um texto e passa a ser um pico visível de relance.
 * Cada caminho é fail-open: um sinal que não existe devolve um array vazio, e a
 * linha do tempo renderiza o resto normalmente.
 */
export interface TimelineData {
  /** Um valor por célula (de 0 a 1); array vazio significa que este sinal não existe. */
  loudness: number[];
  motion: number[];
  danmaku: number[];
  /** JPEG em base64 de quadros amostrados uniformemente (sem o prefixo data:); uma célula com string vazia significa que aquele quadro falhou. */
  thumbs: string[];
  /** Quantos segundos cada célula da curva representa. */
  binSec: number;
}

/** Eventos do processo de monitoramento de gravações (exibidos no painel de controle do renderer). */
export interface WatchEvent {
  type: "found" | "transcribing" | "detecting" | "exporting" | "done" | "error";
  /** Nome do arquivo (para exibição). */
  file: string;
  path: string;
  /** Em done: quantos clipes foram exportados. */
  clips?: number;
  outDir?: string;
  /** Em error: o motivo em uma frase. */
  message?: string;
  at: number;
  /** Tarefa automática persistente relacionada a este evento ao vivo. */
  taskId?: string;
}

export type AutomationTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type AutomationTaskStage = "queued" | "transcribing" | "detecting" | "exporting";

/** Item de tarefa e histórico, só local, do processamento automático de gravações. */
export interface AutomationTask {
  id: string;
  sourcePath: string;
  sourceName: string;
  sourceSize: number;
  sourceMtimeMs: number;
  trigger: "folder" | "webhook" | "retry";
  status: AutomationTaskStatus;
  stage: AutomationTaskStage;
  attempts: number;
  clips?: number;
  outDir?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportProgressEvent {
  /** Posição do clipe que está sendo cortado, começando em 1. */
  current: number;
  total: number;
  clipId: number;
  stage: "preparing" | "cutting" | "finalizing" | "done";
  preparation?: "translation" | "publish" | "variants" | "media";
  /** Progresso de codificação do clipe atual, de 0 a 1 (informado ao vivo pelo ffmpeg); ausente nos eventos entre clipes. */
  fraction?: number;
}

export interface UrlImportProgressEvent {
  stage: "downloading-tool" | "resolving" | "downloading-media" | "merging" | "done";
  /** De 0 a 1 quando o total é conhecido; pode ser omitido nas etapas de resolução ou de junção. */
  fraction?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  etaSec?: number;
}

export interface UrlImportResult {
  /** Caminho da mídia local depois de baixada e juntada, de onde a esteira local de arquivos é reaproveitada por completo. */
  filePath: string;
}

export interface DiagnosticsCheck {
  id: string;
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
}

export interface DiagnosticsReport {
  checks: DiagnosticsCheck[];
  missingCoreModels: number;
  generatedAt: string;
}

export interface DiagnosticsProgressEvent {
  modelId: string;
  current: number;
  total: number;
  phase: "download" | "extract";
  fraction: number;
}

export interface HotClipApi {
  /** Abre o seletor de arquivos; resolve com um caminho ou identificador, ou null quando cancelado. */
  selectMedia: () => Promise<string | null>;
  /** Baixa um vídeo de uma página ou de um link direto HTTP(S) para a pasta administrada pelo app. */
  importMediaUrl: (url: string) => Promise<UrlImportResult>;
  /** Assina o progresso da instalação do baixador, da resolução, do download da mídia e da junção. */
  onUrlImportProgress: (cb: (p: UrlImportProgressEvent) => void) => () => void;
  /** Cancela a importação por link em andamento; arquivos antigos já baixados por completo não são afetados. */
  cancelUrlImport: () => void;
  /** Carrega a biblioteca de projetos e restaura o último projeto ativo quando a origem dele ainda é válida. */
  projectWorkspaceGet: () => Promise<ProjectWorkspaceBootstrap>;
  /** Cria e ativa um projeto a partir de uma sessão de origem recém-lida. */
  projectCreate: (checkpoint: SessionCheckpoint, name?: string) => Promise<ProjectOpenResult | null>;
  /** Ativa um projeto salvo; projetos offline ou alterados não devolvem ponto de controle até serem revinculados. */
  projectOpen: (id: string) => Promise<ProjectOpenResult | null>;
  /** Salva o estado estável de edição dentro de um projeto específico, protegido pela impressão digital da origem dele. */
  projectSave: (id: string, checkpoint: SessionCheckpoint) => Promise<boolean>;
  /** Renomeia os metadados do projeto, sem renomear nem mover a mídia de origem. */
  projectRename: (id: string, name: string) => Promise<ProjectSummary | null>;
  /** Exclui apenas o documento de projeto administrado pelo app; a mídia de origem nunca é apagada. */
  projectDelete: (id: string) => Promise<boolean>;
  /** Reconecta um projeto offline ou alterado a um arquivo de mídia compatível e recém-lido. */
  projectRelink: (id: string, filePath: string) => Promise<ProjectOpenResult | null>;
  /** Sai do projeto atual mantendo-o na biblioteca. */
  projectClose: () => Promise<void>;
  /** Restaura a última sessão de edição estável quando a impressão digital da origem ainda coincide. */
  sessionCheckpointGet: () => Promise<SessionCheckpoint | null>;
  /** Salva de forma atômica uma sessão de edição ativa; false significa que ela passou do teto de segurança. */
  sessionCheckpointSave: (checkpoint: SessionCheckpoint) => Promise<boolean>;
  /** Esquece a sessão ativa depois que a pessoa deliberadamente começa de novo. */
  sessionCheckpointClear: () => Promise<void>;
  /** Lê um arquivo de mídia (duração, trilhas, quadros por segundo); lança erro se a entrada não puder ser lida. */
  probeMedia: (filePath: string) => Promise<MediaInfo>;
  /** Lista os motores de transcrição selecionáveis com o estado de instalação. */
  listAsrEngines: () => Promise<AsrEngineInfo[]>;
  /** Transcreve com o motor escolhido; motores de nuvem precisam da chave de API da pessoa. */
  transcribeMedia: (filePath: string, engineId?: string, apiKey?: string, options?: SpeechRunOptions) => Promise<Transcript>;
  cancelTranscribe: () => void;
  checkLocalSpeech: (url: string) => Promise<{ model: string; aligner: boolean; device: string }>;
  previewAlignment: (filePath: string, transcript: Transcript, request: AlignmentRequest) => Promise<AlignmentPreview>;
  cancelAlignment: () => void;
  /** Importa um texto de legenda existente conferindo contra a duração da origem, sem reconhecimento de fala. */
  importSubtitle: (filePath: string, text: string, format: "srt" | "vtt") => Promise<Transcript>;
  /** Assina o progresso da transcrição; devolve uma função para cancelar a assinatura. */
  onTranscribeProgress: (cb: (p: TranscribeProgressEvent) => void) => () => void;
  /** Detecta candidatos a destaque pelo LLM configurado; informar filePath habilita a evidência dos sinais de imagem e som. */
  detectHighlights: (
    transcript: Transcript,
    llm: LlmConfig,
    filePath?: string,
    diarize?: boolean,
    prefilter?: PrefilterConfig | null,
    vision?: PrefilterConfig | null,
    length?: ClipLength,
    /** Modo de apresentação de produto: a lista de produtos (em venda ao vivo os trechos são escolhidos por produto, e os produtos encontrados entram nas keywords do candidato). */
    products?: string[],
    /** Caminho do vídeo viral usado como espelho: o ritmo dele é medido e a escolha dos trechos pende para esse ritmo (é preferência, não restrição rígida). */
    referencePath?: string | null,
    /** Critérios do gênero da transmissão: o id do preset interno mais o texto personalizado que a pessoa escreveu (o personalizado tem prioridade). */
    genre?: { id?: string; custom?: string } | null,
    /** Briefing do usuário: o que procurar e o que excluir explicitamente (em linguagem natural, injetado nos critérios de seleção). */
    brief?: DetectBrief | null,
    /** Varredura visual completa: com o endpoint de visão configurado, varre a transmissão inteira a cerca de 1 quadro por 30s, e a linha do tempo visual entra na evidência de seleção (leva tempo e é cobrado na nuvem, então vem desligado). */
    scan?: boolean
  ) => Promise<DetectHighlightsResult>;
  /** Corta os destaques selecionados em arquivos mp4; resolve com a lista de arquivos. */
  exportClips: (filePath: string, clips: HighlightCandidate[], options?: ExportOptions) => Promise<ExportedClip[]>;
  /** Assina o progresso de exportação de cada clipe; devolve uma função para cancelar a assinatura. */
  onExportProgress: (cb: (p: ExportProgressEvent) => void) => () => void;
  /** Cancela a exportação em andamento (interrompe o ffmpeg que está rodando; os clipes já concluídos ficam). */
  cancelExport: () => void;
  /** Mostra um arquivo exportado no Finder ou no Explorador de Arquivos. */
  revealClip: (path: string) => void;
  /**
   * URL reproduzível de uma mídia local (para o <video> da bancada de revisão);
   * string vazia significa que este ambiente não suporta prévia.
   * `view` distingue os diferentes consumidores do mesmo arquivo (a imagem
   * principal da bancada, o recorte vertical, a janela da bancada de revisão):
   * ele é embutido no pathname da URL — o Chromium não olha a query ao decidir
   * "se é o mesmo recurso de mídia", e vários <video> compartilhando um recurso
   * corrompem o buffer de mídia, então isso precisa ir no path.
   */
  mediaUrl: (filePath: string, view?: string) => string;
  /** Escolhe uma imagem (para o logo da marca d'água); cancelar devolve null. */
  selectImage: () => Promise<string | null>;
  /** Escolhe um arquivo de áudio (para a trilha de fundo); cancelar devolve null. */
  selectAudio: () => Promise<string | null>;
  /** A IA gera uma trilha livre de direitos (no estilo do gênero; exige uma chave do nível Atlas); devolve o caminho onde foi salva. */
  generateBgm: (config: LlmConfig, genreId?: string) => Promise<string>;
  /** Pega a trilha de picos de áudio de [startSec, endSec] — é a onda sonora da linha do tempo da bancada de revisão. */
  getAudioPeaks: (filePath: string, startSec: number, endSec: number) => Promise<AudioPeaks>;
  /** Dados da linha do tempo da bancada: as curvas de volume e de euforia do chat mais a tira de miniaturas (cada caminho é fail-open). */
  timelineData: (filePath: string, durationSec: number) => Promise<TimelineData>;
  /** Mosaico 3×3 de um trecho candidato (visão rápida da imagem): devolve uma data URL; falha ou ausência de suporte devolve string vazia. */
  contactSheet: (filePath: string, startSec: number, endSec: number) => Promise<string>;
  /** Pergunta ao endpoint do LLM que modelos ele realmente oferece agora (GET /models); em caso de falha devolve o motivo, sem lançar erro. */
  listLlmModels: (baseUrl: string, apiKey: string) => Promise<ModelListResult>;
  /** Retorno das decisões de revisão: na exportação, registra os candidatos aprovados e descartados desta sessão (arquivo local de preferências, injetado na próxima detecção). */
  recordReview: (video: string, kept: ReviewedCandidate[], rejected: ReviewedCandidate[]) => Promise<void>;
  /** Resumo do desempenho real das publicações (do performance-memory.json local). */
  performanceGet: () => Promise<PerformanceSummary>;
  /** Escolhe e importa um CSV ou JSON de plataforma; se a pessoa cancelar, devolve null. */
  performanceImport: () => Promise<PerformanceImportResult | null>;
  /** Exporta o modelo de preenchimento dos dados de desempenho, com identificadores de conteúdo estáveis; se a pessoa cancelar, devolve null. */
  performanceTemplate: () => Promise<{ count: number; path: string } | null>;
  /** Apaga a memória de desempenho real das publicações; não afeta as preferências subjetivas de revisão. */
  performanceClear: () => Promise<void>;
  /** Roda o diagnóstico de ambiente, que é somente leitura. */
  diagnosticsRun: (llm: LlmConfig | null, locale?: "pt" | "en") => Promise<DiagnosticsReport>;
  /** Limpa apenas as renderizações base geradas e devolve um relatório de diagnóstico atualizado. */
  diagnosticsClearRenderCache: (llm: LlmConfig | null, locale?: "pt" | "en") => Promise<DiagnosticsReport>;
  /** Limpa apenas a evidência de análise da origem, que pode ser gerada de novo, e devolve um relatório de diagnóstico atualizado. */
  diagnosticsClearEvidenceIndex: (llm: LlmConfig | null, locale?: "pt" | "en") => Promise<DiagnosticsReport>;
  /** Baixa explicitamente, de forma antecipada, os modelos padrão da esteira que estão faltando; com retomada de download. */
  diagnosticsPrepareModels: (llm: LlmConfig | null, locale?: "pt" | "en") => Promise<DiagnosticsReport>;
  onDiagnosticsProgress: (cb: (p: DiagnosticsProgressEvent) => void) => () => void;
  diagnosticsCancelRepair: () => void;
  /** Escolhe uma pasta (para o monitoramento de gravações); cancelar devolve null. */
  selectDir: () => Promise<string | null>;
  /** Pasta raiz de exportação de fábrica (~/Vídeos/HotClip), que é o que a interface mostra enquanto a pessoa não escolhe outra. */
  defaultOutDir: () => Promise<string>;
  /** Inventário de modelos: onde ficam guardados, quais estão instalados e quanto cada um ocupa (exibido na página de configurações). */
  modelsInfo: () => Promise<ModelsInfo>;
  /** Move a pasta de modelos inteira para um novo lugar; devolve o caminho que passou a valer. Em caso de falha, a pasta original não é afetada. */
  moveModelsDir: (dir: string) => Promise<string>;
  /** Abre uma pasta no gerenciador de arquivos do sistema. */
  openFolder: (path: string) => void;
  /** Começa a monitorar a pasta: uma gravação nova é cortada automaticamente, de ponta a ponta, assim que termina de ser escrita. */
  watchStart: (dir: string, llm: LlmConfig, outDir?: string) => Promise<void>;
  watchStop: () => Promise<void>;
  watchStatus: () => Promise<{ running: boolean; dir: string | null }>;
  /** Fila persistente e histórico do processamento automático (o mais novo primeiro). */
  automationTasksGet: () => Promise<AutomationTask[]>;
  /** Tenta de novo uma tarefa que falhou, foi interrompida ou cancelada, com as configurações atuais de LLM. */
  automationTaskRetry: (id: string, llm: LlmConfig, outDir?: string) => Promise<boolean>;
  /** Cancela uma tarefa na fila ou em execução. */
  automationTaskCancel: (id: string) => Promise<boolean>;
  /** Remove o histórico de tarefas já encerradas; as ativas ficam. */
  automationTasksClear: () => Promise<void>;
  /**
   * Sobe o endpoint de webhook de gravação (o retorno de fim de transmissão do
   * BililiveRecorder ou do blrec já produz os cortes). Escuta apenas em
   * 127.0.0.1, e o caminho de arquivo que vem no retorno precisa estar dentro de
   * dir. Devolve a porta em que ficou escutando.
   */
  webhookStart: (
    dir: string,
    llm: LlmConfig,
    outDir?: string,
    port?: number,
    token?: string
  ) => Promise<{ port: number; dir: string }>;
  webhookStop: () => Promise<void>;
  webhookStatus: () => Promise<{ running: boolean; port: number | null; dir: string | null }>;
  /** Assina os eventos do processo de monitoramento; devolve uma função para cancelar a assinatura. */
  onWatchEvent: (cb: (e: WatchEvent) => void) => () => void;
  /** Verifica uma vez se há versão nova; sem internet ou em caso de falha devolve null (fail-open, nunca incomoda). */
  checkUpdate: () => Promise<UpdateInfo | null>;
  /** Abre um link externo (só domínios da lista de permissões; hoje apenas o GitHub deste projeto). */
  openUrl: (url: string) => void;
  /** Lê o glossário (guardado localmente e aplicado sozinho depois da transcrição). */
  glossaryGet: () => Promise<GlossaryEntry[]>;
  /** Grava o glossário inteiro de volta (acrescentar, remover e alterar passam todos por aqui). */
  glossarySet: (entries: GlossaryEntry[]) => Promise<void>;
}

/** Resultado do inventário de modelos (o "Local de armazenamento dos modelos" da página de configurações). */
export interface ModelsInfo {
  /** A pasta raiz de modelos que está valendo agora. */
  root: string;
  /** O local de fábrica — é a partir dele que a opção "restaurar o padrão" é oferecida depois que a pessoa muda. */
  defaultRoot: string;
  /** Total de bytes ocupados pelos modelos instalados. */
  totalBytes: number;
  entries: Array<{
    id: string;
    /** A chave de i18n do texto que descreve para que serve. */
    useKey: string;
    installed: boolean;
    bytes: number;
    approxBytes: number;
  }>;
}

/** Resultado da verificação de versão nova. */
export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  url: string;
}
