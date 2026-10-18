import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  needsOutline,
  niceTicks,
  rovingNext,
  topRoundedRect,
  truncate
} from './chartKit'

describe('niceTicks', () => {
  it('даёт круглый шаг и верх не ниже максимума', () => {
    expect(niceTicks(0)).toEqual({ ticks: [0, 1], top: 1 })
    expect(niceTicks(3)).toEqual({ ticks: [0, 1, 2, 3], top: 3 })
    expect(niceTicks(7).ticks).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(47).ticks).toEqual([0, 20, 40, 60])
    expect(niceTicks(100).top).toBe(100)
    for (const max of [1, 2, 5, 9, 13, 99, 250, 1234, 10_000]) {
      const { ticks, top } = niceTicks(max)
      expect(top).toBeGreaterThanOrEqual(max)
      expect(ticks.length).toBeLessThanOrEqual(7)
      expect(ticks.every(Number.isInteger)).toBe(true)
    }
  })
  it('нечисловой максимум не ломает шкалу', () => {
    expect(niceTicks(Number.NaN).top).toBe(1)
  })
})

describe('контраст и обводка', () => {
  it('известные значения', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5)
  })
  it('цвета, близкие к фону, получают обводку', () => {
    expect(needsOutline('#15181e')).toBe(true)
    expect(needsOutline('#232833')).toBe(true)
    expect(needsOutline('#2bd67b')).toBe(false)
    expect(needsOutline('#4da3ff')).toBe(false)
  })
})

describe('геометрия и подписи', () => {
  it('скругление не больше половины ширины и высоты', () => {
    expect(topRoundedRect(0, 0, 10, 2, 4)).toContain('Q0 0 2 0')
    expect(topRoundedRect(0, 0, 2, 20, 4)).toContain('Q0 0 1 0')
  })
  it('обрезка', () => {
    expect(truncate('Атака', 10)).toBe('Атака')
    expect(truncate('Переход в оборону', 8)).toBe('Переход…')
  })
  it('стрелки по набору элементов', () => {
    expect(rovingNext('ArrowRight', 0, 3, false)).toBe(1)
    expect(rovingNext('ArrowRight', 2, 3, false)).toBe(2)
    expect(rovingNext('ArrowUp', 1, 3, true)).toBe(0)
    expect(rovingNext('End', 0, 3, false)).toBe(2)
    expect(rovingNext('a', 0, 3, false)).toBeNull()
  })
})
