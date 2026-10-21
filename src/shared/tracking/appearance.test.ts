import { describe, expect, it } from 'vitest'
import { appearanceDistance, LOOK_LENGTH, lookOf } from './appearance'

function image(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number]
): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const c = paint(x, y)
      px.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
    }
  }
  return px
}

const box = { x: 0, y: 0, w: 40, h: 80 }
const red = image(40, 80, (_, y) => (y < 40 ? [220, 30, 30] : [255, 255, 255]))
const blue = image(40, 80, (_, y) => (y < 40 ? [30, 60, 220] : [20, 20, 20]))

describe('lookOf', () => {
  it('2×(3×16) корзин, каждая гистограмма нормирована на 1', () => {
    const l = lookOf(red, 40, 80, box)
    expect(l).toHaveLength(LOOK_LENGTH)
    for (let c = 0; c < 6; c += 1) {
      let s = 0
      for (let k = 0; k < 16; k += 1) s += l[c * 16 + k]
      expect(s).toBeCloseTo(1, 5)
    }
  })

  it('рамка за пределами кадра даёт нулевую примету без падения', () => {
    const l = lookOf(red, 40, 80, { x: 500, y: 500, w: 10, h: 10 })
    expect(l.every((v) => v === 0)).toBe(true)
  })
})

describe('appearanceDistance', () => {
  it('одинаковые — 0, разные цвета — заметно больше, симметрично', () => {
    const a = lookOf(red, 40, 80, box)
    const b = lookOf(blue, 40, 80, box)
    expect(appearanceDistance(a, a)).toBeCloseTo(0, 5)
    expect(appearanceDistance(a, b)).toBeGreaterThan(0.3)
    expect(appearanceDistance(a, b)).toBeLessThanOrEqual(1)
    expect(appearanceDistance(a, b)).toBeCloseTo(appearanceDistance(b, a), 6)
  })

  it('небольшая подсветка меняет примету слабо', () => {
    const a = lookOf(red, 40, 80, box)
    const lit = image(40, 80, (_, y) => (y < 40 ? [230, 40, 35] : [250, 250, 250]))
    expect(appearanceDistance(a, lookOf(lit, 40, 80, box))).toBeLessThan(0.3)
  })
})
