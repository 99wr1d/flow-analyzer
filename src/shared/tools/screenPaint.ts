// Новые рисунки на экране (этап 15): прожектор, изогнутая стрелка, перо, зона, лупа, связи игроков.
// Результат — тот же PitchPaint, что и у рисунков на поле: один код рисует и нажимает ручки и на экране, и в экспорте.
// Координаты рисунков нормализованы; здесь они переводятся в пиксели кадра.
import type { Chain, Curve, Loupe, Pen, Spotlight, Zone } from '../annotations'
import { emptyPaint, type PaintSize, type PitchPaint, type PxPt } from '../pitch/shapes'
import { curveMid, densifyQuad, pointBackFromEnd, polylineLength, trimEnd } from './curve'
import { catmullRom } from './simplify'

export type ScreenToolAnnotation = Spotlight | Curve | Pen | Zone | Loupe | Chain

export const SCREEN_TOOL_TYPES = ['spot', 'curve', 'pen', 'zone', 'loupe', 'chain'] as const

export const isScreenTool = (a: { type: string }): a is ScreenToolAnnotation =>
  (SCREEN_TOOL_TYPES as readonly string[]).includes(a.type)

const px = (p: { x: number; y: number }, size: PaintSize): PxPt => ({
  x: p.x * size.w,
  y: p.y * size.h
})

/** Эллипс в виде многоугольника. */
export function ellipsePolygon(cx: number, cy: number, rx: number, ry: number, n = 72): PxPt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i * 2 * Math.PI) / n
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }
  })
}

/** Прямоугольная лента вокруг отрезка a–b (для попадания курсором по тонкой линии). */
function quad(a: PxPt, b: PxPt, hw: number): PxPt[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return []
  const nx = (-dy / len) * hw
  const ny = (dx / len) * hw
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny }
  ]
}

/** Ленты по звеньям ломаной. */
export function lineHit(points: readonly PxPt[], hw: number, closed = false): PxPt[][] {
  const out: PxPt[][] = []
  const count = closed ? points.length : points.length - 1
  for (let i = 0; i < count; i += 1) {
    const q = quad(points[i], points[(i + 1) % points.length], hw)
    if (q.length > 0) out.push(q)
  }
  return out
}

/** Наконечник стрелки (как у обычной стрелки: растёт с толщиной, не больше 60% длины). */
function headFor(line: readonly PxPt[], widthPx: number): { head: PxPt[]; shaft: PxPt[] } | null {
  const len = polylineLength(line)
  if (len === 0) return null
  const headLength = Math.min(Math.max(widthPx * 3.6, 16), len * 0.6)
  const tip = line[line.length - 1]
  const from = pointBackFromEnd(line, headLength)
  const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1
  const ux = (tip.x - from.x) / d
  const uy = (tip.y - from.y) / d
  const half = headLength * 0.5
  const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength }
  return {
    head: [
      tip,
      { x: base.x - uy * half, y: base.y + ux * half },
      { x: base.x + uy * half, y: base.y - ux * half }
    ],
    // Линия заходит под наконечник, чтобы между ними не было щели.
    shaft: trimEnd(line, headLength * 0.7)
  }
}

function nodesOf(points: readonly PxPt[], size: PaintSize): { nodes: PxPt[]; radius: number } {
  return { nodes: [...points], radius: Math.max(4, size.h / 110) }
}

export function paintScreenTool(a: ScreenToolAnnotation, size: PaintSize): PitchPaint {
  const out = emptyPaint()
  const w = Math.max(1, a.style.width * size.h)
  const dashed = a.style.dash === 'dashed'
  const tol = Math.max(w / 2, 2)

  if (a.type === 'spot') {
    const p1 = px(a.p1, size)
    const p2 = px(a.p2, size)
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2
    const rx = Math.max(Math.abs(p2.x - p1.x) / 2, 1)
    const ry = Math.max(Math.abs(p2.y - p1.y) / 2, 1)
    const poly = ellipsePolygon(cx, cy, rx, ry)
    out.lit.push(poly)
    out.strokes.push({ points: poly, closed: true, widthPx: Math.max(1.5, w * 0.7), dashed: false })
    out.hit = [poly]
    const x0 = Math.min(p1.x, p2.x)
    const x1 = Math.max(p1.x, p2.x)
    const y0 = Math.min(p1.y, p2.y)
    const y1 = Math.max(p1.y, p2.y)
    out.handles = [
      { id: 'nw', point: { x: x0, y: y0 } },
      { id: 'ne', point: { x: x1, y: y0 } },
      { id: 'se', point: { x: x1, y: y1 } },
      { id: 'sw', point: { x: x0, y: y1 } }
    ]
  } else if (a.type === 'curve') {
    const p1 = px(a.p1, size)
    const p2 = px(a.p2, size)
    const c = px(a.c, size)
    const line = densifyQuad(p1, c, p2, 48)
    const parts = headFor(line, w)
    if (parts) {
      out.body.push(parts.head)
      out.strokes.push({ points: parts.shaft, closed: false, widthPx: w, dashed })
      out.hit = [...lineHit(line, tol), parts.head]
    }
    out.handles = [
      { id: 'p1', point: p1 },
      { id: 'p2', point: p2 },
      { id: 'c', point: curveMid(p1, c, p2) }
    ]
  } else if (a.type === 'pen') {
    const pts = catmullRom(
      a.points.map((p) => px(p, size)),
      6
    )
    const parts = a.arrow ? headFor(pts, w) : null
    if (parts) out.body.push(parts.head)
    out.strokes.push({ points: parts ? parts.shaft : pts, closed: false, widthPx: w, dashed })
    out.hit = [...lineHit(pts, tol), ...(parts ? [parts.head] : [])]
  } else if (a.type === 'zone') {
    const pts = a.points.map((p) => px(p, size))
    out.fills.push(pts)
    out.fillOpacity = a.opacity
    out.strokes.push({ points: pts, closed: true, widthPx: w, dashed })
    out.hit = [pts]
    out.handles = pts.map((p, i) => ({ id: `v${i}`, point: p }))
  } else if (a.type === 'chain') {
    const pts = a.points.map((p) => px(p, size))
    if (a.fill && pts.length >= 3) {
      out.fills.push(pts)
      out.fillOpacity = 0.24
    }
    out.strokes.push({ points: pts, closed: false, widthPx: w, dashed })
    const nodes = nodesOf(pts, size)
    out.nodes = nodes.nodes
    out.nodeRadius = nodes.radius
    out.hit = [
      ...lineHit(pts, Math.max(tol, 3)),
      ...pts.map((p) => ellipsePolygon(p.x, p.y, nodes.radius, nodes.radius, 12)),
      ...(a.fill && pts.length >= 3 ? [pts] : [])
    ]
    out.handles = pts.map((p, i) => ({ id: `v${i}`, point: p }))
  } else {
    // loupe
    const lens = px(a.pos, size)
    const src = px(a.src, size)
    const r = a.radius * size.h
    const sr = r / a.zoom
    const dist = Math.hypot(lens.x - src.x, lens.y - src.y)
    let connector: [PxPt, PxPt] | null = null
    if (dist > r + sr + 2) {
      const ux = (src.x - lens.x) / dist
      const uy = (src.y - lens.y) / dist
      connector = [
        { x: lens.x + ux * r, y: lens.y + uy * r },
        { x: src.x - ux * sr, y: src.y - uy * sr }
      ]
    }
    out.lens = { cx: lens.x, cy: lens.y, r, sx: src.x, sy: src.y, sr, connector }
    out.hit = [
      ellipsePolygon(lens.x, lens.y, r + w / 2, r + w / 2, 48),
      ellipsePolygon(src.x, src.y, Math.max(sr, 5), Math.max(sr, 5), 24),
      ...(connector ? lineHit(connector, Math.max(tol, 3)) : [])
    ]
    out.handles = [
      { id: 'src', point: src },
      { id: 'lens', point: { x: lens.x, y: lens.y - r } },
      { id: 'size', point: { x: lens.x + r, y: lens.y } }
    ]
  }

  out.visible = true
  return out
}
