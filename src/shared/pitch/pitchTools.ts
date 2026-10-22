// Новые рисунки на поле (этап 15): прожектор, изогнутая стрелка, перо, зона, связи игроков.
// Как и остальные рисунки на поле, строятся на плоскости поля в метрах и только потом проецируются.
import type {
  GroundChain,
  GroundCurve,
  GroundPen,
  GroundSpotlight,
  GroundZone,
  PitchAnnotation
} from '../annotations'
import { formatLineWidth, formatArea, measureChain } from '../tools/chain'
import {
  curveMid,
  dashPolyline,
  densifyQuad,
  pointBackFromEnd,
  polylineLength,
  trimEnd
} from '../tools/curve'
import { pillarFromFooting, pillarPoly } from '../tools/pillar'
import { interiorPoint, polygonArea } from '../tools/polygon'
import { catmullRom } from '../tools/simplify'
import type { Pt } from './linalg'
import type { Projector } from './projector'
import {
  DASH_GAP,
  DASH_LENGTH,
  WORLD_WIDTH_FACTOR,
  ccw,
  circleAngles,
  dashSegments,
  emptyPaint,
  formatMeters,
  labelBox,
  onCircle,
  ribbon,
  rulerFontPx,
  toPx,
  worldWidthOf,
  type LabelPaint,
  type Measure,
  type PaintSize,
  type PitchPaint,
  type PxPt
} from './shapes'

export type ToolPitchAnnotation =
  GroundSpotlight | GroundCurve | GroundPen | GroundZone | GroundChain

export const isToolAnnotation = (a: PitchAnnotation): a is ToolPitchAnnotation =>
  a.type === 'pspot' ||
  a.type === 'pcurve' ||
  a.type === 'ppen' ||
  a.type === 'pzone' ||
  a.type === 'pchain'

/** Рост человека, м: высота «луча» прожектора. */
export const BEAM_HEIGHT_M = 1.9
/** Верх «луча» уже основания: конус, а не цилиндр. */
const BEAM_TOP_SCALE = 0.72
/** Радиус маркера узла связи на траве, м. */
const NODE_RADIUS_M = 0.62
/** Внутренний радиус кольца узла, м. */
const NODE_INNER_M = 0.36
const NODE_ANGLES = 20

/** Выпуклая оболочка точек (алгоритм Эндрю). */
export function convexHull(points: readonly PxPt[]): PxPt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const cross = (o: PxPt, a: PxPt, b: PxPt): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: PxPt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: PxPt[] = []
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/**
 * Силуэт «луча» над пятном на земле. ПРИБЛИЖЕНИЕ: высота луча — рост человека (1.9 м) × масштаб в этой точке
 * (пикселей на метр по ширине пятна), поднятая «вверх по картинке»; точная вертикаль в плоскости камеры
 * для разметки по четырём точкам земли неизвестна. Верх луча уже основания (конус). Силуэт — выпуклая
 * оболочка основания и поднятого сужённого основания.
 */
export function beamSilhouette(
  ground: readonly PxPt[],
  radiusM: number
): { poly: PxPt[]; top: number; bottom: number; heightPx: number } | null {
  if (ground.length < 3 || !(radiusM > 0)) return null
  let minX = Infinity
  let maxX = -Infinity
  for (const p of ground) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
  }
  const pxPerMeter = (maxX - minX) / (2 * radiusM)
  const heightPx = BEAM_HEIGHT_M * pxPerMeter
  const cx = (minX + maxX) / 2
  const raised = ground.map((p) => ({
    x: cx + (p.x - cx) * BEAM_TOP_SCALE,
    y: p.y - heightPx
  }))
  const poly = convexHull([...ground, ...raised])
  return {
    poly,
    top: Math.min(...poly.map((p) => p.y)),
    bottom: Math.max(...poly.map((p) => p.y)),
    heightPx
  }
}

/** Ленты по звеньям ломаной (в метрах). */
export function polylineRibbons(points: readonly Pt[], hw: number): Pt[][] {
  const out: Pt[][] = []
  for (let i = 1; i < points.length; i += 1) {
    const r = ribbon(points[i - 1], points[i], hw)
    if (r.length > 0) out.push(r)
  }
  return out
}

function labelAt(
  kind: LabelPaint['kind'],
  text: string,
  center: PxPt,
  fontPx: number,
  measure: Measure,
  lift: number
): LabelPaint {
  const box = labelBox(text, fontPx, measure)
  return { kind, text, x: center.x, y: center.y - lift - box.h / 2, w: box.w, h: box.h, fontPx }
}

export function paintPitchTool(
  a: ToolPitchAnnotation,
  proj: Projector,
  size: PaintSize,
  measure: Measure
): PitchPaint {
  const out = emptyPaint()
  const px = (poly: readonly Pt[]): PxPt[] => poly.map((p) => toPx(p, size))
  const pushBody = (worldPoly: Pt[]): void => {
    if (worldPoly.length < 3) return
    const projected = proj.projectPolygon(worldPoly)
    if (projected.length >= 3) out.body.push(px(projected))
  }
  const handle = (id: string, w: Pt): void => {
    const p = proj.toImage(w)
    if (p) out.handles.push({ id, point: toPx(p, size) })
  }
  const w = worldWidthOf(a)
  const hw = w / 2

  /** Ленты вдоль ломаной с учётом пунктира. */
  const strokeWorld = (line: readonly Pt[], dashed: boolean, dashLen = DASH_LENGTH * w): void => {
    const pieces = dashed ? dashPolyline(line, dashLen, DASH_GAP * w) : [line]
    for (const piece of pieces) {
      for (const r of polylineRibbons(piece, hw)) pushBody(r)
    }
  }
  /** Наконечник на конце ломаной; возвращает ломаную, укороченную до его основания. */
  const arrowHead = (line: Pt[]): Pt[] => {
    const len = polylineLength(line)
    if (len === 0) return line
    const head = Math.min(Math.max(w * 4, 1.2), len * 0.6)
    const half = Math.max(head * 0.5, hw * 1.6)
    const tip = line[line.length - 1]
    const from = pointBackFromEnd(line, head)
    const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1
    const ux = (tip.x - from.x) / d
    const uy = (tip.y - from.y) / d
    const base = { x: tip.x - ux * head, y: tip.y - uy * head }
    pushBody(
      ccw([
        tip,
        { x: base.x - uy * half, y: base.y + ux * half },
        { x: base.x + uy * half, y: base.y - ux * half }
      ])
    )
    return trimEnd(line, head * 0.8)
  }
  const labelFont = rulerFontPx(a.style.width, size) * 0.82

  if (a.type === 'pspot') {
    const rim = (a.style.width * WORLD_WIDTH_FACTOR.ring * 0.7) / 2
    const r = a.radius
    const angles = circleAngles(a.center, r + rim, proj, size)
    const circle = (rad: number): Pt[] => angles.map((t) => onCircle(a.center, rad, t))
    const groundProj = proj.projectPolygon(ccw(circle(r)))
    const ground = px(groundProj)
    const outer = ccw(circle(r + rim))
    const inner = [...ccw(circle(Math.max(r - rim, 0.01)))].reverse()
    let lit: PxPt[] = ground
    // Столб: след — низ-середина пятна на траве; столб идёт вертикально по экрану до верха кадра (как у экранного).
    let pillar: ReturnType<typeof pillarFromFooting> = null
    if (a.form === 'pillar' && ground.length >= 3) {
      const xs = ground.map((p) => p.x)
      const x0 = Math.min(...xs)
      const x1 = Math.max(...xs)
      pillar = pillarFromFooting(
        { x: (x0 + x1) / 2, y: Math.max(...ground.map((p) => p.y)) },
        x1 - x0
      )
    }
    if (pillar) {
      out.pillar = pillar
      lit = pillarPoly(pillar, size.h * 0.1)
      out.hit = [pillarPoly(pillar, 0, true)]
      out.lit.push(lit)
      out.visible = true
      handle('radius', { x: a.center.x + r, y: a.center.y })
      return out
    }
    const outerProj = proj.projectPolygon(outer)
    const innerProj = proj.projectPolygon(inner)
    if (outerProj.length >= 3) out.body.push(px(outerProj))
    if (outerProj.length >= 3 && innerProj.length >= 3) out.body.push(px(innerProj))
    if (ground.length >= 3) out.disc.push(ground)
    if (a.beam) {
      const beam = beamSilhouette(ground, r)
      if (beam) {
        out.beam = { poly: beam.poly, top: beam.top, bottom: beam.bottom }
        lit = beam.poly
      }
    }
    if (lit.length >= 3) out.lit.push(lit)
    out.hit = lit.length >= 3 ? [lit] : []
    handle('radius', { x: a.center.x + r, y: a.center.y })
  } else if (a.type === 'pcurve') {
    const line = densifyQuad(a.p1, a.c, a.p2, 48)
    const len = polylineLength(line)
    if (len > 0) {
      const shaft = arrowHead(line)
      strokeWorld(shaft, a.style.dash === 'dashed')
      out.hit = out.body.slice()
    }
    handle('p1', a.p1)
    handle('p2', a.p2)
    handle('c', curveMid(a.p1, a.c, a.p2))
  } else if (a.type === 'ppen') {
    const line = catmullRom(a.points, 6)
    if (polylineLength(line) > 0) {
      const shaft = a.arrow ? arrowHead(line) : line
      strokeWorld(shaft, a.style.dash === 'dashed')
      out.hit = out.body.slice()
    }
  } else if (a.type === 'pzone') {
    const fill = proj.projectPolygon(a.points)
    if (fill.length >= 3) {
      out.fills.push(px(fill))
      out.fillOpacity = a.opacity
    }
    strokeWorld([...a.points, a.points[0]], a.style.dash === 'dashed')
    out.hit = [...out.fills, ...out.body]
    a.points.forEach((p, i) => handle(`v${i}`, p))
    if (a.showArea) {
      const center = proj.toImage(interiorPoint(a.points))
      if (center) {
        out.labels.push(
          labelAt(
            'area',
            formatArea(polygonArea(a.points)),
            toPx(center, size),
            labelFont,
            measure,
            0
          )
        )
      }
    }
  } else {
    // pchain
    const pts = a.points
    if (a.fill && pts.length >= 3) {
      const fill = proj.projectPolygon(pts)
      if (fill.length >= 3) {
        out.fills.push(px(fill))
        out.fillOpacity = 0.24
      }
    }
    strokeWorld(pts, a.style.dash === 'dashed')
    // Узлы — кольца на траве вокруг ног игроков (в перспективе — эллипсы).
    for (const p of pts) {
      const ring = (r: number): Pt[] =>
        Array.from({ length: NODE_ANGLES }, (_, i) =>
          onCircle(p, r, (i * 2 * Math.PI) / NODE_ANGLES)
        )
      const outer = proj.projectPolygon(ccw(ring(NODE_RADIUS_M)))
      const inner = proj.projectPolygon([...ccw(ring(NODE_INNER_M))].reverse())
      if (outer.length >= 3) out.body.push(px(outer))
      if (outer.length >= 3 && inner.length >= 3) out.body.push(px(inner))
    }
    const measured = measureChain(pts)
    if (a.labels && pts.length >= 2) {
      let minTop = Infinity
      const mids: PxPt[] = []
      for (let i = 1; i < pts.length; i += 1) {
        const mid = proj.toImage({
          x: (pts[i].x + pts[i - 1].x) / 2,
          y: (pts[i].y + pts[i - 1].y) / 2
        })
        if (!mid) continue
        const m = toPx(mid, size)
        mids.push(m)
        minTop = Math.min(minTop, m.y)
        if (pts.length >= 3) {
          out.labels.push(
            labelAt(
              'segment',
              formatMeters(measured.segments[i - 1]),
              m,
              labelFont,
              measure,
              labelFont * 0.55
            )
          )
        }
      }
      const first = proj.toImage(pts[0])
      const last = proj.toImage(pts[pts.length - 1])
      if (first && last) {
        const f = toPx(first, size)
        const l = toPx(last, size)
        const c = { x: (f.x + l.x) / 2, y: Math.min(f.y, l.y, minTop) }
        const lift = pts.length >= 3 ? labelFont * 1.75 : labelFont * 0.7
        out.labels.push(
          labelAt('width', formatLineWidth(measured.width), c, labelFont * 1.05, measure, lift)
        )
        if (pts.length >= 3) {
          // Тонкая пунктирная линия между крайними игроками: то, что измеряет «Ширина линии».
          const thin = w * 0.35
          for (const piece of dashSegments(pts[0], pts[pts.length - 1], thin * 6, thin * 4)) {
            const r = ribbon(piece[0], piece[1], thin / 2)
            if (r.length > 0) pushBody(r)
          }
        }
      }
    }
    out.hit = [...out.fills, ...out.body]
    pts.forEach((p, i) => handle(`v${i}`, p))
  }

  // Подписи попадают в область выбора.
  for (const l of out.labels) {
    out.hit.push([
      { x: l.x - l.w / 2, y: l.y - l.h / 2 },
      { x: l.x + l.w / 2, y: l.y - l.h / 2 },
      { x: l.x + l.w / 2, y: l.y + l.h / 2 },
      { x: l.x - l.w / 2, y: l.y + l.h / 2 }
    ])
  }
  out.visible =
    out.body.length > 0 ||
    out.disc.length > 0 ||
    out.fills.length > 0 ||
    out.lit.length > 0 ||
    out.labels.length > 0
  return out
}
