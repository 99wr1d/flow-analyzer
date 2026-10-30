import { describe, expect, it } from 'vitest'
import { applyH } from '../pitch/homography'
import { IDENTITY3, inv3, mul3, type Mat3, type Pt } from '../pitch/linalg'
import { estimateMotion, type EstimateOptions, type Gray } from './estimate'

// Синтетическая сцена: большая «подложка» (шум-текстура + линии разметки), из которой кадры
// вырезаются с известным преобразованием камеры G (пиксели кадра prev → пиксели кадра cur).

const W = 480
const H = 270
/** Подложка больше кадра, чтобы после сдвига/зума за краем кадра тоже была текстура. */
const BW = 680
const BH = 440
const OX = (BW - W) / 2
const OY = (BH - H) / 2

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0
      for (let k = -r; k <= r; k += 1) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))]
      tmp[y * w + x] = s / (2 * r + 1)
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0
      for (let k = -r; k <= r; k += 1) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]
      out[y * w + x] = s / (2 * r + 1)
    }
  }
  return out
}

/** Подложка: мелкий и крупный сглаженный шум (трава/трибуны) и несколько светлых линий (разметка). */
function makeBase(seed: number): Float32Array {
  const rand = rng(seed)
  const fine = new Float32Array(BW * BH).map(() => rand() * 255)
  const coarse = new Float32Array(BW * BH).map(() => rand() * 255)
  const f = boxBlur(boxBlur(fine, BW, BH, 1), BW, BH, 1)
  const c = boxBlur(boxBlur(coarse, BW, BH, 4), BW, BH, 4)
  const base = new Float32Array(BW * BH)
  for (let i = 0; i < base.length; i += 1) base[i] = 128 + (f[i] - 128) * 2.2 + (c[i] - 128) * 4
  for (let k = 0; k < 6; k += 1) {
    // Прямая a·x + b·y = d толщиной ~2 px.
    const ang = rand() * Math.PI
    const a = Math.cos(ang)
    const b = Math.sin(ang)
    const d = a * (rand() * BW) + b * (rand() * BH)
    for (let y = 0; y < BH; y += 1) {
      for (let x = 0; x < BW; x += 1) {
        if (Math.abs(a * x + b * y - d) < 1.2) base[y * BW + x] = 235
      }
    }
  }
  return base
}

function sampleBase(base: Float32Array, x: number, y: number): number {
  const cx = Math.min(BW - 1.001, Math.max(0, x))
  const cy = Math.min(BH - 1.001, Math.max(0, y))
  const ix = Math.floor(cx)
  const iy = Math.floor(cy)
  const fx = cx - ix
  const fy = cy - iy
  const i = iy * BW + ix
  return (
    base[i] * (1 - fx) * (1 - fy) +
    base[i + 1] * fx * (1 - fy) +
    base[i + BW] * (1 - fx) * fy +
    base[i + BW + 1] * fx * fy
  )
}

/**
 * «Игрок»: прямоугольник со своей текстурой, которая едет вместе с ним (пиксели кадра).
 * Без tex — полоски; с tex — кусок подложки tex со сдвигом (tx, ty) (случайная текстура).
 */
interface Player {
  x: number
  y: number
  w: number
  h: number
  tex?: Float32Array
  tx?: number
  ty?: number
}

/**
 * Кадр: пиксель p кадра берётся из подложки в точке G⁻¹·p (+ отступ), билинейно; затем игроки и шум ±noise.
 */
function render(
  base: Float32Array,
  G: Mat3,
  noiseSeed: number,
  noise = 2,
  players: readonly Player[] = []
): Gray {
  const gi = inv3(G)!
  const rand = rng(noiseSeed)
  const data = new Uint8Array(W * H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const q = applyH(gi, { x, y })!
      let v = sampleBase(base, q.x + OX, q.y + OY)
      for (const p of players) {
        if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) {
          if (p.tex) {
            v = sampleBase(p.tex, x - p.x + (p.tx ?? 0), y - p.y + (p.ty ?? 0))
          } else {
            const u = Math.floor((x - p.x) / 3) + Math.floor((y - p.y) / 5)
            v = u % 2 === 0 ? 30 : 220
          }
        }
      }
      v += Math.round(rand() * (2 * noise) - noise)
      data[y * W + x] = Math.max(0, Math.min(255, Math.round(v)))
    }
  }
  return { width: W, height: H, data }
}

const shiftPx = (tx: number, ty: number): Mat3 => [1, 0, tx, 0, 1, ty, 0, 0, 1]
/** Зум s вокруг центра кадра, поворот на ang (рад), затем сдвиг (tx, ty) — всё в пикселях. */
function zoomPx(s: number, tx: number, ty: number, ang = 0): Mat3 {
  const cx = W / 2
  const cy = H / 2
  const c = Math.cos(ang) * s
  const n = Math.sin(ang) * s
  const R: Mat3 = [c, -n, 0, n, c, 0, 0, 0, 1]
  return mul3(shiftPx(cx + tx, cy + ty), mul3(R, shiftPx(-cx, -cy)))
}

const CORNERS: Pt[] = [
  { x: 0, y: 0 },
  { x: W, y: 0 },
  { x: 0, y: H },
  { x: W, y: H },
  { x: W / 2, y: H / 2 }
]

/** Наибольшее расхождение (px) оценки H (доли кадра) с эталоном G (пиксели) по углам и центру кадра. */
function cornerError(Hf: Mat3, G: Mat3): number {
  let worst = 0
  for (const p of CORNERS) {
    const e = applyH(G, p)!
    const q = applyH(Hf, { x: p.x / W, y: p.y / H })!
    worst = Math.max(worst, Math.hypot(q.x * W - e.x, q.y * H - e.y))
  }
  return worst
}

const NO_MASKS: EstimateOptions = { masks: [] }
const base1 = makeBase(11)
const base2 = makeBase(77)

describe('estimateMotion', () => {
  it('(а) сдвиг камеры (+7, −3) px: оценка в пределах 0.3 px, надёжно', () => {
    const G = shiftPx(7, -3)
    const r = estimateMotion(render(base1, IDENTITY3, 1), render(base1, G, 2), NO_MASKS)
    expect(r.reliable).toBe(true)
    expect(cornerError(r.H, G)).toBeLessThan(0.3)
    expect(r.inliers).toBeGreaterThanOrEqual(150)
    expect(r.rms).toBeLessThan(0.5)
  })

  it('(б) зум 1.05 + сдвиг: ошибка углов кадра < 0.5 px', () => {
    const G = zoomPx(1.05, 4, 2)
    const r = estimateMotion(render(base1, IDENTITY3, 3), render(base1, G, 4), NO_MASKS)
    expect(r.reliable).toBe(true)
    expect(cornerError(r.H, G)).toBeLessThan(0.5)
  })

  it('поворот 0.6° + зум 0.97 + сдвиг: ошибка углов < 0.5 px', () => {
    const G = zoomPx(0.97, -5, 3, (0.6 * Math.PI) / 180)
    const r = estimateMotion(render(base1, IDENTITY3, 5), render(base1, G, 6), NO_MASKS)
    expect(r.reliable).toBe(true)
    expect(cornerError(r.H, G)).toBeLessThan(0.5)
  })

  it('(в) «игроки» движутся иначе, чем камера, и закрыты масками: оценка не сбита', () => {
    const G = zoomPx(1.05, 4, 2)
    // Игроки бегут на (+14, +6) px в кадре, независимо от камеры.
    const before: Player[] = [
      { x: 60, y: 50, w: 30, h: 60 },
      { x: 150, y: 120, w: 30, h: 60 },
      { x: 230, y: 70, w: 30, h: 60 },
      { x: 300, y: 150, w: 30, h: 60 },
      { x: 380, y: 60, w: 30, h: 60 },
      { x: 100, y: 180, w: 30, h: 60 }
    ]
    const after = before.map((p) => ({ ...p, x: p.x + 14, y: p.y + 6 }))
    // Маска — рамка, накрывающая игрока на обоих кадрах (доли кадра).
    const masks = before.map((p) => ({
      x: (p.x - 2) / W,
      y: (p.y - 2) / H,
      w: (p.w + 18) / W,
      h: (p.h + 10) / H
    }))
    const prev = render(base1, IDENTITY3, 7, 2, before)
    const cur = render(base1, G, 8, 2, after)
    const r = estimateMotion(prev, cur, { masks })
    expect(r.reliable).toBe(true)
    expect(cornerError(r.H, G)).toBeLessThan(0.5)
  })

  it('«игроки» без масок: RANSAC всё равно отсекает их', () => {
    const G = shiftPx(-6, 2)
    const before: Player[] = [
      { x: 80, y: 60, w: 40, h: 80 },
      { x: 200, y: 100, w: 40, h: 80 },
      { x: 330, y: 70, w: 40, h: 80 }
    ]
    const after = before.map((p) => ({ ...p, x: p.x + 9, y: p.y - 4 }))
    const r = estimateMotion(
      render(base1, IDENTITY3, 9, 2, before),
      render(base1, G, 10, 2, after),
      NO_MASKS
    )
    expect(r.reliable).toBe(true)
    expect(cornerError(r.H, G)).toBeLessThan(0.5)
  })

  it('(г) однородный серый кадр → ненадёжно', () => {
    const gray: Gray = { width: W, height: H, data: new Uint8Array(W * H).fill(128) }
    const r = estimateMotion(gray, { ...gray, data: gray.data.slice() }, NO_MASKS)
    expect(r.reliable).toBe(false)
    expect(r.H).toEqual(IDENTITY3)
  })

  it('однородный серый кадр с шумом ±2 → ненадёжно', () => {
    const flat = new Float32Array(BW * BH).fill(128)
    const r = estimateMotion(render(flat, IDENTITY3, 12), render(flat, IDENTITY3, 13), NO_MASKS)
    expect(r.reliable).toBe(false)
  })

  it('(д) два несвязанных кадра (смена плана) → ненадёжно', () => {
    const r = estimateMotion(render(base1, IDENTITY3, 14), render(base2, IDENTITY3, 15), NO_MASKS)
    expect(r.reliable).toBe(false)
    expect(r.H).toEqual(IDENTITY3)
  })

  it('(е) неподвижная камера, шум ±2: H ≈ единичная (сдвиг < 0.1 px), надёжно', () => {
    const r = estimateMotion(render(base1, IDENTITY3, 16), render(base1, IDENTITY3, 17), NO_MASKS)
    expect(r.reliable).toBe(true)
    expect(cornerError(r.H, IDENTITY3)).toBeLessThan(0.1)
  })

  it('почти весь кадр под масками: мало точек → ненадёжно', () => {
    const masks = [{ x: 0, y: 0, w: 1, h: 0.85 }]
    const r = estimateMotion(render(base1, IDENTITY3, 18), render(base1, shiftPx(3, 0), 19), {
      masks
    })
    expect(r.reliable).toBe(false)
  })

  it('слишком резкий сдвиг (60 px) → ненадёжно, а не ложный сдвиг', () => {
    // 60 px за кадр далеко за пределом захвата 3-уровневой пирамиды: честный ответ — «ненадёжно».
    const G = shiftPx(60, 0)
    const r = estimateMotion(render(base1, IDENTITY3, 20), render(base1, G, 21), NO_MASKS)
    expect(r.reliable).toBe(false)
    expect(r.H).toEqual(IDENTITY3)
  })

  it('кадры разного размера → ненадёжно', () => {
    const a = render(base1, IDENTITY3, 22)
    const b: Gray = { width: 240, height: 135, data: new Uint8Array(240 * 135).fill(100) }
    expect(estimateMotion(a, b, NO_MASKS).reliable).toBe(false)
  })

  it('детерминирован: одинаковый вход → одинаковый результат', () => {
    const prev = render(base1, IDENTITY3, 23)
    const cur = render(base1, zoomPx(1.03, 2, -1), 24)
    expect(estimateMotion(prev, cur, NO_MASKS)).toEqual(estimateMotion(prev, cur, NO_MASKS))
  })
})

// Периодическая текстура (полосы стрижки газона, сетка): сдвиг на полпериода и больше неоднозначен —
// уверенный неверный сдвиг недопустим, допустимы «ненадёжно» или верный ответ.

/** Подложка по формуле f(x, y) плюс (по желанию) ослабленная случайная текстура base1. */
function patternBase(f: (x: number, y: number) => number, texture = 0): Float32Array {
  const out = new Float32Array(BW * BH)
  for (let y = 0; y < BH; y += 1) {
    for (let x = 0; x < BW; x += 1) out[y * BW + x] = f(x, y) + texture * (base1[y * BW + x] - 128)
  }
  return out
}

const STRIPE = 24
const GRID = 16
const stripes = (x: number): number => 128 + 80 * Math.sin((2 * Math.PI * x) / STRIPE)
const grid = (x: number, y: number): number =>
  128 + 55 * Math.sin((2 * Math.PI * x) / GRID) + 55 * Math.sin((2 * Math.PI * y) / GRID)

const periodicCases: {
  name: string
  base: Float32Array
  noise: number
  shifts: [number, number][]
}[] = [
  {
    name: 'полосы, без шума',
    base: patternBase((x) => stripes(x)),
    noise: 0,
    shifts: [
      [STRIPE / 2, 0],
      [STRIPE * 0.7, 0],
      [STRIPE * 0.7, 3]
    ]
  },
  {
    name: 'полосы + шум ±2',
    base: patternBase((x) => stripes(x)),
    noise: 2,
    shifts: [
      [STRIPE / 2, 0],
      [STRIPE * 0.7, 0],
      [STRIPE * 0.7, 3]
    ]
  },
  {
    name: 'полосы + слабая текстура',
    base: patternBase((x) => stripes(x), 0.3),
    noise: 2,
    shifts: [
      [STRIPE / 2, 0],
      [STRIPE * 0.7, 0],
      [STRIPE * 0.7, 3]
    ]
  },
  {
    name: 'сетка, без шума',
    base: patternBase(grid),
    noise: 0,
    shifts: [
      [GRID / 2, 0],
      [GRID * 0.7, 0],
      [GRID * 0.7, GRID * 0.6]
    ]
  },
  {
    name: 'сетка + шум ±2',
    base: patternBase(grid),
    noise: 2,
    shifts: [
      [GRID / 2, GRID / 2],
      [GRID * 0.7, 0],
      [GRID * 0.7, GRID * 0.6]
    ]
  },
  {
    name: 'сетка + слабая текстура',
    base: patternBase(grid, 0.3),
    noise: 2,
    shifts: [
      [GRID / 2, 0],
      [GRID * 0.7, 0],
      [GRID * 0.7, GRID * 0.6]
    ]
  }
]

describe('estimateMotion: периодическая текстура не даёт уверенного ложного сдвига', () => {
  for (const c of periodicCases) {
    for (const [tx, ty] of c.shifts) {
      it(`${c.name}, сдвиг (${tx}, ${ty}) px`, () => {
        const G = shiftPx(tx, ty)
        const r = estimateMotion(
          render(c.base, IDENTITY3, 40, c.noise),
          render(c.base, G, 41, c.noise),
          NO_MASKS
        )
        if (r.reliable) expect(cornerError(r.H, G)).toBeLessThan(0.5)
        else expect(r.H).toEqual(IDENTITY3)
      })
    }
  }
})

// Много игроков: больше половины текстурных точек на движущихся рамках со своей текстурой.

/** Сетка 4×3 игроков 90×62 px (≈ 50 % кадра, ≈ 60 % внутренней области); у каждого своя скорость. */
function crowd(): { before: Player[]; after: Player[]; masks: EstimateOptions['masks'] } {
  const before: Player[] = []
  const after: Player[] = []
  let k = 0
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const p: Player = {
        x: 18 + c * 115,
        y: 14 + r * 86,
        w: 90,
        h: 62,
        tex: base2,
        tx: 40 + 37 * k,
        ty: 30 + 23 * k
      }
      before.push(p)
      // Скорости разные и не совпадают с камерой: от −12 до +12 px.
      after.push({ ...p, x: p.x + ((k * 7) % 25) - 12, y: p.y + ((k * 5) % 13) - 6 })
      k += 1
    }
  }
  const masks = before.map((p, i) => {
    const q = after[i]
    const x0 = Math.min(p.x, q.x) - 2
    const y0 = Math.min(p.y, q.y) - 2
    return {
      x: x0 / W,
      y: y0 / H,
      w: (Math.max(p.x, q.x) + p.w + 2 - x0) / W,
      h: (Math.max(p.y, q.y) + p.h + 2 - y0) / H
    }
  })
  return { before, after, masks }
}

describe('estimateMotion: много игроков', () => {
  const G = shiftPx(-5, 2)
  const { before, after, masks } = crowd()
  const prev = render(base1, IDENTITY3, 50, 2, before)
  const cur = render(base1, G, 51, 2, after)

  it('с масками: фон оценён верно или честно «ненадёжно»', () => {
    const r = estimateMotion(prev, cur, { masks })
    if (r.reliable) expect(cornerError(r.H, G)).toBeLessThan(0.5)
    else expect(r.H).toEqual(IDENTITY3)
  })

  it('без масок: не берёт движение игроков за движение камеры', () => {
    const r = estimateMotion(prev, cur, NO_MASKS)
    if (r.reliable) expect(cornerError(r.H, G)).toBeLessThan(0.5)
    else expect(r.H).toEqual(IDENTITY3)
  })

  it('без масок, все игроки бегут одной группой: два крупных движения — ненадёжно', () => {
    // Группа (≈ 60 % точек) и фон (≈ 40 %) — без масок нельзя понять, что из них камера.
    const together = before.map((p) => ({ ...p, x: p.x + 9, y: p.y + 4 }))
    const r = estimateMotion(prev, render(base1, G, 52, 2, together), NO_MASKS)
    expect(r.reliable).toBe(false)
    expect(r.H).toEqual(IDENTITY3)
  })

  it('крупный движущийся объект без маски (≈ 60 % точек): соперник фону — ненадёжно; с маской — фон', () => {
    // Объект справа от x = 170 px: его текстура едет на (+9, +4) px, фон — с камерой (−5, +2).
    const obj: Player = { x: 170, y: 0, w: W - 170, h: H, tex: base2, tx: 50, ty: 50 }
    const p0 = render(base1, IDENTITY3, 70, 2, [obj])
    const p1 = render(base1, G, 71, 2, [{ ...obj, tx: 50 - 9, ty: 50 - 4 }])
    const bare = estimateMotion(p0, p1, NO_MASKS)
    expect(bare.reliable).toBe(false)
    expect(bare.H).toEqual(IDENTITY3)
    const masked = estimateMotion(p0, p1, { masks: [{ x: 170 / W, y: 0, w: 1 - 170 / W, h: 1 }] })
    if (masked.reliable) expect(cornerError(masked.H, G)).toBeLessThan(0.5)
    else expect(masked.H).toEqual(IDENTITY3)
  })

  it('без масок, половина игроков бежит группой, остальные стоят: ненадёжно или фон', () => {
    const half = before.map((p, i) =>
      i < 6 ? { ...p, x: p.x + 9, y: p.y + 4 } : { ...p, x: p.x - 5, y: p.y + 2 }
    )
    const r = estimateMotion(prev, render(base1, G, 53, 2, half), NO_MASKS)
    if (r.reliable) expect(cornerError(r.H, G)).toBeLessThan(0.5)
    else expect(r.H).toEqual(IDENTITY3)
  })
})

// Неподвижная графика трансляции (табло, логотип, подписи): стоит на месте, пока фон едет.

/** Плашка с высококонтрастной текстурой («текст»): пиксели кадра стоят на месте при любом движении камеры. */
const plate = (x: number, y: number, w: number, h: number, k: number): Player => ({
  x,
  y,
  w,
  h,
  tex: base2,
  tx: 30 + 41 * k,
  ty: 20 + 17 * k
})
const OVERLAYS: Player[] = [plate(70, 200, 340, 56, 0), plate(380, 8, 80, 30, 1)]

describe('estimateMotion: неподвижная графика', () => {
  it('(а) фон едет, табло и логотип стоят: движение фона найдено в пределах 0.3 px', () => {
    for (const [tx, ty] of [
      [5, -2],
      [-3, 1],
      [1.2, 0.4]
    ]) {
      const G = shiftPx(tx, ty)
      const r = estimateMotion(
        render(base1, IDENTITY3, 90, 2, OVERLAYS),
        render(base1, G, 91, 2, OVERLAYS),
        NO_MASKS
      )
      expect(r.reliable).toBe(true)
      expect(cornerError(r.H, G)).toBeLessThan(0.3)
    }
  })

  it('(а) то же с зумом и поворотом камеры', () => {
    const G = zoomPx(1.02, 4, -2, (0.3 * Math.PI) / 180)
    const r = estimateMotion(
      render(base1, IDENTITY3, 92, 2, OVERLAYS),
      render(base1, G, 93, 2, OVERLAYS),
      NO_MASKS
    )
    expect(r.reliable).toBe(true)
    expect(cornerError(r.H, G)).toBeLessThan(0.5)
  })

  it('(б) сцена целиком неподвижна (камера стоит, графика стоит): единичное движение, надёжно', () => {
    const r = estimateMotion(
      render(base1, IDENTITY3, 94, 2, OVERLAYS),
      render(base1, IDENTITY3, 95, 2, OVERLAYS),
      NO_MASKS
    )
    expect(r.reliable).toBe(true)
    expect(cornerError(r.H, IDENTITY3)).toBeLessThan(0.1)
  })

  it('камера почти стоит (0.2 px), графика стоит: не принимает графику за единственное движение', () => {
    const G = shiftPx(0.2, 0)
    const r = estimateMotion(
      render(base1, IDENTITY3, 96, 2, OVERLAYS),
      render(base1, G, 97, 2, OVERLAYS),
      NO_MASKS
    )
    if (r.reliable) expect(cornerError(r.H, G)).toBeLessThan(0.3)
    else expect(r.H).toEqual(IDENTITY3)
  })
})

// Модель камеры: чистый поворот + зум из одной точки (K₂·R·K₁⁻¹, главная точка в центре кадра).

/** Эталон в пикселях кадра: поворот ω = (wx, wy, wz) рад, зум s, фокус f (в полуширинах кадра). */
function cameraG(wx: number, wy: number, wz: number, s: number, f: number): Mat3 {
  const a = Math.hypot(wx, wy, wz)
  const k1 = Math.sin(a) / a
  const k2 = (1 - Math.cos(a)) / (a * a)
  const R: Mat3 = [
    1 + k2 * (-wy * wy - wz * wz),
    -k1 * wz + k2 * wx * wy,
    k1 * wy + k2 * wx * wz,
    k1 * wz + k2 * wx * wy,
    1 + k2 * (-wx * wx - wz * wz),
    -k1 * wx + k2 * wy * wz,
    -k1 * wy + k2 * wx * wz,
    k1 * wx + k2 * wy * wz,
    1 + k2 * (-wx * wx - wy * wy)
  ]
  const Kinv: Mat3 = [1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1]
  const K2: Mat3 = [f * s, 0, 0, 0, f * s, 0, 0, 0, 1]
  const Hn = mul3(K2, mul3(R, Kinv))
  // Пиксели → нормированные (центр — 0, половина ширины — 1) и обратно.
  const T: Mat3 = [2 / W, 0, -1, 0, 2 / W, -H / W, 0, 0, 1]
  return mul3(inv3(T)!, mul3(Hn, T))
}

describe('estimateMotion: модель «поворот + зум камеры»', () => {
  it('(в) чистый поворот + зум: ошибка углов кадра < 0.5 px', () => {
    for (const [wx, wy, wz, s] of [
      [0.004, 0.02, 0.001, 1.01],
      [-0.006, -0.015, -0.002, 0.985],
      [0.0, 0.012, 0.0, 1.0]
    ]) {
      const G = cameraG(wx, wy, wz, s, 3.7)
      const r = estimateMotion(render(base1, IDENTITY3, 100, 2), render(base1, G, 101, 2), NO_MASKS)
      expect(r.reliable).toBe(true)
      expect(cornerError(r.H, G)).toBeLessThan(0.5)
    }
  })

  it('(г) перекос и разный масштаб по осям (модель их не описывает) → ненадёжно', () => {
    // Сдвиг строк пропорционально высоте + растяжение по x: свободная гомография подгонит, камера — нет.
    const skew: Mat3 = [1.04, 0.05, -6, 0, 1, 1, 0, 0, 1]
    const G = mul3(shiftPx(0, 0), skew)
    const r = estimateMotion(render(base1, IDENTITY3, 102, 2), render(base1, G, 103, 2), NO_MASKS)
    expect(r.reliable).toBe(false)
    expect(r.H).toEqual(IDENTITY3)
  })
})
