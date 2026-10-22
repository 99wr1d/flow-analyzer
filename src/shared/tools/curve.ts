// Изогнутая стрелка: квадратичная кривая Безье p0 → p1 с управляющей точкой c.
// Чистая геометрия: работает и в долях кадра, и в пикселях, и в метрах.
export interface Pt2 {
  x: number
  y: number
}

/** Точка кривой при t от 0 до 1. */
export function quadPoint(p0: Pt2, c: Pt2, p1: Pt2, t: number): Pt2 {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y
  }
}

/** Ломаная из n + 1 точек вдоль кривой (первая — p0, последняя — p1). */
export function densifyQuad(p0: Pt2, c: Pt2, p1: Pt2, n = 40): Pt2[] {
  const count = Math.max(2, Math.round(n))
  return Array.from({ length: count + 1 }, (_, i) => quadPoint(p0, c, p1, i / count))
}

/** Середина кривой (t = 0.5): за неё пользователь тянет, чтобы изогнуть стрелку. */
export const curveMid = (p0: Pt2, c: Pt2, p1: Pt2): Pt2 => quadPoint(p0, c, p1, 0.5)

/** Точки, по которым считается рамка кривой: концы и крайние точки по каждой оси (а не управляющая точка вне кривой). */
export function curveExtent(p0: Pt2, c: Pt2, p1: Pt2): Pt2[] {
  const out = [p0, p1]
  const axis = (a: number, b: number, d: number): number | null => {
    const den = a - 2 * b + d
    if (Math.abs(den) < 1e-12) return null
    const t = (a - b) / den
    return t > 0 && t < 1 ? t : null
  }
  for (const t of [axis(p0.x, c.x, p1.x), axis(p0.y, c.y, p1.y)]) {
    if (t !== null) out.push(quadPoint(p0, c, p1, t))
  }
  return out
}

/** Управляющая точка, при которой кривая проходит через mid в середине: c = 2·mid − (p0 + p1) / 2. */
export function controlFromMid(p0: Pt2, mid: Pt2, p1: Pt2): Pt2 {
  return { x: 2 * mid.x - (p0.x + p1.x) / 2, y: 2 * mid.y - (p0.y + p1.y) / 2 }
}

/**
 * Управляющая точка новой стрелки: середина отрезка, сдвинутая в сторону на bend × длины.
 * scale — размеры кадра: сдвиг считается в пикселях, чтобы изгиб был одинаковым по горизонтали и вертикали.
 */
export function defaultControl(
  p0: Pt2,
  p1: Pt2,
  bend = 0.35,
  scale: { w: number; h: number } = { w: 1, h: 1 }
): Pt2 {
  const dx = (p1.x - p0.x) * scale.w
  const dy = (p1.y - p0.y) * scale.h
  // Нормаль слева от направления; для кривой, идущей слева направо, изгиб получается вверх.
  const nx = dy * bend
  const ny = -dx * bend
  return {
    x: (p0.x + p1.x) / 2 + nx / scale.w,
    y: (p0.y + p1.y) / 2 + ny / scale.h
  }
}

/** Длина ломаной. */
export function polylineLength(points: readonly Pt2[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i += 1) {
    sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return sum
}

/** Ломаная без последних `cut` единиц длины (для линии, которая заканчивается у основания наконечника). */
export function trimEnd(points: readonly Pt2[], cut: number): Pt2[] {
  const out = [...points]
  let left = cut
  while (out.length >= 2 && left > 0) {
    const a = out[out.length - 2]
    const b = out[out.length - 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= left + 1e-12) {
      out.pop()
      left -= len
    } else {
      const t = (len - left) / len
      out[out.length - 1] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      left = 0
    }
  }
  return out
}

/** Точка на расстоянии dist от конца ломаной (назад по ломаной); нужна для направления наконечника. */
export function pointBackFromEnd(points: readonly Pt2[], dist: number): Pt2 {
  let left = dist
  for (let i = points.length - 1; i >= 1; i -= 1) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len >= left) {
      const t = len === 0 ? 0 : left / len
      return { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t }
    }
    left -= len
  }
  return points[0]
}

/** Штрихи вдоль ломаной: список кусков ломаной длиной dash с промежутками gap. */
export function dashPolyline(points: readonly Pt2[], dash: number, gap: number): Pt2[][] {
  const out: Pt2[][] = []
  if (points.length < 2 || dash <= 0) return out
  let drawing = true
  let left = dash
  let current: Pt2[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    let a = points[i - 1]
    const b = points[i]
    let len = Math.hypot(b.x - a.x, b.y - a.y)
    while (len > left + 1e-12) {
      const t = left / len
      const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      if (drawing) {
        current.push(cut)
        out.push(current)
        current = []
      } else {
        current = [cut]
      }
      drawing = !drawing
      len -= left
      left = drawing ? dash : gap
      a = cut
    }
    left -= len
    if (drawing) current.push(b)
  }
  if (drawing && current.length >= 2) out.push(current)
  return out
}

/** Шаг между центрами точек пунктира «точки», в толщинах линии. */
export const DOT_STEP = 2.5
/** Предел числа точек на одном рисунке: огромное перо не должно подвесить отрисовку. */
export const MAX_DOTS = 800

/**
 * Раскладка точек по линии длины length: сколько промежутков и какой между ними шаг.
 * Точки ложатся поровну и всегда на оба конца (замкнутая — без повтора первой), поэтому даже у самой короткой линии их хотя бы две.
 */
export function dotLayout(
  length: number,
  step: number,
  closed = false,
  /** Предел числа промежутков: нужен многоугольникам-точкам на поле; штриховка SVG (экран) его не знает. */
  maxGaps = MAX_DOTS
): { gaps: number; spacing: number } {
  if (!(length > 0) || !(step > 0)) return { gaps: 1, spacing: 0 }
  const want = Math.round(length / step)
  const gaps = Math.min(maxGaps, closed ? Math.max(3, want) : Math.max(1, want))
  return { gaps, spacing: length / gaps }
}

/** Центры точек вдоль ломаной (для рисунков, где точки — отдельные многоугольники, например на поле). */
export function dotsAlong(points: readonly Pt2[], step: number, closed = false): Pt2[] {
  const line = closed && points.length > 0 ? [...points, points[0]] : points
  let total = 0
  for (let i = 1; i < line.length; i += 1)
    total += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y)
  if (!(total > 0)) return []
  const { gaps, spacing } = dotLayout(total, step, closed)
  const count = closed ? gaps : gaps + 1
  const out: Pt2[] = []
  let seg = 1
  let walked = 0 // длина до начала звена seg - 1
  for (let k = 0; k < count; k += 1) {
    const target = Math.min(k * spacing, total)
    while (seg < line.length - 1) {
      const len = Math.hypot(line[seg].x - line[seg - 1].x, line[seg].y - line[seg - 1].y)
      if (walked + len >= target) break
      walked += len
      seg += 1
    }
    const a = line[seg - 1]
    const b = line[seg]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const t = len === 0 ? 0 : Math.min(1, Math.max(0, (target - walked) / len))
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return out
}

/**
 * Начало ломаной длиной length (проявление линии: путь обрезается по длине, а не штриховкой).
 * length ≤ 0 — пусто; length ≥ длины ломаной — вся ломаная. Узлы до места среза сохраняются как есть.
 */
export function polylinePrefix(points: readonly Pt2[], length: number): Pt2[] {
  if (points.length === 0 || !(length > 0)) return []
  const out: Pt2[] = [points[0]]
  let left = length
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= left) {
      out.push(b)
      left -= len
    } else {
      const t = left / len
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      return out
    }
  }
  return out
}
