/**
 * A orquestração da detecção: «chamar detectHighlights → guardar o resultado na store da sessão» virou uma ação só.
 * A maior diferença para a versão antiga: mudar um parâmetro só marca como sujo, e o único gatilho é chamar
 * run() explicitamente — o botão «detectar de novo» é a mão que gasta o dinheiro do LLM, e a pessoa sempre
 * sabe que apertou esse botão.
 */
import { useCallback } from "react";
import { getApi } from "../../api/provider";
import { useSession } from "../../stores/session-store";
import { useLlmStore } from "../../stores/llm-store";
import { useRenderPrefs } from "../../stores/render-prefs-store";
import { stripIpcError } from "../../../../shared/transcribe-errors";

export function useDetection(): { run: () => Promise<void> } {
  const { config, prefilter, vision } = useLlmStore();
  const { prefs } = useRenderPrefs();

  const run = useCallback(async (): Promise<void> => {
    const s = useSession.getState();
    if (!s.transcript || s.detecting) return;
    s.setDetecting(true);
    s.setDetectError(null);
    try {
      const focus = prefs.briefFocus.trim();
      const exclude = prefs.briefExclude.trim();
      const result = await getApi().detectHighlights(
        s.transcript,
        config,
        s.file?.path,
        s.diarize,
        prefilter.enabled ? { baseUrl: prefilter.baseUrl, model: prefilter.model } : null,
        vision.enabled ? { baseUrl: vision.baseUrl, model: vision.model, apiKey: vision.apiKey || undefined } : null,
        prefs.clipLength,
        prefs.products,
        s.referencePath,
        { id: prefs.genreId, custom: prefs.genreCustom },
        focus || exclude ? { focus: focus || undefined, exclude: exclude || undefined } : null,
        prefs.fullScan && vision.enabled
      );
      const st = useSession.getState();
      st.setCandidates(result.candidates);
      st.setStats({
        funnel: result.funnel ?? null,
        vision: result.vision ?? null,
        emotion: result.emotion ?? null,
        danmaku: result.danmaku ?? null,
        voice: result.voice ?? null,
        reference: result.reference ?? null,
        referenceError: result.referenceError ?? null,
      });
      // Os aprovados na revisão já saem pré-marcados para exportar; a coluna da direita põe em foco a primeira recomendação (ou a primeira de todas, se não houver)
      st.setSelected(new Set(result.candidates.filter((c) => c.recommended).map((c) => c.id)));
      st.setFocusedId(result.candidates.find((c) => c.recommended)?.id ?? result.candidates[0]?.id ?? null);
      // A transcrição com a marcação de falante volta (a exportação colore a legenda por falante)
      if (result.transcript) st.setTranscript(result.transcript);
      st.markParamsDirty(false);
    } catch (e) {
      // O embrulho do IPC só afoga a única frase que serve para algo — o embrulho sai antes de exibir (issue #6)
      useSession.getState().setDetectError(stripIpcError(e instanceof Error ? e.message : String(e)));
    } finally {
      useSession.getState().setDetecting(false);
    }
  }, [config, prefilter, vision, prefs]);

  return { run };
}
