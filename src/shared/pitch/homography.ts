// Гомография «плоскость поля (метры) → картинка видео (0..1)» по соответствиям точек (нормализованный DLT).
// Чистые функции: без интерфейса и без внешних библиотек.
import { cond3, inv3, jacobiEigen, mul3, type Mat3, type Pt } from './linalg'

export type { Mat3, Pt } from './linalg'

export interface Correspondence {
  /** Точка на поле, метры. */
  world: Pt
  /** Та же точка на картинке: доли ширины/высоты кадра (0..1; за кадром — вне 0..1). */
  image: Pt
}

export type HomographyErrorCode =
  | 'too-few-points'
  | 'bad-number'
  | 'duplicate-points'
  | 'collinear'
  | 'tiny-area'
  | 'ill-conditioned'
  | 'behind-camera'
  | 'twisted-order'
  | 'singular'

export type HomographyResult =
  { ok: true; H: Mat3 } | { ok: false; code: HomographyErrorCode; detail?: string }

/** Площадь (в единицах «высота кадра = 1»), меньше которой точки считаются слишком кучными. */
export const MIN_IMAGE_AREA = 0.002
/** Точки ближе этого расстояния (в долях высоты кадра) считаются одной точкой. */
export const MIN_POINT_DISTANCE = 0.0015
/** Тройка точек почти на одной прямой, если 2·площадь / (большая сторона)² меньше этого числа. */
export const COLLINEAR_RATIO = 0.004
/** Для проверки порядка точек берутся только заметно «толстые» тройки. */
const ORIENTATION_RATIO = 0.03
const MAX_COND = 1e5

const cross = (a: Pt, b: Pt, c: Pt): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** Относительная «толщина» тройки точек: 2·площадь / (длина большей стороны)². 0 — на одной прямой. */
function thinness(a: Pt, b: Pt, c: Pt): number {
  const d = Math.max(
    Math.hypot(b.x - a.x, b.y - a.y),
    Math.hypot(c.x - b.x, c.y - b.y),
    Math.hypot(a.x - c.x, a.y - c.y)
  )
  if (d === 0) return 0
  return Math.abs(cross(a, b, c)) / (d * d)
}

/** Площадь выпуклой оболочки (в тех же единицах, что и точки). */
export function hullArea(points: readonly Pt[]): number {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return 0
  const half = (list: Pt[]): Pt[] => {
    const h: Pt[] = []
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop()
      h.push(q)
    }
    h.pop()
    return h
  }
  const hull = [...half(p), ...half([...p].reverse())]
  let area = 0
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

function normalization(points: readonly Pt[]): { T: Mat3; pts: Pt[] } {
  const n = points.length
  const cx = points.reduce((s, p) => s + p.x, 0) / n
  const cy = points.reduce((s, p) => s + p.y, 0) / n
  const mean = points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n
  const s = mean > 0 ? Math.SQRT2 / mean : 1
  return {
    T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1],
    pts: points.map((p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) }))
  }
}

/** Все ли тройки точек ориентированы одинаково (с учётом общего знака) — иначе точки отмечены «крест-накрест». */
function orientationsConsistent(world: readonly Pt[], image: readonly Pt[]): boolean {
  const n = world.length
  if (n > 14) return true
  let sign = 0
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      for (let k = j + 1; k < n; k += 1) {
        // Почти вырожденные тройки пропускаем: при неточной отметке их ориентация легко «переворачивается».
        if (thinness(world[i], world[j], world[k]) < ORIENTATION_RATIO) continue
        if (thinness(image[i], image[j], image[k]) < ORIENTATION_RATIO) continue
        const s =
          Math.sign(cross(world[i], world[j], world[k])) *
          Math.sign(cross(image[i], image[j], image[k]))
        if (sign === 0) sign = s
        else if (s !== sign) return false
      }
    }
  }
  return true
}

/** Значение w при проекции точки поля матрицей H (знак w показывает, перед камерой точка или за ней). */
export function wOf(H: Mat3, p: Pt): number {
  return H[6] * p.x + H[7] * p.y + H[8]
}

/** Проекция точки поля на картинку (0..1). null — точка на линии горизонта или за камерой. */
export function applyH(H: Mat3, p: Pt): Pt | null {
  const w = wOf(H, p)
  if (!(w > 1e-12)) return null
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w }
}

/**
 * Гомография по N ≥ 4 парам точек (метод наименьших квадратов, нормализация Хартли).
 * aspect — ширина/высота кадра: ошибка минимизируется в «квадратных» единицах, а не в долях сторон.
 * Возвращает H так, что (x, y, 1) на поле → (u·w, v·w, w) на картинке в долях кадра.
 */
export function fitHomography(pairs: readonly Correspondence[], aspect = 1): HomographyResult {
  const n = pairs.length
  if (n < 4) return { ok: false, code: 'too-few-points' }
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
  for (const c of pairs) {
    if (![c.world.x, c.world.y, c.image.x, c.image.y].every(Number.isFinite)) {
      return { ok: false, code: 'bad-number' }
    }
  }
  const world = pairs.map((c) => c.world)
  // Картинка в «квадратных» единицах: высота кадра = 1.
  const image = pairs.map((c) => ({ x: c.image.x * a, y: c.image.y }))

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (
        Math.hypot(image[i].x - image[j].x, image[i].y - image[j].y) < MIN_POINT_DISTANCE ||
        Math.hypot(world[i].x - world[j].x, world[i].y - world[j].y) < 1e-6
      ) {
        return { ok: false, code: 'duplicate-points', detail: `${i + 1},${j + 1}` }
      }
    }
  }
  if (hullArea(image) < MIN_IMAGE_AREA) return { ok: false, code: 'tiny-area' }
  if (n === 4) {
    for (const [i, j, k] of [
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3]
    ]) {
      if (
        thinness(image[i], image[j], image[k]) < COLLINEAR_RATIO ||
        thinness(world[i], world[j], world[k]) < COLLINEAR_RATIO
      ) {
        return { ok: false, code: 'collinear' }
      }
    }
  }

  const nw = normalization(world)
  const ni = normalization(image)
  const ata: number[] = new Array(81).fill(0)
  const addRow = (row: number[]): void => {
    for (let i = 0; i < 9; i += 1) {
      for (let j = 0; j < 9; j += 1) ata[i * 9 + j] += row[i] * row[j]
    }
  }
  for (let k = 0; k < n; k += 1) {
    const { x, y } = nw.pts[k]
    const { x: u, y: v } = ni.pts[k]
    addRow([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
    addRow([0, 0, 0, -x, -y, -1, v * x, v * y, v])
  }
  const eig = jacobiEigen(ata, 9)
  const largest = eig.values[8]
  if (!(largest > 0)) return { ok: false, code: 'singular' }
  // Нулевое пространство должно быть одномерным; иначе точки расположены вырожденно (например, все на одной прямой).
  if (eig.values[1] / largest < 1e-9) return { ok: false, code: 'collinear' }
  const Hn = eig.vectors[0] as unknown as Mat3
  if (cond3(Hn) > MAX_COND) return { ok: false, code: 'ill-conditioned' }

  const tiInv = inv3(ni.T)
  if (!tiInv) return { ok: false, code: 'singular' }
  // hSq = Ti⁻¹ · Hn · Tw — гомография в «квадратных» единицах; затем возвращаем доли ширины: u = u_sq / aspect.
  const hSq = mul3(mul3(tiInv, Hn), nw.T)
  const hFull: Mat3 = [
    hSq[0] / a,
    hSq[1] / a,
    hSq[2] / a,
    hSq[3],
    hSq[4],
    hSq[5],
    hSq[6],
    hSq[7],
    hSq[8]
  ]
  const norm = Math.sqrt(hFull.reduce((s, v) => s + v * v, 0))
  if (!(norm > 0) || !Number.isFinite(norm)) return { ok: false, code: 'singular' }
  const cx = world.reduce((s, p) => s + p.x, 0) / n
  const cy = world.reduce((s, p) => s + p.y, 0) / n
  const sign = wOf(hFull, { x: cx, y: cy }) < 0 ? -1 : 1
  const H = hFull.map((v) => (v / norm) * sign) as unknown as Mat3

  // Точки отмечены крест-накрест: порядок троек на картинке не совпадает с порядком на поле.
  if (!orientationsConsistent(world, image)) return { ok: false, code: 'twisted-order' }
  // Все точки должны быть перед камерой (w одного знака).
  for (const p of world) {
    if (!(wOf(H, p) > 1e-9)) return { ok: false, code: 'behind-camera' }
  }
  return { ok: true, H }
}

/** Ошибка в пикселях для каждой точки: расстояние между отмеченной точкой и проекцией точки поля. */
export function reprojectionErrors(
  H: Mat3,
  pairs: readonly Correspondence[],
  size: { w: number; h: number }
): number[] {
  return pairs.map((c) => {
    const q = applyH(H, c.world)
    if (!q) return Infinity
    return Math.hypot((q.x - c.image.x) * size.w, (q.y - c.image.y) * size.h)
  })
}

export function rms(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length)
}
