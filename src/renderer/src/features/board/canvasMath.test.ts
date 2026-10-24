import { describe, expect, it } from 'vitest'
import type { ResolvedItem } from '../../../../shared/board/resolve'
import type { BoardElement } from '../../../../shared/board/schema'
import {
  angleDeg,
  clampUnit,
  clientToBoard,
  fitRect,
  hitTest,
  moveGeom,
  rectFromPoints
} from './canvasMath'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top
  }) as DOMRect

const token = (x: number, y: number, color = '#ff0000'): BoardElement => ({
  kind: 'token',
  pos: { x, y },
  scale: 1,
  color,
  label: ''
})
const item = (id: string, el: BoardElement): ResolvedItem => ({ id, el, opacity: 1 })

describe('clientToBoard', () => {
  it('поле 800×450 вписано в окно 1000×450: поля по 100 слева и справа', () => {
    const r = rect(0, 0, 1000, 450)
    expect(clientToBoard(r, 100, 0)).toEqual({ x: 0, y: 0 })
    expect(clientToBoard(r, 900, 450)).toEqual({ x: 1, y: 1 })
    expect(clientToBoard(r, 500, 225)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('учитывает сдвиг окна и поля сверху/снизу', () => {
    const r = rect(50, 20, 800, 600) // поле 800×450, по 75 сверху и снизу
    expect(clientToBoard(r, 50, 95)).toEqual({ x: 0, y: 0 })
    expect(clientToBoard(r, 850, 545)).toEqual({ x: 1, y: 1 })
  })

  it('вне поля — за пределами 0..1 (обрезает clampUnit)', () => {
    const p = clientToBoard(rect(0, 0, 1000, 450), 0, 0)
    expect(p.x).toBeLessThan(0)
    expect(clampUnit(p)).toEqual({ x: 0, y: 0 })
    expect(clampUnit({ x: 1.4, y: 0.3 })).toEqual({ x: 1, y: 0.3 })
  })
})

describe('fitRect', () => {
  it('вписывает 16:9 по центру', () => {
    expect(fitRect(1000, 450)).toEqual({ x: 100, y: 0, w: 800, h: 450 })
    expect(fitRect(800, 600)).toEqual({ x: 0, y: 75, w: 800, h: 450 })
  })
})

describe('hitTest', () => {
  it('выбирает верхний из двух пересекающихся', () => {
    const items = [item('a', token(0.5, 0.5)), item('b', token(0.51, 0.5))]
    expect(hitTest(items, { x: 0.505, y: 0.5 })).toBe('b')
    expect(hitTest([...items].reverse(), { x: 0.505, y: 0.5 })).toBe('a')
  })

  it('мимо всех — null', () => {
    expect(hitTest([item('a', token(0.5, 0.5))], { x: 0.1, y: 0.1 })).toBeNull()
  })

  it('длинная наклонная стрелка ловится у линии, а не по всей рамке', () => {
    const arrow = item('arr', {
      kind: 'shape',
      ann: {
        id: '11111111-1111-4111-8111-111111111111',
        space: 'screen',
        type: 'arrow',
        p1: { x: 0.1, y: 0.1 },
        p2: { x: 0.9, y: 0.9 },
        style: { color: '#ffffff', width: 0.008, dash: 'solid' }
      }
    })
    expect(hitTest([arrow], { x: 0.5, y: 0.5 })).toBe('arr')
    expect(hitTest([arrow], { x: 0.8, y: 0.2 })).toBeNull()
  })
})

describe('moveGeom', () => {
  it('сдвигает точку элемента', () => {
    expect(moveGeom(token(0.5, 0.5), 0.1, -0.2)).toEqual({ pos: { x: 0.6, y: 0.3 } })
  })

  it('не выводит за край: сдвиг урезается так, чтобы все точки остались на поле', () => {
    const wavy: BoardElement = {
      kind: 'wavy',
      p1: { x: 0.8, y: 0.5 },
      p2: { x: 0.9, y: 0.5 },
      color: '#ffffff',
      width: 0.008
    }
    const g = moveGeom(wavy, 0.5, 0) as { p1: { x: number }; p2: { x: number } }
    expect(g.p2.x).toBeCloseTo(1)
    expect(g.p1.x).toBeCloseTo(0.9)
  })

  it('перо: двигаются все точки', () => {
    const pen: BoardElement = {
      kind: 'shape',
      ann: {
        id: '11111111-1111-4111-8111-111111111111',
        space: 'screen',
        type: 'pen',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.3 }
        ],
        arrow: false,
        style: { color: '#ffffff', width: 0.008, dash: 'solid' }
      }
    }
    const g = moveGeom(pen, 0.1, 0.1) as { points: { x: number; y: number }[] }
    expect(g.points[0].x).toBeCloseTo(0.2)
    expect(g.points[1].y).toBeCloseTo(0.4)
  })
})

describe('мелочи', () => {
  it('rectFromPoints и angleDeg', () => {
    const r = rectFromPoints({ x: 0.5, y: 0.1 }, { x: 0.2, y: 0.4 })
    expect(r.x).toBeCloseTo(0.2)
    expect(r.y).toBeCloseTo(0.1)
    expect(r.w).toBeCloseTo(0.3)
    expect(r.h).toBeCloseTo(0.3)
    // угол в пикселях доски: вправо 0°, вниз 90°
    expect(angleDeg({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 })).toBeCloseTo(0)
    expect(angleDeg({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 })).toBeCloseTo(90)
  })
})
