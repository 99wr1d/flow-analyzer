// Подписи линеек на поле не должны ложиться друг на друга (две линейки из одной точки: подписи рядом). Простое и
// предсказуемое правило: рисунки идут в порядке слоёв; подпись, которая задевает уже поставленную, поднимается вверх
// на высоту плашки, пока не освободится место. Один и тот же расчёт делают экран и экспорт, поэтому кадр совпадает.
import type { Annotation, PitchAnnotation } from '../annotations'
import { isPitchAnnotation } from '../annotations'
import type { Projector } from './projector'
import { paintPitch, type PaintSize } from './shapes'

export interface LabelBox {
  id: string
  /** Центр плашки, пиксели. */
  x: number
  y: number
  w: number
  h: number
}

/** Зазор между плашками, доля высоты плашки. */
const GAP = 0.12
const MAX_STEPS = 24

const overlaps = (a: LabelBox, b: LabelBox, dy: number): boolean => {
  const gap = a.h * GAP
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y + dy - b.y) < (a.h + b.h) / 2 + gap
  )
}

/** Сдвиг по вертикали (пиксели, ≤ 0 — вверх) для плашки каждого id; без наложения сдвига нет. */
export function nudgeLabels(boxes: readonly LabelBox[]): Map<string, number> {
  const placed: LabelBox[] = []
  const shifts = new Map<string, number>()
  for (const box of boxes) {
    let dy = 0
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const hit = placed.some((p) => overlaps(box, p, dy))
      if (!hit) break
      dy -= box.h * (1 + GAP)
    }
    if (dy !== 0) shifts.set(box.id, dy)
    placed.push({ ...box, y: box.y + dy })
  }
  return shifts
}

/** Сдвиги подписей линеек на поле среди показанных рисунков (в порядке слоёв). */
export function rulerLabelShifts(
  items: readonly Annotation[],
  projectorOf: (calibrationId: string) => Projector | null | undefined,
  size: PaintSize,
  measure: (text: string, fontPx: number) => number
): Map<string, number> {
  const boxes: LabelBox[] = []
  for (const a of items) {
    if (!isPitchAnnotation(a) || a.type !== 'ruler') continue
    const proj = projectorOf((a as PitchAnnotation).calibrationId)
    if (!proj) continue
    const label = paintPitch(a, proj, size, measure).label
    if (label) boxes.push({ id: a.id, x: label.x, y: label.y, w: label.w, h: label.h })
  }
  return nudgeLabels(boxes)
}
