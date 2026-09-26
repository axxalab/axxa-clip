/**
 * Protocolo de atribuição de causa das falhas de transcrição (issue #2).
 * Antes, toda falha mostrava «confira se o arquivo tem trilha de áudio», e a pessoa era levada a
 * transcodificar o material sem parar — a causa de verdade (download do modelo que falhou, descompactação
 * que falhou, material realmente sem trilha) precisa ser separada e chegar à interface.
 * O processo principal marca a causa na fronteira do IPC, e a camada de renderização lê a marca e escolhe
 * o texto; como a marca só atravessa o IPC dentro da string da message, o que se usa é um token de prefixo
 * estável, e não uma subclasse de Error.
 */

/** A sondagem confirmou que o material não tem trilha de áudio — só trocar o material resolve. */
export const ERR_TAG_NO_AUDIO = "[hotclip:no-audio]";
/** O download ou a descompactação do modelo falhou — é a rede ou o disco, e não tem nada a ver com o material. */
export const ERR_TAG_MODEL_DOWNLOAD = "[hotclip:model-download]";
/** O modelo está lá, mas não carregou — o caso mais comum é a camada nativa não abrir um caminho com acento no Windows (issue #4), e o segundo é o arquivo do modelo estar corrompido. */
export const ERR_TAG_MODEL_LOAD = "[hotclip:model-load]";

export type TranscribeErrorKind = "no-audio" | "model-download" | "model-load" | "generic";

/**
 * No processo principal: marca o erro original conforme o resultado da sondagem extra feita depois da falha.
 * Sem resultado (quando o probe também falha), o erro fica como veio — melhor genérico que acusar o material à toa.
 */
export function tagTranscribeError(rawMessage: string, media: { hasAudio: boolean } | null): string {
  if (media && !media.hasAudio) return `${ERR_TAG_NO_AUDIO} ${rawMessage}`;
  if (/model download failed/i.test(rawMessage)) return `${ERR_TAG_MODEL_DOWNLOAD} ${rawMessage}`;
  // O texto fixo de quando a camada nativa do sherpa falha ao criar o recognizer — o arquivo do modelo não abre ou está corrompido, e o material não tem culpa
  if (/check your config/i.test(rawMessage)) return `${ERR_TAG_MODEL_LOAD} ${rawMessage}`;
  return rawMessage;
}

/**
 * Geral: tira o prefixo de embrulho do IPC do Electron ("Error invoking remote method 'x': Error: ...").
 * Todo erro de IPC que vai ser mostrado à pessoa passa por aqui primeiro — o embrulho só afoga a única
 * frase que serve para algo (issue #6).
 */
export function stripIpcError(raw: string): string {
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "").trim();
}

/**
 * Na camada de renderização: tira o prefixo de embrulho do Electron do texto de erro que voltou pelo IPC,
 * reconhece a marca para classificar, e guarda o detalhe original que dá para mostrar à pessoa (é o que tem
 * valor de diagnóstico quando ela abre uma issue).
 */
export function parseTranscribeError(raw: string): { kind: TranscribeErrorKind; detail: string } {
  let detail = stripIpcError(raw);
  let kind: TranscribeErrorKind = "generic";
  if (detail.includes(ERR_TAG_NO_AUDIO)) {
    kind = "no-audio";
    detail = detail.replace(ERR_TAG_NO_AUDIO, "").trim();
  } else if (detail.includes(ERR_TAG_MODEL_DOWNLOAD)) {
    kind = "model-download";
    detail = detail.replace(ERR_TAG_MODEL_DOWNLOAD, "").trim();
  } else if (detail.includes(ERR_TAG_MODEL_LOAD)) {
    kind = "model-load";
    detail = detail.replace(ERR_TAG_MODEL_LOAD, "").trim();
  }
  return { kind, detail };
}
