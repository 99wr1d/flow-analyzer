import { describe, expect, it } from 'vitest'
import type { Spotlight } from '../annotations'
import { paintScreenTool } from './screenPaint'

const spot = (beam?: boolean): Spotlight => ({
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  space: 'screen',
  type: 'spot',
  p1: { x: 0.4, y: 0.6 },
  p2: { x: 0.5, y: 0.7 },
  dim: 0.5,
  ...(beam === undefined ? {} : { beam }),
  style: { color: '#ffd60a', width: 0.008, dash: 'solid' },
  timing: { mode: 'range', start: 0, duration: 3 }
})
const SIZE = { w: 1000, h: 500 }

describe('прожектор на экране с лучом', () => {
  it('без луча: освещён эллипс, луча нет', () => {
    const p = paintScreenTool(spot(), SIZE)
    expect(p.beam).toBeNull()
    const ys = p.lit[0].map((q) => q.y)
    expect(Math.min(...ys)).toBeCloseTo(300, 0)
  })

  it('beam: false — как без луча', () => {
    expect(paintScreenTool(spot(false), SIZE).beam).toBeNull()
  })

  it('с лучом: силуэт поднимается над эллипсом, освещён весь силуэт, нажимается он же', () => {
    const p = paintScreenTool(spot(true), SIZE)
    expect(p.beam).not.toBeNull()
    const beam = p.beam!
    // Основание — эллипс (низ y=350), верх выше эллипса.
    expect(beam.bottom).toBeCloseTo(350, 0)
    expect(beam.top).toBeLessThan(300)
    expect(p.lit[0]).toEqual(beam.poly)
    expect(p.hit[0]).toEqual(beam.poly)
  })

  it('высота луча растёт вместе с эллипсом (как рост человека у пятна на поле)', () => {
    const small = paintScreenTool(spot(true), SIZE).beam!
    const big = paintScreenTool(
      { ...spot(true), p1: { x: 0.3, y: 0.5 }, p2: { x: 0.5, y: 0.7 } },
      SIZE
    ).beam!
    expect(big.bottom - big.top).toBeGreaterThan((small.bottom - small.top) * 1.8)
  })
})
