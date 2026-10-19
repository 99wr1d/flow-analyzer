// Проекция «поле ↔ картинка» и отсечение фигур по линии горизонта.
// Точка поля с w ≤ 0 лежит за камерой или в её плоскости (линия w = 0 на поле переходит в «бесконечно далёкую» линию
// картинки): проецировать её нельзя. Поэтому фигуры на поле сначала обрезаются в МЕТРАХ полуплоскостью «w ≥ W_MIN»
// (чуть не доходя до этой линии) и только потом проецируются. Сам горизонт кадра — образ бесконечно далёких точек поля.
import { inv3, type Mat3, type Pt } from './linalg'

/** Наименьшее допустимое w (H нормирована так, что у точки под центром кадра w = 1). */
export const W_MIN = 0.05
/** Точки земли дальше этих границ (метры) не принимаются: клик у самого горизонта даёт абсурдные координаты. */
export const WORLD_LIMIT = { minX: -80, maxX: 200, minY: -80, maxY: 160 }

/** Полуплоскость в координатах поля: остаётся a·x + b·y + c ≥ 0. */
export interface HalfPlane {
  a: number
  b: number
  c: number
}

const side = (hp: HalfPlane, p: Pt): number => hp.a * p.x + hp.b * p.y + hp.c

function crossPoint(p: Pt, q: Pt, sp: number, sq: number): Pt {
  const t = sp / (sp - sq)
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
}

/** Отсечение многоугольника (метод Сазерленда — Ходжмена по одной полуплоскости). Пустой массив — ничего не осталось. */
export function clipPolygon(poly: readonly Pt[], hp: HalfPlane): Pt[] {
  const out: Pt[] = []
  const n = poly.length
  for (let i = 0; i < n; i += 1) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const sc = side(hp, cur)
    const sp = side(hp, prev)
    if (sc >= 0) {
      if (sp < 0) out.push(crossPoint(prev, cur, sp, sc))
      out.push(cur)
    } else if (sp >= 0) {
      out.push(crossPoint(prev, cur, sp, sc))
    }
  }
  return out.length >= 3 ? out : []
}

/** Отсечение ломаной: список кусков, оставшихся в полуплоскости. */
export function clipPolyline(points: readonly Pt[], hp: HalfPlane): Pt[][] {
  const pieces: Pt[][] = []
  let current: Pt[] = []
  const flush = (): void => {
    if (current.length >= 2) pieces.push(current)
    current = []
  }
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]
    const sp = side(hp, p)
    if (i === 0) {
      if (sp >= 0) current.push(p)
      continue
    }
    const q = points[i - 1]
    const sq = side(hp, q)
    if (sp >= 0 && sq >= 0) {
      current.push(p)
    } else if (sp >= 0 && sq < 0) {
      current.push(crossPoint(q, p, sq, sp), p)
    } else if (sp < 0 && sq >= 0) {
      current.push(crossPoint(q, p, sq, sp))
      flush()
    }
  }
  flush()
  return pieces
}

export interface Projector {
  /** Матрица поле → картинка (доли кадра), нормированная так, что у точки под центром кадра w = 1. */
  H: Mat3
  Hinv: Mat3
  /** Полуплоскость в метрах, в которой проекция безопасна. */
  halfPlane: HalfPlane
  /** Линия горизонта на картинке: a·u + b·v + c = 0 (u, v — доли кадра). */
  horizon: HalfPlane
  /** w точки поля (больше 0 — перед камерой). */
  w: (p: Pt) => number
  /** Точка поля → картинка (доли кадра). null — слишком близко к горизонту или за камерой. */
  toImage: (p: Pt) => Pt | null
  /** Точка картинки → точка поля (метры). null — выше горизонта или слишком далеко. */
  toWorld: (p: Pt) => Pt | null
  /** Ломаная в метрах → куски ломаной на картинке (обрезано по горизонту). */
  projectPolyline: (world: readonly Pt[]) => Pt[][]
  /** Многоугольник в метрах → многоугольник на картинке (пусто, если целиком за горизонтом). */
  projectPolygon: (world: readonly Pt[]) => Pt[]
}

/** Строит проектор по матрице. null — матрица вырождена. */
export function makeProjector(matrix: Mat3): Projector | null {
  const firstInv = inv3(matrix)
  if (!firstInv) return null
  // Нормировка: w под центром кадра равна 1 (знак H не меняем — перед камерой w > 0).
  let H = matrix
  const z = firstInv[6] * 0.5 + firstInv[7] * 0.5 + firstInv[8]
  const wCenter = z !== 0 ? 1 / z : 0
  if (Number.isFinite(wCenter) && wCenter > 0) {
    H = matrix.map((v) => v / wCenter) as unknown as Mat3
  }
  const Hinv = inv3(H)
  if (!Hinv) return null

  const w = (p: Pt): number => H[6] * p.x + H[7] * p.y + H[8]
  const halfPlane: HalfPlane = { a: H[6], b: H[7], c: H[8] - W_MIN }
  const toImage = (p: Pt): Pt | null => {
    const ww = w(p)
    if (!(ww >= W_MIN)) return null
    return { x: (H[0] * p.x + H[1] * p.y + H[2]) / ww, y: (H[3] * p.x + H[4] * p.y + H[5]) / ww }
  }
  const toWorld = (p: Pt): Pt | null => {
    const X = Hinv[0] * p.x + Hinv[1] * p.y + Hinv[2]
    const Y = Hinv[3] * p.x + Hinv[4] * p.y + Hinv[5]
    const Z = Hinv[6] * p.x + Hinv[7] * p.y + Hinv[8]
    // w точки поля = 1 / Z: нужен Z > 0 и не слишком большой.
    if (!(Z > 0) || !(1 / Z >= W_MIN)) return null
    const world = { x: X / Z, y: Y / Z }
    if (
      world.x < WORLD_LIMIT.minX ||
      world.x > WORLD_LIMIT.maxX ||
      world.y < WORLD_LIMIT.minY ||
      world.y > WORLD_LIMIT.maxY
    ) {
      return null
    }
    return world
  }
  const mapAll = (points: readonly Pt[]): Pt[] =>
    points.map((p) => toImage(p)).filter((p): p is Pt => p !== null)
  return {
    H,
    Hinv,
    halfPlane,
    horizon: { a: Hinv[6], b: Hinv[7], c: Hinv[8] },
    w,
    toImage,
    toWorld,
    projectPolyline: (world) => clipPolyline(world, halfPlane).map(mapAll),
    projectPolygon: (world) => mapAll(clipPolygon(world, halfPlane))
  }
}
