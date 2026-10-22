// Новые стили рисунков (0.18): кольцо «как в образце» — тонкая обводка с мягким свечением, лежит на траве.
// Подпись: жирная, без плашки, с тонкой тенью.
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

  test('щелчок в маленьком окне: плоский эллипс не отбрасывается как слишком маленький', async () => {
    const ctx = await launch()
    const { win, app } = ctx
    try {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.6)
      })
      await playersProject(ctx, 'Маленькое окно')
      await win.waitForTimeout(400)
      const layer = await layerBox(win)
      // Высота эллипса 0.07 · 0.35 · высота кадра меньше 8 px, если картинка ниже ~327 px.
      expect(layer.height).toBeLessThan(327)
      await win.getByTestId('tool-circle').click()
      await clickAt(win, [0.5, 0.7])
      await expect(shapes(win, 'circle')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })
})

/** Рамка подписи (по DOM букв, без тени) в пикселях экрана и её центр в долях кадра. */
async function labelBox(
  win: Page,
  index = 0
): Promise<{ f: Frac; box: { x: number; y: number; w: number; h: number } }> {
  const layer = await layerBox(win)
  const b = await shapes(win, 'text')
    .nth(index)
    .locator('[data-part="text"]')
    .evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
  return {
    f: [(b.x + b.w / 2 - layer.x) / layer.width, (b.y + b.h / 2 - layer.y) / layer.height],
    box: b
  }
}

async function typeLabel(win: Page, at: Frac, text: string): Promise<void> {
  await win.keyboard.press('t')
  await clickAt(win, at)
  await win.keyboard.type(text)
  await win.keyboard.press('Enter')
}

test.describe('подписи без плашки', () => {
  test('новая подпись: жирная, лайм, без плашки, с тенью; на экране и в готовом видео одинаково', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await playersProject(ctx, 'Подпись без плашки')
      const layer = await layerBox(win)
      const base = await png(win, 'label-base')
      await win.keyboard.press('t')
      await win.getByTestId('color-c6ff3d').click()
      await clickAt(win, [0.45, 0.78])
      await win.keyboard.type('LW')
      await win.keyboard.press('Enter')
      const label = shapes(win, 'text')
      await expect(label).toHaveCount(1)
      await win.getByTestId('duration-input').fill('3')
      // Панель показывает умолчания: плашки нет, тень есть.
      await expect(win.getByTestId('text-background')).toHaveAttribute('aria-pressed', 'false')
      await expect(win.getByTestId('text-shadow')).toHaveAttribute('aria-pressed', 'true')
      await expect(label).toHaveAttribute('data-color', '#c6ff3d')
      const parts = await label.evaluate((g) => ({
        plate: g.querySelectorAll('rect[fill^="rgba"]').length,
        shadows: g.querySelectorAll('[data-part="text-shadow"]').length,
        weight: Number(g.querySelector('[data-part="text"]')?.getAttribute('font-weight'))
      }))
      expect(parts.plate).toBe(0)
      expect(parts.shadows).toBeGreaterThanOrEqual(2)
      expect(parts.weight).toBeGreaterThanOrEqual(700)

      await win.keyboard.press('Escape')
      await win.getByTestId('tool-select').click()
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)
      const { box } = await labelBox(win)
      const shot = await png(win, 'label-on')
      // Экран: в углу рамки подписи плашки нет (трава не потемнела).
      const corner = maxDelta(shot, base, Math.round(box.x + 1), Math.round(box.y + 1))
      expect(corner).toBeLessThan(25)
      // Тень: рядом с буквами трава темнее, чем без подписи (лайм-буквы светлее травы и сюда не попадают).
      let darker = 0
      for (let y = Math.round(box.y); y < box.y + box.h; y += 1) {
        for (let x = Math.round(box.x); x < box.x + box.w; x += 1) {
          const p = shot.at(x, y)
          const q = base.at(x, y)
          darker = Math.max(darker, q[0] + q[1] + q[2] - (p[0] + p[1] + p[2]))
        }
      }
      console.log(`Экран: тень под буквами темнее на ${darker}`)
      expect(darker).toBeGreaterThan(20)

      // Экспорт: те же лайм-пиксели без плашки.
      const file = await exportWhole(ctx)
      const index = 35
      const exported = frameRgb(file, index, W, H)
      const source = frameRgb(fixture('players.mp4'), index, W, H)
      const fx = (x: number): number => Math.round(((x - layer.x) / layer.width) * W)
      const fy = (y: number): number => Math.round(((y - layer.y) / layer.height) * H)
      const x0 = fx(box.x)
      const x1 = fx(box.x + box.w)
      const y0 = fy(box.y)
      const y1 = fy(box.y + box.h)
      let lime = 0
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const [r, g, b] = pixelAt(exported, W, x, y)
          if (r > 150 && g > 200 && b < 140) lime += 1
        }
      }
      console.log(`Экспорт: лайм-пикселей подписи ${lime}`)
      expect(lime).toBeGreaterThan(15)
      expect(videoDelta(exported, source, [(x0 + 1) / W, (y0 + 1) / H])).toBeLessThan(25)
    } finally {
      await ctx.app.close()
    }
  })

  test('плашка: переключатель меняет подпись и запоминается для следующих; панель показывает значение выбранной', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await playersProject(ctx, 'Переключатель плашки')
      const bg = win.getByTestId('text-background')
      const sh = win.getByTestId('text-shadow')
      const plate = (i: number) => shapes(win, 'text').nth(i).locator('rect[fill^="rgba"]')
      await typeLabel(win, [0.2, 0.3], 'A')
      const labels = shapes(win, 'text')
      await expect(labels).toHaveCount(1)
      await expect(plate(0)).toHaveCount(0)
      // Выбранная подпись A: включаем плашку.
      await win.keyboard.press('v')
      const a = await labelBox(win, 0)
      await clickAt(win, a.f)
      await expect(labels.first()).toHaveAttribute('data-selected', 'true')
      await expect(bg).toHaveAttribute('aria-pressed', 'false')
      await bg.click()
      await expect(bg).toHaveAttribute('aria-pressed', 'true')
      await expect(plate(0)).toHaveCount(1)
      await win.keyboard.press('Escape')
      // Выбор запоминается для следующих (как цвет и толщина): B получает плашку.
      await typeLabel(win, [0.5, 0.3], 'B')
      await expect(labels).toHaveCount(2)
      await expect(plate(1)).toHaveCount(1)
      // Выбираем B и выключаем у неё плашку и тень — следующая подпись C получает «голый» текст.
      await win.keyboard.press('v')
      const b = await labelBox(win, 1)
      await clickAt(win, b.f)
      await expect(labels.nth(1)).toHaveAttribute('data-selected', 'true')
      await bg.click()
      await sh.click()
      await expect(plate(1)).toHaveCount(0)
      await expect(labels.nth(1).locator('[data-part="text-shadow"]')).toHaveCount(0)
      await win.keyboard.press('Escape')
      await typeLabel(win, [0.75, 0.3], 'C')
      await expect(labels).toHaveCount(3)
      await expect(plate(2)).toHaveCount(0)
      await expect(labels.nth(2).locator('[data-part="text-shadow"]')).toHaveCount(0)
      // Выбор A: панель показывает ЕЁ значения (плашка есть, тень есть), а не последние выбранные для новых.
      await win.keyboard.press('v')
      await clickAt(win, (await labelBox(win, 0)).f)
      await expect(labels.first()).toHaveAttribute('data-selected', 'true')
      await expect(bg).toHaveAttribute('aria-pressed', 'true')
      await expect(sh).toHaveAttribute('aria-pressed', 'true')
    } finally {
      await ctx.app.close()
    }
  })
})
