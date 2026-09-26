import { describe, expect, it } from "vitest";
import { onnxExecutionProviders, requestedOnnxProvider } from "../onnx-provider";

describe("escolha do execution provider do onnxruntime", () => {
  it("sem pedir nada, fica na CPU — GPU nunca é ligada por conta própria", () => {
    expect(onnxExecutionProviders({}, "win32")).toEqual(["cpu"]);
    expect(requestedOnnxProvider({})).toBe("cpu");
  });

  it("no Windows, o dml vale (a DirectML.dll vem no pacote) e cai para CPU se falhar", () => {
    expect(onnxExecutionProviders({ HOTCLIP_ONNX_PROVIDER: "dml" }, "win32")).toEqual(["dml", "cpu"]);
  });

  it("fora do Windows o dml é descartado, em vez de estourar dentro do runtime", () => {
    expect(onnxExecutionProviders({ HOTCLIP_ONNX_PROVIDER: "dml" }, "linux")).toEqual(["cpu"]);
    expect(onnxExecutionProviders({ HOTCLIP_ONNX_PROVIDER: "coreml" }, "linux")).toEqual(["cpu"]);
    expect(onnxExecutionProviders({ HOTCLIP_ONNX_PROVIDER: "coreml" }, "darwin")).toEqual(["coreml", "cpu"]);
  });

  it("um nome desconhecido não vira provider — fica na CPU", () => {
    expect(onnxExecutionProviders({ HOTCLIP_ONNX_PROVIDER: "vulkan" }, "win32")).toEqual(["cpu"]);
    expect(onnxExecutionProviders({ HOTCLIP_ONNX_PROVIDER: "" }, "win32")).toEqual(["cpu"]);
  });

  it("cuda é aceito para quem trocou o onnxruntime-node por uma build própria, sempre com a CPU atrás", () => {
    expect(onnxExecutionProviders({ HOTCLIP_ONNX_PROVIDER: "cuda" }, "win32")).toEqual(["cuda", "cpu"]);
  });
});
