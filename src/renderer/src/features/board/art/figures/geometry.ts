/** Геометрия рисунков фигур: векторы, проекция поворота с наклоном камеры, выпуклые оболочки. */

export type V3 = readonly [number, number, number]

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
export const lerp = (a: V3, b: V3, t: number): V3 => add(a, mul(sub(b, a), t))
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Наклон камеры: ближнее к нам на столько опускается на экране от единицы глубины. */
export const TILT = 0.2

export type Pt = [number, number]

/** Готовая фигура: цвета пока ключами, подставляются из формы при рисовании. */
export type Prim =
  | { k: 'path'; d: string; fill: string; stroke?: string; sw?: number; op?: number }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; op?: number }
  | { k: 'text'; x: number; y: number; sx: number; text: string; fill: string; size: number }

export interface Projector {
  (p: V3): Pt
  depth(p: V3): number
  /** Глубинная составляющая направления (+ — на нас). */
  dz(dir: V3): number
  yaw: number
}

export function projector(yaw: number): Projector {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const depth = (p: V3): number => -p[0] * s + p[2] * c
  const f = ((p: V3): Pt => [p[0] * c + p[2] * s, p[1] + depth(p) * TILT]) as Projector
  f.depth = depth
  f.dz = depth
  f.yaw = yaw
  return f
}

// ——— выпуклая оболочка ———
export function hull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const crossZ = (o: Pt, a: Pt, b: Pt): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

export const r1 = (n: number): string => (Math.round(n * 10) / 10).toString()

export function pathOf(poly: Pt[]): string {
  if (poly.length === 0) return ''
  return 'M' + poly.map((p) => r1(p[0]) + ' ' + r1(p[1])).join('L') + 'Z'
}

export const SAMPLES = 28
export const UNIT: Pt[] = Array.from({ length: SAMPLES }, (_, i) => {
  const a = (i / SAMPLES) * Math.PI * 2
  return [Math.cos(a), Math.sin(a)]
})

/** Оболочка экранных кругов. */
export function circlesHull(circles: { c: Pt; r: number }[]): Pt[] {
  const pts: Pt[] = []
  for (const { c, r } of circles) for (const u of UNIT) pts.push([c[0] + u[0] * r, c[1] + u[1] * r])
  return hull(pts)
}

/** Куда сдвигается освещённая часть (к свету — влево вверх). */
export const LIGHT: Pt = [-0.82, -0.57]

/** Светлая часть многоугольника: подобие к его верхней левой точке (остаётся внутри). */
export function litPolygon(poly: Pt[], s: number): Pt[] {
  let a = poly[0]
  for (const p of poly) if (p[0] * 0.82 + p[1] * 0.57 < a[0] * 0.82 + a[1] * 0.57) a = p
  return poly.map((p) => [a[0] + (p[0] - a[0]) * s, a[1] + (p[1] - a[1]) * s] as Pt)
}
