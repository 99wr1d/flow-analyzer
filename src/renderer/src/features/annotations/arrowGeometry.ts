// Форма стрелки: линия, которая заканчивается у основания сплошного наконечника.
import type { PxPoint } from './hit'

export interface ArrowShape {
  /** Конец линии (у основания наконечника). */
  lineEnd: PxPoint
  /** Вершины наконечника: остриё и два крыла. */
  head: [PxPoint, PxPoint, PxPoint]
  headLength: number
}

/** Наконечник растёт вместе с толщиной, но у короткой стрелки не занимает больше 60% длины. */
export function arrowShape(from: PxPoint, to: PxPoint, widthPx: number): ArrowShape {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { lineEnd: from, head: [to, to, to], headLength: 0 }
  const ux = dx / len
  const uy = dy / len
  const headLength = Math.min(Math.max(widthPx * 3.6, 16), len * 0.6)
  const half = headLength * 0.5
  const base = { x: to.x - ux * headLength, y: to.y - uy * headLength }
  return {
    // Линия заходит под наконечник, чтобы между ними не было щели.
    lineEnd: { x: to.x - ux * headLength * 0.7, y: to.y - uy * headLength * 0.7 },
    head: [
      to,
      { x: base.x - uy * half, y: base.y + ux * half },
      { x: base.x + uy * half, y: base.y - ux * half }
    ],
    headLength
  }
}
