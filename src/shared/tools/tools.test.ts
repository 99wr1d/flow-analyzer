// Чистая геометрия новых инструментов: кривая Безье, упрощение и сглаживание пера, площадь зоны, правила
// замыкания, измерение связей, маска прожекторов и геометрия лупы.
import { describe, expect, it } from 'vitest'
import { measureChain, formatArea, formatLineWidth } from './chain'
import {
  controlFromMid,
  curveExtent,
  curveMid,
  dashPolyline,
  dotsAlong,
  MAX_DOTS,
  defaultControl,
  densifyQuad,
  pointBackFromEnd,
  polylineLength,
  quadPoint,
  trimEnd
} from './curve'
import { loupeGeometry } from './loupe'
import {
  canClosePolygon,
  canFinishChain,
  centroid,
  insertionPoint,
  interiorPoint,
  pointInPolygon,
  polygonArea,
  pushVertex,
  removeVertex,
  signedArea
} from './polygon'
import { chaikin, catmullRom, dropClose, rdp, simplifyStroke } from './simplify'
import { composeSpotlights, spotlightBlur } from './spotlight'
import { hasVertices, mapToolPoints, minVertices, toolPointsOf, vertexIndex } from './points'
import type { Annotation } from '../annotations'

describe('кривая Безье', () => {
  const p0 = { x: 0, y: 0 }
  const c = { x: 5, y: 10 }
  const p1 = { x: 10, y: 0 }

  it('начинается в p0, заканчивается в p1, середина по формуле', () => {
    expect(quadPoint(p0, c, p1, 0)).toEqual(p0)
    expect(quadPoint(p0, c, p1, 1)).toEqual(p1)
    expect(curveMid(p0, c, p1)).toEqual({ x: 5, y: 5 })
  })

  it('densifyQuad: n + 1 точек, равномерно по t, длина не меньше хорды', () => {
    const pts = densifyQuad(p0, c, p1, 40)
    expect(pts).toHaveLength(41)
    expect(pts[0]).toEqual(p0)
    expect(pts[40]).toEqual(p1)
    expect(pts[20]).toEqual({ x: 5, y: 5 })
    expect(polylineLength(pts)).toBeGreaterThan(10)
    // Длина настоящей параболы ≈ 14.78; ломаная из 40 звеньев почти совпадает.
    expect(polylineLength(pts)).toBeCloseTo(14.78, 1)
    expect(densifyQuad(p0, c, p1, 0)).toHaveLength(3)
  })

  it('controlFromMid обратна curveMid: кривая проходит через ручку', () => {
    for (const mid of [
      { x: 5, y: 5 },
      { x: 4, y: -3 },
      { x: 9, y: 12 }
    ]) {
      const ctrl = controlFromMid(p0, mid, p1)
      const back = curveMid(p0, ctrl, p1)
      expect(back.x).toBeCloseTo(mid.x, 9)
      expect(back.y).toBeCloseTo(mid.y, 9)
    }
  })

  it('defaultControl: изгиб на долю длины в пикселях, а не в долях кадра', () => {
    const a = { x: 0.2, y: 0.5 }
    const b = { x: 0.6, y: 0.5 }
    const size = { w: 1000, h: 500 }
    const ctrl = defaultControl(a, b, 0.25, size)
    // Длина 400 px; сдвиг 100 px вверх = 0.2 высоты кадра.
    expect(ctrl.x).toBeCloseTo(0.4, 9)
    expect(ctrl.y).toBeCloseTo(0.5 - 100 / 500, 9)
  })

  it('curveExtent: рамка кривой — по самой кривой, а не по управляющей точке', () => {
    const pts = curveExtent(p0, c, p1)
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(5, 9)
    expect(Math.min(...pts.map((p) => p.x))).toBe(0)
    expect(Math.max(...pts.map((p) => p.x))).toBe(10)
    // Прямая «кривая» (c на хорде): лишних точек нет.
    expect(curveExtent(p0, { x: 5, y: 0 }, p1)).toHaveLength(2)
  })

  it('trimEnd и pointBackFromEnd: укорочение ломаной у наконечника', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ]
    expect(trimEnd(line, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 }
    ])
    // Срез длиннее последнего звена уходит на предыдущее.
    const shorter = trimEnd(line, 14)
    expect(shorter[shorter.length - 1].x).toBeCloseTo(6, 9)
    expect(pointBackFromEnd(line, 4)).toEqual({ x: 10, y: 6 })
    expect(pointBackFromEnd(line, 15)).toEqual({ x: 5, y: 0 })
  })

  it('dashPolyline: штрихи заданной длины с промежутками', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    ]
    const dashes = dashPolyline(line, 2, 1)
    expect(dashes).toHaveLength(4)
    expect(dashes[0]).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 }
    ])
    expect(dashes[1][0].x).toBeCloseTo(3, 9)
    expect(dashes[3][dashes[3].length - 1].x).toBeCloseTo(10, 9)
  })
})

describe('перо: упрощение и сглаживание', () => {
  const wave = Array.from({ length: 200 }, (_, i) => ({ x: i, y: Math.sin(i / 12) * 20 }))

  it('RDP сохраняет концы и сильно сокращает число точек, оставаясь в допуске', () => {
    const out = rdp(wave, 1)
    expect(out[0]).toBe(wave[0])
    expect(out[out.length - 1]).toBe(wave[wave.length - 1])
    expect(out.length).toBeLessThan(wave.length / 4)
    expect(out.length).toBeGreaterThan(5)
    // Каждая исходная точка отстоит от упрощённой ломаной не больше допуска.
    const dist = (p: { x: number; y: number }): number => {
      let best = Infinity
      for (let i = 1; i < out.length; i += 1) {
        const a = out[i - 1]
        const b = out[i]
        const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
        const t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2)
        )
        best = Math.min(
          best,
          Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)))
        )
      }
      return best
    }
    expect(Math.max(...wave.map(dist))).toBeLessThanOrEqual(1.0001)
  })

  it('прямая линия сводится к двум точкам; две точки остаются', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2 }))
    expect(rdp(line, 0.5)).toHaveLength(2)
    expect(rdp(line.slice(0, 2), 0.5)).toHaveLength(2)
    expect(rdp([], 1)).toEqual([])
  })

  it('dropClose выбрасывает слишком близкие точки, но оставляет последнюю', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 5, y: 0 },
      { x: 5.1, y: 0 }
    ]
    const out = dropClose(pts, 1)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out[out.length - 1]).toEqual({ x: 5.1, y: 0 })
    expect(out).toHaveLength(2)
  })

  it('simplifyStroke укладывается в максимум точек', () => {
    const noisy = Array.from({ length: 500 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 3) * 10 + Math.cos(i * 1.7) * 3
    }))
    const out = simplifyStroke(noisy, 0.5, 30)
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out.length).toBeGreaterThanOrEqual(2)
  })

  it('Катмулл — Ром проходит через все исходные точки и даёт плавную линию', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 8 },
      { x: 20, y: 0 },
      { x: 30, y: 8 }
    ]
    const smooth = catmullRom(pts, 8)
    expect(smooth).toHaveLength(1 + 3 * 8)
    // Исходные точки лежат на кривой (каждая 8-я).
    pts.slice(1).forEach((p, i) => {
      expect(smooth[(i + 1) * 8].x).toBeCloseTo(p.x, 6)
      expect(smooth[(i + 1) * 8].y).toBeCloseTo(p.y, 6)
    })
    expect(catmullRom(pts.slice(0, 2), 8)).toHaveLength(2)
  })

  it('Чайкин срезает углы и сохраняет концы', () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ]
    const out = chaikin(corner, 2)
    expect(out[0]).toEqual(corner[0])
    expect(out[out.length - 1]).toEqual(corner[2])
    expect(out.length).toBeGreaterThan(corner.length)
    // Угловой точки (10, 0) на сглаженной линии больше нет.
    expect(out.some((p) => p.x === 10 && p.y === 0)).toBe(false)
  })
})

describe('площадь зоны', () => {
  const rect = (w: number, h: number): Array<{ x: number; y: number }> => [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h }
  ]

  it('прямоугольник штрафной площади 16.5 × 40.32 = 665.28 м²', () => {
    expect(polygonArea(rect(16.5, 40.32))).toBeCloseTo(665.28, 6)
    expect(formatArea(polygonArea(rect(16.5, 40.32)))).toBe('665 м²')
  })

  it('не зависит от направления обхода и сдвига', () => {
    const r = rect(10, 4)
    expect(polygonArea([...r].reverse())).toBeCloseTo(40, 9)
    expect(polygonArea(r.map((p) => ({ x: p.x + 100, y: p.y - 50 })))).toBeCloseTo(40, 9)
    expect(signedArea(r)).toBeCloseTo(40, 9)
    expect(signedArea([...r].reverse())).toBeCloseTo(-40, 9)
  })

  it('невыпуклый многоугольник (буква Г): площадь без «дыры» на углу', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 }
    ]
    // 10×4 + 4×6 = 64.
    expect(polygonArea(l)).toBeCloseTo(64, 9)
  })

  it('невыпуклая «стрела»: площадь равна разности', () => {
    const arrow = [
      { x: 0, y: 0 },
      { x: 8, y: 4 },
      { x: 0, y: 8 },
      { x: 3, y: 4 }
    ]
    expect(polygonArea(arrow)).toBeCloseTo(20, 9)
  })

  it('вырожденные случаи: меньше трёх точек и точки на одной прямой', () => {
    expect(polygonArea([])).toBe(0)
    expect(polygonArea([{ x: 1, y: 1 }])).toBe(0)
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 5, y: 5 }
      ])
    ).toBe(0)
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 }
      ])
    ).toBeCloseTo(0, 12)
  })

  it('форматирование: от 100 м² целые, меньше — один знак', () => {
    expect(formatArea(64)).toBe('64.0 м²')
    expect(formatArea(99.94)).toBe('99.9 м²')
    expect(formatArea(100.4)).toBe('100 м²')
    expect(formatArea(0)).toBe('0.0 м²')
  })

  it('внутренняя точка лежит внутри и у «подковы»', () => {
    const u = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 7, y: 10 },
      { x: 7, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 10 },
      { x: 0, y: 10 }
    ]
    const c = centroid(u)
    expect(pointInPolygon(c, u)).toBe(false) // центр масс «подковы» в её выемке
    const p = interiorPoint(u)
    expect(pointInPolygon(p, u)).toBe(true)
    // Выпуклый — это просто центр масс.
    expect(interiorPoint(rect(10, 4))).toEqual({ x: 5, y: 2 })
  })
})

describe('правила замыкания и правки вершин', () => {
  it('зона замыкается от трёх вершин не на одной прямой', () => {
    expect(canClosePolygon([])).toBe(false)
    expect(
      canClosePolygon([
        { x: 0, y: 0 },
        { x: 1, y: 0 }
      ])
    ).toBe(false)
    expect(
      canClosePolygon([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 }
      ])
    ).toBe(false)
    expect(
      canClosePolygon([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 }
      ])
    ).toBe(true)
  })

  it('связь завершается от двух различных узлов', () => {
    expect(canFinishChain([{ x: 0, y: 0 }])).toBe(false)
    expect(
      canFinishChain([
        { x: 0, y: 0 },
        { x: 0, y: 0 }
      ])
    ).toBe(false)
    expect(
      canFinishChain([
        { x: 0, y: 0 },
        { x: 0.1, y: 0 }
      ])
    ).toBe(true)
  })

  it('pushVertex: второй щелчок двойного щелчка не добавляет вершину', () => {
    const pts = [{ x: 1, y: 1 }]
    expect(pushVertex(pts, { x: 1.01, y: 1 }, 0.1)).toHaveLength(1)
    expect(pushVertex(pts, { x: 2, y: 1 }, 0.1)).toHaveLength(2)
    expect(pushVertex([], { x: 0, y: 0 }, 0.1)).toHaveLength(1)
  })

  it('insertionPoint: вставка в ближайшее звено; у зоны есть замыкающее звено', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 }
    ]
    const onBase = insertionPoint(tri, { x: 4, y: 0.5 }, true)
    expect(onBase?.index).toBe(1)
    expect(onBase?.point.x).toBeCloseTo(4, 9)
    expect(onBase?.dist).toBeCloseTo(0.5, 9)
    // Замыкающее звено (5,10)–(0,0): новая вершина идёт в конец списка.
    const closing = insertionPoint(tri, { x: 1.9, y: 4.2 }, true)
    expect(closing?.index).toBe(3)
    // Открытая ломаная замыкающего звена не имеет.
    const open = insertionPoint(tri, { x: 1.9, y: 4.2 }, false)
    expect(open?.index).not.toBe(3)
    expect(insertionPoint([{ x: 0, y: 0 }], { x: 1, y: 1 }, false)).toBeNull()
  })

  it('removeVertex не опускает число вершин ниже минимума', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 }
    ]
    expect(removeVertex(tri, 1, 3)).toBeNull()
    expect(removeVertex(tri, 1, 2)).toHaveLength(2)
    expect(removeVertex(tri, 7, 2)).toBeNull()
    expect(removeVertex([...tri, { x: 1, y: 5 }], 3, 3)).toEqual(tri)
  })

  it('номер вершины из id ручки', () => {
    expect(vertexIndex('v0')).toBe(0)
    expect(vertexIndex('v12')).toBe(12)
    expect(vertexIndex('p1')).toBeNull()
    expect(vertexIndex('c')).toBeNull()
    expect(vertexIndex('v')).toBeNull()
  })
})

describe('связи игроков', () => {
  const line = [
    { x: 10, y: 10 },
    { x: 10, y: 22 },
    { x: 11, y: 30 },
    { x: 10, y: 42.4 }
  ]

  it('длины звеньев, сумма и ширина линии (между крайними игроками)', () => {
    const m = measureChain(line)
    expect(m.segments).toHaveLength(3)
    expect(m.segments[0]).toBeCloseTo(12, 9)
    expect(m.segments[1]).toBeCloseTo(Math.hypot(1, 8), 9)
    expect(m.segments[2]).toBeCloseTo(Math.hypot(1, 12.4), 9)
    expect(m.total).toBeCloseTo(
      m.segments.reduce((a, b) => a + b, 0),
      9
    )
    expect(m.width).toBeCloseTo(32.4, 9)
    expect(m.total).toBeGreaterThan(m.width)
  })

  it('одна точка и пустой список', () => {
    expect(measureChain([{ x: 1, y: 1 }])).toEqual({ segments: [], total: 0, width: 0 })
    expect(measureChain([])).toEqual({ segments: [], total: 0, width: 0 })
  })

  it('подпись «Ширина линии: 32.4 м»', () => {
    expect(formatLineWidth(32.4)).toBe('Ширина линии: 32.4 м')
    expect(formatLineWidth(0)).toBe('Ширина линии: 0.0 м')
  })
})

describe('прожекторы: общая маска', () => {
  const circleA = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ]
  const circleB = [
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 0 }
  ]

  it('нет прожекторов или нет освещённых областей — маски нет', () => {
    expect(composeSpotlights([])).toBeNull()
    expect(composeSpotlights([{ dim: 0.5, lit: [] }])).toBeNull()
  })

  it('прожектор без затемнения (dim 0) маски не даёт и дыр не делает', () => {
    expect(composeSpotlights([{ dim: 0, lit: [circleA] }])).toBeNull()
    const mask = composeSpotlights([
      { dim: 0, lit: [circleA] },
      { dim: 0.5, lit: [circleA] }
    ])
    expect(mask).not.toBeNull()
    expect(mask!.holes).toHaveLength(1)
  })

  it('затемнение — самое сильное, дыры собираются со всех прожекторов', () => {
    const mask = composeSpotlights([
      { dim: 0.4, lit: [circleA] },
      { dim: 0.7, lit: [circleB] }
    ])!
    expect(mask.dim).toBe(0.7)
    expect(mask.holes).toHaveLength(2)
  })

  it('все контуры обходятся в одну сторону (иначе пересечения не откроются при заливке по ненулевому правилу)', () => {
    const mask = composeSpotlights([
      { dim: 0.5, lit: [circleA] },
      { dim: 0.5, lit: [circleB] }
    ])!
    const signs = mask.holes.map((h) => Math.sign(signedArea(h)))
    expect(new Set(signs).size).toBe(1)
    expect(signs[0]).toBe(1)
    // Исходные данные не изменены.
    expect(circleB[1]).toEqual({ x: 20, y: 10 })
  })

  it('прожектор с несколькими областями (пятно и луч) даёт несколько дыр', () => {
    const mask = composeSpotlights([{ dim: 0.3, lit: [circleA, circleB] }])!
    expect(mask.holes).toHaveLength(2)
  })

  it('размытие края растёт с высотой кадра, но не меньше полутора пикселей', () => {
    expect(spotlightBlur(720)).toBeCloseTo(8.64, 6)
    expect(spotlightBlur(40)).toBe(1.5)
  })
})

describe('лупа: геометрия линзы', () => {
  it('диаметр чётный, исходный участок = диаметр / увеличение и лежит внутри кадра', () => {
    const g = loupeGeometry(
      { pos: { x: 0.5, y: 0.5 }, src: { x: 0.5, y: 0.5 }, radius: 0.1, zoom: 2 },
      640,
      360
    )
    expect(g.d).toBe(72)
    expect(g.sw).toBe(36)
    expect(g.ox).toBe(320 - 36)
    expect(g.oy).toBe(180 - 36)
    expect(g.sx).toBe(320 - 18)
    expect(g.sy).toBe(180 - 18)
    expect(g.sx % 2).toBe(0)
    expect(g.sy % 2).toBe(0)
  })

  it('источник у края кадра сдвигается внутрь', () => {
    const g = loupeGeometry(
      { pos: { x: 0.2, y: 0.3 }, src: { x: 0.999, y: 0.001 }, radius: 0.12, zoom: 3 },
      640,
      360
    )
    expect(g.sx + g.sw).toBeLessThanOrEqual(640)
    expect(g.sy).toBe(0)
    expect(g.sx).toBeGreaterThanOrEqual(0)
  })

  it('увеличение 1.5, 2, 3 даёт разные участки', () => {
    const at = (zoom: number): number =>
      loupeGeometry(
        { pos: { x: 0.5, y: 0.5 }, src: { x: 0.5, y: 0.5 }, radius: 0.15, zoom },
        1280,
        720
      ).sw
    expect(at(1.5)).toBeGreaterThan(at(2))
    expect(at(2)).toBeGreaterThan(at(3))
    expect(at(2)).toBe(108)
  })
})

describe('точки рисунков', () => {
  const base = {
    id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
    style: { color: '#ffffff', width: 0.01, dash: 'solid' as const },
    timing: { mode: 'range' as const, start: 0, duration: 3 }
  }

  it('перечисление и преобразование точек для новых видов', () => {
    const zone: Annotation = {
      ...base,
      space: 'screen',
      type: 'zone',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.1 },
        { x: 0.3, y: 0.5 }
      ],
      opacity: 0.3
    }
    expect(toolPointsOf(zone)).toHaveLength(3)
    const moved = mapToolPoints(zone, (p) => ({ x: p.x + 0.1, y: p.y }))
    expect(moved.type === 'zone' && moved.points[0].x).toBeCloseTo(0.2, 9)
    expect(hasVertices(zone)).toBe(true)
    expect(minVertices(zone)).toBe(3)
    const loupe: Annotation = {
      ...base,
      space: 'screen',
      type: 'loupe',
      pos: { x: 0.2, y: 0.2 },
      src: { x: 0.6, y: 0.6 },
      radius: 0.1,
      zoom: 2
    }
    expect(toolPointsOf(loupe)).toEqual([
      loupe.type === 'loupe' ? loupe.pos : null,
      loupe.type === 'loupe' ? loupe.src : null
    ])
    expect(hasVertices(loupe)).toBe(false)
    // Старый вид: точек нет, рисунок возвращается как есть.
    const arrow: Annotation = {
      ...base,
      space: 'screen',
      type: 'arrow',
      p1: { x: 0, y: 0 },
      p2: { x: 1, y: 1 }
    }
    expect(toolPointsOf(arrow)).toEqual([])
    expect(mapToolPoints(arrow, (p) => ({ x: p.x + 1, y: p.y }))).toBe(arrow)
  })
})

describe('точки вдоль линии', () => {
  it('ложатся поровну на оба конца, шаг ≈ заданному', () => {
    const dots = dotsAlong(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 }
      ],
      10
    )
    expect(dots).toHaveLength(11)
    expect(dots[0].x).toBe(0)
    expect(dots[10].x).toBeCloseTo(100, 9)
    expect(dots[1].x).toBeCloseTo(10, 9)
  })

  it('короткая линия — хотя бы две точки; нулевая — ни одной', () => {
    expect(
      dotsAlong(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 }
        ],
        10
      )
    ).toHaveLength(2)
    expect(
      dotsAlong(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 }
        ],
        10
      )
    ).toHaveLength(0)
  })

  it('идут по изгибам ломаной, замкнутая не повторяет первую точку', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]
    const dots = dotsAlong(sq, 5, true)
    expect(dots).toHaveLength(8)
    expect(dots[2]).toEqual({ x: 10, y: 0 })
    expect(dots[3].y).toBeCloseTo(5, 9)
  })

  it('огромное перо не даёт больше MAX_DOTS точек', () => {
    const long = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: (i % 7) * 3 }))
    expect(dotsAlong(long, 0.5).length).toBeLessThanOrEqual(MAX_DOTS + 1)
  })
})
