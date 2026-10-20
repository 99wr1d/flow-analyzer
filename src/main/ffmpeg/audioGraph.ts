// Звук при параллельном экспорте: все куски видео кодируются отдельно, а звук собирается ОДИН раз для всего результата
// (отдельным процессом ffmpeg, параллельно с видео) и в конце подмешивается к склеенному видео без перекодирования.
//
// Чтобы звук не расходился с картинкой, длина каждого куска звука равна длине куска видео в КАДРАХ: видео — мастер.
// Звук обычного куска идёт с начала его первого кадра ровно на столько секунд, сколько в нём кадров; на стоп-кадре звучит
// звук самого кадра, дальше — тишина (так же, как в обычном графе drawGraph.ts).
import type { RangePlan } from '../../shared/exportOverlays'
import { splitRange, type GraphAudio } from './drawGraph'
import { firstFrameAtOrAfter } from './exportChunks'

export interface AudioGraphPlan {
  /** Смещение входа (-ss). */
  offset: number
  /** Сколько секунд читать (-t). */
  span: number
  script: string
  outputSeconds: number
}

/** Граф «звук всего результата». ranges — отрезки, приведённые к целым кадрам (exportChunks.wholeRanges). */
export function planAudioOnly(input: {
  ranges: readonly RangePlan[]
  fps: number
  audio: GraphAudio
}): AudioGraphPlan {
  const { ranges, fps, audio } = input
  const frame = 1 / fps
  const pieces = ranges.flatMap((r) => splitRange(r, fps))

  interface AudioWindow {
    from: number
    to: number
    freeze?: { frames: number }
  }
  const windows: AudioWindow[] = pieces.map((p) => {
    if (p.kind === 'cut') {
      return {
        from: firstFrameAtOrAfter(p.start, fps) / fps,
        to: firstFrameAtOrAfter(p.end, fps) / fps
      }
    }
    const n = p.freeze.frame
    return {
      from: n / fps,
      to: (n + 1) / fps,
      freeze: { frames: Math.round(p.freeze.seconds * fps) + 1 }
    }
  })
  // Смещение — целое число миллисекунд вниз: то же значение уходит в -ss, и времена графа считаются от него.
  const offset = Math.max(0, Math.floor(Math.min(...windows.map((w) => w.from)) * 1000) / 1000)
  const end = Math.max(...windows.map((w) => w.to))
  const span = end - offset + frame
  // Шесть знаков: на 29.97 кадров/с кадр — 33.3667 мс, и округление до миллисекунд копилось бы по кускам.
  const rel = (t: number): string => Math.max(0, t - offset).toFixed(6)

  const format = `aformat=sample_fmts=fltp:sample_rates=${audio.sampleRate}:channel_layouts=${audio.mono ? 'mono' : 'stereo'}`
  const labels = windows.map((_, i) => `[sa${i}]`)
  const lines: string[] = []
  if (windows.length === 1) lines.push(`[0:a]${format}${labels[0]}`)
  else lines.push(`[0:a]${format},asplit=${windows.length}${labels.join('')}`)

  let outputSeconds = 0
  windows.forEach((w, i) => {
    lines.push(
      `${labels[i]}atrim=start=${rel(w.from)}:end=${rel(w.to)},asetpts=PTS-STARTPTS[${w.freeze ? `fa${i}` : `a${i}`}]`
    )
    if (w.freeze) {
      const silence = (w.freeze.frames - 1) / fps
      if (silence > 0) {
        lines.push(
          `anullsrc=r=${audio.sampleRate}:cl=${audio.mono ? 'mono' : 'stereo'}:d=${silence.toFixed(6)},${format},asetpts=PTS-STARTPTS[fs${i}]`
        )
        lines.push(`[fa${i}][fs${i}]concat=n=2:v=0:a=1,asetpts=PTS-STARTPTS[a${i}]`)
      } else {
        lines.push(`[fa${i}]anull[a${i}]`)
      }
      outputSeconds += w.freeze.frames / fps
    } else {
      outputSeconds += w.to - w.from
    }
  })
  lines.push(`${windows.map((_, i) => `[a${i}]`).join('')}concat=n=${windows.length}:v=0:a=1[outa]`)
  return { offset, span, script: lines.join(';\n') + '\n', outputSeconds }
}
