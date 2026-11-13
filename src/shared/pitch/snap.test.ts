import { describe, expect, it } from 'vitest'
import { snapToLines, type RgbaWindow } from './snap'

/** Синтетический кадр: трава с шумом и белые линии заданной ширины (отрезки по двум точкам). */
function scene(
  size: number,
  lines: Array<[number, number, number, number]>,
  opts: { width?: number; noise?: number; seed?: number } = {}
): RgbaWindow {
  const width = opts.width ?? 3
  const noise = opts.noise ?? 0
  let s = opts.seed ?? 7
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let onLine = false
      for (const [x1, y1, x2, y2] of lines) {
        const dx = x2 - x1
        const dy = y2 - y1
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= width / 2) onLine = true
      }
      const i = (y * size + x) * 4
      const n = (rnd() - 0.5) * 2 * noise
      if (onLine) {
        data[i] = 225 + n
        data[i + 1] = 228 + n
        data[i + 2] = 222 + n
      } else {
        data[i] = 45 + n
        data[i + 1] = 135 + n
        data[i + 2] = 55 + n
      }
      data[i + 3] = 255
    }
  }
  return { data, width: size, height: size }
}

describe('snapToLines', () => {
  it('подтягивает клик к пересечению двух линий под прямым углом', () => {
    const img = scene(64, [
      [0, 30, 63, 30],
      [34, 0, 34, 63]
    ])
    const r = snapToLines(img, 38, 27, 14)
    expect(r?.kind).toBe('intersection')
    expect(r!.x).toBeCloseTo(34, 0)
    expect(r!.y).toBeCloseTo(30, 0)
  })

  it('находит пересечение под косым углом', () => {
    const img = scene(64, [
      [0, 50, 63, 14],
      [20, 0, 45, 63]
    ])
    // точка пересечения прямых: найдём численно
    const r = snapToLines(img, 33, 33, 14)
    expect(r?.kind).toBe('intersection')
    const hit = intersection([0, 50, 63, 14], [20, 0, 45, 63])
    expect(Math.hypot(r!.x - hit.x, r!.y - hit.y)).toBeLessThan(1)
  })

  it('держится при шуме газона', () => {
    const img = scene(
      64,
      [
        [0, 30, 63, 30],
        [34, 0, 34, 63]
      ],
      { noise: 14 }
    )
    const r = snapToLines(img, 36, 33, 14)
    expect(r?.kind).toBe('intersection')
    expect(Math.hypot(r!.x - 34, r!.y - 30)).toBeLessThan(1.2)
  })

  it('при одной линии кладёт точку на неё', () => {
    const img = scene(64, [[0, 30, 63, 30]])
    const r = snapToLines(img, 20, 34, 14)
    expect(r?.kind).toBe('line')
    expect(r!.y).toBeCloseTo(30, 0)
    expect(r!.x).toBeCloseTo(20, 0)
  })

  it('без линий возвращает null', () => {
    expect(snapToLines(scene(64, []), 32, 32, 14)).toBeNull()
  })

  it('не цепляется за пересечение дальше радиуса', () => {
    const img = scene(64, [
      [0, 10, 63, 10],
      [10, 0, 10, 63]
    ])
    expect(snapToLines(img, 50, 50, 14)).toBeNull()
  })

  it('выбирает ближайшее из нескольких пересечений', () => {
    const img = scene(64, [
      [0, 20, 63, 20],
      [0, 44, 63, 44],
      [32, 0, 32, 63]
    ])
    const r = snapToLines(img, 33, 41, 14)
    expect(r?.kind).toBe('intersection')
    expect(Math.hypot(r!.x - 32, r!.y - 44)).toBeLessThan(1)
  })

  it('две почти параллельные линии не дают пересечения', () => {
    const img = scene(64, [
      [0, 28, 63, 30],
      [0, 36, 63, 36]
    ])
    const r = snapToLines(img, 32, 32, 14)
    expect(r?.kind).not.toBe('intersection')
  })

  it('не принимает широкую светлую полосу за линию', () => {
    const img = scene(64, [[0, 30, 63, 30]], { width: 18 })
    expect(snapToLines(img, 32, 32, 14)).toBeNull()
  })
})

function intersection(
  a: [number, number, number, number],
  b: [number, number, number, number]
): { x: number; y: number } {
  const [x1, y1, x2, y2] = a
  const [x3, y3, x4, y4] = b
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / d
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / d
  return { x: px, y: py }
}
