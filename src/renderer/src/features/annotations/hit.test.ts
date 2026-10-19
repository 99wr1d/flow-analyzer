import { describe, expect, it } from 'vitest'
import type { ScreenAnnotation as Annotation } from '../../../../shared/annotations'
import { distToEllipseArea, distToSegment, handleAt, hitAnnotation, topHit } from './hit'

const size = { w: 1000, h: 500 }
const measure = (text: string, px: number): number => text.length * px * 0.5
const base = {
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  style: { color: '#ffffff', width: 0.01, dash: 'solid' as const },
  timing: { mode: 'range' as const, start: 0, duration: 3 }
}
const line: Annotation = {
  ...base,
  space: 'screen',
  type: 'line',
  p1: { x: 0.1, y: 0.2 },
  p2: { x: 0.5, y: 0.2 }
}
const circle: Annotation = {
  ...base,
  space: 'screen',
  type: 'circle',
  p1: { x: 0.4, y: 0.4 },
  p2: { x: 0.6, y: 0.8 }
}
const text: Annotation = {
  id: '4f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  space: 'screen',
  type: 'text',
  pos: { x: 0.1, y: 0.7 },
  text: 'Пас',
  style: { color: '#fff000', size: 0.06, background: true },
  timing: base.timing
}

describe('расстояние до отрезка', () => {
  it('вдоль отрезка, за концом и вырожденный отрезок', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })
})

describe('попадание', () => {
  it('тонкая линия: в допуске попадаем, дальше нет', () => {
    // Линия на y = 100 px, толщина 5 px, допуск 7 px.
    expect(hitAnnotation(line, { x: 300, y: 100 }, size, measure)).toBe(true)
    expect(hitAnnotation(line, { x: 300, y: 108 }, size, measure)).toBe(true)
    expect(hitAnnotation(line, { x: 300, y: 115 }, size, measure)).toBe(false)
    expect(hitAnnotation(line, { x: 560, y: 100 }, size, measure)).toBe(false)
  })
  it('эллипс: внутри, рядом с контуром и далеко', () => {
    // Центр (500, 300), радиусы 100 x 100.
    expect(distToEllipseArea({ x: 500, y: 300 }, 500, 300, 100, 100)).toBe(0)
    expect(hitAnnotation(circle, { x: 500, y: 300 }, size, measure)).toBe(true)
    expect(hitAnnotation(circle, { x: 605, y: 300 }, size, measure)).toBe(true)
    expect(hitAnnotation(circle, { x: 640, y: 300 }, size, measure)).toBe(false)
  })
  it('текст: по прямоугольнику', () => {
    // Левый верхний угол (100, 350), шрифт 30 px.
    expect(hitAnnotation(text, { x: 120, y: 370 }, size, measure)).toBe(true)
    expect(hitAnnotation(text, { x: 900, y: 370 }, size, measure)).toBe(false)
    expect(hitAnnotation(text, { x: 120, y: 200 }, size, measure)).toBe(false)
  })
  it('topHit возвращает верхний (последний) рисунок', () => {
    const upper: Annotation = { ...circle, id: '5f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11' }
    expect(topHit([circle, upper], { x: 500, y: 300 }, size, measure)?.id).toBe(upper.id)
    expect(topHit([circle], { x: 5, y: 5 }, size, measure)).toBeNull()
  })
  it('handleAt находит ближайшую ручку', () => {
    expect(handleAt(line, { x: 103, y: 98 }, size)).toBe('p1')
    expect(handleAt(line, { x: 498, y: 101 }, size)).toBe('p2')
    expect(handleAt(line, { x: 300, y: 100 }, size)).toBeNull()
    expect(handleAt(circle, { x: 402, y: 202 }, size)).toBe('nw')
    expect(handleAt(text, { x: 100, y: 350 }, size)).toBeNull()
  })
})
