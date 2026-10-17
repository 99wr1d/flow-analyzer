// Раскладка рисунков по дорожкам таймлайна: пересекающиеся по времени идут на разные строки.
import { MIN_DURATION, type Annotation } from '../../../../shared/annotations'

export const MAX_LANES = 4

export interface LaneItem {
  id: string
  lane: number
  start: number
  end: number
}

export function endOf(a: Annotation, fps: number): number {
  return a.timing.mode === 'range' ? a.timing.start + a.timing.duration : a.timing.start + 0.5 / fps
}

export function startOf(a: Annotation, fps: number): number {
  return a.timing.mode === 'range' ? a.timing.start : a.timing.start - 0.5 / fps
}

/** Жадная раскладка по времени начала. Если строк больше MAX_LANES, лишние ложатся на последнюю. */
export function assignLanes(list: readonly Annotation[], fps: number): LaneItem[] {
  const sorted = [...list].sort((a, b) => startOf(a, fps) - startOf(b, fps))
  const laneEnds: number[] = []
  return sorted.map((a) => {
    const start = startOf(a, fps)
    const end = Math.max(endOf(a, fps), start + MIN_DURATION / 10)
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane === -1) lane = laneEnds.length < MAX_LANES ? laneEnds.length : MAX_LANES - 1
    laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, end)
    return { id: a.id, lane, start, end }
  })
}
