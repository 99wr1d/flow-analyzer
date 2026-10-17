import { describe, expect, it } from 'vitest'
import { MIN_LABEL_SPACING, computeTicks } from './ticks'

describe('computeTicks', () => {
  it('для пустых данных делений нет', () => {
    expect(computeTicks(0, 800).major).toEqual([])
    expect(computeTicks(10, 0).major).toEqual([])
    expect(computeTicks(NaN, 800).major).toEqual([])
  })
  it('короткое видео — шаг в секунду', () => {
    const t = computeTicks(6, 1000)
    expect(t.step).toBe(1)
    expect(t.major).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
  it('подписи не ближе минимального расстояния', () => {
    for (const duration of [6, 90, 600, 5400, 7200]) {
      const t = computeTicks(duration, 900)
      expect((t.step * 900) / duration).toBeGreaterThanOrEqual(MIN_LABEL_SPACING)
    }
  })
  it('длинное видео — шаг в минуты', () => {
    expect(computeTicks(5400, 900).step).toBeGreaterThanOrEqual(300)
  })
  it('малые деления лежат внутри видео', () => {
    const t = computeTicks(6.5, 1000)
    expect(Math.max(...t.minor, ...t.major)).toBeLessThanOrEqual(6.5)
  })
})
