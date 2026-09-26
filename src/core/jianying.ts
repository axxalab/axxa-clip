/**
 * Exportação de rascunho do JianYing / CapCut (v0.14): os pontos de corte que a IA definiu — incluindo
 * cada intervalo preservado do corte seco dentro do trecho — viram uma pasta de rascunho do JianYing
 * Pro (draft_content.json + draft_meta_info.json); é só copiar a pasta inteira para a pasta de rascunhos
 * do editor e abrir para o acabamento. O EDL atende ao DaVinci e ao Premiere, mas o JianYing (o CapCut
 * chinês) não lê EDL — e este é o caminho de «corte bruto da IA → acabamento humano» dentro do editor
 * mais popular desse público.
 *
 * Sobre o formato: a estrutura de draft_content em texto puro do pyJianYingDraft (GuanYixuan), com o
 * modelo marcado como 5.9 (o JianYing 6/7+ abre rascunho gerado em texto puro; a criptografia de rascunho
 * das versões novas só afeta «ler um rascunho existente como modelo», e não a geração). O material aponta
 * para o caminho absoluto do vídeo de origem, então abrir em outra máquina faz o editor pedir para
 * relinkar a mídia — a mesma semântica do EDL. A unidade de tempo é o microssegundo.
 * Função pura (a geração de id é injetável para o teste unitário), e a escrita dos arquivos fica com export.ts.
 */
import { randomUUID } from "crypto";
import type { EdlClip } from "./edl";

/** O gerador de id injetável (por padrão uuid v4); a forma hex serve para os id de trilha, de trecho e de material. */
export type IdGen = () => string;
const defaultIdGen: IdGen = () => randomUUID();
const hexOf = (id: string): string => id.replace(/-/g, "");

export interface DraftContentInput {
  /** O caminho absoluto do vídeo de origem (o material aponta direto para ele, sem copiar mídia). */
  sourcePath: string;
  /** O nome do arquivo de origem (o nome exibido no painel de materiais). */
  sourceName: string;
  /** A duração total do vídeo de origem (segundos) — o teto de duração do objeto de material. */
  sourceDurationSec: number;
  /** O enquadramento do vídeo de origem (a tela do rascunho = o enquadramento original, com o mesmo propósito do EDL: «voltar ao original para o acabamento»). */
  width: number;
  height: number;
  /** A taxa de quadros do rascunho (arredondada; o editor a usa internamente para encaixar na linha de tempo). */
  fps: number;
  /** Os intervalos preservados deste trecho (em segundos absolutos do vídeo de origem; no corte seco são vários, colados em ordem). */
  clip: EdlClip;
}

const SEC_US = 1_000_000;
const toUs = (sec: number): number => Math.round(sec * SEC_US);

/**
 * Monta o objeto draft_content.json de um trecho: uma trilha de vídeo, com os intervalos preservados
 * postos em ordem na linha de tempo (source_timerange aponta de volta para o original e target_timerange
 * os cola em sequência), e cada corte do corte seco vira um trecho independente, arrastável na linha de tempo.
 */
export function buildDraftContent(input: DraftContentInput, newId: IdGen = defaultIdGen): Record<string, unknown> {
  const { sourcePath, sourceName, sourceDurationSec, width, height, fps, clip } = input;
  const segs = clip.segments.filter((s) => s.endSec > s.startSec);
  const materialId = hexOf(newId());
  // A duração do material precisa ser ≥ o fim de qualquer trecho recortado, senão o editor recusa carregar por «material fora do intervalo»
  const maxEndUs = segs.reduce((m, s) => Math.max(m, toUs(s.endSec)), 0);
  const materialDurationUs = Math.max(toUs(sourceDurationSec), maxEndUs);

  const speeds: Array<Record<string, unknown>> = [];
  const segments: Array<Record<string, unknown>> = [];
  let targetUs = 0;
  for (const seg of segs) {
    const durUs = toUs(seg.endSec) - toUs(seg.startSec);
    const speedId = hexOf(newId());
    speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: 1.0, type: "speed" });
    segments.push({
      enable_adjust: true,
      enable_color_correct_adjust: false,
      enable_color_curves: true,
      enable_color_match_adjust: false,
      enable_color_wheels: true,
      enable_lut: true,
      enable_smart_color_adjust: false,
      last_nonzero_volume: 1.0,
      reverse: false,
      track_attribute: 0,
      track_render_index: 0,
      visible: true,
      id: hexOf(newId()),
      material_id: materialId,
      target_timerange: { start: targetUs, duration: durUs },
      common_keyframes: [],
      keyframe_refs: [],
      source_timerange: { start: toUs(seg.startSec), duration: durUs },
      speed: 1.0,
      volume: 1.0,
      extra_material_refs: [speedId],
      is_tone_modify: false,
      clip: {
        alpha: 1.0,
        flip: { horizontal: false, vertical: false },
        rotation: 0.0,
        scale: { x: 1.0, y: 1.0 },
        transform: { x: 0.0, y: 0.0 },
      },
      uniform_scale: { on: true, value: 1.0 },
      hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
      render_index: 0,
    });
    targetUs += durUs;
  }

  const videoMaterial = {
    audio_fade: null,
    category_id: "",
    category_name: "local",
    check_flag: 63487,
    crop: {
      upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0,
      lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0,
    },
    crop_ratio: "free",
    crop_scale: 1.0,
    duration: materialDurationUs,
    height,
    id: materialId,
    local_material_id: "",
    material_id: materialId,
    material_name: sourceName,
    media_path: "",
    path: sourcePath,
    type: "video",
    width,
  };

  // O esqueleto bate campo a campo com o modelo 5.9 do pyJianYingDraft (as categorias de array vazio de
  // materials precisam estar todas presentes: o editor lê por chave, e uma chave faltando conta como rascunho corrompido)
  return {
    canvas_config: { height, ratio: "original", width },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: "none",
      multi_language_list: [],
      multi_language_main: "none",
      multi_language_mode: "none",
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: "",
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null,
    },
    cover: null,
    create_time: 0,
    duration: targetUs,
    extra_info: null,
    fps: fps,
    free_render_index_mode_on: false,
    group_container: null,
    id: newId().toUpperCase(),
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [], audios: [], effects: [], filters: [],
      handwrites: [], stickers: [], texts: [], videos: [],
    },
    last_modified_platform: { app_id: 3704, app_source: "lv", app_version: "5.9.0", os: "windows" },
    platform: { app_id: 3704, app_source: "lv", app_version: "5.9.0", os: "windows" },
    materials: {
      ai_translates: [], audio_balances: [], audio_effects: [], audio_fades: [],
      audio_track_indexes: [], audios: [], beats: [], canvases: [], chromas: [],
      color_curves: [], digital_humans: [], drafts: [], effects: [], flowers: [],
      green_screens: [], handwrites: [], hsl: [], images: [], log_color_wheels: [],
      loudnesses: [], manual_deformations: [], masks: [], material_animations: [],
      material_colors: [], multi_language_refs: [], placeholders: [], plugin_effects: [],
      primary_color_wheels: [], realtime_denoises: [], shapes: [], smart_crops: [],
      smart_relights: [], sound_channel_mappings: [], speeds, stickers: [],
      tail_leaders: [], text_templates: [], texts: [], time_marks: [], transitions: [],
      video_effects: [], video_trackings: [], videos: [videoMaterial],
      vocal_beautifys: [], vocal_separations: [],
    },
    mutable_config: null,
    name: "",
    new_version: "110.0.0",
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: "",
    time_marks: null,
    tracks: [
      {
        attribute: 0,
        flag: 0,
        id: hexOf(newId()),
        is_default_name: true,
        name: "",
        segments,
        type: "video",
      },
    ],
    update_time: 0,
    version: 360000,
  };
}

/** draft_meta_info.json: o modelo é copiado campo a campo, trocando só o draft_id (o editor completa o resto ao abrir). */
export function buildDraftMetaInfo(newId: IdGen = defaultIdGen): Record<string, unknown> {
  return {
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "",
    draft_deeplink_url: "",
    draft_enterprise_info: {
      draft_enterprise_extra: "",
      draft_enterprise_id: "",
      draft_enterprise_name: "",
      enterprise_material: [],
    },
    draft_fold_path: "",
    draft_id: newId().toUpperCase(),
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_materials: [0, 1, 2, 3, 6, 7, 8].map((type) => ({ type, value: [] })),
    draft_materials_copied_info: [],
    draft_name: "",
    draft_new_version: "",
    draft_removable_storage_device: "",
    draft_root_path: "",
    draft_segment_extra_info: [],
    draft_type: "",
    tm_draft_cloud_completed: "",
    tm_draft_cloud_modified: 0,
    tm_draft_removed: 0,
    tm_duration: 0,
  };
}
