/** Новые элементы доски из щелчка или протяжки мышью. Чистые функции. */
import type { PitchViewId } from '../../../../shared/board/ids'
import type { Board, BoardElement } from '../../../../shared/board/schema'
import { MAX_PEN_POINTS } from '../../../../shared/annotations'
import { defaultControl } from '../../../../shared/tools/curve'
import { simplifyStroke } from '../../../../shared/tools/simplify'
import type { BoardDraw } from './boardStore'
import { pitchView } from './art/pitchViews'
import { ASPECT, dist, type Point } from './canvasMath'

/** Толщина линий по умолчанию, доля высоты (не тоньше 0.006 — читается на проекторе). */
export const LINE_WIDTH = 0.008
export const PEN_WIDTH = 0.007
export const TEXT_SIZE = 0.05
/** Короче этого (доля высоты) протяжка считается щелчком: элемент не создаётся. */
export const MIN_DRAG = 0.012

const MIN_SCALE = 0.2
const MAX_SCALE = 4

const round = (v: number): number => Math.round(v * 10000) / 10000
const pt = (p: Point): Point => ({ x: round(p.x), y: round(p.y) })

/** Следующий свободный номер (на 1 больше самого большого, не больше 99). */
export function nextNumber(board: Board): number {
  let max = 0
  for (const it of board.items) if (it.el.kind === 'number') max = Math.max(max, it.el.n)
  return Math.min(99, max + 1)
}

/** Элемент инструмента «поставить» в точке p: фигура и инвентарь — в масштабе вида поля. */
export function placeElement(
  template: BoardElement,
  p: Point,
  view: PitchViewId,
  color: string | null,
  board: Board
): BoardElement {
  const pos = pt(p)
  switch (template.kind) {
    case 'figure':
    case 'equip': {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pitchView(view).scaleAt(p.y)))
      return { ...template, pos, scale: round(scale), color: color ?? template.color }
    }
    case 'token':
      return { ...template, pos, color: color ?? template.color }
    case 'number':
      return { ...template, pos, color: color ?? template.color, n: nextNumber(board) }
    default:
      return template
  }
}

interface LineStyle {
  color: string
  width: number
  dash: 'solid' | 'dashed'
}

const lineStyle = (color: string, dashed: boolean, width = LINE_WIDTH): LineStyle => ({
  color,
  width,
  dash: dashed ? ('dashed' as const) : ('solid' as const)
})

/** Нарисованный элемент: points — путь мыши (для линий важны первая и последняя точки). null — слишком мало. */
export function drawElement(
  draw: BoardDraw,
  points: readonly Point[],
  color: string,
  annId: string
): BoardElement | null {
  if (points.length === 0) return null
  const a = pt(points[0])
  const b = pt(points[points.length - 1])
  const long = dist(a, b) >= MIN_DRAG
  switch (draw) {
    case 'arrow':
    case 'arrow-dashed':
      if (!long) return null
      return {
        kind: 'shape',
        ann: {
          id: annId,
          space: 'screen',
          type: 'arrow',
          p1: a,
          p2: b,
          style: lineStyle(color, draw === 'arrow-dashed')
        }
      }
    case 'line':
      if (!long) return null
      return {
        kind: 'shape',
        ann: {
          id: annId,
          space: 'screen',
          type: 'line',
          p1: a,
          p2: b,
          style: lineStyle(color, false)
        }
      }
    case 'curve': {
      if (!long) return null
      // Изгиб в пикселях доски, чтобы он был одинаковым при любом направлении.
      const c = defaultControl(a, b, 0.3, { w: ASPECT, h: 1 })
      return {
        kind: 'shape',
        ann: {
          id: annId,
          space: 'screen',
          type: 'curve',
          p1: a,
          p2: b,
          c: { x: round(Math.min(2, Math.max(-1, c.x))), y: round(Math.min(2, Math.max(-1, c.y))) },
          style: lineStyle(color, false)
        }
      }
    }
    case 'wavy':
      if (!long) return null
      return { kind: 'wavy', p1: a, p2: b, color, width: LINE_WIDTH }
    case 'pen':
    case 'pen-dashed': {
      // Упрощаем в пикселях доски (x растянут на 16/9), потом обратно в доли.
      const scaled = points.map((q) => ({ x: q.x * ASPECT, y: q.y }))
      const simple = simplifyStroke(scaled, 0.002, MAX_PEN_POINTS).map((q) =>
        pt({ x: q.x / ASPECT, y: q.y })
      )
      let length = 0
      for (let i = 1; i < simple.length; i++) length += dist(simple[i - 1], simple[i])
      if (simple.length < 2 || length < MIN_DRAG) return null
      return {
        kind: 'shape',
        ann: {
          id: annId,
          space: 'screen',
          type: 'pen',
          points: simple,
          arrow: false,
          style: lineStyle(color, draw === 'pen-dashed', PEN_WIDTH)
        }
      }
    }
    case 'hatch-rect':
    case 'hatch-tri':
    case 'hatch-ellipse': {
      if (Math.abs(a.x - b.x) * ASPECT < MIN_DRAG || Math.abs(a.y - b.y) < MIN_DRAG) return null
      const shape = draw === 'hatch-rect' ? 'rect' : draw === 'hatch-tri' ? 'tri' : 'ellipse'
      return { kind: 'hatch', shape, p1: a, p2: b, color }
    }
    case 'text':
      return null
  }
}

/** Подпись: pos — левый верхний угол. */
export function textElement(text: string, p: Point, color: string, annId: string): BoardElement {
  return {
    kind: 'shape',
    ann: {
      id: annId,
      space: 'screen',
      type: 'text',
      pos: pt(p),
      text,
      style: { color, size: TEXT_SIZE, background: false, shadow: true }
    }
  }
}
