// Оценка движения камеры между двумя соседними кадрами: угловые точки Ши–Томаси → пирамидальный
// поток Лукаса–Канаде (с проверкой «туда-обратно») → RANSAC → подгонка по согласованным точкам.
// Чистые функции на обычных массивах, без внешних библиотек. Ложный сдвиг хуже отсутствия сдвига:
// при любом сомнении результат помечается ненадёжным, а H — единичная.
import { fitHomography, hullArea, type Correspondence } from '../pitch/homography'
import { IDENTITY3, det3, inv3, mul3, type Mat3, type Pt } from '../pitch/linalg'
import {
  AMBIGUITY_RADIUS,
  AMBIGUITY_RATIO,
  LK_EPS,
  LK_MAX_FB_ERROR,
  LK_MAX_ITER,
  LK_MAX_RESIDUAL,
  LK_RADIUS,
  MIN_EIG,
  MOTION_EDGE_MARGIN,
  MOTION_HOMOGRAPHY_MIN_HULL_SHARE,
  MOTION_HOMOGRAPHY_MIN_INLIERS,
  MOTION_MAX_RMS_PX,
  MOTION_MAX_SCALE_STEP,
  MOTION_MIN_HULL_SHARE,
  MOTION_MIN_INLIER_SHARE,
  MOTION_MIN_INLIERS,
  MOTION_RANSAC_THRESHOLD_PX,
  MOTION_RIVAL_SHARE,
  MOTION_REF_WIDTH
} from './types'

/** Кадр в оттенках серого: data — width·height байт, построчно. */
export interface Gray {
  width: number
  height: number
  data: Uint8Array
}

/** Прямоугольник в долях кадра. */
export interface MaskRect {
  x: number
  y: number
  w: number
  h: number
}

export interface EstimateOptions {
  /**
   * Рамки игроков (доли кадра): внутри них угловые точки не берутся.
   * Лучше передавать рамки, накрывающие игрока на обоих кадрах.
   */
  masks: readonly MaskRect[]
}

export interface MotionEstimate {
  /** Точка кадра prev → точка кадра cur (доли кадра, применять через applyH); H[8] = 1. Ненадёжно → единичная. */
  H: Mat3
  reliable: boolean
  /** Число согласованных пар точек. */
  inliers: number
  /** Среднеквадратичная ошибка по согласованным точкам, px кадра; Infinity — подгонки нет. */
  rms: number
}

/** Уровней пирамиды (полный кадр, 1/2, 1/4). */
const PYRAMID_LEVELS = 3
/** Угловая точка слабее этой доли от самой сильной в кадре не берётся. */
const CORNER_REL = 0.01
/** Полуширина окна структурного тензора для поиска углов. */
const CORNER_RADIUS = 3
/** Сетка поиска углов: в каждой клетке — одна лучшая точка (≈ 330 клеток → обычно ≥ 150 точек). */
const GRID_COLS = 24
const GRID_ROWS = 14
const RANSAC_SEED = 0x5eed1234
const RANSAC_MAX_ITER = 400
const RANSAC_CONFIDENCE = 0.999

interface Level {
  w: number
  h: number
  img: Float32Array
  gx: Float32Array
  gy: Float32Array
}

/** Сглаживание [1 2 1]/4 по обеим осям и прореживание вдвое. */
function downsample(
  src: Float32Array,
  w: number,
  h: number
): { img: Float32Array; w: number; h: number } {
  const nw = Math.max(1, w >> 1)
  const nh = Math.max(1, h >> 1)
  const tmp = new Float32Array(nw * h)
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    for (let x = 0; x < nw; x += 1) {
      const sx = 2 * x
      const l = src[row + Math.max(0, sx - 1)]
      const r = src[row + Math.min(w - 1, sx + 1)]
      tmp[y * nw + x] = (l + 2 * src[row + sx] + r) * 0.25
    }
  }
  const out = new Float32Array(nw * nh)
  for (let y = 0; y < nh; y += 1) {
    const sy = 2 * y
    const up = Math.max(0, sy - 1) * nw
    const mid = sy * nw
    const dn = Math.min(h - 1, sy + 1) * nw
    for (let x = 0; x < nw; x += 1)
      out[y * nw + x] = (tmp[up + x] + 2 * tmp[mid + x] + tmp[dn + x]) * 0.25
  }
  return { img: out, w: nw, h: nh }
}

/** Центральные разности; на краях — односторонние. */
function makeLevel(img: Float32Array, w: number, h: number): Level {
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    const up = Math.max(0, y - 1) * w
    const dn = Math.min(h - 1, y + 1) * w
    const dy = y > 0 && y < h - 1 ? 0.5 : 1
    for (let x = 0; x < w; x += 1) {
      const l = Math.max(0, x - 1)
      const r = Math.min(w - 1, x + 1)
      gx[row + x] = (img[row + r] - img[row + l]) * (r - l === 2 ? 0.5 : 1)
      gy[row + x] = (img[dn + x] - img[up + x]) * dy
    }
  }
  return { w, h, img, gx, gy }
}

function pyramid(g: Gray): Level[] {
  const img = Float32Array.from(g.data)
  const levels = [makeLevel(img, g.width, g.height)]
  for (let l = 1; l < PYRAMID_LEVELS; l += 1) {
    const prev = levels[l - 1]
    const d = downsample(prev.img, prev.w, prev.h)
    levels.push(makeLevel(d.img, d.w, d.h))
  }
  return levels
}

const WIN = 2 * LK_RADIUS + 1
const WIN_N = WIN * WIN

/**
 * Окно (2r+1)² вокруг (cx, cy), билинейно. Внутри кадра веса одинаковы для всех пикселей окна;
 * у края координаты прижимаются к кадру.
 */
function samplePatch(
  img: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  out: Float32Array
): void {
  const x0 = cx - LK_RADIUS
  const y0 = cy - LK_RADIUS
  if (x0 >= 0 && y0 >= 0 && x0 + WIN < w - 1 && y0 + WIN < h - 1) {
    const ix = Math.floor(x0)
    const iy = Math.floor(y0)
    const fx = x0 - ix
    const fy = y0 - iy
    const w00 = (1 - fx) * (1 - fy)
    const w01 = fx * (1 - fy)
    const w10 = (1 - fx) * fy
    const w11 = fx * fy
    let k = 0
    for (let j = 0; j < WIN; j += 1) {
      let i = (iy + j) * w + ix
      for (let t = 0; t < WIN; t += 1, i += 1, k += 1) {
        out[k] = img[i] * w00 + img[i + 1] * w01 + img[i + w] * w10 + img[i + w + 1] * w11
      }
    }
    return
  }
  let k = 0
  for (let j = 0; j < WIN; j += 1) {
    for (let t = 0; t < WIN; t += 1, k += 1) {
      const x = Math.min(w - 1.001, Math.max(0, x0 + t))
      const y = Math.min(h - 1.001, Math.max(0, y0 + j))
      const ix = Math.floor(x)
      const iy = Math.floor(y)
      const fx = x - ix
      const fy = y - iy
      const i = iy * w + ix
      const i2 = Math.min(ix + 1, w - 1) - ix
      const j2 = iy + 1 < h ? w : 0
      out[k] =
        img[i] * (1 - fx) * (1 - fy) +
        img[i + i2] * fx * (1 - fy) +
        img[i + j2] * (1 - fx) * fy +
        img[i + j2 + i2] * fx * fy
    }
  }
}

/** Окно для проверки неоднозначности: (2r+1)² пикселей уровня пирамиды. */
const AMB_R = 3

/**
 * Похоже ли окно вокруг (x, y) уровня l само на себя со сдвигом δ, где exclude < |δ|∞ ≤ range
 * (целые пиксели уровня). Бестекстурное окно тоже считается неоднозначным.
 */
function ambiguous(l: Level, x: number, y: number, range: number, exclude: number): boolean {
  const { w, h, img } = l
  const cx = Math.round(x)
  const cy = Math.round(y)
  if (cx - AMB_R < 0 || cy - AMB_R < 0 || cx + AMB_R >= w || cy + AMB_R >= h) return false
  const n = (2 * AMB_R + 1) ** 2
  let mean = 0
  for (let j = -AMB_R; j <= AMB_R; j += 1) {
    for (let i = -AMB_R; i <= AMB_R; i += 1) mean += img[(cy + j) * w + cx + i]
  }
  mean /= n
  let contrast = 0
  for (let j = -AMB_R; j <= AMB_R; j += 1) {
    for (let i = -AMB_R; i <= AMB_R; i += 1) contrast += Math.abs(img[(cy + j) * w + cx + i] - mean)
  }
  contrast /= n
  if (!(contrast > 1)) return true
  const limit = AMBIGUITY_RATIO * contrast * n
  for (let dy = -range; dy <= range; dy += 1) {
    const oy = cy + dy
    if (oy - AMB_R < 0 || oy + AMB_R >= h) continue
    for (let dx = -range; dx <= range; dx += 1) {
      if (Math.abs(dx) <= exclude && Math.abs(dy) <= exclude) continue
      const ox = cx + dx
      if (ox - AMB_R < 0 || ox + AMB_R >= w) continue
      // Сумма с досрочным выходом: на обычной текстуре почти каждый сдвиг отсекается за несколько пикселей.
      let sad = 0
      for (let j = -AMB_R; j <= AMB_R && sad < limit; j += 1) {
        const a = (cy + j) * w + cx
        const b = (oy + j) * w + ox
        for (let i = -AMB_R; i <= AMB_R; i += 1) sad += Math.abs(img[a + i] - img[b + i])
      }
      if (sad < limit) return true
    }
  }
  return false
}

// Рабочие буферы окна потока — общие на модуль: track() не реентерабельна (в одном потоке это безопасно,
// у каждого worker свой экземпляр модуля).
const bufT = new Float32Array(WIN_N)
const bufX = new Float32Array(WIN_N)
const bufY = new Float32Array(WIN_N)
const bufJ = new Float32Array(WIN_N)

/** Наименьшее собственное число симметричной матрицы [a b; b c]. */
const minEig = (a: number, b: number, c: number): number =>
  (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b)

/**
 * Пирамидальный Лукас–Канаде (по Бугё): где точка (x, y) кадра from оказалась в кадре to.
 * (guessX, guessY) — начальная догадка смещения на полном разрешении. null — точка потеряна.
 */
function track(
  from: Level[],
  to: Level[],
  x: number,
  y: number,
  guessX: number,
  guessY: number
): { x: number; y: number; residual: number } | null {
  const top = from.length - 1
  let gx = guessX / (1 << top)
  let gy = guessY / (1 << top)
  for (let l = top; l >= 0; l -= 1) {
    const s = 1 / (1 << l)
    const px = x * s
    const py = y * s
    const lf = from[l]
    const lt = to[l]
    samplePatch(lf.img, lf.w, lf.h, px, py, bufT)
    samplePatch(lf.gx, lf.w, lf.h, px, py, bufX)
    samplePatch(lf.gy, lf.w, lf.h, px, py, bufY)
    let a = 0
    let b = 0
    let c = 0
    for (let k = 0; k < WIN_N; k += 1) {
      a += bufX[k] * bufX[k]
      b += bufX[k] * bufY[k]
      c += bufY[k] * bufY[k]
    }
    const det = a * c - b * b
    let dx = 0
    let dy = 0
    // На грубых уровнях текстура сглажена — порог мягче; там бестекстурное окно просто не уточняет догадку.
    if (minEig(a, b, c) / WIN_N >= MIN_EIG / (1 << (2 * l)) && det > 0) {
      for (let it = 0; it < LK_MAX_ITER; it += 1) {
        samplePatch(lt.img, lt.w, lt.h, px + gx + dx, py + gy + dy, bufJ)
        let bx = 0
        let by = 0
        for (let k = 0; k < WIN_N; k += 1) {
          const e = bufT[k] - bufJ[k]
          bx += e * bufX[k]
          by += e * bufY[k]
        }
        const ex = (c * bx - b * by) / det
        const ey = (a * by - b * bx) / det
        dx += ex
        dy += ey
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
        if (ex * ex + ey * ey < LK_EPS * LK_EPS) break
      }
    } else if (l === 0) {
      return null
    }
    if (l > 0) {
      gx = 2 * (gx + dx)
      gy = 2 * (gy + dy)
    } else {
      gx += dx
      gy += dy
    }
  }
  const qx = x + gx
  const qy = y + gy
  const l0 = to[0]
  if (!(
    qx >= LK_RADIUS &&
    qy >= LK_RADIUS &&
    qx <= l0.w - 1 - LK_RADIUS &&
    qy <= l0.h - 1 - LK_RADIUS
  ))
    return null
  samplePatch(from[0].img, from[0].w, from[0].h, x, y, bufT)
  samplePatch(l0.img, l0.w, l0.h, qx, qy, bufJ)
  let sad = 0
  for (let k = 0; k < WIN_N; k += 1) sad += Math.abs(bufT[k] - bufJ[k])
  return { x: qx, y: qy, residual: sad / WIN_N }
}

/** Маска (1 — нельзя брать точку): рамки игроков, расширенные на окно потока. */
function rasterMask(masks: readonly MaskRect[], w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h)
  for (const r of masks) {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) continue
    const x0 = Math.max(0, Math.floor(r.x * w) - LK_RADIUS)
    const y0 = Math.max(0, Math.floor(r.y * h) - LK_RADIUS)
    const x1 = Math.min(w, Math.ceil((r.x + r.w) * w) + LK_RADIUS)
    const y1 = Math.min(h, Math.ceil((r.y + r.h) * h) + LK_RADIUS)
    for (let y = y0; y < y1; y += 1) m.fill(1, y * w + x0, Math.max(y * w + x0, y * w + x1))
  }
  return m
}

/** Углы Ши–Томаси: по одной сильнейшей точке в клетке сетки, вне масок и полей у краёв. */
function detectCorners(l0: Level, mask: Uint8Array): Pt[] {
  const { w, h, gx, gy } = l0
  // Интегральные суммы Ix², IxIy, Iy².
  const W1 = w + 1
  const sxx = new Float64Array(W1 * (h + 1))
  const sxy = new Float64Array(W1 * (h + 1))
  const syy = new Float64Array(W1 * (h + 1))
  for (let y = 0; y < h; y += 1) {
    let rxx = 0
    let rxy = 0
    let ryy = 0
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      rxx += gx[i] * gx[i]
      rxy += gx[i] * gy[i]
      ryy += gy[i] * gy[i]
      const o = (y + 1) * W1 + x + 1
      sxx[o] = sxx[o - W1] + rxx
      sxy[o] = sxy[o - W1] + rxy
      syy[o] = syy[o - W1] + ryy
    }
  }
  const R = CORNER_RADIUS
  const area = (2 * R + 1) ** 2
  const box = (s: Float64Array, x: number, y: number): number =>
    s[(y + R + 1) * W1 + x + R + 1] -
    s[(y - R) * W1 + x + R + 1] -
    s[(y + R + 1) * W1 + x - R] +
    s[(y - R) * W1 + x - R]

  const mx = Math.max(Math.ceil(w * MOTION_EDGE_MARGIN), R + LK_RADIUS + 1)
  const my = Math.max(Math.ceil(h * MOTION_EDGE_MARGIN), R + LK_RADIUS + 1)
  const iw = w - 2 * mx
  const ih = h - 2 * my
  if (iw <= 0 || ih <= 0) return []
  const best: { x: number; y: number; v: number }[] = []
  let globalMax = 0
  for (let r = 0; r < GRID_ROWS; r += 1) {
    const y0 = my + Math.floor((r * ih) / GRID_ROWS)
    const y1 = my + Math.floor(((r + 1) * ih) / GRID_ROWS)
    for (let cc = 0; cc < GRID_COLS; cc += 1) {
      const x0 = mx + Math.floor((cc * iw) / GRID_COLS)
      const x1 = mx + Math.floor(((cc + 1) * iw) / GRID_COLS)
      let bv = 0
      let bx = -1
      let by = -1
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          if (mask[y * w + x]) continue
          const v = minEig(box(sxx, x, y), box(sxy, x, y), box(syy, x, y)) / area
          if (v > bv) {
            bv = v
            bx = x
            by = y
          }
        }
      }
      if (bx >= 0) {
        best.push({ x: bx, y: by, v: bv })
        if (bv > globalMax) globalMax = bv
      }
    }
  }
  const thr = Math.max(MIN_EIG, globalMax * CORNER_REL)
  return best.filter((p) => p.v >= thr).map((p) => ({ x: p.x, y: p.y }))
}

/** Детерминированный ГПСЧ (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Применение H к точке без проверки знака w (для ошибки переноса; w ≤ 0 → Infinity). */
function transferError2(H: Mat3, p: Pt, q: Pt): number {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  if (!(w > 1e-12)) return Infinity
  const u = (H[0] * p.x + H[1] * p.y + H[2]) / w - q.x
  const v = (H[3] * p.x + H[4] * p.y + H[5]) / w - q.y
  return u * u + v * v
}

const cross = (a: Pt, b: Pt, c: Pt): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** Гомография точно по 4 парам (h33 = 1, система 8×8 методом Гаусса). null — вырожденная выборка. */
function homography4(src: readonly Pt[], dst: readonly Pt[]): Mat3 | null {
  // Тройки почти на одной прямой дают неустойчивую модель.
  for (const [i, j, k] of [
    [0, 1, 2],
    [0, 1, 3],
    [0, 2, 3],
    [1, 2, 3]
  ]) {
    if (Math.abs(cross(src[i], src[j], src[k])) < 1e-3) return null
    if (Math.abs(cross(dst[i], dst[j], dst[k])) < 1e-3) return null
  }
  const A: number[][] = []
  for (let n = 0; n < 4; n += 1) {
    const { x, y } = src[n]
    const { x: u, y: v } = dst[n]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let col = 0; col < 8; col += 1) {
    let piv = col
    for (let r = col + 1; r < 8; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-12) return null
    ;[A[col], A[piv]] = [A[piv], A[col]]
    for (let r = 0; r < 8; r += 1) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      if (f === 0) continue
      for (let k = col; k < 9; k += 1) A[r][k] -= f * A[col][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  const H: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
  return H.every(Number.isFinite) ? H : null
}

/** Подобие (сдвиг + масштаб + поворот) по методу наименьших квадратов; от двух пар — точно. */
function similarity(src: readonly Pt[], dst: readonly Pt[]): Mat3 | null {
  const n = src.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i += 1) {
    sx += src[i].x
    sy += src[i].y
    dx += dst[i].x
    dy += dst[i].y
  }
  sx /= n
  sy /= n
  dx /= n
  dy /= n
  let num = 0
  let numB = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    const x = src[i].x - sx
    const y = src[i].y - sy
    const u = dst[i].x - dx
    const v = dst[i].y - dy
    num += x * u + y * v
    numB += x * v - y * u
    den += x * x + y * y
  }
  if (!(den > 1e-12)) return null
  const a = num / den
  const b = numB / den
  return [a, -b, dx - a * sx + b * sy, b, a, dy - b * sx - a * sy, 0, 0, 1]
}

/** Гомография по всем парам — общий нормализованный DLT из разметки поля; h33 приводится к 1. */
function homographyLsq(src: readonly Pt[], dst: readonly Pt[]): Mat3 | null {
  const pairs: Correspondence[] = src.map((p, i) => ({ world: p, image: dst[i] }))
  const r = fitHomography(pairs, 1)
  if (!r.ok || !(r.H[8] > 0)) return null
  return r.H.map((v) => v / r.H[8]) as unknown as Mat3
}

type Model = 'homography' | 'similarity'

function inlierMask(M: Mat3, src: readonly Pt[], dst: readonly Pt[], thr2: number): boolean[] {
  return src.map((p, i) => transferError2(M, p, dst[i]) <= thr2)
}

/**
 * RANSAC (оценка MSAC) с детерминированным ГПСЧ и уточнением: модель по всем согласованным точкам,
 * пересчёт согласованных, ещё раз модель.
 */
function ransac(
  src: readonly Pt[],
  dst: readonly Pt[],
  thr: number,
  model: Model
): { M: Mat3; inl: boolean[] } | null {
  const n = src.length
  const k = model === 'homography' ? 4 : 2
  if (n < k) return null
  const thr2 = thr * thr
  const rand = prng(RANSAC_SEED)
  let bestScore = Infinity
  let bestM: Mat3 | null = null
  let maxIter = RANSAC_MAX_ITER
  const idx: number[] = []
  for (let it = 0; it < maxIter; it += 1) {
    idx.length = 0
    while (idx.length < k) {
      const j = Math.floor(rand() * n)
      if (!idx.includes(j)) idx.push(j)
    }
    const s = idx.map((j) => src[j])
    const d = idx.map((j) => dst[j])
    const M = model === 'homography' ? homography4(s, d) : similarity(s, d)
    if (!M || !(det3(M) > 0)) continue
    let score = 0
    let count = 0
    for (let i = 0; i < n && score < bestScore; i += 1) {
      const e = transferError2(M, src[i], dst[i])
      if (e <= thr2) {
        score += e
        count += 1
      } else score += thr2
    }
    if (score < bestScore) {
      bestScore = score
      bestM = M
      const w = count / n
      const need = Math.log(1 - RANSAC_CONFIDENCE) / Math.log(Math.max(1e-12, 1 - w ** k))
      if (Number.isFinite(need))
        maxIter = Math.min(RANSAC_MAX_ITER, Math.max(it + 1, Math.ceil(need)))
    }
  }
  if (!bestM) return null
  let M = bestM
  let inl = inlierMask(M, src, dst, thr2)
  for (let round = 0; round < 2; round += 1) {
    const s = src.filter((_, i) => inl[i])
    const d = dst.filter((_, i) => inl[i])
    const refit =
      model === 'homography' ? (s.length >= 4 ? homographyLsq(s, d) : null) : similarity(s, d)
    if (!refit) break
    const next = inlierMask(refit, src, dst, thr2)
    if (next.filter(Boolean).length < inl.filter(Boolean).length) break
    M = refit
    inl = next
  }
  return { M, inl }
}

const unreliable = (inliers = 0, rms = Infinity): MotionEstimate => ({
  H: IDENTITY3,
  reliable: false,
  inliers,
  rms
})

/**
 * Движение камеры (фона) между кадрами prev и cur: H переводит точку prev в точку cur (доли кадра).
 * reliable = false, если точек мало, они кучные, подгонка плохая или масштаб скачет — тогда H единичная.
 */
export function estimateMotion(prev: Gray, cur: Gray, opts: EstimateOptions): MotionEstimate {
  const w = prev.width
  const h = prev.height
  if (
    w !== cur.width ||
    h !== cur.height ||
    prev.data.length < w * h ||
    cur.data.length < w * h ||
    w < 8 * (2 * LK_RADIUS + 1) ||
    h < 8 * (2 * LK_RADIUS + 1)
  ) {
    return unreliable()
  }
  const px = w / MOTION_REF_WIDTH
  const pa = pyramid(prev)
  const pb = pyramid(cur)
  const corners = detectCorners(pa[0], rasterMask(opts.masks, w, h))
  if (corners.length < MOTION_MIN_INLIERS) return unreliable()

  // Нормированные координаты: центр кадра — 0, половина ширины — 1 (одинаковый масштаб по осям).
  const half = w / 2
  const norm = (x: number, y: number): Pt => ({ x: (x - w / 2) / half, y: (y - h / 2) / half })
  const src: Pt[] = []
  const dst: Pt[] = []
  const fb2 = (LK_MAX_FB_ERROR * px) ** 2
  // Поиск неоднозначности (радиусы — в пикселях своего уровня): на уровне 1/4 — повторы от 12 px полного кадра
  // до AMBIGUITY_RADIUS; на уровне 1/2 — мелкие повторы от 4 до 12 px, которые уровень 1/4 уже не различает.
  const ambFar = Math.max(4, Math.round((AMBIGUITY_RADIUS * px) / 4))
  const ambNear = Math.max(2, Math.round((12 * px) / 2))
  for (const p of corners) {
    // Периодическая текстура: поток может сойтись к соседнему периоду, и все такие точки «согласятся» на ложный сдвиг.
    if (ambiguous(pa[2], p.x / 4, p.y / 4, ambFar, 2)) continue
    if (ambiguous(pa[1], p.x / 2, p.y / 2, ambNear, 1)) continue
    const q = track(pa, pb, p.x, p.y, 0, 0)
    if (!q || q.residual > LK_MAX_RESIDUAL) continue
    // Проверка «туда-обратно»: из найденной точки поток должен вернуть к исходной.
    const back = track(pb, pa, q.x, q.y, p.x - q.x, p.y - q.y)
    if (!back || (back.x - p.x) ** 2 + (back.y - p.y) ** 2 > fb2) continue
    src.push(norm(p.x, p.y))
    dst.push(norm(q.x, q.y))
  }
  if (src.length < MOTION_MIN_INLIERS) return unreliable()

  const thr = (MOTION_RANSAC_THRESHOLD_PX * px) / half
  const frameArea = (w * h) / (half * half)
  const hullOf = (inl: boolean[]): number => hullArea(src.filter((_, i) => inl[i])) / frameArea
  const count = (inl: boolean[]): number => inl.filter(Boolean).length

  let fit = ransac(src, dst, thr, 'homography')
  if (
    !fit ||
    count(fit.inl) < MOTION_HOMOGRAPHY_MIN_INLIERS ||
    hullOf(fit.inl) < MOTION_HOMOGRAPHY_MIN_HULL_SHARE
  ) {
    // Точек мало или они кучные: гомография по ним неустойчива, берём подобие.
    fit = ransac(src, dst, thr, 'similarity')
  }
  if (!fit) return unreliable()

  const inliers = count(fit.inl)
  let sum2 = 0
  for (let i = 0; i < src.length; i += 1)
    if (fit.inl[i]) sum2 += transferError2(fit.M, src[i], dst[i])
  const rmsPx = inliers > 0 ? Math.sqrt(sum2 / inliers) * half : Infinity
  const scale = Math.sqrt(Math.abs(fit.M[0] * fit.M[4] - fit.M[1] * fit.M[3]))
  const reliable =
    inliers >= MOTION_MIN_INLIERS &&
    // Доля — от всех найденных углов, а не от прошедших поток: потерянные точки тоже говорят против.
    inliers >= MOTION_MIN_INLIER_SHARE * corners.length &&
    hullOf(fit.inl) >= MOTION_MIN_HULL_SHARE &&
    rmsPx <= MOTION_MAX_RMS_PX * px &&
    scale <= MOTION_MAX_SCALE_STEP &&
    scale >= 1 / MOTION_MAX_SCALE_STEP
  if (!reliable) return unreliable(inliers, rmsPx)

  // Соперник: среди несогласованных точек есть второе крупное согласованное движение (например, группа игроков
  // без масок, бегущая вместе). Тогда неизвестно, какое из них — камера.
  const restSrc = src.filter((_, i) => !fit.inl[i])
  const restDst = dst.filter((_, i) => !fit.inl[i])
  // Один игрок даёт десяток-другой точек — соперником считается только движение не меньше MOTION_MIN_INLIERS.
  const rivalMin = Math.max(MOTION_MIN_INLIERS, MOTION_RIVAL_SHARE * inliers)
  if (restSrc.length >= rivalMin) {
    const rival = ransac(restSrc, restDst, thr, 'similarity')
    if (rival && count(rival.inl) >= rivalMin) return unreliable(inliers, rmsPx)
  }

  // Из нормированных координат в доли кадра: n = N·f, H_f = N⁻¹·H_n·N.
  const N: Mat3 = [w / half, 0, -w / 2 / half, 0, h / half, -h / 2 / half, 0, 0, 1]
  const Ni = inv3(N)
  if (!Ni) return unreliable(inliers, rmsPx)
  const Hf = mul3(Ni, mul3(fit.M, N))
  if (!(Hf[8] > 0) || !Hf.every(Number.isFinite)) return unreliable(inliers, rmsPx)
  return { H: Hf.map((v) => v / Hf[8]) as unknown as Mat3, reliable: true, inliers, rms: rmsPx }
}
