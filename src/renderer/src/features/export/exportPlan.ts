// Что и как будет экспортировано: отрезки с запасом и рисунки в них. Чистые функции — по ним строятся
// сводка в окне экспорта, переключатель «С рисунками» и сам запрос.
import type { Timing } from '../../../../shared/annotations'
import type { Episode } from '../../../../shared/episodes'
import type { ExportMode } from '../../../../shared/export'
import {
  hasDrawings,
  planExport,
  type AnimFrame,
  type OverlayPlan,
  type TimeRange
} from '../../../../shared/exportOverlays'
import { prepareClips } from '../../../../shared/exportRanges'
import type { Scope } from './selection'

export const WHOLE_VIDEO_LABEL = 'Всё видео'

export interface PlanInput {
  scope: Scope
  /** Эпизоды, выбранные в окне (для scope === 'whole' не используются). */
  episodes: readonly Episode[]
  /** Режим из окна; «Всё видео» всегда выдаёт один файл. */
  mode: ExportMode
  padding: number
  duration: number
  fps: number
  timings: readonly Timing[]
  /** Номера движущихся (анимированных) рисунков. */
  animated?: ReadonlySet<number>
}

export interface ExportPlan {
  /** Готовые отрезки (с запасом, обрезанные по видео) в порядке вывода. */
  clips: TimeRange[]
  /** Режим с учётом «Всё видео». */
  mode: ExportMode
  plans: OverlayPlan[]
  /** Хоть один рисунок попал в экспортируемые отрезки. */
  hasDrawings: boolean
  /** Различные наборы рисунков — по ним рисуются картинки. */
  keys: string[]
  /** Секунды, которые стоп-кадры добавляют к результату. */
  freezeSeconds: number
  /** Кадры с движущимися рисунками (без повторов, по возрастанию): для каждого рисуется своя картинка. */
  animFrames: AnimFrame[]
}

export function planExportView(input: PlanInput): ExportPlan {
  const whole = input.scope === 'whole'
  const mode: ExportMode = whole ? 'files' : input.mode
  let clips: TimeRange[]
  if (whole) {
    clips = input.duration > 0 ? [{ start: 0, end: input.duration }] : []
  } else {
    const prepared = prepareClips(
      input.episodes.map((e) => ({ start: e.start, end: e.end, label: e.tagName })),
      input.duration > 0 ? input.duration : null,
      input.padding
    )
    clips = prepared.ok
      ? prepared.clips.map((c) => ({ start: c.start, end: c.end }))
      : input.episodes.map((e) => ({ start: e.start, end: e.end }))
  }
  const plans =
    clips.length > 0 ? planExport(clips, mode, input.timings, input.fps, input.animated) : []
  const keys: string[] = []
  const seen = new Set<string>()
  for (const plan of plans) {
    for (const key of plan.keys) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }
  const frames = new Map<number, AnimFrame>()
  for (const plan of plans) for (const f of plan.animation.frames) frames.set(f.frame, f)
  return {
    clips,
    mode,
    plans,
    hasDrawings: plans.some(hasDrawings),
    keys,
    freezeSeconds: plans.reduce((sum, p) => sum + p.freezeSeconds, 0),
    animFrames: [...frames.values()].sort((a, b) => a.frame - b.frame)
  }
}
