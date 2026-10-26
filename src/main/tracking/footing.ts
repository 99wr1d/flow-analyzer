// Точка ног игрока по кадру. Середина нижней кромки рамки детектора уходит от ног у бегущего игрока: рамку растягивают
// поднятая назад нога и руки, и кольцо у ног оказывается «за игроком». Здесь по полосе у низа рамки находится то, что
// стоит на траве (бутсы, гетры), и берётся середина этого по горизонтали. Решения трекера это не меняет: только вывод.
import { rgbToU, rgbToV } from '../../shared/grassKey'

/** Полоса у низа рамки, где ищутся ноги: доля высоты рамки. */
export const FOOT_STRIP = 0.15
/** Насколько дальше от середины рамки может уйти точка ног: доля ширины рамки. */
const MAX_SHIFT = 0.4
/** «Не трава» начинается с такого расстояния до цвета травы (цветность и осветление, доли), полностью — через ещё столько же. */
const NOT_GRASS_FROM = 0.04
const NOT_GRASS_RAMP = 0.04
/** Меньше «ног» (в столбцах полосы) — ноги не видны, остаётся середина рамки. */
const MIN_WEIGHT_COLUMNS = 0.5
/** Строка полосы, где «не травы» меньше стольких пикселей, ногой не считается (шум). */
const MIN_ROW_PIXELS = 1
/** Высота полосы касания над самой нижней строкой с ногами: доля высоты рамки. */
const CONTACT_BAND = 0.04
/** Линия разметки проверяется по строкам ниже рамки: отступ от низа рамки и сколько строк смотреть, пиксели. */
const LINE_GAP = 3
const LINE_PROBE = 4

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/**
 * x ног (пиксели кадра) для рамки box на кадре RGBA w×h. Цвет травы — медиана полосы у низа рамки (ноги в ней — меньшинство);
 * «ногами» считается то, что отличается от травы цветностью или светлее её (тень темнее травы, но той же цветности, — не ноги).
 * Ног не видно — середина рамки.
 */
export function footX(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  box: { x: number; y: number; w: number; h: number }
): number {
  const centre = box.x + box.w / 2
  if (!(box.w > 0) || !(box.h > 0) || rgba.length < w * h * 4) return centre
  const x0 = Math.max(0, Math.floor(box.x))
  const x1 = Math.min(w, Math.ceil(box.x + box.w))
  const yb = Math.min(h, Math.round(box.y + box.h))
  const ya = Math.max(0, yb - Math.max(3, Math.round(box.h * FOOT_STRIP)))
  if (x1 - x0 < 2 || yb - ya < 1) return centre
  // Трава вокруг: та же полоса, по полширины рамки с каждой стороны.
  const gx0 = Math.max(0, Math.floor(box.x - box.w / 2))
  const gx1 = Math.min(w, Math.ceil(box.x + box.w * 1.5))
  const us: number[] = []
  const vs: number[] = []
  const ys: number[] = []
  for (let y = ya; y < yb; y += 1) {
    for (let x = gx0; x < gx1; x += 1) {
      const i = (y * w + x) * 4
      const r = rgba[i]
      const g = rgba[i + 1]
      const b = rgba[i + 2]
      us.push(rgbToU(r, g, b))
      vs.push(rgbToV(r, g, b))
      ys.push(0.299 * r + 0.587 * g + 0.114 * b)
    }
  }
  const gu = median(us)
  const gv = median(vs)
  const gy = median(ys)
  /** Насколько пиксель «не трава»: 0 — трава (или тень на ней), 1 — точно не трава. */
  const notGrass = (x: number, y: number): number => {
    const i = (y * w + x) * 4
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const du = rgbToU(r, g, b) - gu
    const dv = rgbToV(r, g, b) - gv
    const chroma = Math.sqrt((du * du + dv * dv) / (255 * 255 * 2))
    const lighter = Math.max(0, 0.299 * r + 0.587 * g + 0.114 * b - gy) / 255
    const d = Math.max(chroma, lighter)
    return Math.min(1, Math.max(0, (d - NOT_GRASS_FROM) / NOT_GRASS_RAMP))
  }
  // Линии разметки: столбец, где «не трава» продолжается и ниже рамки (ноги кончаются у её низа), и строка, где она идёт
  // за рамку в обе стороны, — это линия, а не ноги.
  const lineColumn = (x: number): boolean => {
    let sum = 0
    let n = 0
    for (let y = yb + LINE_GAP; y < Math.min(h, yb + LINE_GAP + LINE_PROBE); y += 1) {
      sum += notGrass(x, y)
      n += 1
    }
    return n > 0 && sum / n >= 0.5
  }
  const lineRow = (y: number): boolean => {
    let left = 0
    let nl = 0
    for (let x = gx0; x < x0; x += 1) {
      left += notGrass(x, y)
      nl += 1
    }
    let right = 0
    let nr = 0
    for (let x = x1; x < gx1; x += 1) {
      right += notGrass(x, y)
      nr += 1
    }
    return nl > 0 && nr > 0 && left / nl >= 0.5 && right / nr >= 0.5
  }
  const rows = yb - ya
  const rowSum = new Float64Array(rows)
  const rowX = new Float64Array(rows)
  const skipRow = Array.from({ length: rows }, (_, r) => lineRow(ya + r))
  for (let x = x0; x < x1; x += 1) {
    if (lineColumn(x)) continue
    for (let y = ya; y < yb; y += 1) {
      if (skipRow[y - ya]) continue
      const k = notGrass(x, y)
      rowSum[y - ya] += k
      rowX[y - ya] += k * (x + 0.5)
    }
  }
  let total = 0
  for (const s of rowSum) total += s
  if (total < MIN_WEIGHT_COLUMNS * rows) return centre
  // Нога, что стоит на траве, — самая нижняя: середина берётся по самым нижним строкам, где ноги есть (поднятая назад
  // нога выше и в расчёт не входит; обе ноги на земле — середина между ними).
  let lowest = rows - 1
  while (lowest > 0 && rowSum[lowest] < MIN_ROW_PIXELS) lowest -= 1
  const band = Math.max(2, Math.round(box.h * CONTACT_BAND))
  let sum = 0
  let sumX = 0
  for (let r = Math.max(0, lowest - band); r <= lowest; r += 1) {
    sum += rowSum[r]
    sumX += rowX[r]
  }
  if (!(sum > 0)) return centre
  const found = sumX / sum
  return Math.min(centre + MAX_SHIFT * box.w, Math.max(centre - MAX_SHIFT * box.w, found))
}
