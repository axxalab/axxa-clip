/**
 * Local ASR, edição de português: Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0) pelo sherpa-onnx.
 *
 * É o motor local que enxerga português. Os outros tiers locais (SenseVoice, Paraformer,
 * FireRedASR2) foram treinados em mandarim e inglês, e o português passava por eles como ruído.
 *
 * Por que ele e não o Whisper: é um transducer, o que significa marca de tempo por token NATIVA
 * vinda da própria decodificação — a legenda palavra a palavra, o alinhamento reverso do ponto de
 * corte e o corte de vício de linguagem dependem disso. Cobre 25 idiomas europeus.
 * 465MB de download; pico de RAM na casa de 2GB.
 */
import { join } from "path";
import { cpus } from "os";
import { PARAKEET_MODEL } from "../models";
import { SherpaOfflineEngine } from "./sherpa-offline";

export class ParakeetEngine extends SherpaOfflineEngine {
  constructor(modelsRoot: string) {
    super(
      {
        id: "parakeet-local",
        label: "Parakeet TDT v3 (local · português e mais 24 idiomas)",
        asset: PARAKEET_MODEL,
        buildModelConfig: (dir) => ({
          transducer: {
            encoder: join(dir, "encoder.int8.onnx"),
            decoder: join(dir, "decoder.int8.onnx"),
            joiner: join(dir, "joiner.int8.onnx"),
          },
          // Sem isto o sherpa-onnx lê o pacote como transducer do estilo icefall e a decodificação sai vazia
          modelType: "nemo_transducer",
        }),
        // O modelo escreve em minúsculas e sem pontuação; o CT-Transformer devolve a pontuação
        punctuate: true,
        language: "pt",
        // Encoder grande pede mais linha de execução, deixando folga para o processo da interface
        numThreads: Math.min(6, Math.max(2, cpus().length - 2)),
      },
      modelsRoot
    );
  }
}
