import { describe, expect, it } from 'vitest'
import { PLAYBACK_RATES, formatRate, stepRate } from './speed'

describe('stepRate', () => {
  it('быстрее', () => {
    expect(stepRate(1, 1)).toBe(1.5)
    expect(stepRate(0.25, 1)).toBe(0.5)
  })
  it('медленнее', () => {
    expect(stepRate(1, -1)).toBe(0.75)
    expect(stepRate(2, -1)).toBe(1.5)
  })
  it('на краях не выходит за пределы', () => {
    expect(stepRate(2, 1)).toBe(2)
    expect(stepRate(0.25, -1)).toBe(0.25)
  })
  it('значение вне списка округляется к ближайшему соседу', () => {
    expect(stepRate(1.2, 1)).toBe(1.5)
    expect(stepRate(1.2, -1)).toBe(1)
  })
  it('список скоростей и подписи', () => {
    expect([...PLAYBACK_RATES]).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2])
    expect(formatRate(0.25)).toBe('0.25×')
  })
})
