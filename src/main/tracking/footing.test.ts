// Точка ног по кадру: середина нижней кромки рамки сдвигается к тому, что реально стоит на траве у низа рамки.
import { describe, expect, it } from 'vitest'
import { footX, FOOT_STRIP } from './footing'

const W = 200
const H = 120
const GRASS: [number, number, number] = [104, 122, 70]

/** Кадр: трава с лёгким шумом и прямоугольники заданного цвета. */
function frame(
  rects: Array<{ x: number; y: number; w: number; h: number; c: [number, number, number] }>
): Uint8Array {
  const rgba = new Uint8Array(W * H * 4)
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < W * H; i += 1) {
    const n = Math.round((rnd() - 0.5) * 10)
    rgba.set([GRASS[0] + n, GRASS[1] + n, GRASS[2] + n, 255], i * 4)
  }
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) rgba.set([...r.c, 255], (y * W + x) * 4)
    }
  }
  return rgba
}

describe('footX: ноги по кадру, а не середина рамки', () => {
  // Бегун бежит влево: опорная нога у левого края рамки, задняя нога поднята вправо (выше полосы у низа рамки).
  const box = { x: 60, y: 20, w: 60, h: 80 }
  const runner = frame([
    { x: 70, y: 20, w: 20, h: 50, c: [200, 30, 40] }, // корпус
    { x: 66, y: 70, w: 8, h: 30, c: [220, 200, 190] }, // опорная нога до низа рамки
    { x: 90, y: 72, w: 30, h: 8, c: [220, 200, 190] } // задняя нога поднята
  ])

  it('сдвигается к опорной ноге (середина рамки — 90, нога — 70)', () => {
    const x = footX(runner, W, H, box)
    expect(Math.abs(x - 70)).toBeLessThan(3)
  })

  it('обе ноги у низа рамки, задняя чуть приподнята: точка — у опорной (нижней) ноги', () => {
    const stride = frame([
      { x: 66, y: 80, w: 8, h: 20, c: [220, 200, 190] }, // опорная до низа рамки (y 100)
      { x: 104, y: 84, w: 10, h: 9, c: [220, 200, 190] } // задняя: низ на 93
    ])
    expect(Math.abs(footX(stride, W, H, box) - 70)).toBeLessThan(3)
  })

  it('обе ноги на траве — середина между ними', () => {
    const both = frame([
      { x: 66, y: 86, w: 8, h: 14, c: [220, 200, 190] },
      { x: 104, y: 86, w: 8, h: 14, c: [220, 200, 190] }
    ])
    expect(Math.abs(footX(both, W, H, box) - 89)).toBeLessThan(3)
  })

  it('белая линия разметки поперёк полосы (вертикальная, уходит ниже рамки) ногами не считается', () => {
    const line = frame([
      { x: 66, y: 86, w: 8, h: 14, c: [220, 200, 190] },
      { x: 105, y: 0, w: 4, h: H, c: [235, 238, 236] }
    ])
    expect(Math.abs(footX(line, W, H, box) - 70)).toBeLessThan(3)
  })

  it('горизонтальная линия разметки по низу рамки (уходит за рамку в стороны) ногами не считается', () => {
    const line = frame([
      { x: 66, y: 86, w: 8, h: 10, c: [220, 200, 190] },
      { x: 0, y: 97, w: W, h: 3, c: [235, 238, 236] }
    ])
    expect(Math.abs(footX(line, W, H, box) - 70)).toBeLessThan(3)
  })

  it('белые бутсы и гетры на траве тоже считаются ногами', () => {
    const white = frame([{ x: 100, y: 88, w: 10, h: 12, c: [235, 238, 236] }])
    expect(Math.abs(footX(white, W, H, box) - 105)).toBeLessThan(3)
  })

  it('у низа рамки только трава (ноги закрыты, пустой кадр) — середина рамки', () => {
    expect(footX(frame([]), W, H, box)).toBeCloseTo(90, 6)
    expect(footX(new Uint8Array(W * H * 4), W, H, box)).toBeCloseTo(90, 6)
  })

  it('тень на траве (темнее, та же цветность) ногами не считается', () => {
    const shadow = frame([
      { x: 64, y: 88, w: 8, h: 12, c: [220, 200, 190] },
      { x: 76, y: 92, w: 44, h: 8, c: [52, 61, 35] }
    ])
    expect(Math.abs(footX(shadow, W, H, box) - 68)).toBeLessThan(3)
  })

  it('сдвиг ограничен рамкой: не дальше 0.4 ширины от середины', () => {
    const edge = frame([{ x: 60, y: 90, w: 3, h: 10, c: [220, 200, 190] }])
    expect(footX(edge, W, H, box)).toBeGreaterThanOrEqual(90 - 0.4 * 60 - 1e-9)
  })

  it('рамка у края кадра и за ним: без ошибок', () => {
    expect(Number.isFinite(footX(runner, W, H, { x: -20, y: 90, w: 40, h: 40 }))).toBe(true)
    expect(Number.isFinite(footX(runner, W, H, { x: 190, y: 100, w: 30, h: 30 }))).toBe(true)
  })

  it('полоса у низа рамки — FOOT_STRIP её высоты', () => {
    expect(FOOT_STRIP).toBeGreaterThan(0.05)
    expect(FOOT_STRIP).toBeLessThan(0.2)
  })
})
