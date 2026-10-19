// Общие помощники для тестов с видео поля pitch.mp4: истина о камере, разметка поля по штрафной площади.
import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { fixture, seekVideo } from './helpers'
import { createProject } from './startHelpers'

export interface Pt {
  x: number
  y: number
}
export interface Truth {
  frame: { w: number; h: number }
  H: number[]
  points: {
    penaltyArea: { world: Pt; image: Pt }[]
    goalArea: { world: Pt; image: Pt }[]
    penaltySpot: { world: Pt; image: Pt }
  }
  players: { world: Pt }[]
}
export const truth = JSON.parse(readFileSync(fixture('pitch.json'), 'utf8')) as Truth
export const W = truth.frame.w
export const H = truth.frame.h

/** Точка поля (метры) → доли кадра по точной гомографии камеры. */
export function project(x: number, y: number): Pt {
  const h = truth.H
  const w = h[6] * x + h[7] * y + h[8]
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w }
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}
export async function layerBox(win: Page): Promise<Box> {
  const b = await win.getByTestId('annotation-layer').boundingBox()
  expect(b).not.toBeNull()
  return b!
}
export async function at(win: Page, p: Pt): Promise<[number, number]> {
  const b = await layerBox(win)
  return [b.x + p.x * b.width, b.y + p.y * b.height]
}
export async function click(win: Page, p: Pt): Promise<void> {
  const [x, y] = await at(win, p)
  await win.mouse.click(x, y)
}
export async function drag(win: Page, from: Pt, to: Pt, shift = false): Promise<void> {
  const [x0, y0] = await at(win, from)
  const [x1, y1] = await at(win, to)
  if (shift) await win.keyboard.down('Shift')
  await win.mouse.move(x0, y0)
  await win.mouse.down()
  await win.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 5 })
  await win.mouse.move(x1, y1, { steps: 5 })
  await win.mouse.up()
  if (shift) await win.keyboard.up('Shift')
}

/** Новый проект с видео поля, видео стоит на секунде 1. */
export async function openPitch(
  ctx: { app: ElectronApplication; win: Page },
  title = 'Поле'
): Promise<void> {
  await createProject(ctx, { title, video: fixture('pitch.mp4') })
  await seekVideo(ctx.win, 1)
}

/** Размечает поле по штрафной площади; extras — дополнительные точки для точности. Возвращает текст точности. */
export async function calibrate(
  win: Page,
  extras: 'none' | 'goal-area' = 'goal-area',
  jitter = false
): Promise<string> {
  // Неточная рука: каждый клик смещён на 1–1.5 экранных пикселя (1.5–3 пикселя видео), по заранее заданному образцу.
  let n = 0
  const click = async (w: Page, p: Pt): Promise<void> => {
    const [x, y] = await at(w, p)
    const [dx, dy] = jitter ? JITTER[n++ % JITTER.length] : [0, 0]
    await w.mouse.click(x + dx, y + dy)
  }
  await win.getByTestId('pitch-calibrate').click()
  await expect(win.getByTestId('calibration-mode')).toBeVisible()
  await expect(win.getByTestId('cal-status')).toContainText('точку 1 из 4')
  for (const [i, p] of truth.points.penaltyArea.entries()) {
    await click(win, p.image)
    if (i < 3) await expect(win.getByTestId('cal-status')).toContainText(`точку ${i + 2} из 4`)
  }
  await expect(win.getByTestId('cal-status')).toContainText('Все обязательные точки отмечены')
  await expect(win.getByTestId('cal-preview')).toBeVisible()
  if (extras === 'goal-area') {
    const extra = [
      ['ga-l1', truth.points.goalArea[0]],
      ['ga-l2', truth.points.goalArea[1]],
      ['ga-l3', truth.points.goalArea[2]],
      ['ga-l4', truth.points.goalArea[3]],
      ['ps-l', truth.points.penaltySpot]
    ] as const
    for (const [id, p] of extra) {
      await win.getByTestId('cal-add-point').click()
      await win.getByTestId(`cal-extra-${id}`).click()
      await expect(win.getByTestId('cal-status')).toContainText('Щёлкните по точке на видео')
      await click(win, p.image)
    }
  }
  return (await win.getByTestId('cal-accuracy').textContent()) ?? ''
}

export const JITTER: [number, number][] = [
  [1.2, -0.8],
  [-1, 1.1],
  [0.7, 1.4],
  [-1.3, -0.6],
  [0.9, -1.2],
  [-0.6, 0.8],
  [1.1, 0.5],
  [-0.9, -1],
  [0.4, -1.3]
]

export async function saveCalibration(win: Page): Promise<void> {
  await win.getByTestId('cal-save').click()
  await expect(win.getByTestId('calibration-mode')).toHaveCount(0)
  await expect(win.getByTestId('calibration-item')).toHaveCount(1)
}
