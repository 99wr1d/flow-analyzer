// Попадание курсора в рисунки. Всё считается в пикселях картинки (координаты нормализованы по осям по-разному).
import type { Annotation, Point } from '../../../../shared/annotations'
import { handlesOf, type HandleId, type Rect, type Size } from './geometry'

export interface PxPoint {
  x: number
  y: number
}

export const HIT_TOLERANCE = 7
export const HANDLE_RADIUS = 9

export function toPx(p: Point, size: Size): PxPoint {
  return { x: p.x * size.w, y: p.y * size.h }
}

export function distToSegment(p: PxPoint, a: PxPoint, b: PxPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Расстояние от точки до эллипса (приближённо; 0, если точка внутри). */
export function distToEllipseArea(
  p: PxPoint,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): number {
  const ex = Math.max(rx, 0.5)
  const ey = Math.max(ry, 0.5)
  const d = Math.hypot((p.x - cx) / ex, (p.y - cy) / ey)
  return d <= 1 ? 0 : (d - 1) * Math.min(ex, ey)
}

/** Прямоугольник подписи в пикселях картинки (по размеру текста width в пикселях). */
export function textRect(
  a: Extract<Annotation, { type: 'text' }>,
  size: Size,
  textWidth: number
): Rect {
  const font = a.style.size * size.h
  const pad = font * 0.3
  return {
    x: a.pos.x * size.w,
    y: a.pos.y * size.h,
    w: textWidth + pad * 2,
    h: font * 1.2 + pad * 2
  }
}

/** Попадает ли точка (px, пиксели картинки) в рисунок. measure — ширина текста в пикселях. */
export function hitAnnotation(
  a: Annotation,
  p: PxPoint,
  size: Size,
  measure: (text: string, fontPx: number) => number,
  tolerance: number = HIT_TOLERANCE
): boolean {
  if (a.type === 'text') {
    const r = textRect(a, size, measure(a.text, a.style.size * size.h))
    return (
      p.x >= r.x - tolerance / 2 &&
      p.x <= r.x + r.w + tolerance / 2 &&
      p.y >= r.y - tolerance / 2 &&
      p.y <= r.y + r.h + tolerance / 2
    )
  }
  const p1 = toPx(a.p1, size)
  const p2 = toPx(a.p2, size)
  const half = (a.style.width * size.h) / 2
  if (a.type === 'circle') {
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2
    const rx = Math.abs(p2.x - p1.x) / 2
    const ry = Math.abs(p2.y - p1.y) / 2
    return distToEllipseArea(p, cx, cy, rx, ry) <= half + tolerance
  }
  return distToSegment(p, p1, p2) <= half + tolerance
}

/** Верхний (последний нарисованный) рисунок под курсором. */
export function topHit(
  list: readonly Annotation[],
  p: PxPoint,
  size: Size,
  measure: (text: string, fontPx: number) => number
): Annotation | null {
  for (let i = list.length - 1; i >= 0; i--) {
    if (hitAnnotation(list[i], p, size, measure)) return list[i]
  }
  return null
}

/** Ручка выбранного рисунка под курсором. */
export function handleAt(
  a: Annotation,
  p: PxPoint,
  size: Size,
  radius: number = HANDLE_RADIUS
): HandleId | null {
  let best: HandleId | null = null
  let bestDist = radius
  for (const h of handlesOf(a)) {
    const d = Math.hypot(p.x - h.point.x * size.w, p.y - h.point.y * size.h)
    if (d <= bestDist) {
      best = h.id
      bestDist = d
    }
  }
  return best
}
