/**
 * Verificação de versão nova: na inicialização, o releases/latest do GitHub é consultado uma vez em silêncio
 * e, havendo versão nova, o cabeçalho avisa e aponta a página de download — montar uma cadeia de atualização
 * automática num aplicativo sem assinatura é pesado demais, e «saber que existe versão nova» é o elo mais
 * fino e mais necessário do ciclo de distribuição. Sem rede, com limite de uso ou com falha de leitura, tudo
 * fica em silêncio (falha em aberto) e ninguém é incomodado. As funções puras (comparação de versão e leitura
 * da resposta) são testáveis, e o fetch é injetado.
 */

export const RELEASES_URL = "https://github.com/xixihhhh/hotclip/releases/latest";
const LATEST_API = "https://api.github.com/repos/xixihhhh/hotclip/releases/latest";

/** "v1.2.3" / "1.2.3" → [1,2,3]; sem conseguir ler, devolve null. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Devolve true quando latest é mais nova que current (se qualquer uma não puder ser lida, devolve false: melhor o silêncio que o alarme falso). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  url: string;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/** Consulta a versão mais nova uma vez; qualquer falha devolve null (ninguém é incomodado). */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<UpdateInfo | null> {
  try {
    const res = await fetchImpl(LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: unknown };
    const latest = typeof data.tag_name === "string" ? data.tag_name : "";
    if (!parseVersion(latest)) return null;
    return {
      current: currentVersion,
      latest: latest.replace(/^v/, ""),
      hasUpdate: isNewerVersion(latest, currentVersion),
      url: RELEASES_URL,
    };
  } catch {
    return null;
  }
}
