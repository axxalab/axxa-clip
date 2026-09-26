/**
 * Exportação de EDL de linha de tempo (CMX3600): os pontos de corte escolhidos pela IA — inclusive cada
 * intervalo preservado do corte seco dentro do trecho — são escritos como uma linha de tempo EDL, o formato
 * comum dos editores, e no DaVinci Resolve, no Premiere ou no Final Cut basta relinkar o vídeo de origem
 * para seguir com o acabamento. É a ponte do fluxo «corte bruto da IA → acabamento humano»: os pontos de
 * corte são da máquina, e o último corte pode sempre ser de uma pessoa.
 *
 * O CMX3600 é texto puro e o formato de troca de linha de tempo mais universal; cada intervalo preservado é
 * um event, e o lado record é colado em sequência. Montado só com strings, sem dependência, e testável byte a byte.
 */

export interface EdlClip {
  /** O título do trecho (numa linha de comentário; o Resolve mostra isso como nome do clipe). */
  title: string;
  /** Os intervalos preservados deste trecho (em segundos absolutos da origem; no corte seco um trecho tem vários). */
  segments: Array<{ startSec: number; endSec: number }>;
}

/** Segundos → o código de tempo SMPTE sem descarte de quadro, HH:MM:SS:FF. */
export function secToTimecode(sec: number, fps: number): string {
  const fpsInt = Math.max(1, Math.round(fps));
  const totalFrames = Math.round(Math.max(0, sec) * fpsInt);
  const ff = totalFrames % fpsInt;
  const totalSec = Math.floor(totalFrames / fpsInt);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}:${p(ff)}`;
}

/**
 * Monta o EDL CMX3600. Os eventos ficam na ordem em que chegaram, e o lado record acumula de 0 em sequência
 * — depois de importar, a linha de tempo já está na «ordem do vídeo pronto», e cada pedaço aponta de volta
 * para a posição correspondente na origem.
 */
export function buildEdl(opts: { title: string; sourceName: string; fps: number; clips: EdlClip[] }): string {
  const { title, sourceName, fps, clips } = opts;
  const lines: string[] = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  let event = 0;
  let recordSec = 0;
  for (const clip of clips) {
    for (const seg of clip.segments) {
      const dur = seg.endSec - seg.startSec;
      if (dur <= 0) continue;
      event += 1;
      const num = String(event).padStart(3, "0");
      const srcIn = secToTimecode(seg.startSec, fps);
      const srcOut = secToTimecode(seg.endSec, fps);
      const recIn = secToTimecode(recordSec, fps);
      const recOut = secToTimecode(recordSec + dur, fps);
      // AX = o número de rolo auxiliar (os editores modernos relinkam pelo FROM CLIP NAME); B = o vídeo e o áudio são cortados juntos
      lines.push(`${num}  AX       B     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
      lines.push(`* FROM CLIP NAME: ${sourceName}`);
      lines.push(`* COMMENT: ${clip.title}`);
      lines.push("");
      recordSec += dur;
    }
  }
  return lines.join("\n");
}
