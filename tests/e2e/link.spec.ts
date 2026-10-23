// «Связка» (0.19): точки у ног игроков — линия или область с лёгкой заливкой, кольца у ног, на поле — длины звеньев.
// Экран (cfr25.mp4) и поле (pitch.mp4); экран = экспорт — по пикселям.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { frameRgb, pixelAt } from '../../src/main/ffmpeg/ffmpeg.testkit'
import { SHOTS, SUFFIX, fixture, launch, makeUserData, seekVideo, stubDialog } from './helpers'
import { calibrate, openPitch, project, saveCalibration } from './pitchHelpers'
import { createProject } from './startHelpers'
import {
  clickAt,
  dblclickAt,
  dragPx,
  geo,
  handleCenter,
  px,
  setRange,
  shapes,
  type Frac
} from './toolsHelpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string; projectsDir: string }

const tool = (win: Page, id: string) => win.getByTestId(`tool-${id}`)
const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `link-${name}${SUFFIX}.png`) })
const world = (x: number, y: number): Frac => {
  const p = project(x, y)
  return [p.x, p.y]
}

async function screenProject(ctx: Ctx): Promise<void> {
  await createProject(ctx, { title: 'Связка', video: fixture('cfr25.mp4') })
  await seekVideo(ctx.win, 1)
}

interface Geo {
  points: Array<{ x: number; y: number }>
}
const pointsOf = async (win: Page, type: string, index = 0): Promise<Geo['points']> =>
  (await geo<Geo>(shapes(win, type).nth(index))).points

/** Три «игрока»: треугольник LW–N8–LB. */
const TRI: Frac[] = [
  [0.2, 0.3],
  [0.7, 0.35],
  [0.4, 0.8]
]

test.describe('связка на экране', () => {
  test('клавиша K и рейка, 3 щелчка и Enter: линия с кольцами у ног, белая и тонкая, под игроками', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await expect(tool(win, 'link')).toHaveAttribute('title', /Связка.*\(K\)$/)
      await win.keyboard.press('k')
      await expect(tool(win, 'link')).toHaveAttribute('aria-pressed', 'true')
      for (const p of TRI) await clickAt(win, p)
      await expect(win.getByTestId('poly-draft')).toHaveAttribute('data-points', '3')
      await expect(win.getByTestId('poly-hint')).toContainText('от 2 до 8')
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'link')).toHaveCount(1)
      await expect(win.getByTestId('poly-draft')).toHaveCount(0)
      const link = shapes(win, 'link')
      expect(await pointsOf(win, 'link')).toHaveLength(3)
      // Белая тонкая «Линия»: без заливки, по кольцу у каждой точки, под игроками.
      await expect(link).toHaveAttribute('data-color', '#ffffff')
      await expect(link).toHaveAttribute('data-under', 'true')
      await expect(link.locator('[data-part="fill"]')).toHaveCount(0)
      await expect(link.locator('[data-part="ring"]')).toHaveCount(3)
      await expect(win.getByTestId('link-line')).toHaveAttribute('aria-pressed', 'true')
      await expect(win.getByTestId('link-area')).toHaveAttribute('aria-pressed', 'false')
      await expect(win.getByTestId('link-rings')).toHaveAttribute('aria-pressed', 'true')
      await expect(win.getByTestId('width-0')).toHaveAttribute('aria-pressed', 'true')
      await shot(win, 'screen-line')
    } finally {
      await app.close()
    }
  })

  test('Backspace, Esc, двойной щелчок; минимум 2 точки, не больше 8', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('k')
      for (const p of TRI) await clickAt(win, p)
      await win.keyboard.press('Backspace')
      await expect(win.getByTestId('poly-draft')).toHaveAttribute('data-points', '2')
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('poly-draft')).toHaveCount(0)
      await expect(shapes(win, 'link')).toHaveCount(0)
      await expect(tool(win, 'link')).toHaveAttribute('aria-pressed', 'true')
      // Одна точка: Enter не завершает и объясняет почему.
      await clickAt(win, TRI[0])
      await win.keyboard.press('Enter')
      await expect(win.getByTestId('toast')).toContainText('минимум две точки')
      await expect(shapes(win, 'link')).toHaveCount(0)
      // Двойной щелчок на второй точке завершает связку из двух точек.
      await dblclickAt(win, TRI[1])
      await expect(shapes(win, 'link')).toHaveCount(1)
      expect(await pointsOf(win, 'link')).toHaveLength(2)
      await win.keyboard.press('Escape')
      await win.keyboard.press('k')
      // Восемь точек можно, девятая не ставится.
      const eight: Frac[] = Array.from({ length: 8 }, (_, i) => [
        0.1 + i * 0.1,
        0.5 + (i % 2) * 0.1
      ])
      for (const p of eight) await clickAt(win, p)
      await expect(win.getByTestId('poly-draft')).toHaveAttribute('data-points', '8')
      await clickAt(win, [0.5, 0.9])
      await expect(win.getByTestId('toast')).toContainText('не больше 8')
      await expect(win.getByTestId('poly-draft')).toHaveAttribute('data-points', '8')
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'link')).toHaveCount(2)
      expect(await pointsOf(win, 'link', 1)).toHaveLength(8)
    } finally {
      await app.close()
    }
  })

  test('«Область»: заливка 12% по умолчанию, ползунок 0–40%, кольца выключаются, значения выбранного, запоминание', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('k')
      // Выбор перед рисованием запоминается для новых связок.
      await win.getByTestId('link-area').click()
      for (const p of TRI) await clickAt(win, p)
      await win.keyboard.press('Enter')
      const link = shapes(win, 'link')
      await expect(link.locator('[data-part="fill"]')).toHaveCount(1)
      await expect(link.locator('[data-part="fill"]')).toHaveAttribute('fill-opacity', '0.12')
      await expect(win.getByTestId('link-area')).toHaveAttribute('aria-pressed', 'true')
      // Панель «Рисунок»: ползунок заливки.
      await win.keyboard.press('v')
      await setRange(win.getByTestId('prop-link-fill'), 30)
      await expect(link.locator('[data-part="fill"]')).toHaveAttribute('fill-opacity', '0.3')
      // Линия: заливки нет.
      await win.getByTestId('link-line').click()
      await expect(link.locator('[data-part="fill"]')).toHaveCount(0)
      await win.getByTestId('link-area').click()
      await expect(link.locator('[data-part="fill"]')).toHaveCount(1)
      // Кольца у ног выключаются и включаются, отмена возвращает.
      await win.getByTestId('link-rings').click()
      await expect(link.locator('[data-part="ring"]')).toHaveCount(0)
      await expect(win.getByTestId('link-rings')).toHaveAttribute('aria-pressed', 'false')
      await win.keyboard.press('Control+z')
      await expect(link.locator('[data-part="ring"]')).toHaveCount(3)
      // Пунктир «Точки» и свечение — как у линий 0.18.
      await win.getByTestId('dash-dotted').click()
      await expect(link.locator('[data-part="stroke"]').first()).toHaveAttribute(
        'stroke-dasharray',
        /.+/
      )
      await win.getByTestId('glow-toggle').click()
      await expect(link).toHaveAttribute('data-glow', 'true')
      await shot(win, 'screen-area-selected')
      // Снимаем выделение: следующая связка рисуется «Областью» с заливкой 30% (выбор запомнился).
      await win.keyboard.press('Escape')
      await win.keyboard.press('k')
      await win.getByTestId('dash-solid').click()
      for (const p of TRI) await clickAt(win, [p[0] - 0.15, p[1] + 0.1])
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'link')).toHaveCount(2)
      await expect(shapes(win, 'link').nth(1).locator('[data-part="fill"]')).toHaveAttribute(
        'fill-opacity',
        '0.3'
      )
    } finally {
      await app.close()
    }
  })

  test('точки тащатся, Alt+щелчок добавляет, Delete убирает; Ctrl+Z / Ctrl+Y', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('k')
      for (const p of TRI) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await win.keyboard.press('v')
      const before = await pointsOf(win, 'link')
      const v1 = await handleCenter(win, 'v1')
      await dragPx(win, v1, [v1[0], v1[1] - 60])
      const after = await pointsOf(win, 'link')
      expect(after[1].y).toBeLessThan(before[1].y - 0.05)
      expect(after[2]).toEqual(before[2])
      await win.keyboard.press('Control+z')
      expect(await pointsOf(win, 'link')).toEqual(before)
      const mid: Frac = [(before[1].x + before[2].x) / 2, (before[1].y + before[2].y) / 2]
      await clickAt(win, mid, { alt: true })
      expect(await pointsOf(win, 'link')).toHaveLength(4)
      await win.keyboard.press('Control+z')
      expect(await pointsOf(win, 'link')).toHaveLength(3)
      await win.keyboard.press('Control+y')
      const last = await handleCenter(win, 'v3')
      await win.mouse.click(last[0], last[1])
      await win.keyboard.press('Delete')
      expect(await pointsOf(win, 'link')).toHaveLength(3)
      await win.keyboard.press('Control+z')
      await win.keyboard.press('Control+z')
      await win.keyboard.press('Control+z')
      await expect(shapes(win, 'link')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('клавишу можно переназначить в настройках (группа «Рисование»)', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.getByTestId('open-settings').click()
      await win.getByTestId('settings-tab-keys').click()
      const row = win.locator('[data-testid="keys-row"][data-command="draw:link"]')
      await expect(row).toBeVisible()
      await win.locator('[data-testid="hotkey-edit"][data-command="draw:link"]').click()
      await win.keyboard.press('KeyQ')
      await win.getByTestId('settings-save').click()
      await expect(tool(win, 'link')).toHaveAttribute('title', /\(Q\)$/)
      await win.keyboard.press('q')
      await expect(tool(win, 'link')).toHaveAttribute('aria-pressed', 'true')
    } finally {
      await app.close()
    }
  })
})

test.describe('связка на поле', () => {
  test('метры: длины звеньев и «Ширина линии» у линии, у области — три звена; заливка 12%', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      await tool(win, 'link').click()
      // Четыре игрока вдоль x = 12: расстояния 8, 9 и 8 м, ширина 25 м.
      for (const y of [16, 24, 33, 41]) await clickAt(win, world(12, y))
      await win.keyboard.press('Enter')
      const link = shapes(win, 'plink')
      await expect(link).toHaveCount(1)
      await expect(link).toHaveAttribute('data-under', 'true')
      const segments = await link.getByTestId('segment-label').allTextContents()
      expect(segments).toHaveLength(3)
      const meters = segments.map((t) => Number(/([\d.]+)/.exec(t)?.[1]))
      console.log('Связка на поле: звенья', segments.join(' | '), 'ожидалось 8, 9, 8')
      expect(Math.abs(meters[0] - 8)).toBeLessThan(0.4)
      expect(Math.abs(meters[1] - 9)).toBeLessThan(0.4)
      expect(Math.abs(meters[2] - 8)).toBeLessThan(0.4)
      const width = await link.getByTestId('width-label').textContent()
      expect(Math.abs(Number(/([\d.]+) м/.exec(width ?? '')?.[1]) - 25)).toBeLessThan(0.6)
      const pts = await pointsOf(win, 'plink')
      expect(pts).toHaveLength(4)
      expect(Math.abs(pts[0].x - 12)).toBeLessThan(0.4)
      await shot(win, 'pitch-line')
      // «Область»: замыкающее звено, «Ширины линии» нет, заливка.
      await win.keyboard.press('v')
      await win.getByTestId('link-area').click()
      await expect(link.locator('[data-part="fill"]')).toHaveAttribute('fill-opacity', '0.12')
      await expect(link.getByTestId('segment-label')).toHaveCount(4)
      await expect(link.getByTestId('width-label')).toHaveCount(0)
      // Подписи выключаются.
      await win.getByTestId('prop-labels').uncheck()
      await expect(link.getByTestId('segment-label')).toHaveCount(0)
      await win.getByTestId('prop-labels').check()
      // Точка тащится: подпись пересчитывается.
      const v3 = await handleCenter(win, 'v3')
      const to = await px(win, world(12, 47))
      await dragPx(win, v3, to)
      const moved = await pointsOf(win, 'plink')
      expect(moved[3].y).toBeGreaterThan(pts[3].y + 3)
      await win.keyboard.press('Control+z')
      await win.keyboard.press('Escape')
      await shot(win, 'pitch-area')
    } finally {
      await app.close()
    }
  })
})

const W = 640
const H = 360

function makeOutDir(): string {
  const dir = join(makeUserData(), 'out')
  mkdirSync(dir)
  return dir
}

const luma = ([r, g, b]: [number, number, number]): number => 0.299 * r + 0.587 * g + 0.114 * b

test.describe('экспорт связки', () => {
  test('экран = экспорт: линия, кольцо у ног и заливка попадают в кадр видео там же, где на экране', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('k')
      await win.getByTestId('link-area').click()
      // С 0.16.4 новые рисунки лежат под игроками; на этом видео газона нет — кладём поверх, чтобы пиксели не прятались.
      await win.getByTestId('under-toggle').click()
      await win.getByTestId('width-2').click()
      const tri: Frac[] = [
        [0.1, 0.88],
        [0.4, 0.88],
        [0.25, 0.6]
      ]
      for (const p of tri) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await win.keyboard.press('v')
      await win.keyboard.press('Escape')
      await seekVideo(win, 1.5)
      await win.waitForTimeout(300)
      const out = makeOutDir()
      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-scope-whole')).toBeChecked()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 90_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const file = join(out, readdirSync(out)[0])
      const index = 38
      const rgb = frameRgb(file, index, W, H)
      const src = frameRgb(fixture('cfr25.mp4'), index, W, H)
      const at = (frame: Buffer, fx: number, fy: number): [number, number, number] =>
        pixelAt(frame, W, Math.round(fx * W), Math.round(fy * H))
      // Середина нижнего звена — белая линия.
      const onLine = at(rgb, 0.25, 0.88)
      console.log(
        'Экспорт связки: линия',
        onLine.join(','),
        'исходник',
        at(src, 0.25, 0.88).join(',')
      )
      expect(luma(onLine)).toBeGreaterThan(150)
      // Заливка внутри треугольника светлее исходного кадра.
      const inside = at(rgb, 0.25, 0.78)
      const insideSrc = at(src, 0.25, 0.78)
      console.log('Экспорт связки: заливка', inside.join(','), 'исходник', insideSrc.join(','))
      expect(luma(inside)).toBeGreaterThan(luma(insideSrc) + 3)
      // Кольцо у ноги: на боковой границе эллипса (rx = 0.015·H) светлее, чем в стороне от связки.
      const rx = (0.015 * H) / W
      const ring = at(rgb, 0.1 - rx, 0.88)
      console.log(
        'Экспорт связки: кольцо',
        ring.join(','),
        'исходник',
        at(src, 0.1 - rx, 0.88).join(',')
      )
      expect(luma(ring)).toBeGreaterThan(luma(at(src, 0.1 - rx, 0.88)) + 20)
    } finally {
      await app.close()
    }
  })
})
