// Перо: упрощение нарисованной от руки линии (Рамер — Дуглас — Пекер) и сглаживание (Катмулл — Ром, Чайкин).
import type { Pt2 } from './curve'

function distToSegment(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Упрощение ломаной: остаются точки, без которых линия отклонится больше чем на eps. Концы сохраняются. */
export function rdp(points: readonly Pt2[], eps: number): Pt2[] {
  const n = points.length
  if (n <= 2) return [...points]
  const keep = new Array<boolean>(n).fill(false)
  keep[0] = true
  keep[n - 1] = true
  // Без рекурсии: у длинной линии стек глубоким не будет.
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!
    let far = -1
    let farDist = eps
    for (let i = lo + 1; i < hi; i += 1) {
      const d = distToSegment(points[i], points[lo], points[hi])
      if (d > farDist) {
        farDist = d
        far = i
      }
    }
    if (far !== -1) {
      keep[far] = true
      stack.push([lo, far], [far, hi])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Выбрасывает точки ближе minDist к предыдущей; последняя точка штриха сохраняется. */
export function dropClose(points: readonly Pt2[], minDist: number): Pt2[] {
  const out: Pt2[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p)
  }
  const end = points[points.length - 1]
  if (end && out.length > 0 && out[out.length - 1] !== end) {
    const last = out[out.length - 1]
    if (out.length > 1 && Math.hypot(end.x - last.x, end.y - last.y) < minDist) {
      out[out.length - 1] = end
    } else {
      out.push(end)
    }
  }
  return out
}

/**
 * Упрощение штриха пера: eps — допуск (в тех же единицах, что и точки); если точек всё равно больше max,
 * допуск растёт, пока не уложимся.
 */
export function simplifyStroke(points: readonly Pt2[], eps: number, max: number): Pt2[] {
  let tol = eps
  let out = rdp(dropClose(points, eps * 0.5), tol)
  while (out.length > max && tol < 1e9) {
    tol *= 1.5
    out = rdp(out, tol)
  }
  return out
}

/** Сглаживание Чайкина: углы срезаются, концы остаются на месте. */
export function chaikin(points: readonly Pt2[], iterations = 2): Pt2[] {
  let pts = [...points]
  for (let it = 0; it < iterations && pts.length > 2; it += 1) {
    const next: Pt2[] = [pts[0]]
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]
      const b = pts[i + 1]
      next.push(
        { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
        { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y }
      )
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  return pts
}

const lerp = (a: Pt2, b: Pt2, t: number): Pt2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
})

/**
 * Кривая Катмулл — Рома (центрипетальная, без петель) через все точки: на каждое звено perSegment точек.
 * Первая и последняя точки сохраняются.
 */
export function catmullRom(points: readonly Pt2[], perSegment = 8): Pt2[] {
  const n = points.length
  if (n < 3) return [...points]
  const pad = (a: Pt2, b: Pt2): Pt2 => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y })
  const ext = [pad(points[0], points[1]), ...points, pad(points[n - 1], points[n - 2])]
  const out: Pt2[] = [points[0]]
  const knot = (a: Pt2, b: Pt2): number => Math.max(Math.hypot(b.x - a.x, b.y - a.y) ** 0.5, 1e-6)
  for (let i = 1; i < ext.length - 2; i += 1) {
    const p0 = ext[i - 1]
    const p1 = ext[i]
    const p2 = ext[i + 1]
    const p3 = ext[i + 2]
    const t0 = 0
    const t1 = t0 + knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    for (let k = 1; k <= perSegment; k += 1) {
      const t = t1 + ((t2 - t1) * k) / perSegment
      const a1 = lerp(p0, p1, (t - t0) / (t1 - t0))
      const a2 = lerp(p1, p2, (t - t1) / (t2 - t1))
      const a3 = lerp(p2, p3, (t - t2) / (t3 - t2))
      const b1 = lerp(a1, a2, (t - t0) / (t2 - t0))
      const b2 = lerp(a2, a3, (t - t1) / (t3 - t1))
      out.push(lerp(b1, b2, (t - t1) / (t2 - t1)))
    }
  }
  return out
}
