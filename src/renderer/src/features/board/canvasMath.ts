/** Геометрия холста доски: экран → доля поля, попадание мышью, сдвиг элементов. Чистые функции. */
import type { ResolvedItem } from '../../../../shared/board/resolve'
import type { BoardElement } from '../../../../shared/board/schema'
import { densifyQuad } from '../../../../shared/tools/curve'
import { itemBox } from './BoardItemView'
import { BOARD_H, BOARD_W } from './art/constants'

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Ширина доски в «высотах»: 16 / 9. Расстояния считаются в долях высоты, чтобы по осям было одинаково. */
export const ASPECT = BOARD_W / BOARD_H

type RectLike = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

/** Поле 16:9, вписанное в прямоугольник w×h по центру (как SVG с preserveAspectRatio «meet»). */
export function fitRect(w: number, h: number): Box {
  const scale = Math.min(w / BOARD_W, h / BOARD_H)
  const fw = BOARD_W * scale
  const fh = BOARD_H * scale
  return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh }
}

/** Точка экрана → доля поля (0..1 внутри поля, за краем — меньше 0 или больше 1). rect — рамка SVG доски. */
export function clientToBoard(rect: RectLike, clientX: number, clientY: number): Point {
  const f = fitRect(rect.width, rect.height)
  return {
    x: f.w > 0 ? (clientX - rect.left - f.x) / f.w : 0,
    y: f.h > 0 ? (clientY - rect.top - f.y) / f.h : 0
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export const clampUnit = (p: Point): Point => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) })

/** Расстояние в долях высоты доски. */
export const dist = (a: Point, b: Point): number => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y)

function distToSegment(p: Point, a: Point, b: Point): number {
  const ax = a.x * ASPECT
  const bx = b.x * ASPECT
  const px = p.x * ASPECT
  const dx = bx - ax
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (p.y - a.y) * dy) / len2, 0, 1)
  return Math.hypot(px - (ax + t * dx), p.y - (a.y + t * dy))
}

function distToPolyline(p: Point, pts: readonly Point[]): number {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]))
  return best
}

/** Запас попадания по линии, доля высоты. */
const LINE_TOLERANCE = 0.018

/** Линия элемента, если он «линейный» (стрелка, линия, змейка, кривая, перо): по ней ловится мышь. */
function linePoints(el: BoardElement): Point[] | null {
  if (el.kind === 'wavy') return [el.p1, el.p2]
  if (el.kind !== 'shape') return null
  const a = el.ann
  switch (a.type) {
    case 'arrow':
    case 'line':
      return [a.p1, a.p2]
    case 'curve':
      return densifyQuad(a.p1, a.c, a.p2, 24)
    case 'pen':
      return a.points
    default:
      return null
  }
}

function lineWidth(el: BoardElement): number {
  if (el.kind === 'wavy') return el.width + 0.016
  if (el.kind === 'shape' && 'style' in el.ann && 'width' in el.ann.style) return el.ann.style.width
  return 0
}

export const inBox = (b: Box, p: Point): boolean =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

/** Попадание в один элемент. */
export function hitsItem(item: ResolvedItem, p: Point): boolean {
  const line = linePoints(item.el)
  if (line) return distToPolyline(p, line) <= LINE_TOLERANCE + lineWidth(item.el) / 2
  return inBox(itemBox(item), p)
}

/** Верхний элемент под точкой (последний в списке рисуется поверх). */
export function hitTest(items: readonly ResolvedItem[], p: Point): string | null {
  for (let i = items.length - 1; i >= 0; i--) if (hitsItem(items[i], p)) return items[i].id
  return null
}

/** Все точки геометрии элемента (для сдвига и рамки). */
function pointsOf(el: BoardElement): Point[] {
  switch (el.kind) {
    case 'figure':
    case 'equip':
    case 'token':
    case 'number':
      return [el.pos]
    case 'wavy':
    case 'hatch':
      return [el.p1, el.p2]
    case 'shape': {
      const a = el.ann
      switch (a.type) {
        case 'text':
          return [a.pos]
        case 'pen':
        case 'zone':
          return a.points
        default:
          // управляющая точка кривой может быть за полем — край ограничивают только концы
          return [a.p1, a.p2]
      }
    }
  }
}

/** Сдвиг (dx, dy), урезанный так, чтобы все точки остались на поле. */
export function clampDelta(el: BoardElement, dx: number, dy: number): Point {
  const pts = pointsOf(el)
  const xs = pts.map((q) => q.x)
  const ys = pts.map((q) => q.y)
  return {
    x: clamp(dx, -Math.min(...xs), 1 - Math.max(...xs)),
    y: clamp(dy, -Math.min(...ys), 1 - Math.max(...ys))
  }
}

const shift = (q: Point, d: Point): Point => ({ x: q.x + d.x, y: q.y + d.y })

/** Геометрия для editGeom: элемент сдвинут на (dx, dy) в долях поля, не дальше края. */
export function moveGeom(el: BoardElement, dx: number, dy: number): Record<string, unknown> {
  const d = clampDelta(el, dx, dy)
  switch (el.kind) {
    case 'figure':
    case 'equip':
    case 'token':
    case 'number':
      return { pos: shift(el.pos, d) }
    case 'wavy':
    case 'hatch':
      return { p1: shift(el.p1, d), p2: shift(el.p2, d) }
    case 'shape': {
      const a = el.ann
      switch (a.type) {
        case 'text':
          return { pos: shift(a.pos, d) }
        case 'pen':
        case 'zone':
          return { points: a.points.map((q) => shift(q, d)) }
        case 'curve':
          return {
            p1: shift(a.p1, d),
            p2: shift(a.p2, d),
            c: { x: clamp(a.c.x + d.x, -1, 2), y: clamp(a.c.y + d.y, -1, 2) }
          }
        default:
          return { p1: shift(a.p1, d), p2: shift(a.p2, d) }
      }
    }
  }
}

export function rectFromPoints(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y)
  }
}

/** Угол направления a → b в пикселях доски, градусы: вправо 0°, вниз 90°. */
export function angleDeg(a: Point, b: Point): number {
  return (Math.atan2(b.y - a.y, (b.x - a.x) * ASPECT) * 180) / Math.PI
}

/** Угол в пределах −180..180. */
export function wrapDeg(a: number): number {
  let r = ((((a + 180) % 360) + 360) % 360) - 180
  if (r === -180) r = 180
  return r
}
