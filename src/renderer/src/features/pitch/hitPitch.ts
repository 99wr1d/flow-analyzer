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
import { HANDLE_RADIUS, HIT_TOLERANCE, distToPolygon, pointInPolygon } from '../annotations/hit'

export { distToPolygon, pointInPolygon }

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
