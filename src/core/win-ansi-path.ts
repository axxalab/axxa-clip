/**
 * Resgate de caminho não-ASCII no Windows (issue #4).
 *
 * A camada nativa do sherpa-onnx abre o arquivo do modelo em ANSI (std::ifstream) e, quando o caminho tem
 * caractere fora do ASCII (o caso mais comum: um nome de usuário com acento, como C:\Users\Conceição\...),
 * ela interpreta os bytes UTF-8 pela página de código do sistema, nada abre, e a criação do recognizer
 * lança direto «Please check your config!». O fs do próprio Node usa a API de caracteres largos e não tem
 * esse problema — por isso baixar e inventariar os modelos funciona, e só o caminho entregue à camada
 * nativa explode.
 *
 * A solução: a pasta, que já existe, é convertida no caminho curto 8.3 (cada trecho fica em ASCII puro,
 * como C:\Users\3F2D~1\...) antes de ir para a camada nativa. Se não der para converter (o volume
 * desligou a geração de nomes 8.3, por exemplo), o caminho volta como veio, e a camada de atribuição de
 * causa do erro avisa a pessoa para mover os modelos para um caminho sem acento.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Se o caminho tem caractere que o ANSI não abre (critério conservador: qualquer coisa fora do ASCII imprimível já conta). */
export function hasNonAscii(path: string): boolean {
  return /[^\x20-\x7e]/.test(path);
}

/** Literal de string com aspas simples do PowerShell: a aspa simples de dentro é duplicada, e não há outra regra de escape. */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Só no win32 e só quando o caminho tem caractere fora do ASCII: a pasta existente é convertida no
 * caminho curto 8.3; nos outros casos (ou quando a conversão falha, ou o resultado continua fora do ASCII)
 * o caminho volta como veio, sem nunca lançar — isto aqui é só o resgate, e a atribuição de causa do erro
 * tem a sua própria saída.
 */
export async function toAnsiSafeDir(dir: string): Promise<string> {
  if (process.platform !== "win32" || !hasNonAscii(dir)) return dir;
  try {
    const script = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder(${psQuote(dir)}).ShortPath`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 15_000 }
    );
    const short = stdout.trim();
    // Com o 8.3 desligado no volume, o ShortPath devolve o nome longo como estava (ainda fora do ASCII) — o que conta como não convertido
    if (short && !hasNonAscii(short)) return short;
  } catch {
    /* PowerShell indisponível ou tempo esgotado: volta o caminho original */
  }
  return dir;
}
