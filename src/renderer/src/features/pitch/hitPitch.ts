// Попадание курсора в рисунки на поле: проверяется по тому же построению (paintPitch), что и отрисовка.
import {
  isPitchAnnotation,
  type Annotation,
  type PitchAnnotation
} from '../../../../shared/annotations'
import type { Projector } from '../../../../shared/pitch/projector'
import {
  paintPitch,
  type Measure,
  type PaintSize,
  type PitchHandleId,
  type PitchPaint,
  type PxPt
} from '../../../../shared/pitch/shapes'
import { HANDLE_RADIUS, HIT_TOLERANCE, distToSegment } from '../annotations/hit'

export function pointInPolygon(p: PxPt, poly: readonly PxPt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function distToPolygon(p: PxPt, poly: readonly PxPt[]): number {
  if (pointInPolygon(p, poly)) return 0
  let best = Infinity
  for (let i = 0; i < poly.length; i += 1) {
    best = Math.min(best, distToSegment(p, poly[i], poly[(i + 1) % poly.length]))
  }
  return best
}

/** Попадает ли точка (пиксели картинки) в уже построенный рисунок. */
export function hitPaint(paint: PitchPaint, p: PxPt, tolerance: number = HIT_TOLERANCE): boolean {
  return paint.hit.some((poly) => distToPolygon(p, poly) <= tolerance)
}

/** Ручка рисунка под курсором. */
export function pitchHandleAt(
  paint: PitchPaint,
  p: PxPt,
  radius: number = HANDLE_RADIUS
): PitchHandleId | null {
  let best: PitchHandleId | null = null
  let bestDist = radius
  for (const h of paint.handles) {
    const d = Math.hypot(p.x - h.point.x, p.y - h.point.y)
    if (d <= bestDist) {
      best = h.id
      bestDist = d
    }
  }
  return best
}

export type ProjectorLookup = (calibrationId: string) => Projector | null | undefined

export function paintOf(
  a: PitchAnnotation,
  lookup: ProjectorLookup,
  size: PaintSize,
  measure: Measure
): PitchPaint | null {
  const proj = lookup(a.calibrationId)
  return proj ? paintPitch(a, proj, size, measure) : null
}

/** Попадание в любой рисунок (экранный или на поле) — для рисунков на поле. */
export function hitPitchAnnotation(
  a: Annotation,
  p: PxPt,
  lookup: ProjectorLookup,
  size: PaintSize,
  measure: Measure
): boolean {
  if (!isPitchAnnotation(a)) return false
  const paint = paintOf(a, lookup, size, measure)
  return paint !== null && hitPaint(paint, p)
}
