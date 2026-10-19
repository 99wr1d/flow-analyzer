import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRASS_KEY,
  GrassKeySchema,
  alphaFromDiff,
  chromakeyAlpha,
  estimateGrassColor,
  ffmpegColor,
  grassMask,
  isGreenish,
  keyUV,
  parseHex,
  rgbToU,
  rgbToV,
  toHex
} from './grassKey'

describe('цвет и U/V', () => {
  it('разбор и запись цвета', () => {
    expect(parseHex('#2a7d3e')).toEqual([42, 125, 62])
    expect(toHex(42, 125, 62)).toBe('#2a7d3e')
    expect(toHex(-5, 300, 12.4)).toBe('#00ff0c')
    expect(ffmpegColor('#2A7D3E')).toBe('0x2a7d3e')
  })

  it('U и V: серый нейтрален, чистые цвета — по формулам JPEG', () => {
    for (const v of [0, 90, 128, 255]) {
      expect(rgbToU(v, v, v)).toBe(128)
      expect(rgbToV(v, v, v)).toBe(128)
    }
    expect(rgbToU(0, 0, 255)).toBe(255)
    expect(rgbToV(255, 0, 0)).toBe(255)
    expect(keyUV('#2a7d3e')).toEqual({ u: 111, v: 92 })
  })
})

describe('alphaFromDiff (формула ffmpeg)', () => {
  it('мягкий край: линейный переход от similarity до similarity + blend, дробная часть отбрасывается', () => {
    expect(alphaFromDiff(0.05, 0.1, 0.1)).toBe(0)
    expect(alphaFromDiff(0.1, 0.1, 0.1)).toBe(0)
    expect(alphaFromDiff(0.15, 0.1, 0.1)).toBe(127)
    expect(alphaFromDiff(0.2, 0.1, 0.1)).toBe(255)
    expect(alphaFromDiff(0.9, 0.1, 0.1)).toBe(255)
  })

  it('без мягкости — жёсткий порог', () => {
    expect(alphaFromDiff(0.1, 0.1, 0)).toBe(0)
    expect(alphaFromDiff(0.1001, 0.1, 0)).toBe(255)
  })
})

describe('chromakeyAlpha', () => {
  const key = { color: '#2a7d3e', similarity: 0.1, blend: 0.05 }

  it('цвет ключа — 0 (прозрачность газона), блок далёких цветов — 255', () => {
    const w = 7
    const u = new Uint8Array(w * w).fill(111)
    const v = new Uint8Array(w * w).fill(92)
    for (let y = 2; y <= 4; y += 1)
      for (let x = 2; x <= 4; x += 1) {
        u[y * w + x] = 200
        v[y * w + x] = 20
      }
    const a = chromakeyAlpha(u, v, w, w, key)
    expect(a[0]).toBe(0)
    expect(a[w * w - 1]).toBe(0)
    expect(a[3 * w + 3]).toBe(255)
  })

  it('окно 3×3 сглаживает: одиночная точка шума не пробивает газон', () => {
    const w = 9
    const u = new Uint8Array(w * w).fill(111)
    const v = new Uint8Array(w * w).fill(92)
    // Одна красная точка (шум) посреди газона.
    u[4 * w + 4] = 90
    v[4 * w + 4] = 240
    const a = chromakeyAlpha(u, v, w, w, { ...key, similarity: 0.1, blend: 0 })
    expect(a[4 * w + 4]).toBe(0)
    // А сплошной блок 3×3 того же цвета — уже «не газон».
    for (let y = 3; y <= 5; y += 1)
      for (let x = 3; x <= 5; x += 1) {
        u[y * w + x] = 90
        v[y * w + x] = 240
      }
    expect(chromakeyAlpha(u, v, w, w, { ...key, blend: 0 })[4 * w + 4]).toBe(255)
  })

  it('точки за краем кадра не добавляют расстояния: угол газонной картинки остаётся газоном', () => {
    const u = new Uint8Array(4).fill(111)
    const v = new Uint8Array(4).fill(92)
    expect(Array.from(chromakeyAlpha(u, v, 2, 2, key))).toEqual([0, 0, 0, 0])
  })
})

/** Синтетический кадр: газон с полосами и шумом, белые линии, «игроки», тёмная трибуна сверху. */
function frame(
  w: number,
  h: number,
  opts: { green?: [number, number, number] } = {}
): Uint8ClampedArray {
  const [gr, gg, gb] = opts.green ?? [42, 125, 62]
  const rgba = new Uint8ClampedArray(w * h * 4)
  let seed = 3
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4
      const stripe = Math.floor(x / 20) % 2 === 0 ? 1 : 0.86
      const n = (rnd() - 0.5) * 8
      let c: [number, number, number] = [gr * stripe + n, gg * stripe + n, gb * stripe + n]
      if (y < h * 0.3) c = [200 + n, 120 + n, 40 + n] // верх кадра: трибуны другого цвета
      if (y > h * 0.7 && y < h * 0.7 + 3) c = [240, 242, 238] // линия
      rgba.set([c[0], c[1], c[2], 255], i)
    }
  }
  // Игроки: красный и синий прямоугольники в нижней части.
  const box = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c: [number, number, number]
  ): void => {
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) rgba.set([...c, 255], (y * w + x) * 4)
  }
  box(
    Math.floor(w * 0.2),
    Math.floor(h * 0.45),
    Math.floor(w * 0.3),
    Math.floor(h * 0.85),
    [214, 40, 57]
  )
  box(
    Math.floor(w * 0.6),
    Math.floor(h * 0.5),
    Math.floor(w * 0.7),
    Math.floor(h * 0.9),
    [29, 78, 216]
  )
  return rgba
}

describe('estimateGrassColor: цвет газона по кадру', () => {
  const W = 320
  const H = 180
  const uvOf = (hex: string): [number, number] => {
    const [r, g, b] = parseHex(hex)
    return [rgbToU(r, g, b), rgbToV(r, g, b)]
  }

  it('находит газон среди линий, игроков и шума: цветность совпадает с настоящей', () => {
    const found = estimateGrassColor(frame(W, H), W, H)
    expect(found).not.toBeNull()
    const [u, v] = uvOf(found!)
    const [tu, tv] = uvOf('#2a7d3e')
    expect(Math.hypot(u - tu, v - tv)).toBeLessThan(6)
  })

  it('работает и для другого оттенка газона (жёлто-зелёный, выжженный)', () => {
    const found = estimateGrassColor(frame(W, H, { green: [96, 140, 48] }), W, H)
    expect(found).not.toBeNull()
    const [u, v] = uvOf(found!)
    const [tu, tv] = uvOf('#608c30')
    expect(Math.hypot(u - tu, v - tv)).toBeLessThan(6)
  })

  it('верхние 40 % кадра не смотрятся: яркая зелень на трибунах не мешает', () => {
    const f = frame(W, H)
    for (let y = 0; y < H * 0.4; y += 1) {
      for (let x = 0; x < W; x += 1) f.set([20, 220, 40, 255], (y * W + x) * 4)
    }
    const found = estimateGrassColor(f, W, H)!
    const [u, v] = uvOf(found)
    const [tu, tv] = uvOf('#2a7d3e')
    expect(Math.hypot(u - tu, v - tv)).toBeLessThan(6)
  })

  it('кадр без газона (серое и красное): null', () => {
    const f = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i += 1)
      f.set(i % 2 ? [200, 30, 30, 255] : [120, 120, 120, 255], i * 4)
    expect(estimateGrassColor(f, W, H)).toBeNull()
  })

  it('isGreenish: зелёное да; серое, красное, тёмное, синее — нет', () => {
    expect(isGreenish(42, 125, 62)).toBe(true)
    expect(isGreenish(120, 120, 120)).toBe(false)
    expect(isGreenish(214, 40, 57)).toBe(false)
    expect(isGreenish(5, 12, 6)).toBe(false)
    expect(isGreenish(29, 78, 216)).toBe(false)
  })
})

describe('grassMask: маска по кадру', () => {
  it('газон — 255, игроки и линия — почти 0', () => {
    const W = 160
    const H = 90
    const f = frame(W, H)
    const key = { color: '#2a7d3e', similarity: 0.07, blend: 0.05 }
    const m = grassMask(f, W, H, key)
    const at = (x: number, y: number): number => m[Math.round(y) * W + Math.round(x)]
    expect(at(W * 0.1, H * 0.6)).toBeGreaterThan(250) // газон
    expect(at(W * 0.25, H * 0.65)).toBeLessThan(5) // красный игрок
    expect(at(W * 0.65, H * 0.7)).toBeLessThan(5) // синий игрок
    expect(at(W * 0.45, H * 0.7 + 1)).toBeLessThan(80) // линия
    expect(at(W * 0.5, H * 0.1)).toBeLessThan(5) // трибуны другого цвета
  })
})

describe('настройки ключа по умолчанию', () => {
  it('допустимы схемой; границы чувствительности и мягкости проверяются', () => {
    expect(GrassKeySchema.safeParse(DEFAULT_GRASS_KEY).success).toBe(true)
    expect(GrassKeySchema.safeParse({ ...DEFAULT_GRASS_KEY, similarity: 0.0 }).success).toBe(false)
    expect(GrassKeySchema.safeParse({ ...DEFAULT_GRASS_KEY, similarity: 0.6 }).success).toBe(false)
    expect(GrassKeySchema.safeParse({ ...DEFAULT_GRASS_KEY, blend: 0.31 }).success).toBe(false)
    expect(GrassKeySchema.safeParse({ ...DEFAULT_GRASS_KEY, blend: 0 }).success).toBe(true)
    expect(GrassKeySchema.safeParse({ ...DEFAULT_GRASS_KEY, color: 'green' }).success).toBe(false)
  })
})
