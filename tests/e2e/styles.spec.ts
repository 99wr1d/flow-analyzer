// Новые стили рисунков (0.18): кольцо «как в образце» — тонкая обводка с мягким свечением, лежит на траве.
// Настоящее приложение: players.mp4 (газон, крупные игроки). Пиксели экрана сравниваются с кадром готового видео.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { frameRgb, pixelAt } from '../../src/main/ffmpeg/ffmpeg.testkit'
import { SHOTS, fixture, launch, makeUserData, seekVideo, stubDialog } from './helpers'
import { createProject } from './startHelpers'
import {
  clickAt,
  dragPath,
  geo,
  layerBox,
  readPng,
  shapes,
  type Frac,
  type Pixels
} from './toolsHelpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string; projectsDir: string }
type Rgb = [number, number, number]

const W = 640
const H = 360
/** Уровень толщины «Тонкая» (по умолчанию у кольца): 0.006 высоты кадра. */
const WIDTH = 0.006

const png = async (win: Page, name: string): Promise<Pixels> =>
  readPng(await win.screenshot(), SHOTS, `styles-px-${name}`)
const canvasOf = (win: Page) => win.getByTestId('under-canvas')

async function playersProject(ctx: Ctx, title: string): Promise<void> {
  await createProject(ctx, { title, video: fixture('players.mp4') })
  await seekVideo(ctx.win, 1)
  await ctx.win.keyboard.press('Escape')
}

/** Ждёт, пока слой «под игроками» нарисовал рисунки. */
async function waitUnderDrawn(win: Page): Promise<void> {
  await expect(canvasOf(win)).toHaveAttribute('data-renderer', 'webgl2')
  await expect
    .poll(async () => Number((await canvasOf(win).getAttribute('data-rasters')) ?? 0), {
      timeout: 10_000
    })
    .toBeGreaterThan(0)
  await win.waitForTimeout(250)
}

/** Наибольшее изменение канала R/G/B в окне 3×3 вокруг точки окна. */
function maxDelta(a: Pixels, b: Pixels, x: number, y: number): number {
  let best = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const p = a.at(x + dx, y + dy)
      const q = b.at(x + dx, y + dy)
      best = Math.max(best, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]))
    }
  }
  return best
}

interface Ellipse {
  cx: number
  cy: number
  rx: number
  ry: number
}

/** Эллипс рисунка в пикселях кадра видео. */
async function ellipseOf(win: Page, index = 0): Promise<Ellipse> {
  const g = await geo<{ p1: { x: number; y: number }; p2: { x: number; y: number } }>(
    shapes(win, 'circle').nth(index)
  )
  return {
    cx: ((g.p1.x + g.p2.x) / 2) * W,
    cy: ((g.p1.y + g.p2.y) / 2) * H,
    rx: (Math.abs(g.p2.x - g.p1.x) / 2) * W,
    ry: (Math.abs(g.p2.y - g.p1.y) / 2) * H
  }
}

/** Точка над верхней точкой эллипса на расстоянии o (в толщинах обводки) от её внешнего края (доли кадра). */
const aboveTop = (e: Ellipse, o: number): Frac => {
  const w = WIDTH * H
  return [e.cx / W, (e.cy - e.ry - w / 2 - o * w) / H]
}

async function exportWhole(ctx: Ctx): Promise<string> {
  const { app, win } = ctx
  const out = join(makeUserData(), 'out')
  mkdirSync(out)
  await stubDialog(app, out)
  await win.getByTestId('export-open').click()
  await expect(win.getByTestId('export-scope-whole')).toBeChecked()
  await expect(win.getByTestId('export-drawings')).toBeChecked()
  await win.getByTestId('export-start').click()
  await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 90_000 })
  await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
  const file = join(out, readdirSync(out)[0])
  await win
    .getByTestId('export-close')
    .click()
    .catch(() => undefined)
  return file
}

/** Разница кадра готового видео с исходным в точке (доли кадра): наибольшее изменение канала в окне 3×3. */
function videoDelta(exported: Buffer, source: Buffer, f: Frac): number {
  const x = Math.round(f[0] * W)
  const y = Math.round(f[1] * H)
  let best = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const p = pixelAt(exported, W, x + dx, y + dy)
      const q = pixelAt(source, W, x + dx, y + dy)
      best = Math.max(best, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]))
    }
  }
  return best
}

const rgbOf = (frame: Buffer, f: Frac): Rgb =>
  pixelAt(frame, W, Math.round(f[0] * W), Math.round(f[1] * H))

test.describe('кольцо «как в образце»', () => {
  test('щелчок: плоский эллипс 0.35 со свечением; ореол виден на экране и в экспорте, без свечения — нет', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await playersProject(ctx, 'Кольцо со свечением')
      const layer = await layerBox(win)
      const base = await png(win, 'glow-base')

      // Щелчок по траве: эллипс 7% высоты кадра шириной, высота — 0.35 от ширины (разметки поля нет).
      await win.getByTestId('tool-circle').click()
      await expect(win.getByTestId('glow-toggle')).toHaveAttribute('aria-pressed', 'true')
      await clickAt(win, [0.62, 0.8])
      const ring = shapes(win, 'circle')
      await expect(ring).toHaveCount(1)
      await expect(ring).toHaveAttribute('data-glow', 'true')
      await win.getByTestId('duration-input').fill('3')
      const e = await ellipseOf(win)
      expect(e.ry / e.rx).toBeGreaterThan(0.33)
      expect(e.ry / e.rx).toBeLessThan(0.37)
      expect(e.cx / W).toBeCloseTo(0.62, 2)
      expect(e.cy / H).toBeCloseTo(0.8, 2)
      await waitUnderDrawn(win)
      await win.keyboard.press('Escape')
      await win.getByTestId('tool-select').click()
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)

      // Экран: рядом с обводкой (0.8 толщины от края) трава подкрашена цветом кольца, далеко (6 толщин) — нет.
      const lit = await png(win, 'glow-on')
      const screenAt = (f: Frac): [number, number] => [
        layer.x + f[0] * layer.width,
        layer.y + f[1] * layer.height
      ]
      const near = aboveTop(e, 0.8)
      const far = aboveTop(e, 6)
      const dNear = maxDelta(lit, base, ...screenAt(near))
      const dFar = maxDelta(lit, base, ...screenAt(far))
      console.log(`Экран, ореол: рядом с обводкой ${dNear}, далеко ${dFar}`)
      expect(dNear).toBeGreaterThan(9)
      expect(dFar).toBeLessThan(6)
      // Оттенок ореола — цвет кольца (жёлтый): красный и зелёный растут сильнее синего.
      const [r0, g0, b0] = base.at(...screenAt(near))
      const [r1, g1, b1] = lit.at(...screenAt(near))
      expect(r1 - r0).toBeGreaterThan(b1 - b0)
      expect(g1 - g0).toBeGreaterThan(b1 - b0)

      // Экспорт: тот же ореол на кадре готового видео.
      const file = await exportWhole(ctx)
      const index = 35 // 1.4 с
      const exported = frameRgb(file, index, W, H)
      const source = frameRgb(fixture('players.mp4'), index, W, H)
      const vNear = videoDelta(exported, source, near)
      const vFar = videoDelta(exported, source, far)
      console.log(`Экспорт, ореол: рядом с обводкой ${vNear}, далеко ${vFar}`)
      expect(vNear).toBeGreaterThan(8)
      expect(vFar).toBeLessThan(9)
      const [er, eg, eb] = rgbOf(exported, near)
      const [sr, sg, sb] = rgbOf(source, near)
      expect(er - sr).toBeGreaterThan(eb - sb)
      expect(eg - sg).toBeGreaterThan(eb - sb)

      // Свечение выключено: ореола нет ни на экране, ни в кадре (выбираем кольцо — панель покажет его значение).
      await clickAt(win, [e.cx / W, (e.cy + e.ry) / H])
      await expect(ring).toHaveAttribute('data-selected', 'true')
      await win.getByTestId('glow-toggle').click()
      await expect(ring).not.toHaveAttribute('data-glow', 'true')
      await win.keyboard.press('Escape')
      await waitUnderDrawn(win)
      await win.waitForTimeout(250)
      const dark = await png(win, 'glow-off')
      // Без свечения возвращается прежняя тень (темнит траву), но не подкрашивает её цветом кольца.
      expect(dark.at(...screenAt(near))[0] - base.at(...screenAt(near))[0]).toBeLessThan(4)
      const file2 = await exportWhole(ctx)
      expect(rgbOf(frameRgb(file2, index, W, H), near)[0] - rgbOf(source, near)[0]).toBeLessThan(5)
    } finally {
      await ctx.app.close()
    }
  })

  test('«под игроками»: ореол ложится на траву и не закрывает игрока — на экране и в экспорте', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await playersProject(ctx, 'Ореол под игроком')
      const layer = await layerBox(win)
      const base = await png(win, 'under-base')
      // Эллипс вокруг ног красного игрока (x 120..164, y 130..250): верх эллипса проходит через тело.
      const cx = 142
      await win.getByTestId('tool-circle').click()
      await dragPath(win, [
        [(cx - 70) / W, 225 / H],
        [(cx + 70) / W, 275 / H]
      ])
      const ring = shapes(win, 'circle')
      await expect(ring).toHaveCount(1)
      await expect(ring).toHaveAttribute('data-glow', 'true')
      await expect(ring).toHaveAttribute('data-under', 'true')
      await win.getByTestId('duration-input').fill('3')
      await waitUnderDrawn(win)
      await win.keyboard.press('Escape')
      await win.getByTestId('tool-select').click()
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)
      const e = await ellipseOf(win)
      const lit = await png(win, 'under-on')
      const screenAt = (f: Frac): [number, number] => [
        layer.x + f[0] * layer.width,
        layer.y + f[1] * layer.height
      ]
      // Над верхом эллипса — тело игрока (ореол под ним, игрок чистый); слева от эллипса — трава (ореол виден).
      const body = aboveTop(e, 0.8)
      const grass: Frac = [(e.cx - e.rx) / W - (WIDTH * H * 1.5) / W, e.cy / H]
      const dBody = maxDelta(lit, base, ...screenAt(body))
      const dGrass = maxDelta(lit, base, ...screenAt(grass))
      console.log(`Экран: игрок под ореолом ${dBody}, трава у обводки ${dGrass}`)
      expect(dBody).toBeLessThan(12)
      expect(dGrass).toBeGreaterThan(9)

      const file = await exportWhole(ctx)
      const index = 35
      const exported = frameRgb(file, index, W, H)
      const source = frameRgb(fixture('players.mp4'), index, W, H)
      const vBody = videoDelta(exported, source, body)
      const vGrass = videoDelta(exported, source, grass)
      console.log(`Экспорт: игрок под ореолом ${vBody}, трава у обводки ${vGrass}`)
      expect(vBody).toBeLessThan(14)
      expect(vGrass).toBeGreaterThan(8)
    } finally {
      await ctx.app.close()
    }
  })

  test('панель показывает свечение выбранного кольца, а не умолчание для новых', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await playersProject(ctx, 'Переключатель свечения')
      const toggle = win.getByTestId('glow-toggle')
      // Недоступно, пока выбрано что-то кроме кольца.
      await win.getByTestId('tool-arrow').click()
      await expect(toggle).toBeDisabled()

      // Кольцо A (свечение по умолчанию включено).
      await win.getByTestId('tool-circle').click()
      await dragPath(win, [
        [0.55, 0.62],
        [0.7, 0.72]
      ])
      await expect(shapes(win, 'circle')).toHaveCount(1)
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      // Без выбора выключаем свечение «для новых» и рисуем кольцо B.
      await win.keyboard.press('Escape')
      await win.getByTestId('tool-circle').click()
      await expect(toggle).toBeEnabled()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await dragPath(win, [
        [0.2, 0.8],
        [0.35, 0.9]
      ])
      await expect(shapes(win, 'circle')).toHaveCount(2)
      await expect(shapes(win, 'circle').nth(1)).not.toHaveAttribute('data-glow', 'true')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      // Выбираем A: панель показывает ЕГО свечение (включено), хотя для новых оно выключено.
      await win.getByTestId('tool-select').click()
      const a = await ellipseOf(win, 0)
      await clickAt(win, [a.cx / W, (a.cy + a.ry) / H])
      await expect(shapes(win, 'circle').first()).toHaveAttribute('data-selected', 'true')
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      // Выключаем у A — меняется только A.
      await toggle.click()
      await expect(shapes(win, 'circle').first()).not.toHaveAttribute('data-glow', 'true')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    } finally {
      await ctx.app.close()
    }
  })
})
