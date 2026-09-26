/**
 * Vigia de gravações (a pasta vigiada): uma pasta é observada e, quando um vídeo novo «termina de ser
 * escrito e assenta», ele vai sozinho para a esteira de corte de ponta a ponta — a live acaba de ser
 * gravada e já sai cortada, 24 horas por dia sem ninguém olhando, conversando com o ecossistema de quem
 * grava escrevendo no disco ao vivo (gravadores de live, OBS e afins).
 *
 * As duas decisões importantes foram pensadas para o cenário de gravação:
 * - estabilidade: o arquivo sendo gravado cresce sem parar, então só depois de N rodadas seguidas com
 *   tamanho e mtime iguais ele conta como escrito;
 * - o registro do que já foi processado (seen) é persistente: reiniciar o aplicativo não corta de novo o que já saiu.
 * A vigilância é por consulta periódica, não por fs.watch: em disco de rede, com renome atômico ou com
 * escrita em partes o fs.watch não é confiável, e a consulta é mais firme.
 * Este arquivo é lógica pura (com o fs e o relógio injetados) e testável por inteiro; a ligação de
 * verdade está no processo principal.
 */

/** As extensões comuns de gravação e vídeo (inclusive contêineres de live como ts e flv). */
const VIDEO_EXTS = new Set(["mp4", "mkv", "mov", "flv", "ts", "webm", "m4v", "avi"]);

export function isVideoFile(name: string): boolean {
  if (name.startsWith(".")) return false; // arquivo oculto / temporário de download com ponto na frente
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.has(ext);
}

export interface WatchedFile {
  path: string;
  size: number;
  mtimeMs: number;
}

/** O registro do que já foi processado (a forma do JSON persistido): caminho → a impressão de tamanho na hora do processamento. */
export interface SeenMap {
  [path: string]: { size: number; mtimeMs: number };
}

/** Mesmo caminho com a mesma impressão conta como já processado; se o arquivo for sobrescrito (tamanho ou mtime diferente), ele é tratado como novo. */
export function isSeen(seen: SeenMap, f: WatchedFile): boolean {
  const rec = seen[f.path];
  return Boolean(rec && rec.size === f.size && rec.mtimeMs === f.mtimeMs);
}

export interface FolderWatcherOptions {
  /** A listagem da pasta (devolve só o stat dos arquivos de vídeo); se lançar, aquela rodada é pulada. */
  listDir: () => Promise<WatchedFile[]>;
  /** O retorno de um arquivo novo que terminou de ser escrito (em série: o próximo só é enviado quando o anterior termina). */
  onStable: (file: WatchedFile) => Promise<void>;
  /** O julgamento de «já processado» (que normalmente consulta o SeenMap persistido). */
  isSeen: (file: WatchedFile) => boolean;
  /** Quantas rodadas seguidas com o tamanho igual contam como escrito (2 por padrão). */
  stableRounds?: number;
}

interface TrackState {
  size: number;
  mtimeMs: number;
  rounds: number;
}

/**
 * O núcleo da vigilância da pasta: cada tick() lista a pasta e acompanha o tamanho de cada arquivo;
 * o arquivo que ficar stableRounds rodadas sem mudar e ainda não tiver sido processado entra em ordem no
 * onStable. O tick é disparado de fora (por um temporizador ou pelo teste).
 */
export class FolderWatcher {
  private tracks = new Map<string, TrackState>();
  private queue: WatchedFile[] = [];
  private processing = false;
  private readonly stableRounds: number;

  constructor(private readonly opts: FolderWatcherOptions) {
    this.stableRounds = Math.max(1, opts.stableRounds ?? 2);
  }

  /** Uma rodada de consulta; devolve quantos arquivos entraram na fila nesta rodada (para as asserções do teste). */
  async tick(): Promise<number> {
    let files: WatchedFile[];
    try {
      files = await this.opts.listDir();
    } catch {
      return 0; // a pasta está ilegível no momento (oscilação de disco de rede): esta rodada é pulada
    }
    const present = new Set<string>();
    let enqueued = 0;
    for (const f of files) {
      present.add(f.path);
      if (this.opts.isSeen(f)) {
        this.tracks.delete(f.path);
        continue;
      }
      const prev = this.tracks.get(f.path);
      if (prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs) {
        prev.rounds += 1;
        if (prev.rounds >= this.stableRounds) {
          this.tracks.delete(f.path);
          this.queue.push(f);
          enqueued += 1;
        }
      } else {
        // Arquivo novo, ou ainda crescendo: a contagem de rodadas estáveis recomeça
        this.tracks.set(f.path, { size: f.size, mtimeMs: f.mtimeMs, rounds: 0 });
      }
    }
    // Os arquivos que sumiram da pasta (movidos ou apagados) deixam de ser acompanhados
    for (const p of [...this.tracks.keys()]) if (!present.has(p)) this.tracks.delete(p);
    void this.drain();
    return enqueued;
  }

  /** Consumo da fila em série: a máquina que grava roda uma esteira de corte por vez, sem estourar a CPU. */
  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const f = this.queue.shift()!;
        if (this.opts.isSeen(f)) continue; // foi marcado por outro caminho enquanto estava na fila
        try {
          await this.opts.onStable(f);
        } catch {
          // A falha de um arquivo não atrapalha os seguintes (relatar o erro é responsabilidade do próprio onStable)
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /** Espera a fila atual esvaziar (para os testes e para uma parada graciosa). */
  async idle(): Promise<void> {
    while (this.processing || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}
