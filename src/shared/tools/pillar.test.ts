import { describe, expect, it } from 'vitest'
import type { Spotlight } from '../annotations'
import { paintScreenTool } from './screenPaint'
import { PILLAR_WIDTH_SHARE, pillarFromFooting } from './pillar'

const spot = (form?: 'oval' | 'pillar', beam?: boolean): Spotlight => ({
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  space: 'screen',
  type: 'spot',
  p1: { x: 0.4, y: 0.6 },
  p2: { x: 0.5, y: 0.7 },
  dim: 0.5,
  ...(form ? { form } : {}),
  ...(beam === undefined ? {} : { beam }),
  style: { color: '#c6ff3d', width: 0.008, dash: 'solid' },
  timing: { mode: 'range', start: 0, duration: 3 }
})
const SIZE = { w: 1000, h: 500 }

describe('световой столб: геометрия', () => {
  it('вертикаль по экрану от верха кадра до низа-середины следа, ширина — доля ширины следа', () => {
    const p = pillarFromFooting({ x: 450, y: 350 }, 100)!
    expect(p.x).toBe(450)
    expect(p.top).toBe(0)
    expect(p.bottom).toBe(350)
    expect(p.half).toBeCloseTo((100 * PILLAR_WIDTH_SHARE) / 2, 6)
  })

  it('ноги у верхнего края — короткий столб; ноги выше края — столба нет', () => {
    expect(pillarFromFooting({ x: 10, y: 12 }, 40)!.bottom).toBe(12)
    expect(pillarFromFooting({ x: 10, y: 0.2 }, 40)).toBeNull()
    expect(pillarFromFooting({ x: 10, y: -5 }, 40)).toBeNull()
  })

  it('экранный прожектор «Столб»: pillar в paint, освещён и нажимается столб, без обводки овала и луча', () => {
    const p = paintScreenTool(spot('pillar', true), SIZE)
    expect(p.pillar).toBeDefined()
    // Овал 100×50 px с центром (450, 325): низ-середина (450, 350).
    expect(p.pillar!.x).toBeCloseTo(450, 6)
    expect(p.pillar!.bottom).toBeCloseTo(350, 6)
    expect(p.pillar!.half).toBeCloseTo((100 * PILLAR_WIDTH_SHARE) / 2, 6)
    expect(p.beam).toBeNull()
    expect(p.strokes).toEqual([])
    const ys = p.lit[0].map((q) => q.y)
    expect(Math.max(...ys)).toBeCloseTo(350, 6)
    expect(Math.min(...ys)).toBeLessThanOrEqual(0)
    const xs = p.lit[0].map((q) => q.x)
    expect(Math.min(...xs)).toBeCloseTo(450 - p.pillar!.half, 6)
    expect(Math.max(...xs)).toBeCloseTo(450 + p.pillar!.half, 6)
    expect(Math.min(...p.hit[0].map((q) => q.y))).toBe(0)
    expect(Math.max(...p.hit[0].map((q) => q.y))).toBeCloseTo(350, 6)
    // Ручки овала остаются: столб правится так же, как овал.
    expect(p.handles).toHaveLength(4)
  })

  it('вид «овал» и старый прожектор без form — как раньше (без столба)', () => {
    expect(paintScreenTool(spot(), SIZE).pillar).toBeUndefined()
    expect(paintScreenTool(spot('oval'), SIZE).pillar).toBeUndefined()
    expect(paintScreenTool(spot('oval'), SIZE).strokes).toHaveLength(1)
  })
})
