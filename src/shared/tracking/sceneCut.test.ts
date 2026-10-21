import { describe, expect, it } from 'vitest'
import { frameHistOf, isSceneCut } from './sceneCut'

const solid = (v: number, g = v, b = v): Uint8Array => {
  const px = new Uint8Array(32 * 32 * 4)
  for (let i = 0; i < px.length; i += 4) px.set([v, g, b, 255], i)
  return px
}

describe('isSceneCut', () => {
  it('тот же кадр и лёгкое изменение яркости — не смена плана', () => {
    const a = frameHistOf(solid(120, 160, 90), 32, 32)
    expect(isSceneCut(a, a)).toBe(false)
    expect(isSceneCut(a, frameHistOf(solid(122, 161, 91), 32, 32))).toBe(false)
  })

  it('другой кадр — смена плана', () => {
    expect(isSceneCut(frameHistOf(solid(235), 32, 32), frameHistOf(solid(30), 32, 32))).toBe(true)
  })

  it('гистограмма нормирована: каждый канал даёт сумму 1', () => {
    const h = frameHistOf(solid(10, 100, 200), 32, 32)
    expect(h).toHaveLength(48)
    for (let c = 0; c < 3; c += 1) {
      let s = 0
      for (let k = 0; k < 16; k += 1) s += h[c * 16 + k]
      expect(s).toBeCloseTo(1, 5)
    }
  })
})
