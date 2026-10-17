import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../../../shared/annotations'
import { arrowShape } from './arrowGeometry'
import {
  bboxOf,
  containRect,
  denormalize,
  handlesOf,
  moveBy,
  moveHandle,
  normalize,
  snapAngle,
  squareFrom
} from './geometry'
import { assignLanes } from './lanes'

describe('containRect: картинка внутри элемента (object-fit: contain)', () => {
  it('широкое видео в квадратном окне: поля сверху и снизу', () => {
    const r = containRect(1000, 1000, 1600, 900)!
    expect(r.w).toBeCloseTo(1000)
    expect(r.h).toBeCloseTo(562.5)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(218.75)
  })
  it('вертикальное видео в широком окне: поля по бокам', () => {
    const r = containRect(1200, 600, 720, 1280)!
    expect(r.h).toBeCloseTo(600)
    expect(r.w).toBeCloseTo(337.5)
    expect(r.x).toBeCloseTo((1200 - 337.5) / 2)
    expect(r.y).toBeCloseTo(0)
  })
  it('точное совпадение пропорций и некорректные размеры', () => {
    expect(containRect(640, 360, 1280, 720)).toEqual({ x: 0, y: 0, w: 640, h: 360 })
    expect(containRect(0, 360, 1280, 720)).toBeNull()
    expect(containRect(640, 360, 0, 0)).toBeNull()
  })
  for (const [bw, bh, vw, vh] of [
    [900, 500, 640, 360],
    [500, 900, 640, 360],
    [800, 800, 1920, 1080],
    [1280, 720, 720, 1280]
  ]) {
    it(`normalize и denormalize обратимы (${bw}x${bh}, видео ${vw}x${vh})`, () => {
      const rect = containRect(bw, bh, vw, vh)!
      for (const p of [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0.25, y: 0.8 }
      ]) {
        const px = denormalize(p, rect)
        const back = normalize(px.x, px.y, rect)
        expect(back.x).toBeCloseTo(p.x, 9)
        expect(back.y).toBeCloseTo(p.y, 9)
      }
    })
  }
  it('рисунок остаётся на том же месте картинки при изменении размера окна', () => {
    const p = { x: 0.3, y: 0.6 }
    const a = containRect(1000, 600, 1600, 900)!
    const b = containRect(1400, 1000, 1600, 900)!
    const pa = denormalize(p, a)
    const pb = denormalize(p, b)
    expect((pa.x - a.x) / a.w).toBeCloseTo((pb.x - b.x) / b.w)
    expect((pa.y - a.y) / a.h).toBeCloseTo((pb.y - b.y) / b.h)
  })
})

describe('привязка углов (Shift)', () => {
  const size = { w: 1600, h: 900 }
  const origin = { x: 0.5, y: 0.5 }
  const angleOf = (p: { x: number; y: number }): number =>
    (Math.atan2((p.y - origin.y) * size.h, (p.x - origin.x) * size.w) * 180) / Math.PI

  it('округляет направление до 15°, длина сохраняется', () => {
    const raw = { x: 0.5 + 0.3, y: 0.5 + 0.075 } // 67.5 px вниз при 480 px вправо: ≈ 8°
    const snapped = snapAngle(origin, raw, size)
    expect(angleOf(snapped)).toBeCloseTo(15, 5)
    const lenRaw = Math.hypot((raw.x - origin.x) * size.w, (raw.y - origin.y) * size.h)
    const lenSnapped = Math.hypot((snapped.x - origin.x) * size.w, (snapped.y - origin.y) * size.h)
    expect(lenSnapped).toBeCloseTo(lenRaw, 5)
  })
  it('почти горизонталь и почти вертикаль выравниваются', () => {
    expect(angleOf(snapAngle(origin, { x: 0.9, y: 0.52 }, size))).toBeCloseTo(0, 5)
    expect(Math.abs(angleOf(snapAngle(origin, { x: 0.52, y: 0.1 }, size)))).toBeCloseTo(90, 5)
  })
  it('не выходит за картинку', () => {
    const p = snapAngle({ x: 0.9, y: 0.5 }, { x: 1.0, y: 0.57 }, size)
    expect(p.x).toBeLessThanOrEqual(1 + 1e-9)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })
  it('нулевая длина не ломается', () => {
    expect(snapAngle(origin, origin, size)).toEqual(origin)
  })
  it('Shift у круга: квадрат в пикселях', () => {
    const e = squareFrom({ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.3 }, size)
    expect((e.x - 0.2) * size.w).toBeCloseTo((e.y - 0.2) * size.h, 5)
    expect((e.x - 0.2) * size.w).toBeCloseTo(0.4 * size.w, 5)
  })
})

const arrow: Annotation = {
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  type: 'arrow',
  p1: { x: 0.2, y: 0.3 },
  p2: { x: 0.6, y: 0.5 },
  style: { color: '#ffffff', width: 0.008, dash: 'solid' },
  timing: { mode: 'range', start: 0, duration: 3 }
}
const circle: Annotation = { ...arrow, type: 'circle' }

describe('перемещение и ручки', () => {
  it('moveBy сдвигает и удерживает рисунок внутри картинки', () => {
    const moved = moveBy(arrow, 0.1, 0.1, bboxOf(arrow)) as typeof arrow
    expect(moved.p1.x).toBeCloseTo(0.3)
    expect(moved.p1.y).toBeCloseTo(0.4)
    const clamped = moveBy(arrow, 0.9, -0.9, bboxOf(arrow)) as typeof arrow
    expect(clamped.p2.x).toBeCloseTo(1)
    expect(clamped.p1.y).toBeCloseTo(0)
    expect(clamped.p2.y - clamped.p1.y).toBeCloseTo(0.2)
  })
  it('ручки: два конца у стрелки, четыре угла у круга', () => {
    expect(handlesOf(arrow).map((h) => h.id)).toEqual(['p1', 'p2'])
    expect(handlesOf(circle).map((h) => h.id)).toEqual(['nw', 'ne', 'se', 'sw'])
  })
  it('moveHandle: конец стрелки и угол круга', () => {
    expect(moveHandle(arrow, 'p2', { x: 2, y: -1 })).toMatchObject({ p2: { x: 1, y: 0 } })
    const c = moveHandle(circle, 'nw', { x: 0.1, y: 0.1 }) as typeof arrow
    // Противоположный (юго-восточный) угол остаётся на месте.
    expect(c.p1).toEqual({ x: 0.6, y: 0.5 })
    expect(c.p2).toEqual({ x: 0.1, y: 0.1 })
  })
})

describe('стрелка и дорожки', () => {
  it('наконечник на конце, линия заканчивается внутри него', () => {
    const s = arrowShape({ x: 0, y: 0 }, { x: 200, y: 0 }, 6)
    expect(s.head[0]).toEqual({ x: 200, y: 0 })
    expect(s.lineEnd.x).toBeGreaterThan(200 - s.headLength)
    expect(s.lineEnd.x).toBeLessThan(200)
  })
  it('у короткой стрелки наконечник не длиннее 60%', () => {
    const s = arrowShape({ x: 0, y: 0 }, { x: 20, y: 0 }, 12)
    expect(s.headLength).toBeLessThanOrEqual(12.0001)
  })
  it('пересекающиеся рисунки уходят на разные строки', () => {
    const mk = (id: string, start: number, duration: number): Annotation => ({
      ...arrow,
      id,
      timing: { mode: 'range', start, duration }
    })
    const lanes = assignLanes([mk('a', 0, 3), mk('b', 1, 3), mk('c', 5, 1)], 25)
    const by = Object.fromEntries(lanes.map((l) => [l.id, l.lane]))
    expect(by).toEqual({ a: 0, b: 1, c: 0 })
  })
})
