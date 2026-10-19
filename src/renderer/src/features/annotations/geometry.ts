// Чистая геометрия рисунков: отображение «нормализованные координаты ↔ пиксели» и привязка углов.
import type { ScreenAnnotation, Point } from '../../../../shared/annotations'

export interface Size {
  w: number
  h: number
}
export interface Rect extends Size {
  x: number
  y: number
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Где внутри элемента boxW×boxH лежит картинка видео vw×vh при object-fit: contain. */
export function containRect(boxW: number, boxH: number, vw: number, vh: number): Rect | null {
  if (!(boxW > 0 && boxH > 0 && vw > 0 && vh > 0)) return null
  const scale = Math.min(boxW / vw, boxH / vh)
  const w = vw * scale
  const h = vh * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

/** Пиксели элемента → координаты 0..1 по картинке (могут выйти за 0..1, если точка вне картинки). */
export function normalize(px: number, py: number, rect: Rect): Point {
  return { x: (px - rect.x) / rect.w, y: (py - rect.y) / rect.h }
}

/** Координаты 0..1 по картинке → пиксели элемента. */
export function denormalize(p: Point, rect: Rect): { x: number; y: number } {
  return { x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h }
}

export function clampPoint(p: Point): Point {
  return { x: clamp01(p.x), y: clamp01(p.y) }
}

/** Угол привязки по умолчанию: 15°. */
export const SNAP_STEP_DEG = 15

/**
 * Shift при рисовании линии/стрелки: направление от origin к point округляется до step градусов.
 * Углы считаются в пикселях (картинка не квадратная), длина сохраняется; результат остаётся внутри картинки.
 */
export function snapAngle(
  origin: Point,
  point: Point,
  size: Size,
  stepDeg: number = SNAP_STEP_DEG
): Point {
  const dx = (point.x - origin.x) * size.w
  const dy = (point.y - origin.y) * size.h
  const len = Math.hypot(dx, dy)
  if (len === 0) return point
  const step = (stepDeg * Math.PI) / 180
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  // Не вылезаем за картинку: уменьшаем длину, если нужно.
  let max = len
  const limit = (u: number, o: number, span: number): void => {
    if (Math.abs(u) < 1e-9) return
    const room = u > 0 ? (1 - o) * span : o * span
    max = Math.min(max, room / Math.abs(u))
  }
  limit(ux, origin.x, size.w)
  limit(uy, origin.y, size.h)
  return { x: origin.x + (ux * max) / size.w, y: origin.y + (uy * max) / size.h }
}

/** Shift при рисовании круга: из origin получается квадрат (в пикселях), т. е. идеальный круг. */
export function squareFrom(origin: Point, point: Point, size: Size): Point {
  const dx = (point.x - origin.x) * size.w
  const dy = (point.y - origin.y) * size.h
  const sx = dx < 0 ? -1 : 1
  const sy = dy < 0 ? -1 : 1
  let side = Math.max(Math.abs(dx), Math.abs(dy))
  const roomX = sx > 0 ? (1 - origin.x) * size.w : origin.x * size.w
  const roomY = sy > 0 ? (1 - origin.y) * size.h : origin.y * size.h
  side = Math.min(side, roomX, roomY)
  return { x: origin.x + (sx * side) / size.w, y: origin.y + (sy * side) / size.h }
}

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function bboxOf(a: ScreenAnnotation, textBox?: Rect | null, size?: Size): BBox {
  if (a.type === 'text') {
    const w = size && textBox ? textBox.w / size.w : 0
    const h = size && textBox ? textBox.h / size.h : 0
    return { x0: a.pos.x, y0: a.pos.y, x1: a.pos.x + w, y1: a.pos.y + h }
  }
  return {
    x0: Math.min(a.p1.x, a.p2.x),
    y0: Math.min(a.p1.y, a.p2.y),
    x1: Math.max(a.p1.x, a.p2.x),
    y1: Math.max(a.p1.y, a.p2.y)
  }
}

const clampRange = (v: number, lo: number, hi: number): number =>
  lo > hi ? hi : Math.min(hi, Math.max(lo, v))

/** Сдвиг рисунка на (dx, dy) в нормализованных координатах; рисунок остаётся целиком внутри картинки. */
export function moveBy(a: ScreenAnnotation, dx: number, dy: number, box: BBox): ScreenAnnotation {
  const cx = clampRange(dx, -box.x0, 1 - box.x1)
  const cy = clampRange(dy, -box.y0, 1 - box.y1)
  if (a.type === 'text') return { ...a, pos: { x: a.pos.x + cx, y: a.pos.y + cy } }
  return {
    ...a,
    p1: { x: a.p1.x + cx, y: a.p1.y + cy },
    p2: { x: a.p2.x + cx, y: a.p2.y + cy }
  }
}

export type HandleId = 'p1' | 'p2' | 'nw' | 'ne' | 'se' | 'sw'

export interface HandlePoint {
  id: HandleId
  point: Point
}

/** Ручки выбранного рисунка: концы линии/стрелки или углы рамки круга. У текста ручек нет. */
export function handlesOf(a: ScreenAnnotation): HandlePoint[] {
  if (a.type === 'arrow' || a.type === 'line') {
    return [
      { id: 'p1', point: a.p1 },
      { id: 'p2', point: a.p2 }
    ]
  }
  if (a.type === 'circle') {
    const b = bboxOf(a)
    return [
      { id: 'nw', point: { x: b.x0, y: b.y0 } },
      { id: 'ne', point: { x: b.x1, y: b.y0 } },
      { id: 'se', point: { x: b.x1, y: b.y1 } },
      { id: 'sw', point: { x: b.x0, y: b.y1 } }
    ]
  }
  return []
}

/** Перетаскивание ручки: двигает только её (у круга — противоположный угол остаётся на месте). */
export function moveHandle(a: ScreenAnnotation, handle: HandleId, to: Point): ScreenAnnotation {
  const p = clampPoint(to)
  if (a.type === 'arrow' || a.type === 'line') {
    if (handle === 'p1') return { ...a, p1: p }
    if (handle === 'p2') return { ...a, p2: p }
    return a
  }
  if (a.type === 'circle') {
    const b = bboxOf(a)
    const west = handle === 'nw' || handle === 'sw'
    const north = handle === 'nw' || handle === 'ne'
    if (!['nw', 'ne', 'se', 'sw'].includes(handle)) return a
    const fixedX = west ? b.x1 : b.x0
    const fixedY = north ? b.y1 : b.y0
    return { ...a, p1: { x: fixedX, y: fixedY }, p2: p }
  }
  return a
}
