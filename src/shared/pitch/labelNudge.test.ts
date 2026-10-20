import { describe, expect, it } from 'vitest'
import type { Ruler } from '../annotations'
import { fitHomography, type Correspondence } from './homography'
import { penaltyAreaRect } from './landmarks'
import { nudgeLabels, rulerLabelShifts, type LabelBox } from './labelNudge'
import { lookAtCamera } from './pitch.testkit'
import { makeProjector } from './projector'
import { paintPitch } from './shapes'

const SIZE = { w: 1280, h: 720 }
const measure = (t: string, px: number): number => t.length * px * 0.58
const calId = '00000000-0000-4000-8000-0000000000c1'
const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)
const pairs: Correspondence[] = penaltyAreaRect({ length: 105, width: 68 }, 'left').map((w) => ({
  world: w,
  image: cam.project(w)!
}))
const fit = fitHomography(pairs, cam.aspect)
if (!fit.ok) throw new Error('камера теста не годится')
const proj = makeProjector(fit.H)!

const box = (id: string, x: number, y: number, w = 60, h = 20): LabelBox => ({ id, x, y, w, h })

describe('nudgeLabels', () => {
  it('подписи, которые не пересекаются, остаются на месте', () => {
    expect(nudgeLabels([box('a', 100, 100), box('b', 300, 100), box('c', 100, 200)]).size).toBe(0)
  })

  it('вторая подпись на месте первой поднимается над ней, без пересечения', () => {
    const s = nudgeLabels([box('a', 100, 100), box('b', 105, 104)])
    expect(s.has('a')).toBe(false)
    const dy = s.get('b') as number
    expect(dy).toBeLessThan(0)
    // Новое положение b выше a на высоту плашки с зазором.
    expect(104 + dy).toBeLessThanOrEqual(100 - 20)
  })

  it('три подписи в одном месте разводятся все', () => {
    const s = nudgeLabels([box('a', 50, 50), box('b', 50, 50), box('c', 50, 50)])
    const ys = [50, 50 + (s.get('b') ?? 0), 50 + (s.get('c') ?? 0)]
    expect(new Set(ys).size).toBe(3)
    expect(
      Math.min(...ys.flatMap((y, i) => ys.slice(i + 1).map((z) => Math.abs(y - z))))
    ).toBeGreaterThanOrEqual(20)
  })

  it('результат не зависит от повторного вызова (детерминированно)', () => {
    const list = [box('a', 10, 10), box('b', 12, 12), box('c', 14, 8)]
    expect([...nudgeLabels(list)]).toEqual([...nudgeLabels(list)])
  })
})

describe('rulerLabelShifts', () => {
  it('две линейки из одной точки с близкими серединами: подписи расходятся, одиночная не двигается', () => {
    const base = {
      space: 'pitch' as const,
      calibrationId: calId,
      type: 'ruler' as const,
      style: { color: '#ffd60a', width: 0.011, dash: 'solid' as const },
      timing: { mode: 'frame' as const, start: 1, freezeSeconds: 3 }
    }
    const r1: Ruler = {
      ...base,
      id: '00000000-0000-4000-8000-0000000000a1',
      p1: { x: 8, y: 20 },
      p2: { x: 8, y: 36 }
    }
    const r2: Ruler = {
      ...base,
      id: '00000000-0000-4000-8000-0000000000a2',
      p1: { x: 8, y: 20 },
      p2: { x: 8, y: 37 }
    }
    const far: Ruler = {
      ...base,
      id: '00000000-0000-4000-8000-0000000000a3',
      p1: { x: 30, y: 10 },
      p2: { x: 30, y: 12 }
    }
    const shifts = rulerLabelShifts([r1, r2, far], () => proj, SIZE, measure)
    const l1 = paintPitch(r1, proj, SIZE, measure).label!
    const l2 = paintPitch(r2, proj, SIZE, measure).label!
    // До сдвига плашки пересекаются.
    expect(Math.abs(l1.y - l2.y)).toBeLessThan(l1.h)
    expect(shifts.has(r1.id)).toBe(false)
    const dy = shifts.get(r2.id) as number
    expect(Math.abs(l1.y - (l2.y + dy))).toBeGreaterThanOrEqual(l1.h)
    expect(shifts.has(far.id)).toBe(false)
  })
})
