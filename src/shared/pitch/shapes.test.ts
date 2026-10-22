import { describe, expect, it } from 'vitest'
import { AnnotationSchema, type PitchAnnotation, type Ring, type Ruler } from '../annotations'
import { ProjectSchema } from '../project'
import { sampleProject } from '../project.testkit'
import {
  CalibrationSchema,
  fitCalibration,
  isCalibrationFresh,
  nearestCalibration,
  projectorFor
} from './calibration'
import { moveWorld, moveWorldHandle, snapWorldAngle } from './edit'
import { fitHomography, type Correspondence } from './homography'
import {
  FIFA,
  arcPoints,
  goalAreaRect,
  penaltyAreaRect,
  penaltySpot,
  pitchLines
} from './landmarks'
import { jacobiEigen } from './linalg'
import { lookAtCamera, sampleCalibration } from './pitch.testkit'
import { makeProjector } from './projector'
import { circleAngles, dashSegments, formatMeters, paintPitch, worldDistance } from './shapes'
import { TEMPLATE_IDS, buildTemplate } from './templates'

const SIZE = { w: 1280, h: 720 }
const measure = (t: string, px: number): number => t.length * px * 0.58
const calId = '00000000-0000-4000-8000-0000000000c1'

// Камера у ближней боковой линии, высоко над левой штрафной.
const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)
const worldPts = penaltyAreaRect({ length: 105, width: 68 }, 'left')
const pairs: Correspondence[] = worldPts.map((w) => ({ world: w, image: cam.project(w)! }))
const fit = fitHomography(pairs, cam.aspect)
if (!fit.ok) throw new Error('камера теста не годится')
const proj = makeProjector(fit.H)!

const baseRing: Ring = {
  id: '00000000-0000-4000-8000-000000000a01',
  space: 'pitch',
  calibrationId: calId,
  type: 'ring',
  center: { x: 8, y: 34 },
  radius: 1,
  style: { color: '#ffd60a', width: 0.011, dash: 'solid' },
  timing: { mode: 'frame', start: 1, freezeSeconds: 3 }
}

/** Коническое сечение по точкам: возвращает функцию «алгебраическое расстояние / норма градиента» (приближённо — пиксели). */
function conicFit(points: { x: number; y: number }[]): (p: { x: number; y: number }) => number {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const scale = Math.sqrt(
    points.reduce((s, p) => s + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0) / points.length
  )
  const n = (p: { x: number; y: number }): [number, number] => [
    (p.x - cx) / scale,
    (p.y - cy) / scale
  ]
  const m = new Array(36).fill(0)
  for (const p of points) {
    const [x, y] = n(p)
    const row = [x * x, x * y, y * y, x, y, 1]
    for (let i = 0; i < 6; i += 1) for (let j = 0; j < 6; j += 1) m[i * 6 + j] += row[i] * row[j]
  }
  const { vectors, values } = jacobiEigen(m, 6)
  const [A, B, C, D, E, F] = vectors[0]
  // Наименьшее собственное значение ≈ 0: точки лежат на одной конике.
  expect(values[0] / values[5]).toBeLessThan(1e-9)
  return (p) => {
    const [x, y] = n(p)
    const v = A * x * x + B * x * y + C * y * y + D * x + E * y + F
    const gx = 2 * A * x + B * y + D
    const gy = B * x + 2 * C * y + E
    return (Math.abs(v) / Math.hypot(gx, gy)) * scale
  }
}

describe('кольцо на поле', () => {
  it('проекция окружности — эллипс: вершины построенного многоугольника лежат на конике', () => {
    const exact = Array.from({ length: 120 }, (_, i) => {
      const a = (i / 120) * Math.PI * 2
      const p = proj.toImage({ x: 8 + 1 * Math.cos(a), y: 34 + 1 * Math.sin(a) })!
      return { x: p.x * SIZE.w, y: p.y * SIZE.h }
    })
    const distance = conicFit(exact)
    const paint = paintPitch({ ...baseRing, radius: 1 }, proj, SIZE, measure)
    expect(paint.disc).toHaveLength(1)
    for (const v of paint.disc[0]) expect(distance(v)).toBeLessThan(0.3)
    expect(paint.disc[0].length).toBeGreaterThanOrEqual(32)
  })

  it('кольцо вдали уже и ниже, чем вблизи (перспектива), размер в метрах один', () => {
    const near = paintPitch({ ...baseRing, center: { x: 8, y: 60 } }, proj, SIZE, measure)
    const far = paintPitch({ ...baseRing, center: { x: 8, y: 10 } }, proj, SIZE, measure)
    const width = (poly: { x: number; y: number }[]): number =>
      Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x))
    expect(width(near.disc[0])).toBeGreaterThan(width(far.disc[0]) * 1.3)
  })

  it('пунктирное кольцо состоит из нескольких штрихов', () => {
    const p = paintPitch(
      { ...baseRing, style: { ...baseRing.style, dash: 'dashed' } },
      proj,
      SIZE,
      measure
    )
    expect(p.body.length).toBeGreaterThan(4)
  })

  it('число сегментов растёт с размером окружности', () => {
    const small = circleAngles({ x: 8, y: 34 }, 0.3, proj, SIZE).length
    const big = circleAngles({ x: 8, y: 34 }, 9.15, proj, SIZE).length
    expect(big).toBeGreaterThan(small)
    expect(small).toBeGreaterThanOrEqual(32)
  })

  it('кольцо целиком за камерой не рисуется', () => {
    const p = paintPitch({ ...baseRing, center: { x: 25, y: 160 } }, proj, SIZE, measure)
    expect(p.visible).toBe(false)
  })
})

describe('линейка и измерение в метрах', () => {
  const ruler: Ruler = {
    id: '00000000-0000-4000-8000-000000000a02',
    space: 'pitch',
    calibrationId: calId,
    type: 'ruler',
    p1: { x: 0, y: 13.84 },
    p2: { x: 16.5, y: 13.84 },
    style: { color: '#ffffff', width: 0.011, dash: 'solid' },
    timing: { mode: 'frame', start: 1, freezeSeconds: 3 }
  }

  it('подпись: 16.5 м', () => {
    expect(paintPitch(ruler, proj, SIZE, measure).label?.text).toBe('16.5 м')
    expect(formatMeters(40.32)).toBe('40.3 м')
    expect(formatMeters(23.449)).toBe('23.4 м')
  })

  it('расстояние, посчитанное по кликам на картинке, 16.5 ± 0.01 м', () => {
    const a = proj.toImage(ruler.p1)!
    const b = proj.toImage(ruler.p2)!
    const wa = proj.toWorld(a)!
    const wb = proj.toWorld(b)!
    expect(Math.abs(worldDistance(wa, wb) - 16.5)).toBeLessThan(0.01)
  })

  it('засечки и лента проецируются; ручки на концах', () => {
    const p = paintPitch(ruler, proj, SIZE, measure)
    expect(p.body.length).toBe(3)
    expect(p.handles.map((h) => h.id)).toEqual(['p1', 'p2'])
  })

  it('стрелка на траве сужается вдаль: ширина у основания больше, чем у острия при взгляде вдаль', () => {
    const arrow: PitchAnnotation = {
      id: '00000000-0000-4000-8000-000000000a03',
      space: 'pitch',
      calibrationId: calId,
      type: 'parrow',
      p1: { x: 8, y: 60 },
      p2: { x: 8, y: 8 },
      style: { color: '#ffffff', width: 0.011, dash: 'solid' },
      timing: { mode: 'frame', start: 1, freezeSeconds: 3 }
    }
    const paint = paintPitch(arrow, proj, SIZE, measure)
    expect(paint.body.length).toBe(2)
    const shaft = paint.body[0]
    const widthAtY = (target: number): number => {
      const xs = shaft.filter((p) => Math.abs(p.y - target) < 40).map((p) => p.x)
      return Math.max(...xs) - Math.min(...xs)
    }
    const ys = shaft.map((p) => p.y)
    const bottom = widthAtY(Math.max(...ys))
    const top = widthAtY(Math.min(...ys))
    expect(bottom).toBeGreaterThan(top * 1.2)
  })
})

describe('привязка и правка в метрах', () => {
  it('Shift: 0°, 45°, 90° относительно осей поля, длина сохраняется', () => {
    const o = { x: 10, y: 10 }
    const near0 = snapWorldAngle(o, { x: 20, y: 11 })
    expect(near0.y).toBeCloseTo(10, 9)
    expect(near0.x - 10).toBeCloseTo(Math.hypot(10, 1), 9)
    const d45 = snapWorldAngle(o, { x: 19, y: 22 })
    expect(Math.abs(d45.x - 10)).toBeCloseTo(Math.abs(d45.y - 10), 9)
    const d90 = snapWorldAngle(o, { x: 10.7, y: 25 })
    expect(d90.x).toBeCloseTo(10, 9)
    expect(snapWorldAngle(o, o)).toEqual(o)
  })

  it('сдвиг и ручка радиуса', () => {
    const moved = moveWorld(baseRing, 2, -3) as Ring
    expect(moved.center).toEqual({ x: 10, y: 31 })
    const grown = moveWorldHandle(baseRing, 'radius', { x: 12, y: 34 }) as Ring
    expect(grown.radius).toBeCloseTo(4, 9)
    const tiny = moveWorldHandle(baseRing, 'radius', { x: 8, y: 34 }) as Ring
    expect(tiny.radius).toBeGreaterThan(0)
  })
})

describe('калибровка', () => {
  const size = { w: 1920, h: 1080 }

  it('fitCalibration: RMS в пикселях и проектор', () => {
    const r = fitCalibration(sampleCalibration().points, 16 / 9, size)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rms).toBeLessThan(1e-3)
  })

  it('projectorFor кэширует по объекту и возвращает null для плохих точек', () => {
    const c = sampleCalibration()
    expect(projectorFor(c)).toBe(projectorFor(c))
    const bad = sampleCalibration({
      points: c.points.map((p, i) => (i === 2 ? { ...p, image: c.points[1].image } : p))
    })
    expect(projectorFor(bad)).toBeNull()
  })

  it('ближайшая разметка по времени с любой стороны, при равенстве — ранняя', () => {
    const a = sampleCalibration({ id: '00000000-0000-4000-8000-0000000000a1', time: 10 })
    const b = sampleCalibration({ id: '00000000-0000-4000-8000-0000000000b1', time: 20 })
    expect(nearestCalibration([a, b], 12)!.calibration.id).toBe(a.id)
    expect(nearestCalibration([a, b], 18)!.calibration.id).toBe(b.id)
    expect(nearestCalibration([a, b], 15)!.calibration.id).toBe(a.id)
    expect(nearestCalibration([a, b], 12)!.offset).toBeCloseTo(2, 9)
    expect(nearestCalibration([], 1)).toBeNull()
    expect(isCalibrationFresh(a, 10.9)).toBe(true)
    expect(isCalibrationFresh(a, 11.5)).toBe(false)
  })

  it('схема: границы размеров поля', () => {
    const c = sampleCalibration()
    expect(CalibrationSchema.safeParse(c).success).toBe(true)
    expect(CalibrationSchema.safeParse({ ...c, pitch: { length: 130, width: 68 } }).success).toBe(
      false
    )
    expect(CalibrationSchema.safeParse({ ...c, pitch: { length: 105, width: 40 } }).success).toBe(
      false
    )
    expect(CalibrationSchema.safeParse({ ...c, points: c.points.slice(0, 3) }).success).toBe(false)
  })
})

describe('схемы: старые проекты', () => {
  it('у старого рисунка space = screen, у старого проекта calibrations = []', () => {
    const old = {
      id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
      type: 'arrow',
      p1: { x: 0.1, y: 0.1 },
      p2: { x: 0.5, y: 0.5 },
      style: { color: '#ffd60a', width: 0.008, dash: 'solid' },
      timing: { mode: 'range', start: 1, duration: 2 }
    }
    const parsed = AnnotationSchema.parse(old)
    expect(parsed.space).toBe('screen')
    const { calibrations: _omit, ...file } = sampleProject()
    void _omit
    const project = ProjectSchema.parse({ ...file, annotations: [old] })
    expect(project.calibrations).toEqual([])
    expect(project.annotations[0].space).toBe('screen')
  })

  it('рисунок на поле проходит схему, а без calibrationId — нет', () => {
    expect(AnnotationSchema.safeParse(baseRing).success).toBe(true)
    const { calibrationId: _c, ...noCal } = baseRing
    void _c
    expect(AnnotationSchema.safeParse(noCal).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...baseRing, radius: 100 }).success).toBe(false)
  })

  it('проект с разметкой читается и повторяющийся id отклоняется', () => {
    const c = sampleCalibration()
    expect(ProjectSchema.safeParse({ ...sampleProject(), calibrations: [c] }).success).toBe(true)
    expect(ProjectSchema.safeParse({ ...sampleProject(), calibrations: [c, c] }).success).toBe(
      false
    )
  })
})

describe('шаблоны и размеры по правилам ФИФА', () => {
  const size = { length: 105, width: 68 }

  it('штрафная 16.5 × 40.32 по центру ворот', () => {
    const [a, b, c, d] = penaltyAreaRect(size, 'left')
    expect(b.x - a.x).toBeCloseTo(16.5, 9)
    expect(c.y - b.y).toBeCloseTo(40.32, 9)
    expect((a.y + d.y) / 2).toBeCloseTo(34, 9)
    const [ra, rb] = penaltyAreaRect(size, 'right')
    expect(ra.x).toBeCloseTo(105, 9)
    expect(rb.x).toBeCloseTo(105 - 16.5, 9)
  })

  it('вратарская 5.5 × 18.32, пенальти 11 м, центральный круг 9.15', () => {
    const [a, b, c] = goalAreaRect(size, 'left')
    expect(b.x - a.x).toBeCloseTo(5.5, 9)
    expect(c.y - b.y).toBeCloseTo(18.32, 9)
    expect(penaltySpot(size, 'left')).toEqual({ x: 11, y: 34 })
    expect(penaltySpot(size, 'right').x).toBeCloseTo(94, 9)
    expect(FIFA.centreCircleRadius).toBe(9.15)
  })

  it('у каждого шаблона 4 обязательные точки, все внутри поля', () => {
    for (const id of TEMPLATE_IDS) {
      const t = buildTemplate(id, size)
      expect(t.required).toHaveLength(4)
      for (const p of [...t.required, ...t.extras]) {
        expect(p.world.x).toBeGreaterThanOrEqual(-1e-9)
        expect(p.world.x).toBeLessThanOrEqual(size.length + 1e-9)
        expect(p.world.y).toBeGreaterThanOrEqual(-1e-9)
        expect(p.world.y).toBeLessThanOrEqual(size.width + 1e-9)
      }
      const ids = [...t.required, ...t.extras].map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('поле другого размера: площади остаются по центру ворот', () => {
    const t = buildTemplate('penalty-right', { length: 100, width: 60 })
    expect(t.required[0].world.x).toBe(100)
    expect(t.required[1].world.x).toBeCloseTo(83.5, 9)
    expect((t.required[0].world.y + t.required[3].world.y) / 2).toBeCloseTo(30, 9)
  })

  it('линии поля: центральная окружность и дуги согласованы', () => {
    const lines = pitchLines(size)
    expect(lines.filter((l) => l.kind === 'arc').length).toBe(2 + 1 + 4)
    const arc = arcPoints({ x: 0, y: 0 }, 2, 0, Math.PI, 4)
    expect(arc).toHaveLength(5)
    expect(arc[4].x).toBeCloseTo(-2, 9)
  })

  it('штрихи: суммарно покрывают длину и не выходят за концы', () => {
    const segs = dashSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 1)
    expect(segs[0][0].x).toBe(0)
    expect(segs[segs.length - 1][1].x).toBeLessThanOrEqual(10)
    expect(segs.length).toBe(5)
  })
})
describe('заливка кольца (0.16.4)', () => {
  it('диск рисуется с заданной прозрачностью; без поля — прежние 0.18', () => {
    const paint = (extra: Partial<Ring>): number | undefined =>
      paintPitch({ ...baseRing, ...extra }, proj, SIZE, measure).discOpacity
    expect(paint({})).toBe(0.18)
    expect(paint({ fillOpacity: 0.05 })).toBe(0.05)
    expect(paint({ fillOpacity: 0 })).toBe(0)
  })
})

describe('кольцо: ширина обводки в пикселях для ореола', () => {
  it('нет glow — нет и ширины; со glow ширина около мировой ширины в пикселях', () => {
    expect(paintPitch(baseRing, proj, SIZE, measure).glowPx).toBeUndefined()
    const lit = paintPitch({ ...baseRing, glow: true }, proj, SIZE, measure)
    expect(lit.glowPx).toBeGreaterThan(1)
    // Ближнее кольцо шире в пикселях, чем дальнее (перспектива).
    const near = paintPitch(
      { ...baseRing, glow: true, center: { x: 8, y: 60 } },
      proj,
      SIZE,
      measure
    )
    const far = paintPitch(
      { ...baseRing, glow: true, center: { x: 8, y: 10 } },
      proj,
      SIZE,
      measure
    )
    expect(near.glowPx!).toBeGreaterThan(far.glowPx!)
  })
})
