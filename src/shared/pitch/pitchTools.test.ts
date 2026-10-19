// Рисунки на поле этапа 15 в перспективе: кривая Безье после проекции, прожектор с «лучом», площадь зоны,
// связи игроков с подписями расстояний и ширины.
import { describe, expect, it } from 'vitest'
import type {
  GroundChain,
  GroundCurve,
  GroundPen,
  GroundSpotlight,
  GroundZone
} from '../annotations'
import { curveMid, densifyQuad } from '../tools/curve'
import { polygonArea } from '../tools/polygon'
import { fitHomography, type Correspondence } from './homography'
import { penaltyAreaRect } from './landmarks'
import { handleAnchor, moveWorld, moveWorldHandle } from './edit'
import { lookAtCamera } from './pitch.testkit'
import { beamSilhouette, convexHull, isToolAnnotation, polylineRibbons } from './pitchTools'
import { makeProjector } from './projector'
import { paintPitch } from './shapes'

const SIZE = { w: 1280, h: 720 }
const measure = (t: string, px: number): number => t.length * px * 0.58
const calId = '00000000-0000-4000-8000-0000000000c1'

const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)
const penalty = penaltyAreaRect({ length: 105, width: 68 }, 'left')
const pairs: Correspondence[] = penalty.map((w) => ({ world: w, image: cam.project(w)! }))
const fit = fitHomography(pairs, cam.aspect)
if (!fit.ok) throw new Error('камера теста не годится')
const proj = makeProjector(fit.H)!

const base = {
  space: 'pitch' as const,
  calibrationId: calId,
  style: { color: '#ffd60a', width: 0.011, dash: 'solid' as const },
  timing: { mode: 'frame' as const, start: 1, freezeSeconds: 3 }
}
const id = (n: number): string => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const px = (w: { x: number; y: number }): { x: number; y: number } => {
  const p = proj.toImage(w)!
  return { x: p.x * SIZE.w, y: p.y * SIZE.h }
}

const curve: GroundCurve = {
  ...base,
  id: id(1),
  type: 'pcurve',
  p1: { x: 4, y: 20 },
  p2: { x: 12, y: 44 },
  c: { x: 14, y: 26 }
}

describe('изогнутая стрелка на поле', () => {
  it('кривая строится в метрах: ручка c стоит на самой кривой (в её середине), а не на управляющей точке', () => {
    const paint = paintPitch(curve, proj, SIZE, measure)
    const ids = paint.handles.map((h) => h.id)
    expect(ids).toEqual(['p1', 'p2', 'c'])
    const handle = paint.handles.find((h) => h.id === 'c')!.point
    const mid = px(curveMid(curve.p1, curve.c, curve.p2))
    expect(handle.x).toBeCloseTo(mid.x, 6)
    expect(handle.y).toBeCloseTo(mid.y, 6)
    const control = px(curve.c)
    expect(Math.hypot(handle.x - control.x, handle.y - control.y)).toBeGreaterThan(5)
  })

  it('в изображении кривая изогнута: точки лежат по обе стороны от хорды и совпадают с проекцией формулы', () => {
    const world = densifyQuad(curve.p1, curve.c, curve.p2, 48)
    const image = world.map(px)
    const a = image[0]
    const b = image[image.length - 1]
    const side = (p: { x: number; y: number }): number =>
      ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y)
    const maxOff = Math.max(...image.map((p) => Math.abs(side(p))))
    expect(maxOff).toBeGreaterThan(8)
    // Тело стрелки (ленты и наконечник) лежит вокруг этой ломаной: каждая точка ломаной внутри какого-то многоугольника.
    const paint = paintPitch(curve, proj, SIZE, measure)
    expect(paint.visible).toBe(true)
    expect(paint.body.length).toBeGreaterThan(40)
    const inside = (p: { x: number; y: number }): boolean =>
      paint.body.some((poly) => {
        let ins = false
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
          const u = poly[i]
          const v = poly[j]
          if (u.y > p.y !== v.y > p.y && p.x < ((v.x - u.x) * (p.y - u.y)) / (v.y - u.y) + u.x) {
            ins = !ins
          }
        }
        return ins
      })
    // Середины звеньев (не стыки лент) вне зоны наконечника лежат внутри лент.
    const mids = image
      .slice(1, 42)
      .map((p, i) => ({ x: (p.x + image[i].x) / 2, y: (p.y + image[i].y) / 2 }))
    expect(mids.filter(inside).length).toBe(mids.length)
  })

  it('наконечник есть: последний многоугольник — треугольник на конце p2', () => {
    const paint = paintPitch(curve, proj, SIZE, measure)
    const tip = paint.body.find((poly) => poly.length === 3)
    expect(tip).toBeTruthy()
    const end = px(curve.p2)
    const near = Math.min(...tip!.map((p) => Math.hypot(p.x - end.x, p.y - end.y)))
    expect(near).toBeLessThan(1)
  })

  it('пунктир даёт больше отдельных кусков, чем сплошная линия', () => {
    const solid = paintPitch(curve, proj, SIZE, measure)
    const dashed = paintPitch(
      { ...curve, style: { ...curve.style, dash: 'dashed' } },
      proj,
      SIZE,
      measure
    )
    expect(dashed.body.length).not.toBe(solid.body.length)
    expect(dashed.visible).toBe(true)
  })

  it('ручки: p1/p2 двигают концы, c — подбирает кривую так, чтобы она прошла через курсор', () => {
    const moved = moveWorldHandle(curve, 'p1', { x: 6, y: 18 })
    expect(moved.type === 'pcurve' && moved.p1).toEqual({ x: 6, y: 18 })
    const target = { x: 12, y: 30 }
    const bent = moveWorldHandle(curve, 'c', target)
    expect(bent.type === 'pcurve').toBe(true)
    if (bent.type === 'pcurve') {
      const mid = curveMid(bent.p1, bent.c, bent.p2)
      expect(mid.x).toBeCloseTo(target.x, 9)
      expect(mid.y).toBeCloseTo(target.y, 9)
    }
    expect(handleAnchor(curve, 'p1')).toEqual(curve.p2)
    expect(handleAnchor(curve, 'p2')).toEqual(curve.p1)
    expect(handleAnchor(curve, 'c')).toBeNull()
  })

  it('сдвиг переносит и концы, и управляющую точку', () => {
    const moved = moveWorld(curve, 1, -2)
    expect(moved.type === 'pcurve' && moved.c).toEqual({ x: 15, y: 24 })
    expect(moved.type === 'pcurve' && moved.p2).toEqual({ x: 13, y: 42 })
  })
})

describe('прожектор на поле', () => {
  const spot: GroundSpotlight = {
    ...base,
    id: id(2),
    type: 'pspot',
    center: { x: 9, y: 34 },
    radius: 2.2,
    dim: 0.55,
    beam: false
  }

  it('без луча освещён эллипс на земле: лежит вокруг проекции центра и шире по горизонтали', () => {
    const paint = paintPitch(spot, proj, SIZE, measure)
    expect(paint.lit).toHaveLength(1)
    expect(paint.beam).toBeNull()
    const poly = paint.lit[0]
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    const c = px(spot.center)
    expect(Math.min(...xs)).toBeLessThan(c.x)
    expect(Math.max(...xs)).toBeGreaterThan(c.x)
    expect(Math.min(...ys)).toBeLessThan(c.y)
    expect(Math.max(...ys)).toBeGreaterThan(c.y)
    // Площадь в пикселях ≈ площадь эллипса.
    expect(polygonArea(poly)).toBeGreaterThan(300)
    expect(paint.handles.map((h) => h.id)).toEqual(['radius'])
  })

  it('с лучом: высота = 1.9 м × масштаб (пикселей на метр) в этой точке, луч выше основания', () => {
    const withBeam = paintPitch({ ...spot, beam: true }, proj, SIZE, measure)
    expect(withBeam.beam).not.toBeNull()
    const ground = paintPitch(spot, proj, SIZE, measure).lit[0]
    const minX = Math.min(...ground.map((p) => p.x))
    const maxX = Math.max(...ground.map((p) => p.x))
    const pxPerMeter = (maxX - minX) / (2 * spot.radius)
    const sil = beamSilhouette(ground, spot.radius)!
    expect(sil.heightPx).toBeCloseTo(1.9 * pxPerMeter, 6)
    const groundTop = Math.min(...ground.map((p) => p.y))
    expect(sil.top).toBeCloseTo(groundTop - sil.heightPx, 6)
    expect(sil.bottom).toBeCloseTo(Math.max(...ground.map((p) => p.y)), 6)
    // Освещённая область — весь силуэт (пятно + луч), и он больше пятна.
    expect(polygonArea(withBeam.lit[0])).toBeGreaterThan(polygonArea(ground) * 1.5)
    // Луч сужается кверху (конус).
    const widthAt = (y: number): number => {
      const row = withBeam.lit[0].filter((p) => Math.abs(p.y - y) < 1)
      return row.length ? Math.max(...row.map((p) => p.x)) - Math.min(...row.map((p) => p.x)) : 0
    }
    expect(widthAt(sil.top)).toBeLessThan(widthAt(sil.bottom - 2) + 1)
  })

  it('радиус меняется ручкой в пределах 0.5–15 м', () => {
    const r = moveWorldHandle(spot, 'radius', { x: 9 + 5, y: 34 })
    expect(r.type === 'pspot' && r.radius).toBeCloseTo(5, 9)
    const small = moveWorldHandle(spot, 'radius', { x: 9.1, y: 34 })
    expect(small.type === 'pspot' && small.radius).toBe(0.5)
    const big = moveWorldHandle(spot, 'radius', { x: 90, y: 34 })
    expect(big.type === 'pspot' && big.radius).toBe(15)
  })

  it('выпуклая оболочка: внутренние точки отбрасываются', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }
    ])
    expect(hull).toHaveLength(4)
    expect(convexHull([{ x: 1, y: 1 }])).toHaveLength(1)
  })
})

describe('зона на поле', () => {
  const zone: GroundZone = {
    ...base,
    id: id(3),
    type: 'pzone',
    points: penalty,
    opacity: 0.3,
    showArea: true
  }

  it('площадь штрафной площади в метрах: подпись «665 м²»', () => {
    const paint = paintPitch(zone, proj, SIZE, measure)
    expect(paint.labels).toHaveLength(1)
    expect(paint.labels[0].kind).toBe('area')
    expect(paint.labels[0].text).toBe('665 м²')
    expect(paint.fills).toHaveLength(1)
    expect(paint.fillOpacity).toBe(0.3)
    expect(paint.handles.map((h) => h.id)).toEqual(['v0', 'v1', 'v2', 'v3'])
  })

  it('подпись площади выключается', () => {
    const paint = paintPitch({ ...zone, showArea: false }, proj, SIZE, measure)
    expect(paint.labels).toHaveLength(0)
    expect(paint.fills).toHaveLength(1)
  })

  it('невыпуклая зона: подпись стоит внутри многоугольника на картинке', () => {
    const l: GroundZone = {
      ...zone,
      points: [
        { x: 2, y: 20 },
        { x: 14, y: 20 },
        { x: 14, y: 26 },
        { x: 6, y: 26 },
        { x: 6, y: 44 },
        { x: 2, y: 44 }
      ]
    }
    const paint = paintPitch(l, proj, SIZE, measure)
    // 12×6 + 4×18 = 144 м².
    expect(paint.labels[0].text).toBe('144 м²')
    const label = paint.labels[0]
    const fill = paint.fills[0]
    let ins = false
    for (let i = 0, j = fill.length - 1; i < fill.length; j = i, i += 1) {
      const u = fill[i]
      const v = fill[j]
      if (
        u.y > label.y !== v.y > label.y &&
        label.x < ((v.x - u.x) * (label.y - u.y)) / (v.y - u.y) + u.x
      ) {
        ins = !ins
      }
    }
    expect(ins).toBe(true)
  })

  it('вершины двигаются по одной, сдвиг переносит все', () => {
    const moved = moveWorldHandle(zone, 'v2', { x: 20, y: 50 })
    expect(moved.type === 'pzone' && moved.points[2]).toEqual({ x: 20, y: 50 })
    expect(moved.type === 'pzone' && moved.points[1]).toEqual(zone.points[1])
    expect(moveWorldHandle(zone, 'v9', { x: 1, y: 1 })).toBe(zone)
    const shifted = moveWorld(zone, 1, 1)
    expect(shifted.type === 'pzone' && shifted.points[0]).toEqual({ x: 1, y: 14.84 })
    expect(handleAnchor(zone, 'v0')).toEqual(zone.points[1])
    expect(handleAnchor(zone, 'v2')).toEqual(zone.points[1])
  })
})

describe('связи игроков на поле', () => {
  const chain: GroundChain = {
    ...base,
    id: id(4),
    type: 'pchain',
    points: [
      { x: 10, y: 10 },
      { x: 10, y: 22 },
      { x: 11, y: 30 },
      { x: 10, y: 42.4 }
    ],
    fill: false,
    labels: true
  }

  it('подписи длин звеньев и «Ширина линии» (между крайними игроками)', () => {
    const paint = paintPitch(chain, proj, SIZE, measure)
    const segments = paint.labels.filter((l) => l.kind === 'segment')
    const width = paint.labels.filter((l) => l.kind === 'width')
    expect(segments.map((l) => l.text)).toEqual(['12.0 м', '8.1 м', '12.4 м'])
    expect(width).toHaveLength(1)
    expect(width[0].text).toBe('Ширина линии: 32.4 м')
    expect(paint.handles.map((h) => h.id)).toEqual(['v0', 'v1', 'v2', 'v3'])
  })

  it('у связи из двух игроков одна подпись — ширина', () => {
    const two = { ...chain, points: chain.points.slice(0, 2) }
    const paint = paintPitch(two, proj, SIZE, measure)
    expect(paint.labels.map((l) => l.kind)).toEqual(['width'])
    expect(paint.labels[0].text).toBe('Ширина линии: 12.0 м')
  })

  it('подписи выключаются, заливка включается', () => {
    const quiet = paintPitch({ ...chain, labels: false }, proj, SIZE, measure)
    expect(quiet.labels).toHaveLength(0)
    expect(quiet.fills).toHaveLength(0)
    const filled = paintPitch({ ...chain, fill: true }, proj, SIZE, measure)
    expect(filled.fills).toHaveLength(1)
    expect(filled.fillOpacity).toBeGreaterThan(0)
  })

  it('узлы — кольца на траве: на каждый узел внешний контур и отверстие', () => {
    const plain = paintPitch({ ...chain, labels: false }, proj, SIZE, measure)
    // 3 ленты звеньев + 4 узла-кольца (внешний контур и отверстие).
    expect(plain.body.length).toBeGreaterThanOrEqual(11)
    const nodeBodies = plain.body.filter((poly) => poly.length >= 16)
    expect(nodeBodies.length).toBeGreaterThanOrEqual(8)
  })

  it('область выбора включает подписи', () => {
    const paint = paintPitch(chain, proj, SIZE, measure)
    expect(paint.hit.length).toBeGreaterThan(paint.labels.length)
  })
})

describe('перо на поле', () => {
  const pen: GroundPen = {
    ...base,
    id: id(5),
    type: 'ppen',
    points: [
      { x: 4, y: 20 },
      { x: 7, y: 24 },
      { x: 9, y: 22 },
      { x: 12, y: 30 }
    ],
    arrow: false
  }

  it('линия по траве; стрелка на конце добавляет наконечник', () => {
    const plain = paintPitch(pen, proj, SIZE, measure)
    const withArrow = paintPitch({ ...pen, arrow: true }, proj, SIZE, measure)
    expect(plain.visible).toBe(true)
    expect(plain.handles).toHaveLength(0)
    expect(plain.body.some((poly) => poly.length === 3)).toBe(false)
    expect(withArrow.body.some((poly) => poly.length === 3)).toBe(true)
  })

  it('сдвиг переносит все точки; ручек нет', () => {
    const moved = moveWorld(pen, 2, 3)
    expect(moved.type === 'ppen' && moved.points[3]).toEqual({ x: 14, y: 33 })
    expect(moveWorldHandle(pen, 'p1', { x: 1, y: 1 })).toBe(pen)
  })
})

describe('вспомогательное', () => {
  it('isToolAnnotation отличает новые виды от старых', () => {
    expect(isToolAnnotation(curve)).toBe(true)
    expect(
      isToolAnnotation({
        ...base,
        id: id(6),
        type: 'ring',
        center: { x: 1, y: 1 },
        radius: 1
      })
    ).toBe(false)
  })

  it('ленты вдоль ломаной: по одной на звено, нулевые звенья пропускаются', () => {
    const ribbons = polylineRibbons(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 }
      ],
      0.5
    )
    expect(ribbons).toHaveLength(2)
  })
})
