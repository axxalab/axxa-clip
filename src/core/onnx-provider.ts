/**
 * Qual execution provider do onnxruntime-node os modelos de visão usam
 * (YuNet, FER+ e TransNetV2 — o rosto, a emoção e a troca de plano).
 *
 * O que está mesmo disponível, conferido nos binários que o npm entrega (onnxruntime-node 1.27):
 *   - Windows x64 → traz a `DirectML.dll` junto, então o provider `dml` roda em qualquer GPU
 *     compatível com DirectX 12, NVIDIA inclusive, **sem instalar mais nada**;
 *   - Linux x64 e macOS → só a biblioteca de CPU; não há `onnxruntime_providers_cuda`.
 * Ou seja: não existe CUDA de verdade pelo pacote do npm. Quem quiser CUDA precisa trocar o
 * onnxruntime-node por uma build própria com o provider compilado; o nome continua aceito aqui
 * para esse caso, mas ligar `cuda` sem essa build só faz cair de volta para a CPU.
 *
 * Fica desligado por padrão de propósito: driver de GPU varia demais entre máquinas, e uma falha
 * de EP no meio de uma análise longa custa mais que o ganho. A última posição da lista é sempre a
 * CPU, de modo que um provider indisponível degrade em vez de derrubar a análise.
 */
export type OnnxProvider = "cpu" | "dml" | "cuda" | "coreml";

const KNOWN: OnnxProvider[] = ["cpu", "dml", "cuda", "coreml"];

/** O provider pedido por ambiente; um valor desconhecido ou vazio significa CPU. */
export function requestedOnnxProvider(env: NodeJS.ProcessEnv = process.env): OnnxProvider {
  const value = (env.HOTCLIP_ONNX_PROVIDER ?? "").trim().toLowerCase() as OnnxProvider;
  return KNOWN.includes(value) ? value : "cpu";
}

/**
 * A lista de providers na ordem de tentativa, com a CPU sempre por último.
 * Um provider que não faz sentido na plataforma (o dml fora do Windows, o coreml fora do macOS)
 * é descartado aqui, em vez de virar erro lá dentro do runtime.
 */
export function onnxExecutionProviders(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): OnnxProvider[] {
  const wanted = requestedOnnxProvider(env);
  if (wanted === "cpu") return ["cpu"];
  if (wanted === "dml" && platform !== "win32") return ["cpu"];
  if (wanted === "coreml" && platform !== "darwin") return ["cpu"];
  return [wanted, "cpu"];
}

/** As opções de sessão prontas para o `InferenceSession.create`. */
export function onnxSessionOptions(): { executionProviders: OnnxProvider[] } {
  return { executionProviders: onnxExecutionProviders() };
}
