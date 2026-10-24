/** Ручки выделенного элемента: где они стоят и как меняют элемент, когда их тянут. */
import { editGeom, setStyle } from '../../../../shared/board/edit'
import type { ResolvedItem } from '../../../../shared/board/resolve'
import type { Board, BoardElement } from '../../../../shared/board/schema'
import { controlFromMid, curveMid } from '../../../../shared/tools/curve'
import { itemBox } from './BoardItemView'
import { BOARD_H, BOARD_W } from './art/constants'
import { angleDeg, clampUnit, dist, wrapDeg, type Point } from './canvasMath'

export type HandleKind = 'scale' | 'rotate' | 'p1' | 'p2' | 'mid'

export interface Handle {
  kind: HandleKind
  x: number
  y: number
}

/** Отступ рамки выделения (как в BoardItemView), пиксели доски. */
const PAD = 8
/** Ручка поворота выше рамки, пиксели доски при обычном масштабе. */
const ROTATE_OFFSET = 34

const MIN_SCALE = 0.2
const MAX_SCALE = 4
const MIN_TEXT = 0.01
const MAX_TEXT = 0.3

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Ручки элемента. k — пикселей экрана на пиксель доски (ручки одного размера при любом приближении). */
export function handlesFor(item: ResolvedItem, k = 1): Handle[] {
  const el = item.el
  const box = itemBox(item)
  const padX = PAD / BOARD_W
  const padY = PAD / BOARD_H
  const corner: Handle = {
    kind: 'scale',
    x: box.x + box.w + padX,
    y: box.y + box.h + padY
  }
  switch (el.kind) {
    case 'figure':
    case 'equip':
      return [
        corner,
        { kind: 'rotate', x: box.x + box.w / 2, y: box.y - padY - ROTATE_OFFSET / k / BOARD_H }
      ]
    case 'token':
    case 'number':
      return [corner]
    case 'wavy':
    case 'hatch':
      return [
        { kind: 'p1', ...el.p1 },
        { kind: 'p2', ...el.p2 }
      ]
    case 'shape': {
      const a = el.ann
      switch (a.type) {
        case 'arrow':
        case 'line':
          return [
            { kind: 'p1', ...a.p1 },
            { kind: 'p2', ...a.p2 }
          ]
        case 'curve':
          return [
            { kind: 'p1', ...a.p1 },
            { kind: 'p2', ...a.p2 },
            { kind: 'mid', ...curveMid(a.p1, a.c, a.p2) }
          ]
        case 'text':
          return [corner]
        default:
          return []
      }
    }
  }
}

/** Опорная точка масштаба и поворота: ступни фигуры, центр кружка, левый верхний угол подписи. */
function anchorOf(el: BoardElement): Point | null {
  if (el.kind === 'figure' || el.kind === 'equip' || el.kind === 'token' || el.kind === 'number')
    return el.pos
  if (el.kind === 'shape' && el.ann.type === 'text') return el.ann.pos
  return null
}

/**
 * Доска после протяжки ручки от start до p. el — элемент в этом кадре на момент начала протяжки.
 * snap — Shift: поворот шагами по 15°.
 */
export function dragHandle(
  base: Board,
  id: string,
  frame: number,
  el: BoardElement,
  kind: HandleKind,
  start: Point,
  p: Point,
  snap = false
): Board {
  const anchor = anchorOf(el)
  switch (kind) {
    case 'scale': {
      if (!anchor) return base
      const d0 = dist(anchor, start)
      const ratio = d0 > 1e-6 ? dist(anchor, p) / d0 : 1
      if (el.kind === 'shape' && el.ann.type === 'text') {
        const size = clamp(el.ann.style.size * ratio, MIN_TEXT, MAX_TEXT)
        return setStyle(base, id, { size: Math.round(size * 10000) / 10000 })
      }
      if (!('scale' in el)) return base
      const scale = clamp(el.scale * ratio, MIN_SCALE, MAX_SCALE)
      return editGeom(base, id, frame, { scale: Math.round(scale * 1000) / 1000 })
    }
    case 'rotate': {
      if (!anchor || !('rotation' in el)) return base
      let r = wrapDeg(el.rotation + angleDeg(anchor, p) - angleDeg(anchor, start))
      if (snap) r = wrapDeg(Math.round(r / 15) * 15)
      return editGeom(base, id, frame, { rotation: Math.round(r * 10) / 10 })
    }
    case 'p1':
    case 'p2':
      return editGeom(base, id, frame, { [kind]: clampUnit(p) })
    case 'mid': {
      if (el.kind !== 'shape' || el.ann.type !== 'curve') return base
      const c = controlFromMid(el.ann.p1, p, el.ann.p2)
      return editGeom(base, id, frame, { c: { x: clamp(c.x, -1, 2), y: clamp(c.y, -1, 2) } })
    }
  }
}
