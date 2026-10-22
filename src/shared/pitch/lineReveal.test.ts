// Свечение и проявление линий (0.18): путь обрезается по длине (не штриховкой), с точками и свечением вместе;
// наконечник — только когда линия дошла до конца; попадание курсором не зависит от времени.
import { describe, expect, it } from 'vitest'
import type { Curve, GroundArrow, GroundCurve, GroundLine } from '../annotations'
import { polylineLength, polylinePrefix } from '../tools/curve'
import { paintScreenTool } from '../tools/screenPaint'
import { lighten, revealFraction } from '../styleFx'
import { fitHomography, type Correspondence } from './homography'
import { penaltyAreaRect } from './landmarks'
import { lookAtCamera } from './pitch.testkit'
import { makeProjector } from './projector'
import { paintPitch, type PxPt } from './shapes'

const SIZE = { w: 1280, h: 720 }
const measure = (t: string, px: number): number => t.length * px * 0.58
const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)
const pairs: Correspondence[] = penaltyAreaRect({ length: 105, width: 68 }, 'left').map((w) => ({
  world: w,
  image: cam.project(w)!
}))
const fit = fitHomography(pairs, cam.aspect)
if (!fit.ok) throw new Error('камера теста не годится')
const proj = makeProjector(fit.H)!

const range = { mode: 'range' as const, start: 10, duration: 5 }
const id = (n: number): string => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const pitchBase = {
  space: 'pitch' as const,
  calibrationId: '00000000-0000-4000-8000-0000000000c1',
  style: { color: '#c6ff3d', width: 0.011, dash: 'solid' as const },
  timing: range
}
const screenBase = { space: 'screen' as const, style: pitchBase.style, timing: range }

const parrow: GroundArrow = {
  ...pitchBase,
  id: id(1),
  type: 'parrow',
  p1: { x: 4, y: 20 },
  p2: { x: 14, y: 44 },
  reveal: 1
}
const pline: GroundLine = { ...parrow, type: 'pline' }
const pcurve: GroundCurve = {
  ...pitchBase,
  id: id(2),
  type: 'pcurve',
  p1: { x: 4, y: 20 },
  p2: { x: 12, y: 44 },
  c: { x: 14, y: 26 },
  reveal: 1
}
const curve: Curve = {
  ...screenBase,
  id: id(3),
  type: 'curve',
  p1: { x: 0.1, y: 0.7 },
  p2: { x: 0.8, y: 0.5 },
  c: { x: 0.5, y: 0.2 },
  reveal: 1
}

// reveal = 1 с, начало отрезка = 10 с: k секунд после начала.
const at = (k: number): number => 10 + k
/** Размах фигур по картинке: растёт вместе с линией, в какую бы сторону она ни шла. */
const extent = (polys: PxPt[][]): number => {
  const pts = polys.flat()
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}

describe('polylinePrefix', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 }
  ]
  it('режет по длине, сохраняя узлы до среза', () => {
    expect(polylinePrefix(pts, 5)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 }
    ])
    const p = polylinePrefix(pts, 15)
    expect(p).toHaveLength(3)
    expect(p[2]).toEqual({ x: 10, y: 5 })
    expect(polylineLength(p)).toBeCloseTo(15)
  })
  it('нулевая длина — пусто, длиннее линии — вся линия', () => {
    expect(polylinePrefix(pts, 0)).toEqual([])
    expect(polylinePrefix(pts, 99)).toEqual(pts)
  })
})

describe('lighten', () => {
  it('подмешивает белый; не #rrggbb оставляет как есть', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080')
    expect(lighten('#c6ff3d', 0)).toBe('#c6ff3d')
    expect(lighten('#c6ff3d', 1)).toBe('#ffffff')
    expect(lighten('red', 0.5)).toBe('red')
  })
})

describe('проявление: кривая на экране', () => {
  const stroke = (t?: number): number =>
    paintScreenTool(curve, SIZE, t).strokes.reduce((s, x) => s + polylineLength(x.points), 0)
  it('путь растёт по длине, наконечник — только в конце', () => {
    const shaft = polylineLength(paintScreenTool(curve, SIZE).strokes[0].points)
    expect(paintScreenTool(curve, SIZE, at(0)).strokes).toHaveLength(0)
    expect(paintScreenTool(curve, SIZE, at(0)).body).toHaveLength(0)
    expect(paintScreenTool(curve, SIZE, at(0.5)).body).toHaveLength(0)
    // Доля — от всей длины до кончика: стержень (короче) растёт чуть медленнее.
    expect(stroke(at(0.5))).toBeGreaterThan(shaft * 0.4)
    expect(stroke(at(0.5))).toBeLessThan(shaft * 0.6)
    expect(paintScreenTool(curve, SIZE, at(0.999)).body).toHaveLength(0)
    expect(paintScreenTool(curve, SIZE, at(1)).body).toHaveLength(1)
    expect(stroke(at(1))).toBeCloseTo(shaft)
  })
  it('точки раскладываются по длине всей линии', () => {
    const dotted = { ...curve, style: { ...curve.style, dash: 'dotted' as const } }
    const a = paintScreenTool(dotted, SIZE, at(0.3)).strokes[0]
    const b = paintScreenTool(dotted, SIZE, at(0.9)).strokes[0]
    expect(a.layoutLength).toBeCloseTo(b.layoutLength!)
  })
  it('нажатие и ручки от времени не зависят; без времени — целиком', () => {
    const early = paintScreenTool(curve, SIZE, at(0.2))
    const late = paintScreenTool(curve, SIZE, at(3))
    expect(early.hit).toEqual(late.hit)
    expect(early.handles).toEqual(late.handles)
    expect(paintScreenTool(curve, SIZE).body).toHaveLength(1)
  })
  it('рисунок «только кадр» всегда целиком', () => {
    const frame = { ...curve, timing: { mode: 'frame' as const, start: 10, freezeSeconds: 3 } }
    expect(paintScreenTool(frame, SIZE, 10).strokes).toHaveLength(1)
    expect(paintScreenTool(frame, SIZE, 10).body).toHaveLength(1)
  })
  it('свечение включает ореол линии', () => {
    expect(paintScreenTool(curve, SIZE, 12).lineGlow).toBeUndefined()
    expect(paintScreenTool({ ...curve, glow: true }, SIZE, 12).lineGlow).toBe(true)
  })
})

describe('проявление: линии на поле', () => {
  it('сплошная линия обрезается по длине, наконечника нет до конца', () => {
    expect(paintPitch(parrow, proj, SIZE, measure, at(0)).body).toHaveLength(0)
    const half = paintPitch(parrow, proj, SIZE, measure, at(0.5))
    const near = paintPitch(parrow, proj, SIZE, measure, at(0.999))
    const done = paintPitch(parrow, proj, SIZE, measure, at(1))
    expect(half.body).toHaveLength(1)
    expect(near.body).toHaveLength(1)
    expect(done.body).toHaveLength(2)
    expect(extent(half.body)).toBeLessThan(extent(near.body))
  })
  it('линия без наконечника растёт до p2', () => {
    const half = paintPitch(pline, proj, SIZE, measure, at(0.5))
    const full = paintPitch(pline, proj, SIZE, measure, at(1))
    expect(half.body).toHaveLength(1)
    expect(full.body).toHaveLength(1)
    expect(extent(half.body)).toBeLessThan(extent(full.body))
  })
  it('кривая: путь обрезается, наконечник в конце', () => {
    const part = paintPitch(pcurve, proj, SIZE, measure, at(0.5))
    const full = paintPitch(pcurve, proj, SIZE, measure, at(1))
    expect(part.body.length).toBeLessThan(full.body.length)
    const near = paintPitch(pcurve, proj, SIZE, measure, at(0.999))
    expect(near.body.length).toBe(full.body.length - 1)
  })
  it('точки: видны первые floor(доля · число), по порядку вдоль линии, целиком — все', () => {
    const dotted = { ...pline, style: { ...pline.style, dash: 'dotted' as const } }
    const all = paintPitch(dotted, proj, SIZE, measure, at(1)).body
    expect(all.length).toBeGreaterThan(8)
    for (const k of [0.25, 0.5, 0.8]) {
      const part = paintPitch(dotted, proj, SIZE, measure, at(k)).body
      expect(part).toHaveLength(Math.floor(k * all.length))
      // Те же точки на тех же местах — не пересчитанные заново.
      expect(part).toEqual(all.slice(0, part.length))
    }
    expect(paintPitch(dotted, proj, SIZE, measure, at(0)).body).toHaveLength(0)
  })
  it('точки + наконечник: точки стержня подряд, наконечник отдельно и только в конце', () => {
    const dotted = { ...parrow, style: { ...parrow.style, dash: 'dotted' as const } }
    const part = paintPitch(dotted, proj, SIZE, measure, at(0.999)).body
    const full = paintPitch(dotted, proj, SIZE, measure, at(1)).body
    expect(full).toHaveLength(part.length + 1)
    expect(full.filter((p) => p.length === 3)).toHaveLength(1)
    expect(part.every((p) => p.length === 12)).toBe(true)
  })
  it('попадание курсором у пунктира точками — по сплошной ленте всей линии, и не зависит от времени', () => {
    const dotted = { ...pcurve, style: { ...pcurve.style, dash: 'dotted' as const } }
    const early = paintPitch(dotted, proj, SIZE, measure, at(0.1))
    const late = paintPitch(dotted, proj, SIZE, measure, at(2))
    const none = paintPitch(dotted, proj, SIZE, measure)
    expect(early.hit).toEqual(late.hit)
    expect(none.hit).toEqual(late.hit)
    // Ленты (четырёхугольники) и наконечник, а не 12-угольники точек.
    expect(late.hit.every((p) => p.length !== 12)).toBe(true)
    expect(late.hit.length).toBeGreaterThan(20)
  })
  it('попадание у пунктирной прямой на поле — одна сплошная лента', () => {
    const dotted = { ...pline, style: { ...pline.style, dash: 'dotted' as const } }
    const paint = paintPitch(dotted, proj, SIZE, measure, at(0.3))
    expect(paint.hit).toHaveLength(1)
    expect(paint.hit[0]).toHaveLength(4)
  })
  it('свечение: ореол по ширине линии и светлое ядро; без свечения их нет', () => {
    const plain = paintPitch(pline, proj, SIZE, measure, at(1))
    expect(plain.glowPx).toBeUndefined()
    expect(plain.core).toBeUndefined()
    const glowing = paintPitch({ ...pline, glow: true }, proj, SIZE, measure, at(1))
    expect(glowing.glowPx).toBeGreaterThan(1)
    expect(glowing.core).toHaveLength(1)
    // Ширина ореола не зависит от стадии проявления.
    const early = paintPitch({ ...pline, glow: true }, proj, SIZE, measure, at(0.2))
    expect(early.glowPx).toBeCloseTo(glowing.glowPx!)
  })
  it('без времени или у «только кадр» линия целиком', () => {
    expect(paintPitch(parrow, proj, SIZE, measure).body).toHaveLength(2)
    const frame = { ...parrow, timing: { mode: 'frame' as const, start: 10, freezeSeconds: 3 } }
    expect(paintPitch(frame, proj, SIZE, measure, 10).body).toHaveLength(2)
  })
})

describe('одна и та же доля на экране и в экспорте', () => {
  it('доля зависит только от времени видео и начала отрезка (клип, начатый посреди отрезка)', () => {
    // Экспорт клипа, начавшегося на 10.4 с, на кадре 10.5 с — та же доля, что при перемотке на 10.5 с.
    expect(revealFraction(parrow, 10.5)).toBeCloseTo(0.5)
    expect(paintPitch(parrow, proj, SIZE, measure, 10.5)).toEqual(
      paintPitch(parrow, proj, SIZE, measure, 10.5)
    )
  })
})
