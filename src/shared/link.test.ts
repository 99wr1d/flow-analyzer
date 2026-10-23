// «Связка» (0.19): 2–8 точек у ног игроков — линия или область, маленькие кольца у ног, на поле — длины звеньев.
import { describe, expect, it } from 'vitest'
import {
  AnnotationSchema,
  DEFAULT_LINK_FILL,
  MAX_LINK_FILL,
  MAX_LINK_POINTS,
  isUnderPlayers,
  newUnderDefault,
  type GroundLink,
  type Link
} from './annotations'
import { GEOM_FIELDS } from './animation'
import { groundEllipseRatioIn, GROUND_RATIO_FALLBACK } from './pitch/ground'
import { moveWorld, moveWorldHandle, handleAnchor } from './pitch/edit'
import { fitHomography, type Correspondence } from './pitch/homography'
import { penaltyAreaRect } from './pitch/landmarks'
import { lookAtCamera } from './pitch/pitch.testkit'
import { makeProjector } from './pitch/projector'
import { paintPitch } from './pitch/shapes'
import { LINK_RING_RADIUS_M, LINK_RING_STROKE } from './tools/linkLook'
import { WORLD_WIDTH_FACTOR } from './pitch/shapes'
import { hasVertices, mapToolPoints, maxVertices, minVertices, toolPointsOf } from './tools/points'
import { isScreenTool, paintScreenTool } from './tools/screenPaint'

const SIZE = { w: 1280, h: 720 }
const measure = (t: string, px: number): number => t.length * px * 0.58
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const timing = { mode: 'range', start: 1, duration: 2 }
const style = { color: '#ffffff', width: 0.006, dash: 'solid' }
const pts = [
  { x: 0.1, y: 0.2 },
  { x: 0.5, y: 0.25 },
  { x: 0.3, y: 0.7 }
]

const screenRaw = { id: uuid(1), space: 'screen', type: 'link', points: pts, style, timing }
const link = (extra: Partial<Link> = {}): Link =>
  ({ ...AnnotationSchema.parse(screenRaw), ...extra }) as Link

describe('Связка: схема', () => {
  it('по умолчанию линия с кольцами, заливка 12%', () => {
    const a = link()
    expect(a.type).toBe('link')
    expect(a.closed).toBe(false)
    expect(a.rings).toBe(true)
    expect(a.fillOpacity).toBe(DEFAULT_LINK_FILL)
    expect(DEFAULT_LINK_FILL).toBe(0.12)
  })

  it('от 2 до 8 точек', () => {
    expect(AnnotationSchema.safeParse({ ...screenRaw, points: [pts[0]] }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...screenRaw, points: pts.slice(0, 2) }).success).toBe(true)
    const eight = Array.from({ length: MAX_LINK_POINTS }, (_, i) => ({ x: i / 10, y: 0.5 }))
    expect(AnnotationSchema.safeParse({ ...screenRaw, points: eight }).success).toBe(true)
    expect(
      AnnotationSchema.safeParse({ ...screenRaw, points: [...eight, { x: 0.9, y: 0.5 }] }).success
    ).toBe(false)
  })

  it('заливка не больше 40%', () => {
    expect(AnnotationSchema.safeParse({ ...screenRaw, fillOpacity: MAX_LINK_FILL }).success).toBe(
      true
    )
    expect(AnnotationSchema.safeParse({ ...screenRaw, fillOpacity: 0.5 }).success).toBe(false)
  })

  it('на поле: метры, подписи длин по умолчанию включены', () => {
    const a = AnnotationSchema.parse({
      ...screenRaw,
      space: 'pitch',
      calibrationId: uuid(9),
      type: 'plink',
      points: [
        { x: 10, y: 20 },
        { x: 18, y: 24 }
      ]
    })
    expect(a.type === 'plink' && a.labels).toBe(true)
    expect(a.type === 'plink' && a.rings).toBe(true)
  })

  it('ключи кадров несут points', () => {
    expect(GEOM_FIELDS.link).toEqual(['points'])
    expect(GEOM_FIELDS.plink).toEqual(['points'])
    const moved = pts.map((p) => ({ x: p.x + 0.1, y: p.y }))
    const a = AnnotationSchema.parse({
      ...screenRaw,
      keyframes: [
        { t: 1, geom: { points: pts } },
        { t: 2, geom: { points: moved } }
      ]
    })
    expect(a.type === 'link' && a.keyframes?.length).toBe(2)
  })

  it('«под игроками» — по умолчанию для нового рисунка на экране и на поле', () => {
    expect(newUnderDefault('link', 'screen')).toBe(true)
    expect(newUnderDefault('plink', 'pitch')).toBe(true)
    expect(isUnderPlayers({ type: 'link' })).toBe(true)
    expect(isUnderPlayers({ type: 'plink' })).toBe(true)
  })
})

describe('Связка: вершины', () => {
  it('точки читаются, переносятся и правятся как у цепочки', () => {
    const a = link()
    expect(toolPointsOf(a)).toEqual(pts)
    expect(mapToolPoints(a, (p) => ({ x: p.x + 1, y: p.y })).points[0].x).toBeCloseTo(1.1)
    expect(hasVertices(a)).toBe(true)
    expect(minVertices(a)).toBe(2)
    expect(maxVertices(a)).toBe(MAX_LINK_POINTS)
  })
})

describe('Связка на экране: рисунок', () => {
  it('это инструмент с общим рисовальщиком', () => {
    expect(isScreenTool(link())).toBe(true)
  })

  it('линия: открытая ломаная без заливки, по кольцу у каждой точки', () => {
    const paint = paintScreenTool(link(), SIZE)
    const [line, ...rings] = paint.strokes
    expect(line.ring).toBeUndefined()
    expect(rings.every((r) => r.ring === true)).toBe(true)
    expect(line.closed).toBe(false)
    expect(line.points).toHaveLength(3)
    expect(paint.fills).toHaveLength(0)
    expect(rings).toHaveLength(3)
    rings.forEach((r, i) => {
      expect(r.closed).toBe(true)
      const cx = r.points.reduce((s, p) => s + p.x, 0) / r.points.length
      const cy = r.points.reduce((s, p) => s + p.y, 0) / r.points.length
      expect(cx).toBeCloseTo(pts[i].x * SIZE.w, 3)
      expect(cy).toBeCloseTo(pts[i].y * SIZE.h, 3)
    })
  })

  it('эллипс колец: по умолчанию 0.35, по разметке поля — из groundEllipseRatioIn; кольцо светится само', () => {
    const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)
    const pairs: Correspondence[] = penaltyAreaRect({ length: 105, width: 68 }, 'left').map(
      (w) => ({ world: w, image: cam.project(w)! })
    )
    const fit = fitHomography(pairs, cam.aspect)
    if (!fit.ok) throw new Error('камера теста не годится')
    const proj = makeProjector(fit.H)!
    const dims = (paint: ReturnType<typeof paintScreenTool>): number => {
      const ring = paint.strokes[1]
      const xs = ring.points.map((p) => p.x)
      const ys = ring.points.map((p) => p.y)
      return (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs))
    }
    const at = pts[1]
    const plain = paintScreenTool(link(), SIZE)
    expect(dims(plain)).toBeCloseTo(GROUND_RATIO_FALLBACK, 2)
    const ratio = groundEllipseRatioIn(proj, SIZE.w / SIZE.h, at)
    expect(ratio).not.toBeCloseTo(GROUND_RATIO_FALLBACK, 2)
    const calibrated = paintScreenTool(link(), SIZE, undefined, (p) =>
      groundEllipseRatioIn(proj, SIZE.w / SIZE.h, p)
    )
    // Кольцо второй точки — со своим наклоном.
    const ring1 = calibrated.strokes[2]
    const h1 = Math.max(...ring1.points.map((p) => p.y)) - Math.min(...ring1.points.map((p) => p.y))
    const w1 = Math.max(...ring1.points.map((p) => p.x)) - Math.min(...ring1.points.map((p) => p.x))
    expect(h1 / w1).toBeCloseTo(ratio, 2)
    // У колец своё слабое свечение, у линии его нет (свечение линий — отдельно).
    expect(plain.strokes[0].glow).toBeUndefined()
    expect(plain.strokes.slice(1).every((s) => s.glow === true)).toBe(true)
  })

  it('кольцо — плоский эллипс «на траве»: шире, чем выше, и небольшое', () => {
    const ring = paintScreenTool(link(), SIZE).strokes[1]
    const xs = ring.points.map((p) => p.x)
    const ys = ring.points.map((p) => p.y)
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    expect(h).toBeLessThan(w)
    expect(w).toBeLessThan(SIZE.h * 0.08)
    expect(w).toBeGreaterThan(SIZE.h * 0.015)
    expect(ring.dash).toBe('solid')
  })

  it('«Область»: замкнутая линия и лёгкая заливка', () => {
    const paint = paintScreenTool(link({ closed: true }), SIZE)
    expect(paint.strokes[0].closed).toBe(true)
    expect(paint.fills).toHaveLength(1)
    expect(paint.fills[0]).toHaveLength(3)
    expect(paint.fillOpacity).toBeCloseTo(0.12)
    expect(paintScreenTool(link({ closed: true, fillOpacity: 0.3 }), SIZE).fillOpacity).toBe(0.3)
  })

  it('«Область» из двух точек — просто линия (заливать нечего)', () => {
    const paint = paintScreenTool(link({ closed: true, points: pts.slice(0, 2) }), SIZE)
    expect(paint.fills).toHaveLength(0)
    expect(paint.strokes[0].closed).toBe(false)
  })

  it('кольца выключаются; линия остаётся', () => {
    const paint = paintScreenTool(link({ rings: false }), SIZE)
    expect(paint.strokes).toHaveLength(1)
  })

  it('пунктир и свечение — как у линий 0.18, кольца остаются сплошными', () => {
    const paint = paintScreenTool(
      link({ style: { color: '#fff', width: 0.006, dash: 'dotted' }, glow: true }),
      SIZE
    )
    expect(paint.strokes[0].dash).toBe('dotted')
    expect(paint.strokes[1].dash).toBe('solid')
    expect(paint.lineGlow).toBe(true)
    expect(paintScreenTool(link(), SIZE).lineGlow).toBeUndefined()
  })

  it('ручки — вершины, попадание — по звеньям и кольцам', () => {
    const paint = paintScreenTool(link(), SIZE)
    expect(paint.handles.map((h) => h.id)).toEqual(['v0', 'v1', 'v2'])
    expect(paint.hit.length).toBeGreaterThanOrEqual(2 + 3)
    expect(paint.visible).toBe(true)
  })
})

describe('Связка на поле', () => {
  const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)
  const penalty = penaltyAreaRect({ length: 105, width: 68 }, 'left')
  const pairs: Correspondence[] = penalty.map((w) => ({ world: w, image: cam.project(w)! }))
  const fit = fitHomography(pairs, cam.aspect)
  if (!fit.ok) throw new Error('камера теста не годится')
  const proj = makeProjector(fit.H)!
  const world = [
    { x: 6, y: 20 },
    { x: 14, y: 26 },
    { x: 10, y: 38 }
  ]
  const ground = (extra: Partial<GroundLink> = {}): GroundLink =>
    ({
      ...AnnotationSchema.parse({
        id: uuid(2),
        space: 'pitch',
        calibrationId: uuid(9),
        type: 'plink',
        points: world,
        style,
        timing
      }),
      ...extra
    }) as GroundLink

  it('линия: ленты и кольца на траве, ручки по вершинам', () => {
    const paint = paintPitch(ground({ labels: false, rings: false }), proj, SIZE, measure)
    expect(paint.visible).toBe(true)
    expect(paint.handles.map((h) => h.id)).toEqual(['v0', 'v1', 'v2'])
    expect(paint.fills).toHaveLength(0)
    const withRings = paintPitch(ground({ labels: false }), proj, SIZE, measure)
    // Кольцо — внешний контур и дырка: два многоугольника на точку; лежат отдельно от линий и светятся сами.
    expect(paint.rings).toBeUndefined()
    expect(withRings.rings).toHaveLength(6)
    expect(withRings.body).toHaveLength(paint.body.length)
    expect(withRings.ringGlowPx).toBeGreaterThan(0)
    expect(withRings.glowPx).toBeUndefined()
  })

  it('кольцо на траве той же толщины, что на экране: в LINK_RING_STROKE раз толще линии', () => {
    const a = ground({ labels: false })
    const hw = (a.style.width * WORLD_WIDTH_FACTOR.line * 0.4) / 2
    const paint = paintPitch(a, proj, SIZE, measure)
    // Ширина обводки в метрах: (внешний радиус − внутренний) = 2·hw·LINK_RING_STROKE; проверяем по самой геометрии.
    const [outer, inner] = paint.rings!
    const w = (poly: Array<{ x: number; y: number }>): number =>
      Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x))
    const r = LINK_RING_RADIUS_M
    const half = hw * LINK_RING_STROKE
    expect(w(outer) / w(inner)).toBeGreaterThan(1)
    // Отношение ширин колец на картинке близко к отношению радиусов (перспектива в одной точке почти не искажает).
    expect(w(outer) / w(inner)).toBeCloseTo((r + half) / (r - half), 1)
  })

  it('точечный пунктир «Области»: точки не удваиваются на первой вершине', () => {
    const dotted = ground({
      closed: true,
      labels: false,
      rings: false,
      style: { color: '#fff', width: 0.018, dash: 'dotted' }
    })
    const centers = paintPitch(dotted, proj, SIZE, measure).body.map((poly) => ({
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length
    }))
    expect(centers.length).toBeGreaterThan(6)
    let min = Infinity
    for (let i = 0; i < centers.length; i += 1) {
      for (let j = i + 1; j < centers.length; j += 1) {
        min = Math.min(min, Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y))
      }
    }
    expect(min).toBeGreaterThan(0.5)
  })

  it('«Область» заливается с прозрачностью 12%', () => {
    const paint = paintPitch(ground({ closed: true }), proj, SIZE, measure)
    expect(paint.fills).toHaveLength(1)
    expect(paint.fillOpacity).toBeCloseTo(0.12)
  })

  it('подписи: длины звеньев; у линии с 3+ точками ещё «Ширина линии»', () => {
    const paint = paintPitch(ground(), proj, SIZE, measure)
    const segs = paint.labels.filter((l) => l.kind === 'segment').map((l) => l.text)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toBe(`${Math.hypot(8, 6).toFixed(1)} м`)
    expect(paint.labels.some((l) => l.kind === 'width')).toBe(true)
  })

  it('«Область»: три звена (с замыкающим), без «Ширины линии»', () => {
    const paint = paintPitch(ground({ closed: true }), proj, SIZE, measure)
    expect(paint.labels.filter((l) => l.kind === 'segment')).toHaveLength(3)
    expect(paint.labels.some((l) => l.kind === 'width')).toBe(false)
  })

  it('подписи выключаются', () => {
    expect(paintPitch(ground({ labels: false }), proj, SIZE, measure).labels).toHaveLength(0)
  })

  it('перенос и ручки в метрах', () => {
    const a = ground()
    const moved = moveWorld(a, 2, 1)
    expect(moved.type === 'plink' && moved.points[0]).toEqual({ x: 8, y: 21 })
    const dragged = moveWorldHandle(a, 'v1', { x: 20, y: 30 })
    expect(dragged.type === 'plink' && dragged.points[1]).toEqual({ x: 20, y: 30 })
    expect(handleAnchor(a, 'v1')).toEqual(world[0])
  })
})
