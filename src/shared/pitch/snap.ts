// Привязка точки разметки к белым линиям поля: по небольшому окну пикселей вокруг клика находим тонкие светлые
// линии, подгоняем к ним прямые и возвращаем ближайшее пересечение (или ближайшую точку линии, если она одна).
// Чистая функция без DOM: окно пикселей приходит как RGBA, как у ImageData.

export interface RgbaWindow {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface SnapResult {
  /** Куда сдвинуть точку, в пикселях окна. */
  x: number
  y: number
  kind: 'intersection' | 'line'
}

/** Насколько пиксель должен быть светлее соседей по обе стороны от линии (по яркости 0..255). */
const RIDGE_CONTRAST = 20
/** Расстояние до соседей, которыми меряем «светлее фона»; шире этого — уже не тонкая линия. */
const RIDGE_REACH = 4
const MIN_LUM = 110
const MAX_SAT = 0.35
const MIN_LINE_PIXELS = 14
const MAX_LINES = 4
/** Пересечение берём, только если прямые расходятся не меньше чем на этот угол. */
const MIN_ANGLE_DEG = 8
/** Линия должна доходить до пересечения: ближайшая её точка не дальше стольких пикселей. */
const REACH_TO_CROSSING = 9
const ANGLE_STEP_DEG = 3

interface Line {
  /** Точка на прямой. */
  px: number
  py: number
  /** Единичное направление. */
  dx: number
  dy: number
  pts: Array<[number, number]>
}

const AXES: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
]

function ridgePixels(img: RgbaWindow): Array<[number, number]> {
  const { data, width: w, height: h } = img
  const lum = new Float32Array(w * h)
  const ok = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    ok[i] = lum[i] >= MIN_LUM && mx > 0 && (mx - mn) / mx <= MAX_SAT ? 1 : 0
  }
  const out: Array<[number, number]> = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!ok[i]) continue
      let best = 0
      for (const [ax, ay] of AXES) {
        const k = RIDGE_REACH / Math.hypot(ax, ay)
        const sx = Math.round(ax * k)
        const sy = Math.round(ay * k)
        const x1 = x - sx
        const y1 = y - sy
        const x2 = x + sx
        const y2 = y + sy
        if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 >= w || x2 >= w || y1 >= h || y2 >= h)
          continue
        const c = Math.min(lum[i] - lum[y1 * w + x1], lum[i] - lum[y2 * w + x2])
        if (c > best) best = c
      }
      if (best >= RIDGE_CONTRAST) out.push([x, y])
    }
  }
  return out
}

/** Подгонка прямой по точкам методом наименьших квадратов (с учётом ошибки по обеим осям). */
function fitLine(pts: Array<[number, number]>): Line {
  let mx = 0
  let my = 0
  for (const [x, y] of pts) {
    mx += x
    my += y
  }
  mx /= pts.length
  my /= pts.length
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
    sxy += (x - mx) * (y - my)
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang), pts }
}

const distTo = (l: Line, x: number, y: number): number =>
  Math.abs((x - l.px) * l.dy - (y - l.py) * l.dx)

/** Ищем до MAX_LINES прямых: пик Хафа, уточнение по точкам рядом, затем точки линии вычёркиваем. */
function findLines(all: Array<[number, number]>, w: number, h: number): Line[] {
  let pts = all.slice()
  const lines: Line[] = []
  const nAng = Math.round(180 / ANGLE_STEP_DEG)
  const cos: number[] = []
  const sin: number[] = []
  for (let a = 0; a < nAng; a++) {
    const t = (a * ANGLE_STEP_DEG * Math.PI) / 180
    cos.push(Math.cos(t))
    sin.push(Math.sin(t))
  }
  const rhoMax = Math.ceil(Math.hypot(w, h))
  const rhoBins = 2 * rhoMax + 1
  while (lines.length < MAX_LINES && pts.length >= MIN_LINE_PIXELS) {
    const acc = new Int32Array(nAng * rhoBins)
    for (const [x, y] of pts) {
      for (let a = 0; a < nAng; a++) {
        acc[a * rhoBins + Math.round(x * cos[a] + y * sin[a]) + rhoMax]++
      }
    }
    let bi = 0
    let bv = 0
    for (let i = 0; i < acc.length; i++) {
      if (acc[i] > bv) {
        bv = acc[i]
        bi = i
      }
    }
    if (bv < MIN_LINE_PIXELS) break
    const a = Math.floor(bi / rhoBins)
    const rho = (bi % rhoBins) - rhoMax
    let near = pts.filter(([x, y]) => Math.abs(x * cos[a] + y * sin[a] - rho) <= 2.2)
    if (near.length < MIN_LINE_PIXELS) break
    let line = fitLine(near)
    near = pts.filter(([x, y]) => distTo(line, x, y) <= 1.8)
    if (near.length >= MIN_LINE_PIXELS) line = fitLine(near)
    const members = new Set(pts.filter(([x, y]) => distTo(line, x, y) <= 2.5))
    lines.push({ ...line, pts: near })
    pts = pts.filter((p) => !members.has(p))
  }
  return lines
}

function nearestPointOn(l: Line, x: number, y: number): number {
  let best = Infinity
  for (const [qx, qy] of l.pts) best = Math.min(best, Math.hypot(qx - x, qy - y))
  return best
}

/**
 * Привязка клика (cx, cy в координатах окна) к линиям. Ближайшее пересечение двух линий, если оно не дальше
 * radius; иначе ближайшая точка единственной линии; иначе null (ничего уверенного не нашли).
 */
export function snapToLines(
  img: RgbaWindow,
  cx: number,
  cy: number,
  radius: number
): SnapResult | null {
  const lines = findLines(ridgePixels(img), img.width, img.height)
  if (lines.length === 0) return null

  const minSin = Math.sin((MIN_ANGLE_DEG * Math.PI) / 180)
  let best: SnapResult | null = null
  let bestDist = Infinity
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]
      const b = lines[j]
      const cross = a.dx * b.dy - a.dy * b.dx
      if (Math.abs(cross) < minSin) continue
      const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / cross
      const x = a.px + t * a.dx
      const y = a.py + t * a.dy
      const d = Math.hypot(x - cx, y - cy)
      if (d > radius || d >= bestDist) continue
      if (
        nearestPointOn(a, x, y) > REACH_TO_CROSSING ||
        nearestPointOn(b, x, y) > REACH_TO_CROSSING
      )
        continue
      best = { x, y, kind: 'intersection' }
      bestDist = d
    }
  }
  if (best) return best

  for (const l of lines) {
    const t = (cx - l.px) * l.dx + (cy - l.py) * l.dy
    const x = l.px + t * l.dx
    const y = l.py + t * l.dy
    const d = Math.hypot(x - cx, y - cy)
    if (d <= radius && d < bestDist) {
      best = { x, y, kind: 'line' }
      bestDist = d
    }
  }
  return best
}
