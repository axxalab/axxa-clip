import type { TranscriptSegment } from "./api-types";
import type { TranscriptSearchHit } from "./transcript-search";
import type { VisualEvidenceHit } from "./evidence-search";

export type EvidenceSource = "all" | "transcript" | "visual";
export type EvidenceResult =
  | { kind: "transcript"; id: string; startSec: number; endSec: number; hit: TranscriptSearchHit }
  | { kind: "visual"; id: string; startSec: number; endSec: number; hit: VisualEvidenceHit };

/** Uma ordem de tempo só para a navegação pelo mouse e pelo teclado, filtrando a evidência antiga que está fora do intervalo do material de origem. */
export function evidenceResults(
  transcript: readonly TranscriptSearchHit[], visual: readonly VisualEvidenceHit[],
  durationSec: number, source: EvidenceSource = "all",
): EvidenceResult[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const results: EvidenceResult[] = [];
  if (source !== "visual") transcript.forEach((hit, i) => results.push({ kind: "transcript", id: `text:${i}`, startSec: hit.startSec, endSec: hit.endSec, hit }));
  if (source !== "transcript") visual.forEach((hit) => results.push({ kind: "visual", id: `visual:${hit.id}`, startSec: hit.t, endSec: hit.t, hit }));
  return results.filter((r) => Number.isFinite(r.startSec) && Number.isFinite(r.endSec) &&
    r.startSec >= 0 && r.startSec < durationSec && r.endSec >= r.startSec && r.endSec <= durationSec)
    .sort((a, b) => a.startSec - b.startSec);
}

/** O primeiro Enter posiciona no primeiro item, e só depois avança; ao contrário, o primeiro vai para o último item. */
export function nextEvidenceIndex(current: number, length: number, delta: 1 | -1): number {
  if (length <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (Math.min(current, length - 1) + delta + length) % length;
}

/** A audição tem um contexto curto e não passa de 30 segundos; a escolha do trecho preserva frases inteiras, e a confirmação final é da pessoa. */
export function evidenceContext(result: EvidenceResult, segments: readonly TranscriptSegment[], durationSec: number): {
  startSec: number; endSec: number; segmentIds: number[];
} {
  const startSec = Math.max(0, result.startSec - 2);
  const endSec = Math.min(durationSec, result.endSec + 2, startSec + 30);
  const matched = result.kind === "transcript" ? new Set(result.hit.segmentIds) : null;
  return {
    startSec, endSec,
    segmentIds: segments.filter((segment) => matched ? matched.has(segment.id)
      : segment.endSec > startSec && segment.startSec < endSec).map((segment) => segment.id),
  };
}
