// Зона и связи игроков: площадь, внутренняя точка для подписи, правила замыкания и вставки вершин.
import type { Pt2 } from './curve'

/** Площадь со знаком по формуле шнуровки (против часовой стрелки — плюс). */
export function signedArea(points: readonly Pt2[]): number {
  let a = 0
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Площадь многоугольника (в единицах координат в квадрате; для метров — м²). Подходит и для невыпуклых. */
export const polygonArea = (points: readonly Pt2[]): number => Math.abs(signedArea(points))

export function pointInPolygon(p: Pt2, poly: readonly Pt2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Центр масс многоугольника. */
export function centroid(points: readonly Pt2[]): Pt2 {
  const a = signedArea(points)
  if (Math.abs(a) < 1e-12) {
    const n = Math.max(points.length, 1)
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n
    }
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    const cross = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * cross
    cy += (p.y + q.y) * cross
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

/** Точка, которая гарантированно лежит внутри многоугольника (центр масс, а у «подковы» — середина самого широкого сечения). */
export function interiorPoint(points: readonly Pt2[]): Pt2 {
  const c = centroid(points)
  if (pointInPolygon(c, points)) return c
  const xs: number[] = []
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (a.y > c.y !== b.y > c.y) xs.push(a.x + ((c.y - a.y) * (b.x - a.x)) / (b.y - a.y))
  }
  xs.sort((p, q) => p - q)
  let best = { from: c.x, to: c.x }
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > best.to - best.from) best = { from: xs[i], to: xs[i + 1] }
  }
  return { x: (best.from + best.to) / 2, y: c.y }
}

/** Можно ли замкнуть зону: нужно не меньше трёх вершин, не лежащих на одной прямой. */
export function canClosePolygon(points: readonly Pt2[], minArea = 1e-9): boolean {
  return points.length >= 3 && polygonArea(points) > minArea
}

/** Связь можно завершить, когда есть хотя бы два различных узла. */
export function canFinishChain(points: readonly Pt2[], minDist = 1e-9): boolean {
  return (
    points.length >= 2 &&
    points.some((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y) > minDist)
  )
}

/** Вершины с новой точкой: точка, совпадающая с последней (двойной щелчок), не добавляется. */
export function pushVertex(points: readonly Pt2[], p: Pt2, minDist: number): Pt2[] {
  const last = points[points.length - 1]
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minDist) return [...points]
  return [...points, p]
}

/** Ближайшая точка отрезка a–b к p и доля пути t (0..1). */
export function nearestOnSegment(p: Pt2, a: Pt2, b: Pt2): { point: Pt2; t: number; dist: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const point = { x: a.x + dx * t, y: a.y + dy * t }
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) }
}

/**
 * Куда вставить новую вершину при щелчке с Alt: ближайшее звено ломаной (closed — с замыкающим звеном).
 * Возвращает индекс, который займёт новая вершина, и её положение на звене; null — если звеньев нет.
 */
export function insertionPoint(
  points: readonly Pt2[],
  p: Pt2,
  closed: boolean
): { index: number; point: Pt2; dist: number } | null {
  const count = closed ? points.length : points.length - 1
  let best: { index: number; point: Pt2; dist: number } | null = null
  for (let i = 0; i < count; i += 1) {
    const hit = nearestOnSegment(p, points[i], points[(i + 1) % points.length])
    if (!best || hit.dist < best.dist) best = { index: i + 1, point: hit.point, dist: hit.dist }
  }
  return best
}

/** Копия без вершины index; null — если после удаления останется меньше min вершин. */
export function removeVertex(points: readonly Pt2[], index: number, min: number): Pt2[] | null {
  if (index < 0 || index >= points.length || points.length - 1 < min) return null
  return points.filter((_, i) => i !== index)
}
