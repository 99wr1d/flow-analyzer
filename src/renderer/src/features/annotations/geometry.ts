// Чистая геометрия рисунков: отображение «нормализованные координаты ↔ пиксели» и привязка углов.
import {
  MAX_LOUPE_RADIUS,
  MIN_LOUPE_RADIUS,
  type ScreenAnnotation,
  type Point
} from '../../../../shared/annotations'
import { controlFromMid, curveExtent } from '../../../../shared/tools/curve'
import { mapToolPoints, toolPointsOf, vertexIndex } from '../../../../shared/tools/points'

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

/** Ширина эллипса «у ног», созданного щелчком, в долях высоты кадра. */
export const GROUND_ELLIPSE_WIDTH = 0.07

/**
 * Плоский эллипс «на траве» вокруг точки щелчка: отношение высоты к ширине (в пикселях) — ratio
 * (groundEllipseRatio: по разметке поля или 0.35). У края кадра сдвигается внутрь, форма не меняется.
 */
export function groundEllipseBox(
  center: Point,
  ratio: number,
  size: Size
): { p1: Point; p2: Point } {
  const rx = (GROUND_ELLIPSE_WIDTH * size.h) / size.w / 2
  const ry = (GROUND_ELLIPSE_WIDTH * ratio * size.h) / size.h / 2
  const cx = Math.min(1 - rx, Math.max(rx, center.x))
  const cy = Math.min(1 - ry, Math.max(ry, center.y))
  return { p1: { x: cx - rx, y: cy - ry }, p2: { x: cx + rx, y: cy + ry } }
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
  if (a.type === 'arrow' || a.type === 'line' || a.type === 'circle' || a.type === 'spot') {
    return {
      x0: Math.min(a.p1.x, a.p2.x),
      y0: Math.min(a.p1.y, a.p2.y),
      x1: Math.max(a.p1.x, a.p2.x),
      y1: Math.max(a.p1.y, a.p2.y)
    }
  }
  const pts = a.type === 'curve' ? curveExtent(a.p1, a.c, a.p2) : toolPointsOf(a)
  const box = {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y))
  }
  if (a.type === 'loupe') {
    // Линза — круг радиуса radius × высота кадра; по горизонтали это radius × h / w долей ширины.
    const rx = a.radius * (size ? size.h / size.w : 1)
    box.x0 = Math.min(box.x0, a.pos.x - rx)
    box.x1 = Math.max(box.x1, a.pos.x + rx)
    box.y0 = Math.min(box.y0, a.pos.y - a.radius)
    box.y1 = Math.max(box.y1, a.pos.y + a.radius)
  }
  return box
}

const clampRange = (v: number, lo: number, hi: number): number =>
  lo > hi ? hi : Math.min(hi, Math.max(lo, v))

/** Сдвиг рисунка на (dx, dy) в нормализованных координатах; рисунок остаётся целиком внутри картинки. */
export function moveBy(a: ScreenAnnotation, dx: number, dy: number, box: BBox): ScreenAnnotation {
  const cx = clampRange(dx, -box.x0, 1 - box.x1)
  const cy = clampRange(dy, -box.y0, 1 - box.y1)
  if (a.type === 'text') return { ...a, pos: { x: a.pos.x + cx, y: a.pos.y + cy } }
  if (a.type === 'arrow' || a.type === 'line' || a.type === 'circle') {
    return {
      ...a,
      p1: { x: a.p1.x + cx, y: a.p1.y + cy },
      p2: { x: a.p2.x + cx, y: a.p2.y + cy }
    }
  }
  return mapToolPoints(a, (p) => ({ x: p.x + cx, y: p.y + cy }))
}

export type HandleId = string

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
  if (a.type === 'circle' || a.type === 'spot') {
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

/** Перетаскивание ручки: двигает только её (у круга — противоположный угол остаётся на месте). size нужен лупе. */
export function moveHandle(
  a: ScreenAnnotation,
  handle: HandleId,
  to: Point,
  size?: Size
): ScreenAnnotation {
  const p = clampPoint(to)
  if (a.type === 'arrow' || a.type === 'line') {
    if (handle === 'p1') return { ...a, p1: p }
    if (handle === 'p2') return { ...a, p2: p }
    return a
  }
  if (a.type === 'circle' || a.type === 'spot') {
    const b = bboxOf(a)
    const west = handle === 'nw' || handle === 'sw'
    const north = handle === 'nw' || handle === 'ne'
    if (!['nw', 'ne', 'se', 'sw'].includes(handle)) return a
    const fixedX = west ? b.x1 : b.x0
    const fixedY = north ? b.y1 : b.y0
    return { ...a, p1: { x: fixedX, y: fixedY }, p2: p }
  }
  if (a.type === 'curve') {
    if (handle === 'p1') return { ...a, p1: p }
    if (handle === 'p2') return { ...a, p2: p }
    // Ручка стоит на самой кривой: управляющая точка подбирается так, чтобы кривая прошла через курсор.
    if (handle === 'c') {
      const c = controlFromMid(a.p1, p, a.p2)
      return { ...a, c: { x: clampRange(c.x, -1, 2), y: clampRange(c.y, -1, 2) } }
    }
    return a
  }
  if (a.type === 'zone' || a.type === 'chain') {
    const i = vertexIndex(handle)
    if (i === null || i >= a.points.length) return a
    return { ...a, points: a.points.map((q, k) => (k === i ? p : q)) }
  }
  if (a.type === 'loupe') {
    if (handle === 'src') return { ...a, src: p }
    if (handle === 'lens') {
      // Ручка стоит на верхнем краю линзы; двигается только линза, источник остаётся на месте.
      return { ...a, pos: clampPoint({ x: p.x, y: p.y + a.radius }) }
    }
    if (handle === 'size') {
      const k = size ? size.w / size.h : 1
      const r = Math.hypot((p.x - a.pos.x) * k, p.y - a.pos.y)
      return { ...a, radius: Math.min(MAX_LOUPE_RADIUS, Math.max(MIN_LOUPE_RADIUS, r)) }
    }
    return a
  }
  return a
}
