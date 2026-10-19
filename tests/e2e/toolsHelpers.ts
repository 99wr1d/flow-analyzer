// Помощники для тестов новых инструментов: мышь по картинке в долях кадра, чтение геометрии рисунков.
import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { frameRgb, pixelAt } from '../../src/main/ffmpeg/ffmpeg.testkit'

export type Frac = [number, number]

export interface LayerBox {
  x: number
  y: number
  width: number
  height: number
}

export async function layerBox(win: Page): Promise<LayerBox> {
  const b = await win.getByTestId('annotation-layer').boundingBox()
  expect(b).not.toBeNull()
  return b!
}

/** Точка картинки (доли кадра) → координаты окна. */
export async function px(win: Page, [fx, fy]: Frac): Promise<[number, number]> {
  const b = await layerBox(win)
  return [b.x + fx * b.width, b.y + fy * b.height]
}

export async function clickAt(
  win: Page,
  p: Frac,
  opts: { alt?: boolean; shift?: boolean } = {}
): Promise<void> {
  const [x, y] = await px(win, p)
  if (opts.alt) await win.keyboard.down('Alt')
  if (opts.shift) await win.keyboard.down('Shift')
  await win.mouse.click(x, y)
  if (opts.shift) await win.keyboard.up('Shift')
  if (opts.alt) await win.keyboard.up('Alt')
}

export async function dblclickAt(win: Page, p: Frac): Promise<void> {
  const [x, y] = await px(win, p)
  await win.mouse.dblclick(x, y)
}

/** Мышь идёт по ломаной с нажатой кнопкой (steps — промежуточных движений на каждое звено). */
export async function dragPath(win: Page, path: Frac[], steps = 6): Promise<void> {
  const pts = await Promise.all(path.map((p) => px(win, p)))
  await win.mouse.move(pts[0][0], pts[0][1])
  await win.mouse.down()
  for (const [x, y] of pts.slice(1)) await win.mouse.move(x, y, { steps })
  await win.mouse.up()
}

export const shapes = (win: Page, type: string): Locator =>
  win.locator(`[data-testid="annotation"][data-type="${type}"]:not([data-id="poly-draft"])`)

export async function geo<T = Record<string, unknown>>(l: Locator): Promise<T> {
  return JSON.parse((await l.first().getAttribute('data-geo')) ?? '{}') as T
}

/** Яркость (0..255) пикселя картинки в окне: по скриншоту, который сделал Playwright. */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export interface Pixels {
  w: number
  h: number
  at: (x: number, y: number) => [number, number, number]
}

/** Пиксели PNG (скриншот Playwright): раскладываются ffmpeg, размер берётся из заголовка PNG. */
export function readPng(png: Buffer, tmpDir: string, name: string): Pixels {
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  const path = join(tmpDir, `${name}.png`)
  writeFileSync(path, png)
  const rgb = frameRgb(path, 0, w, h)
  return { w, h, at: (x, y) => pixelAt(rgb, w, Math.round(x), Math.round(y)) }
}

/** Средняя яркость квадрата со стороной 2·r вокруг (cx, cy). */
export function avgLuma(p: Pixels, cx: number, cy: number, r = 3): number {
  let sum = 0
  let n = 0
  for (let y = Math.round(cy) - r; y <= Math.round(cy) + r; y += 1) {
    for (let x = Math.round(cx) - r; x <= Math.round(cx) + r; x += 1) {
      const [rr, g, b] = p.at(x, y)
      sum += luma(rr, g, b)
      n += 1
    }
  }
  return sum / n
}

/** Билинейная выборка яркости-цвета из PNG (дробные координаты). */
export function bilinear(p: Pixels, x: number, y: number): [number, number, number] {
  const x0 = Math.max(0, Math.min(p.w - 2, Math.floor(x)))
  const y0 = Math.max(0, Math.min(p.h - 2, Math.floor(y)))
  const fx = Math.max(0, Math.min(1, x - x0))
  const fy = Math.max(0, Math.min(1, y - y0))
  const a = p.at(x0, y0)
  const b = p.at(x0 + 1, y0)
  const c = p.at(x0, y0 + 1)
  const d = p.at(x0 + 1, y0 + 1)
  return [0, 1, 2].map(
    (i) => a[i] * (1 - fx) * (1 - fy) + b[i] * fx * (1 - fy) + c[i] * (1 - fx) * fy + d[i] * fx * fy
  ) as [number, number, number]
}

export const colorDiff = (a: [number, number, number], b: [number, number, number]): number =>
  (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3

/** Перетаскивание мышью между двумя точками окна (пиксели). */
export async function dragPx(
  win: Page,
  from: [number, number],
  to: [number, number],
  steps = 8
): Promise<void> {
  await win.mouse.move(from[0], from[1])
  await win.mouse.down()
  await win.mouse.move(to[0], to[1], { steps })
  await win.mouse.up()
}

/** Центр ручки выбранного рисунка (data-handle) в координатах окна. */
export async function handleCenter(win: Page, id: string): Promise<[number, number]> {
  const box = await win.locator(`[data-testid="handles"] [data-handle="${id}"]`).boundingBox()
  expect(box, `ручка ${id}`).not.toBeNull()
  return [box!.x + box!.width / 2, box!.y + box!.height / 2]
}

/** Ползунок: значение задаётся так, чтобы React увидел событие. */
export async function setRange(l: Locator, value: number): Promise<void> {
  await l.evaluate((el, v) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/** Расстояние между точками в долях кадра, пересчитанное в пиксели картинки. */
export const pxDist = (a: Frac, b: Frac, w: number, h: number): number =>
  Math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h)
