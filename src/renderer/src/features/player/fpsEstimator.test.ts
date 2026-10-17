import { describe, expect, it } from 'vitest'
import { fpsFromRun } from './fpsEstimator'

describe('fpsFromRun', () => {
  it('кадры / время, притянутые к стандартной частоте', () => {
    expect(fpsFromRun(120, 4)).toBe(30)
    expect(fpsFromRun(100, 4)).toBe(25)
    expect(fpsFromRun(300, 10.01)).toBe(29.97)
  })
  it('слишком короткий отрезок или нулевое время - нет оценки', () => {
    expect(fpsFromRun(5, 0.2)).toBeNull()
    expect(fpsFromRun(50, 0)).toBeNull()
  })
})
