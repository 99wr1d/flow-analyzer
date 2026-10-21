// Этап 15: прожектор, изогнутая стрелка, перо, зона, лупа, связи игроков — на экране (cfr25.mp4) и на поле (pitch.mp4).
// Каждый инструмент: создание клавишей и с рейки, правка (ручки, свойства), отмена/повтор, пиксели на экране и в экспорте.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { ff, frameRgb, pixelAt } from '../../src/main/ffmpeg/ffmpeg.testkit'
import { loupeGeometry } from '../../src/shared/tools/loupe'
import { curveMid } from '../../src/shared/tools/curve'
import { SHOTS, SUFFIX, fixture, launch, makeUserData, seekVideo, stubDialog } from './helpers'
import { calibrate, openPitch, project, saveCalibration, truth } from './pitchHelpers'
import { cardByTitle, createProject, seedProject } from './startHelpers'
import {
  avgLuma,
  bilinear,
  clickAt,
  colorDiff,
  dblclickAt,
  dragPath,
  dragPx,
  geo,
  handleCenter,
  layerBox,
  px,
  readPng,
  setRange,
  shapes,
  type Frac
} from './toolsHelpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string; projectsDir: string }

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `tools-${name}${SUFFIX}.png`) })
const png = async (win: Page, name: string): Promise<ReturnType<typeof readPng>> =>
  readPng(await win.screenshot(), SHOTS, `tools-px-${name}`)

const tool = (win: Page, id: string) => win.getByTestId(`tool-${id}`)
const pt = (p: { x: number; y: number }): Frac => [p.x, p.y]
const world = (x: number, y: number): Frac => pt(project(x, y))

async function screenProject(ctx: Ctx, title = 'Инструменты'): Promise<void> {
  await createProject(ctx, { title, video: fixture('cfr25.mp4') })
  await seekVideo(ctx.win, 1)
}

/** Снимает выделение рисунка (Esc при инструменте «Выбор»). */
async function deselect(win: Page): Promise<void> {
  await win.keyboard.press('v')
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('inspector')).toHaveCount(0)
}

/** Отменяет шаги, пока рисунок не исчезнет (count − 1 рисунков), затем повторяет столько же шагов. */
async function undoRedo(win: Page, type: string, count: number): Promise<void> {
  let steps = 0
  while ((await shapes(win, type).count()) >= count && steps < 12) {
    await win.keyboard.press('Control+z')
    steps += 1
    await win.waitForTimeout(40)
  }
  await expect(shapes(win, type)).toHaveCount(count - 1)
  for (let i = 0; i < steps; i += 1) await win.keyboard.press('Control+y')
  await expect(shapes(win, type)).toHaveCount(count)
}

interface Pts {
  points: Array<{ x: number; y: number }>
}
const pointsOf = async (win: Page, type: string, index = 0): Promise<Pts['points']> =>
  (await geo<Pts>(shapes(win, type).nth(index))).points

test.describe('рейка инструментов и клавиши', () => {
  test('три группы, подсказки с клавишами, все 12 инструментов помещаются при высоте окна 700', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setSize(1100, 700)
      })
      await win.waitForTimeout(300)
      for (const g of ['basic', 'field', 'advanced']) {
        await expect(win.getByTestId(`tool-group-${g}`)).toBeVisible()
      }
      const keys: Record<string, string> = {
        select: 'V',
        arrow: 'A',
        curve: 'B',
        line: 'L',
        circle: 'C',
        text: 'T',
        spot: 'S',
        zone: 'Z',
        chain: 'N',
        pen: 'D',
        loupe: 'G'
      }
      for (const [id, key] of Object.entries(keys)) {
        await expect(tool(win, id)).toHaveAttribute('title', new RegExp(`\\(${key}\\)$`))
      }
      // Линейка без разметки поля недоступна и подсказывает, что делать.
      await expect(tool(win, 'ruler')).toBeDisabled()
      // Рейка не прокручивается: все кнопки целиком в окне.
      const fits = await win.evaluate(() => {
        const nav = document.querySelector('nav.tool-rail') as HTMLElement
        const rect = nav.getBoundingClientRect()
        const buttons = [...nav.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
        return {
          scrolls: nav.scrollHeight > nav.clientHeight + 1,
          lowest: Math.max(...buttons.map((b) => b.bottom)),
          navBottom: rect.bottom,
          count: buttons.length,
          viewport: window.innerHeight
        }
      })
      console.log('Рейка при окне 700 px:', JSON.stringify(fits))
      expect(fits.count).toBe(12)
      expect(fits.scrolls).toBe(false)
      expect(fits.lowest).toBeLessThanOrEqual(fits.navBottom)
      expect(fits.lowest).toBeLessThanOrEqual(fits.viewport)
      await shot(win, 'rail-700')
    } finally {
      await app.close()
    }
  })

  test('клавиши новых инструментов переназначаются в настройках (группа «Рисование»)', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.getByTestId('open-settings').click()
      await win.getByTestId('settings-tab-keys').click()
      for (const id of ['spot', 'curve', 'pen', 'zone', 'chain', 'loupe']) {
        const row = win.locator(`[data-testid="keys-row"][data-command="draw:${id}"]`)
        await expect(row).toHaveCount(1)
        await expect(row).toBeVisible()
      }
      const edit = win.locator('[data-testid="hotkey-edit"][data-command="draw:spot"]')
      await edit.click()
      await win.keyboard.press('KeyQ')
      await expect(
        win.locator(
          '[data-testid="hotkey-field"][data-command="draw:spot"] [data-testid="hotkey-value"]'
        )
      ).toHaveText('Q')
      await win.getByTestId('settings-save').click()
      await expect(tool(win, 'spot')).toHaveAttribute('title', /\(Q\)$/)
      await win.keyboard.press('q')
      await expect(tool(win, 'spot')).toHaveAttribute('aria-pressed', 'true')
      await win.keyboard.press('v')
      await win.keyboard.press('s')
      await expect(tool(win, 'spot')).toHaveAttribute('aria-pressed', 'false')
    } finally {
      await app.close()
    }
  })
})

test.describe('прожектор', () => {
  test('экран: затемнение вне пятна, общая маска для двух прожекторов, ползунок, отмена', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      const before = await png(win, 'spot-before')
      await win.keyboard.press('s')
      await clickAt(win, [0.3, 0.5])
      await expect(shapes(win, 'spot')).toHaveCount(1)
      const g = await geo<{ p1: { x: number; y: number }; p2: { x: number; y: number } }>(
        shapes(win, 'spot')
      )
      // Щелчок без протягивания: высокий эллипс вокруг точки.
      const box = await layerBox(win)
      const w = Math.abs(g.p2.x - g.p1.x) * box.width
      const h = Math.abs(g.p2.y - g.p1.y) * box.height
      expect(h).toBeGreaterThan(w * 1.5)
      expect((g.p1.x + g.p2.x) / 2).toBeCloseTo(0.3, 2)
      await expect(win.getByTestId('spotlight-dim')).toHaveAttribute('data-dim', '0.55')
      await deselect(win)
      const after = await png(win, 'spot-after')
      const [cx, cy] = await px(win, [0.3, 0.5])
      const [ox, oy] = await px(win, [0.92, 0.1])
      const outside = avgLuma(after, ox, oy) / avgLuma(before, ox, oy)
      const inside = avgLuma(after, cx, cy) / avgLuma(before, cx, cy)
      console.log(
        'Прожектор на экране: яркость вне пятна ×',
        outside.toFixed(3),
        '(ожидалось 0.45), в центре ×',
        inside.toFixed(3)
      )
      expect(outside).toBeGreaterThan(0.4)
      expect(outside).toBeLessThan(0.5)
      expect(inside).toBeGreaterThan(0.96)
      expect(inside).toBeLessThan(1.04)
      await shot(win, 'spot-screen')

      // Второй прожектор — с рейки; маска одна, дыр две.
      await tool(win, 'spot').click()
      await clickAt(win, [0.72, 0.7])
      await expect(shapes(win, 'spot')).toHaveCount(2)
      await expect(win.getByTestId('spotlight-dim')).toHaveCount(1)
      await expect(win.getByTestId('spotlight-dim')).toHaveAttribute('data-holes', '2')
      await tool(win, 'select').click()
      // Ползунок: 20–80 %.
      const slider = win.getByTestId('prop-dim')
      await expect(slider).toHaveAttribute('min', '20')
      await expect(slider).toHaveAttribute('max', '80')
      await setRange(slider, 30)
      await expect(win.getByTestId('prop-dim-value')).toHaveText('30%')
      expect((await geo<{ dim: number }>(shapes(win, 'spot').nth(1))).dim).toBe(0.3)
      // У двух прожекторов затемнение общее — самое сильное (первый остался 0.55).
      await expect(win.getByTestId('spotlight-dim')).toHaveAttribute('data-dim', '0.55')
      await clickAt(win, [0.3, 0.5])
      await setRange(win.getByTestId('prop-dim'), 20)
      await expect(win.getByTestId('spotlight-dim')).toHaveAttribute('data-dim', '0.3')
      // Отмена возвращает затемнение первого, повтор — снова 20 %.
      await win.keyboard.press('Control+z')
      await expect(win.getByTestId('spotlight-dim')).toHaveAttribute('data-dim', '0.55')
      await win.keyboard.press('Control+y')
      await expect(win.getByTestId('spotlight-dim')).toHaveAttribute('data-dim', '0.3')
      // Созданные рисунки отменяются и возвращаются.
      await undoRedo(win, 'spot', 2)
      await expect(shapes(win, 'spot')).toHaveCount(2)
      await deselect(win)
      await shot(win, 'spot-two-screen')
    } finally {
      await app.close()
    }
  })

  test('экран: прожектор растягивается рамкой и двигается за углы; Esc по рейке', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await tool(win, 'spot').click()
      await dragPath(win, [
        [0.5, 0.3],
        [0.7, 0.6]
      ])
      const g = await geo<{ p1: { x: number; y: number }; p2: { x: number; y: number } }>(
        shapes(win, 'spot')
      )
      expect(g.p1.x).toBeCloseTo(0.5, 2)
      expect(g.p2.y).toBeCloseTo(0.6, 2)
      await win.keyboard.press('v')
      const se = await handleCenter(win, 'se')
      const [tx, ty] = await px(win, [0.8, 0.8])
      await dragPx(win, se, [tx, ty])
      const g2 = await geo<{ p2: { x: number; y: number } }>(shapes(win, 'spot'))
      expect(g2.p2.x).toBeCloseTo(0.8, 2)
      expect(g2.p2.y).toBeCloseTo(0.8, 2)
      await win.keyboard.press('Control+z')
      expect((await geo<{ p2: { x: number } }>(shapes(win, 'spot'))).p2.x).toBeCloseTo(0.7, 2)
    } finally {
      await app.close()
    }
  })

  test('поле: эллипс на траве с лучом, затемнение, ползунок, радиус ручкой, «Только кадр»', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      const before = await png(win, 'pspot-before')
      const player = truth.players[0].world
      await win.keyboard.press('s')
      await clickAt(win, world(player.x, player.y))
      await expect(shapes(win, 'pspot')).toHaveCount(1)
      const g = await geo<{ center: { x: number; y: number }; radius: number; beam: boolean }>(
        shapes(win, 'pspot')
      )
      expect(Math.hypot(g.center.x - player.x, g.center.y - player.y)).toBeLessThan(0.5)
      expect(g.radius).toBe(2.2)
      expect(g.beam).toBe(true)
      // «Только кадр» по умолчанию.
      await expect(win.getByTestId('mode-frame')).toHaveAttribute('aria-pressed', 'true')
      await expect(shapes(win, 'pspot').locator('[data-part="beam"]')).toHaveCount(1)
      await shot(win, 'spot-pitch-selected')
      // Луч выключается галочкой.
      await win.keyboard.press('v')
      await win.getByTestId('prop-beam').uncheck()
      await expect(shapes(win, 'pspot').locator('[data-part="beam"]')).toHaveCount(0)
      expect((await geo<{ beam: boolean }>(shapes(win, 'pspot'))).beam).toBe(false)
      await win.keyboard.press('Control+z')
      await expect(shapes(win, 'pspot').locator('[data-part="beam"]')).toHaveCount(1)
      // Радиус ручкой.
      const handle = await handleCenter(win, 'radius')
      const [tx, ty] = await px(win, world(player.x + 4, player.y))
      await dragPx(win, handle, [tx, ty])
      const r = (await geo<{ radius: number }>(shapes(win, 'pspot'))).radius
      console.log('Радиус прожектора после ручки:', r.toFixed(2), 'ожидалось ≈ 4')
      expect(r).toBeGreaterThan(3.6)
      expect(r).toBeLessThan(4.4)
      await deselect(win)
      // Затемнение вне пятна и неизменный центр.
      const after = await png(win, 'pspot-after')
      const [cx, cy] = await px(win, world(player.x, player.y))
      const [ox, oy] = await px(win, [0.9, 0.12])
      const outside = avgLuma(after, ox, oy) / avgLuma(before, ox, oy)
      expect(outside).toBeGreaterThan(0.38)
      expect(outside).toBeLessThan(0.52)
      const inside = avgLuma(after, cx, cy) / avgLuma(before, cx, cy)
      expect(inside).toBeGreaterThan(0.9)
      await shot(win, 'spot-pitch')
      await undoRedo(win, 'pspot', 1)
    } finally {
      await app.close()
    }
  })
})

test.describe('изогнутая стрелка', () => {
  test('экран: клавиша B, изгиб средней ручкой, Shift, пунктир, отмена; создание с рейки', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('b')
      await expect(tool(win, 'curve')).toHaveAttribute('aria-pressed', 'true')
      await dragPath(win, [
        [0.2, 0.8],
        [0.6, 0.8]
      ])
      await expect(shapes(win, 'curve')).toHaveCount(1)
      type Curve = {
        p1: { x: number; y: number }
        p2: { x: number; y: number }
        c: { x: number; y: number }
      }
      const g0 = await geo<Curve>(shapes(win, 'curve'))
      // Новая стрелка уже изогнута (вверх от хорды).
      expect(g0.c.y).toBeLessThan(0.8 - 0.05)
      expect(shapes(win, 'curve').locator('[data-part="stroke"]')).toHaveCount(1)
      await shot(win, 'curve-screen-new')

      // Изгиб: тянем среднюю ручку к (0.4, 0.3) — кривая проходит через эту точку.
      await win.keyboard.press('v')
      const mid = await handleCenter(win, 'c')
      const m0 = curveMid(g0.p1, g0.c, g0.p2)
      const [mx, my] = await px(win, [m0.x, m0.y])
      expect(Math.hypot(mid[0] - mx, mid[1] - my)).toBeLessThan(2)
      const target = await px(win, [0.4, 0.3])
      await dragPx(win, mid, target)
      const g1 = await geo<Curve>(shapes(win, 'curve'))
      const m1 = curveMid(g1.p1, g1.c, g1.p2)
      console.log('Изгиб: середина кривой', JSON.stringify(m1), 'ожидалось (0.4, 0.3)')
      expect(m1.x).toBeCloseTo(0.4, 2)
      expect(m1.y).toBeCloseTo(0.3, 2)
      expect(g1.p1).toEqual(g0.p1)
      expect(g1.p2).toEqual(g0.p2)
      await shot(win, 'curve-screen')
      // Пунктир (стиль применяется к выбранной).
      await win.getByTestId('dash-dashed').click()
      await expect(shapes(win, 'curve').locator('[data-part="stroke"]')).toHaveAttribute(
        'stroke-dasharray',
        /\d/
      )
      // Отмена: сначала пунктир, затем изгиб.
      await win.keyboard.press('Control+z')
      await expect(shapes(win, 'curve').locator('[data-part="stroke"]')).not.toHaveAttribute(
        'stroke-dasharray',
        /\d/
      )
      await win.keyboard.press('Control+z')
      expect((await geo<Curve>(shapes(win, 'curve'))).c).toEqual(g0.c)
      await win.keyboard.press('Control+y')
      await win.keyboard.press('Control+y')
      await expect(win.getByTestId('dash-dashed')).toHaveAttribute('aria-pressed', 'true')
      await win.keyboard.press('Control+z')
      await win.keyboard.press('Control+z')

      // Рейка + Shift: направление привязывается к 15°, концы по одной горизонтали.
      await tool(win, 'curve').click()
      await win.keyboard.down('Shift')
      await dragPath(win, [
        [0.15, 0.2],
        [0.5, 0.22]
      ])
      await win.keyboard.up('Shift')
      await expect(shapes(win, 'curve')).toHaveCount(2)
      const snapped = await geo<Curve>(shapes(win, 'curve').nth(1))
      expect(snapped.p2.y).toBeCloseTo(snapped.p1.y, 6)
      await undoRedo(win, 'curve', 2)
    } finally {
      await app.close()
    }
  })

  test('поле: кривая в метрах, изгиб ручкой, «Только кадр»', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      await tool(win, 'curve').click()
      await dragPath(win, [world(3, 22), world(14, 44)])
      await expect(shapes(win, 'pcurve')).toHaveCount(1)
      type PCurve = {
        p1: { x: number; y: number }
        p2: { x: number; y: number }
        c: { x: number; y: number }
      }
      const g0 = await geo<PCurve>(shapes(win, 'pcurve'))
      expect(Math.hypot(g0.p1.x - 3, g0.p1.y - 22)).toBeLessThan(0.5)
      expect(Math.hypot(g0.p2.x - 14, g0.p2.y - 44)).toBeLessThan(0.5)
      await expect(win.getByTestId('mode-frame')).toHaveAttribute('aria-pressed', 'true')
      await win.keyboard.press('v')
      const mid = await handleCenter(win, 'c')
      // Тянем середину кривой в точку поля (13, 28).
      const target = await px(win, world(13, 28))
      await dragPx(win, mid, target)
      const g1 = await geo<PCurve>(shapes(win, 'pcurve'))
      const m = curveMid(g1.p1, g1.c, g1.p2)
      console.log('Кривая на поле: середина', m.x.toFixed(2), m.y.toFixed(2), 'ожидалось (13, 28)')
      expect(Math.hypot(m.x - 13, m.y - 28)).toBeLessThan(0.5)
      await deselect(win)
      await shot(win, 'curve-pitch')
      await undoRedo(win, 'pcurve', 1)
    } finally {
      await app.close()
    }
  })
})

test.describe('перо', () => {
  test('экран: клавиша D, точек меньше, чем движений мыши, сглаженная линия, стрелка на конце, отмена', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('d')
      await expect(tool(win, 'pen')).toHaveAttribute('aria-pressed', 'true')
      // Волна: четыре звена по 12 промежуточных движений мыши (≈ 49 точек до упрощения).
      const wave: Frac[] = [
        [0.1, 0.25],
        [0.18, 0.12],
        [0.26, 0.25],
        [0.34, 0.12],
        [0.42, 0.25]
      ]
      await dragPath(win, wave, 12)
      await expect(shapes(win, 'pen')).toHaveCount(1)
      const points = await pointsOf(win, 'pen')
      console.log('Перо: точек после упрощения', points.length, 'из ≈49 движений мыши')
      expect(points.length).toBeGreaterThanOrEqual(5)
      expect(points.length).toBeLessThan(25)
      // Концы линии на месте.
      expect(points[0].x).toBeCloseTo(0.1, 1)
      expect(points[points.length - 1].x).toBeCloseTo(0.42, 1)
      // Линия сглажена: в пути куда больше отрезков, чем сохранённых точек.
      const d = (await shapes(win, 'pen').locator('[data-part="stroke"]').getAttribute('d')) ?? ''
      expect((d.match(/L/g) ?? []).length).toBeGreaterThan(points.length * 3)
      await shot(win, 'pen-screen')
      // Стрелка на конце — галочка в панели.
      await win.keyboard.press('v')
      await win.getByTestId('prop-arrow').check()
      expect((await geo<{ arrow: boolean }>(shapes(win, 'pen'))).arrow).toBe(true)
      await expect(shapes(win, 'pen').locator('[data-part="body"]')).toHaveCount(1)
      await win.keyboard.press('Control+z')
      expect((await geo<{ arrow: boolean }>(shapes(win, 'pen'))).arrow).toBe(false)
      // Перетаскивание целиком и отмена.
      const before = (await pointsOf(win, 'pen'))[0]
      const [fx, fy] = await px(win, [0.26, 0.25])
      await dragPx(win, [fx, fy - 0.0], [fx + 60, fy + 80])
      const after = (await pointsOf(win, 'pen'))[0]
      expect(after.y).toBeGreaterThan(before.y + 0.05)
      await win.keyboard.press('Control+z')
      expect((await pointsOf(win, 'pen'))[0].y).toBeCloseTo(before.y, 6)
      await undoRedo(win, 'pen', 1)

      // Рейка: следующая линия; слишком короткий штрих рисунком не становится.
      await tool(win, 'pen').click()
      await dragPath(win, [
        [0.6, 0.6],
        [0.7, 0.55],
        [0.8, 0.65]
      ])
      await expect(shapes(win, 'pen')).toHaveCount(2)
      await clickAt(win, [0.5, 0.9])
      await expect(shapes(win, 'pen')).toHaveCount(2)
    } finally {
      await app.close()
    }
  })

  test('поле: точки переводятся в метры (линия лежит на траве), стрелка на конце', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      await tool(win, 'pen').click()
      const path: Frac[] = [world(4, 44), world(6, 40), world(9, 46), world(12, 41), world(14, 48)]
      await dragPath(win, path, 10)
      await expect(shapes(win, 'ppen')).toHaveCount(1)
      const points = await pointsOf(win, 'ppen')
      expect(points.length).toBeGreaterThanOrEqual(5)
      expect(points.length).toBeLessThan(25)
      expect(Math.hypot(points[0].x - 4, points[0].y - 44)).toBeLessThan(0.5)
      const last = points[points.length - 1]
      expect(Math.hypot(last.x - 14, last.y - 48)).toBeLessThan(0.5)
      await win.keyboard.press('v')
      await win.getByTestId('prop-arrow').check()
      await expect(shapes(win, 'ppen').locator('[data-part="body"]')).toHaveCount(1)
      await deselect(win)
      await shot(win, 'pen-pitch')
      await undoRedo(win, 'ppen', 1)
    } finally {
      await app.close()
    }
  })
})

const ZONE5: Frac[] = [
  [0.55, 0.15],
  [0.72, 0.12],
  [0.82, 0.28],
  [0.74, 0.45],
  [0.58, 0.4]
]

test.describe('зона', () => {
  test('экран: пять вершин и Enter, Backspace, Esc, двойной щелчок, щелчок по первой вершине', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('z')
      await expect(tool(win, 'zone')).toHaveAttribute('aria-pressed', 'true')
      for (const p of ZONE5) await clickAt(win, p)
      await expect(win.getByTestId('poly-draft')).toHaveAttribute('data-points', '5')
      await expect(win.getByTestId('poly-hint')).toContainText('Enter')
      // Backspace убирает последнюю вершину.
      await win.keyboard.press('Backspace')
      await expect(win.getByTestId('poly-draft')).toHaveAttribute('data-points', '4')
      // Esc отменяет весь черновик, инструмент остаётся.
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('poly-draft')).toHaveCount(0)
      await expect(shapes(win, 'zone')).toHaveCount(0)
      await expect(tool(win, 'zone')).toHaveAttribute('aria-pressed', 'true')
      // Две вершины: Enter зону не замыкает и объясняет почему.
      await clickAt(win, ZONE5[0])
      await clickAt(win, ZONE5[1])
      await win.keyboard.press('Enter')
      await expect(win.getByTestId('toast')).toContainText('минимум три точки')
      await expect(shapes(win, 'zone')).toHaveCount(0)
      await win.keyboard.press('Escape')

      // Пять вершин и Enter.
      for (const p of ZONE5) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'zone')).toHaveCount(1)
      await expect(win.getByTestId('poly-draft')).toHaveCount(0)
      expect(await pointsOf(win, 'zone')).toHaveLength(5)
      await expect(shapes(win, 'zone').locator('[data-part="fill"]')).toHaveCount(1)
      await shot(win, 'zone-screen')
      await undoRedo(win, 'zone', 1)

      // Двойной щелчок на четвёртой вершине замыкает зону из четырёх вершин.
      await win.keyboard.press('Escape') // из «Выбор» снова нужен инструмент
      await win.keyboard.press('z')
      for (const p of ZONE5.slice(0, 3)) await clickAt(win, [p[0] - 0.4, p[1] + 0.35])
      await dblclickAt(win, [ZONE5[3][0] - 0.4, ZONE5[3][1] + 0.35])
      await expect(shapes(win, 'zone')).toHaveCount(2)
      expect(await pointsOf(win, 'zone', 1)).toHaveLength(4)

      // Щелчок рядом с первой вершиной замыкает зону из трёх вершин.
      await win.keyboard.press('z')
      const tri: Frac[] = [
        [0.1, 0.7],
        [0.3, 0.7],
        [0.2, 0.9]
      ]
      for (const p of tri) await clickAt(win, p)
      await clickAt(win, [0.1, 0.705])
      await expect(shapes(win, 'zone')).toHaveCount(3)
      expect(await pointsOf(win, 'zone', 2)).toHaveLength(3)
    } finally {
      await app.close()
    }
  })

  test('экран: прозрачность, вершины тащатся, Alt+щелчок добавляет, Delete убирает; отмена каждого шага', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('z')
      for (const p of ZONE5.slice(0, 4)) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await win.keyboard.press('v')
      const opacity = win.getByTestId('prop-opacity')
      await expect(opacity).toHaveAttribute('min', '10')
      await expect(opacity).toHaveAttribute('max', '60')
      await setRange(opacity, 50)
      await expect(shapes(win, 'zone').locator('[data-part="fill"]')).toHaveAttribute(
        'fill-opacity',
        '0.5'
      )
      await win.keyboard.press('Control+z')
      await expect(shapes(win, 'zone').locator('[data-part="fill"]')).toHaveAttribute(
        'fill-opacity',
        '0.3'
      )

      // Вершина v1: тянем вправо.
      const start = await pointsOf(win, 'zone')
      const v1 = await handleCenter(win, 'v1')
      await dragPx(win, v1, [v1[0] + 40, v1[1] + 10])
      const moved = await pointsOf(win, 'zone')
      expect(moved[1].x).toBeGreaterThan(start[1].x + 0.03)
      expect(moved[0]).toEqual(start[0])
      await win.keyboard.press('Control+z')
      expect((await pointsOf(win, 'zone'))[1]).toEqual(start[1])

      // Alt+щелчок по ребру v0–v1 добавляет пятую вершину, и она сразу тащится.
      const edge: Frac = [(start[0].x + start[1].x) / 2, (start[0].y + start[1].y) / 2]
      await clickAt(win, edge, { alt: true })
      expect(await pointsOf(win, 'zone')).toHaveLength(5)
      const inserted = (await pointsOf(win, 'zone'))[1]
      expect(inserted.x).toBeCloseTo(edge[0], 2)
      expect(inserted.y).toBeCloseTo(edge[1], 2)
      await win.keyboard.press('Control+z')
      expect(await pointsOf(win, 'zone')).toHaveLength(4)
      await win.keyboard.press('Control+y')
      expect(await pointsOf(win, 'zone')).toHaveLength(5)

      // Выбрали вершину v2 (подсвечена) — Delete убирает только её.
      const v2 = await handleCenter(win, 'v2')
      await win.mouse.click(v2[0], v2[1])
      await expect(win.locator('[data-testid="handles"] [data-handle="v2"]')).toHaveAttribute(
        'data-chosen',
        'true'
      )
      await win.keyboard.press('Delete')
      await expect(shapes(win, 'zone')).toHaveCount(1)
      expect(await pointsOf(win, 'zone')).toHaveLength(4)
      await win.keyboard.press('Control+z')
      expect(await pointsOf(win, 'zone')).toHaveLength(5)
      // Без выбранной вершины Delete удаляет весь рисунок.
      await clickAt(win, [0.66, 0.3])
      await win.keyboard.press('Delete')
      await expect(shapes(win, 'zone')).toHaveCount(0)
      await win.keyboard.press('Control+z')
      await expect(shapes(win, 'zone')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('поле: штрафная площадь по углам даёт ≈ 665 м², подпись выключается, зона невыпуклая', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      await win.keyboard.press('z')
      await expect(tool(win, 'zone')).toHaveAttribute('aria-pressed', 'true')
      const corners = truth.points.penaltyArea
      for (const c of corners) await clickAt(win, pt(c.image))
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'pzone')).toHaveCount(1)
      await expect(win.getByTestId('mode-frame')).toHaveAttribute('aria-pressed', 'true')
      const label = shapes(win, 'pzone').getByTestId('area-label')
      await expect(label).toHaveCount(1)
      const text = (await label.getAttribute('data-text')) ?? ''
      const area = Number(/^(\d+)/.exec(text)?.[1])
      console.log('Площадь штрафной площади по кликам:', text, 'ожидалось ≈ 665 м² (16.5 × 40.32)')
      expect(text).toMatch(/ м²$/)
      expect(Math.abs(area - 665.3)).toBeLessThan(8)
      await shot(win, 'zone-pitch-selected')
      // Подпись площади — по желанию.
      await win.keyboard.press('v')
      await win.getByTestId('prop-area').uncheck()
      await expect(shapes(win, 'pzone').getByTestId('area-label')).toHaveCount(0)
      await win.keyboard.press('Control+z')
      await expect(shapes(win, 'pzone').getByTestId('area-label')).toHaveCount(1)
      await deselect(win)
      await shot(win, 'zone-pitch')
      await undoRedo(win, 'pzone', 1)

      // Невыпуклая «буква Г» на траве: 12×6 + 4×18 = 144 м².
      await win.keyboard.press('z')
      for (const [x, y] of [
        [2, 20],
        [14, 20],
        [14, 26],
        [6, 26],
        [6, 44],
        [2, 44]
      ]) {
        await clickAt(win, world(x, y))
      }
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'pzone')).toHaveCount(2)
      // «Площадь на зоне» выключили в прошлый раз — новая зона запоминает выбор (отмена на это не влияет).
      await expect(shapes(win, 'pzone').nth(1).getByTestId('area-label')).toHaveCount(0)
      await win.keyboard.press('v')
      await win.getByTestId('prop-area').check()
      const t2 =
        (await shapes(win, 'pzone').nth(1).getByTestId('area-label').getAttribute('data-text')) ??
        ''
      expect(Math.abs(Number(/^(\d+)/.exec(t2)?.[1]) - 144)).toBeLessThan(4)
    } finally {
      await app.close()
    }
  })
})

const CHAIN4: Frac[] = [
  [0.1, 0.72],
  [0.2, 0.78],
  [0.32, 0.74],
  [0.44, 0.8]
]

test.describe('связи игроков', () => {
  test('экран: четыре узла и двойной щелчок, заливка, узлы тащатся, Alt+щелчок добавляет, Delete убирает', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      await win.keyboard.press('n')
      await expect(tool(win, 'chain')).toHaveAttribute('aria-pressed', 'true')
      for (const p of CHAIN4.slice(0, 3)) await clickAt(win, p)
      await expect(win.getByTestId('poly-draft')).toHaveAttribute('data-points', '3')
      await dblclickAt(win, CHAIN4[3])
      await expect(shapes(win, 'chain')).toHaveCount(1)
      expect(await pointsOf(win, 'chain')).toHaveLength(4)
      await expect(shapes(win, 'chain').locator('[data-part="node"]')).toHaveCount(4)
      await shot(win, 'chain-screen')
      // Заливка между игроками.
      await win.keyboard.press('v')
      await expect(shapes(win, 'chain').locator('[data-part="fill"]')).toHaveCount(0)
      await win.getByTestId('prop-fill').check()
      await expect(shapes(win, 'chain').locator('[data-part="fill"]')).toHaveCount(1)
      await win.keyboard.press('Control+z')
      await expect(shapes(win, 'chain').locator('[data-part="fill"]')).toHaveCount(0)
      await win.keyboard.press('Control+y')
      // Узел v1 тащится.
      const before = await pointsOf(win, 'chain')
      const v1 = await handleCenter(win, 'v1')
      await dragPx(win, v1, [v1[0], v1[1] - 60])
      const after = await pointsOf(win, 'chain')
      expect(after[1].y).toBeLessThan(before[1].y - 0.05)
      expect(after[2]).toEqual(before[2])
      await win.keyboard.press('Control+z')
      // Alt+щелчок по звену v1–v2: пятый узел.
      const mid: Frac = [(before[1].x + before[2].x) / 2, (before[1].y + before[2].y) / 2]
      await clickAt(win, mid, { alt: true })
      expect(await pointsOf(win, 'chain')).toHaveLength(5)
      await win.keyboard.press('Control+z')
      expect(await pointsOf(win, 'chain')).toHaveLength(4)
      await win.keyboard.press('Control+y')
      // Выбрали последний узел и нажали Delete: остаётся четыре.
      const last = await handleCenter(win, 'v4')
      await win.mouse.click(last[0], last[1])
      await win.keyboard.press('Delete')
      expect(await pointsOf(win, 'chain')).toHaveLength(4)
      await expect(shapes(win, 'chain')).toHaveCount(1)
      await win.keyboard.press('Control+z')
      expect(await pointsOf(win, 'chain')).toHaveLength(5)
      await undoRedo(win, 'chain', 1)
    } finally {
      await app.close()
    }
  })

  test('поле: подписи расстояний между игроками и «Ширина линии», узлы в метрах, заливка', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      await tool(win, 'chain').click()
      // Четыре игрока вдоль линии x = 12: расстояния 8, 9 и 8 м, ширина 25 м.
      const ys = [16, 24, 33, 41]
      for (const y of ys) await clickAt(win, world(12, y))
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'pchain')).toHaveCount(1)
      await expect(win.getByTestId('mode-frame')).toHaveAttribute('aria-pressed', 'true')
      const segments = await shapes(win, 'pchain').getByTestId('segment-label').allTextContents()
      expect(segments).toHaveLength(3)
      const meters = segments.map((t) => Number(/([\d.]+)/.exec(t)?.[1]))
      console.log('Связи на поле: звенья', segments.join(' | '), 'ожидалось 8, 9, 8')
      expect(Math.abs(meters[0] - 8)).toBeLessThan(0.4)
      expect(Math.abs(meters[1] - 9)).toBeLessThan(0.4)
      expect(Math.abs(meters[2] - 8)).toBeLessThan(0.4)
      const width = await shapes(win, 'pchain').getByTestId('width-label').textContent()
      console.log('Связи на поле:', width, 'ожидалось 25.0 м')
      expect(width).toMatch(/^Ширина линии: [\d.]+ м$/)
      expect(Math.abs(Number(/([\d.]+) м/.exec(width ?? '')?.[1]) - 25)).toBeLessThan(0.6)
      const pts = await pointsOf(win, 'pchain')
      expect(pts).toHaveLength(4)
      expect(Math.abs(pts[0].x - 12)).toBeLessThan(0.4)
      await shot(win, 'chain-pitch-selected')
      // Подписи выключаются, заливка включается.
      await win.keyboard.press('v')
      await win.getByTestId('prop-labels').uncheck()
      await expect(shapes(win, 'pchain').getByTestId('segment-label')).toHaveCount(0)
      await expect(shapes(win, 'pchain').getByTestId('width-label')).toHaveCount(0)
      await win.getByTestId('prop-labels').check()
      await win.getByTestId('prop-fill').check()
      await expect(shapes(win, 'pchain').locator('[data-part="fill"]')).toHaveCount(1)
      // Узел тащится: подписи пересчитываются.
      const v3 = await handleCenter(win, 'v3')
      const to = await px(win, world(12, 46))
      await dragPx(win, v3, to)
      const width2 = await shapes(win, 'pchain').getByTestId('width-label').textContent()
      expect(Number(/([\d.]+) м/.exec(width2 ?? '')?.[1])).toBeGreaterThan(29)
      await win.keyboard.press('Control+z')
      await deselect(win)
      await shot(win, 'chain-pitch')
      await undoRedo(win, 'pchain', 1)
    } finally {
      await app.close()
    }
  })
})

test.describe('лупа', () => {
  test('экран: линза показывает увеличенный участок (×2, ×3), источник двигается отдельно, окно времени', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx)
      const before = await png(win, 'loupe-before')
      await win.keyboard.press('g')
      await expect(tool(win, 'loupe')).toHaveAttribute('aria-pressed', 'true')
      // Протягиваем от места, которое увеличиваем (центр кадра), к месту линзы.
      await dragPath(win, [
        [0.5, 0.5],
        [0.78, 0.3]
      ])
      await expect(shapes(win, 'loupe')).toHaveCount(1)
      await expect(win.getByTestId('loupe-canvas')).toHaveCount(1)
      type Loupe = {
        pos: { x: number; y: number }
        src: { x: number; y: number }
        radius: number
        zoom: number
      }
      const g = await geo<Loupe>(shapes(win, 'loupe'))
      expect(g.zoom).toBe(2)
      expect(g.src.x).toBeCloseTo(0.5, 2)
      expect(g.pos.x).toBeCloseTo(0.78, 2)
      await deselect(win)
      await win.waitForTimeout(250)

      const box = await layerBox(win)
      /** Сравнение линзы на скриншоте с увеличенным участком снимка без линзы. */
      const check = async (
        zoom: number,
        name: string
      ): Promise<{ magnified: number; plain: number }> => {
        const after = await png(win, name)
        const r = g.radius * box.height
        const lensC: Frac = await px(win, [g.pos.x, g.pos.y])
        const srcC: Frac = await px(win, [g.src.x, g.src.y])
        let mag = 0
        let plain = 0
        let n = 0
        for (let v = -r + 5; v <= r - 5; v += 3) {
          for (let u = -r + 5; u <= r - 5; u += 3) {
            if (Math.hypot(u, v) > r - 6) continue
            const got = after.at(lensC[0] + u, lensC[1] + v)
            mag += colorDiff(got, bilinear(before, srcC[0] + u / zoom, srcC[1] + v / zoom))
            plain += colorDiff(got, bilinear(before, lensC[0] + u, lensC[1] + v))
            n += 1
          }
        }
        return { magnified: mag / n, plain: plain / n }
      }
      const x2 = await check(2, 'loupe-x2')
      console.log(
        'Лупа ×2: расхождение с увеличенным участком',
        x2.magnified.toFixed(1),
        '; с неувеличенным',
        x2.plain.toFixed(1)
      )
      expect(x2.magnified).toBeLessThan(26)
      expect(x2.plain).toBeGreaterThan(x2.magnified * 2)
      await shot(win, 'loupe-screen')

      // Увеличение ×3 через панель.
      await win.keyboard.press('v')
      await clickAt(win, [g.pos.x, g.pos.y + 0.02])
      await win.getByTestId('zoom-3').click()
      expect((await geo<Loupe>(shapes(win, 'loupe'))).zoom).toBe(3)
      await deselect(win)
      await win.waitForTimeout(250)
      const x3 = await check(3, 'loupe-x3')
      console.log('Лупа ×3: расхождение с увеличенным участком', x3.magnified.toFixed(1))
      expect(x3.magnified).toBeLessThan(26)
      expect(x3.plain).toBeGreaterThan(x3.magnified * 1.5)
      await win.keyboard.press('Control+z')
      expect((await geo<Loupe>(shapes(win, 'loupe'))).zoom).toBe(2)

      // Источник двигается отдельно: линза остаётся на месте, содержимое меняется.
      await clickAt(win, [g.pos.x, g.pos.y + 0.02])
      const src = await handleCenter(win, 'src')
      const [tx, ty] = await px(win, [0.3, 0.5])
      await dragPx(win, src, [tx, ty])
      const moved = await geo<Loupe>(shapes(win, 'loupe'))
      expect(moved.src.x).toBeCloseTo(0.3, 2)
      expect(moved.pos).toEqual(g.pos)
      await win.keyboard.press('Control+z')
      expect((await geo<Loupe>(shapes(win, 'loupe'))).src.x).toBeCloseTo(0.5, 2)
      // Размер линзы — ручкой на краю.
      const size = await handleCenter(win, 'size')
      await dragPx(win, size, [size[0] + 25, size[1]])
      expect((await geo<Loupe>(shapes(win, 'loupe'))).radius).toBeGreaterThan(g.radius + 0.03)
      await win.keyboard.press('Control+z')

      // Окно времени: после длительности линзы нет (и canvas убран).
      await win.getByTestId('duration-input').fill('0.5')
      await seekVideo(win, 1.2)
      await expect(win.getByTestId('loupe-canvas')).toHaveCount(1)
      await seekVideo(win, 2)
      await expect(win.getByTestId('loupe-canvas')).toHaveCount(0)
      await seekVideo(win, 1)
      await undoRedo(win, 'loupe', 1)
    } finally {
      await app.close()
    }
  })

  test('на поле лупа остаётся экранным рисунком; рейка создаёт лупу и при включённом «На поле»', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      await tool(win, 'loupe').click()
      await dragPath(win, [
        [0.4, 0.5],
        [0.75, 0.25]
      ])
      await expect(shapes(win, 'loupe')).toHaveCount(1)
      await expect(shapes(win, 'loupe')).toHaveAttribute('data-space', 'screen')
      await deselect(win)
      await win.waitForTimeout(250)
      await shot(win, 'loupe-pitch')
    } finally {
      await app.close()
    }
  })
})

test.describe('проект и старые файлы', () => {
  test('сохранение и открытие: все шесть новых рисунков на экране возвращаются', async () => {
    const ctx = await launch()
    let { app, win } = ctx
    const userData = ctx.userData
    try {
      await screenProject(ctx, 'Все инструменты')
      await win.keyboard.press('s')
      await clickAt(win, [0.3, 0.5])
      await win.keyboard.press('b')
      await dragPath(win, [
        [0.45, 0.85],
        [0.8, 0.6]
      ])
      await win.keyboard.press('d')
      await dragPath(
        win,
        [
          [0.1, 0.2],
          [0.15, 0.1],
          [0.2, 0.2],
          [0.25, 0.1]
        ],
        8
      )
      await win.keyboard.press('z')
      for (const p of ZONE5) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await win.keyboard.press('n')
      for (const p of CHAIN4) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await win.keyboard.press('g')
      await dragPath(win, [
        [0.9, 0.3],
        [0.86, 0.8]
      ])
      await win.keyboard.press('v')
      // Свойства: прозрачность зоны, заливка связи, стрелка пера, увеличение 3.
      await clickAt(win, [0.7, 0.28])
      await setRange(win.getByTestId('prop-opacity'), 45)
      const read = async (): Promise<string[]> => {
        const out: string[] = []
        for (const type of ['spot', 'curve', 'pen', 'zone', 'chain', 'loupe']) {
          out.push(`${type}:${await shapes(win, type).first().getAttribute('data-geo')}`)
        }
        return out
      }
      const saved = await read()
      expect(saved).toHaveLength(6)
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      await app.close()

      const next = await launch({ userData })
      app = next.app
      win = next.win
      await expect(cardByTitle(win, 'Все инструменты')).toBeVisible()
      await cardByTitle(win, 'Все инструменты').getByTestId('card-open-main').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await seekVideo(win, 1.5)
      await expect(win.getByTestId('annotation')).toHaveCount(6)
      expect(await read()).toEqual(saved)
      // Свойства тоже сохранились.
      await clickAt(win, [0.7, 0.28])
      await expect(win.getByTestId('prop-opacity-value')).toHaveText('45%')
      await expect(win.getByTestId('loupe-canvas')).toHaveCount(1)
      await expect(win.getByTestId('spotlight-dim')).toHaveCount(1)
      await shot(win, 'reopened')
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('сохранение и открытие: рисунки на поле возвращаются вместе с разметкой', async () => {
    const ctx = await launch()
    let { app, win } = ctx
    const userData = ctx.userData
    try {
      await openPitch(ctx, 'Поле инструменты')
      await calibrate(win)
      await saveCalibration(win)
      const player = truth.players[0].world
      await win.keyboard.press('s')
      await clickAt(win, world(player.x, player.y))
      await win.keyboard.press('b')
      await dragPath(win, [world(3, 22), world(14, 44)])
      await win.keyboard.press('d')
      await dragPath(win, [world(4, 44), world(6, 40), world(9, 46), world(12, 41)], 8)
      await win.keyboard.press('z')
      for (const c of truth.points.penaltyArea) await clickAt(win, pt(c.image))
      await win.keyboard.press('Enter')
      await win.keyboard.press('n')
      for (const y of [16, 24, 33]) await clickAt(win, world(12, y))
      await win.keyboard.press('Enter')
      await win.keyboard.press('v')
      const types = ['pspot', 'pcurve', 'ppen', 'pzone', 'pchain']
      const read = async (): Promise<string[]> => {
        const out: string[] = []
        for (const type of types) {
          out.push(`${type}:${await shapes(win, type).first().getAttribute('data-geo')}`)
        }
        return out
      }
      const saved = await read()
      const area = await shapes(win, 'pzone').getByTestId('area-label').getAttribute('data-text')
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      await app.close()

      const next = await launch({ userData })
      app = next.app
      win = next.win
      await cardByTitle(win, 'Поле инструменты').getByTestId('card-open-main').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await seekVideo(win, 1)
      await expect(win.getByTestId('annotation')).toHaveCount(5)
      await expect(win.getByTestId('calibration-item')).toHaveCount(1)
      expect(await read()).toEqual(saved)
      expect(await shapes(win, 'pzone').getByTestId('area-label').getAttribute('data-text')).toBe(
        area
      )
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('старый проект (без новых полей) открывается, новые инструменты в нём работают', async () => {
    const ctx = await launch()
    const { app, projectsDir } = ctx
    try {
      mkdirSync(projectsDir, { recursive: true })
      const file = join(projectsDir, 'старый.flowproj')
      seedProject(file, {
        video: fixture('cfr25.mp4'),
        meta: { title: 'Старый проект', type: 'other' },
        annotations: 2
      })
      await app.close()
      const next = await launch({ userData: ctx.userData })
      const win = next.win
      await cardByTitle(win, 'Старый проект').getByTestId('card-open-main').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await seekVideo(win, 1.5)
      await expect(shapes(win, 'arrow')).toHaveCount(2)
      await win.keyboard.press('s')
      await clickAt(win, [0.3, 0.6])
      await expect(shapes(win, 'spot')).toHaveCount(1)
      await win.keyboard.press('z')
      for (const p of ZONE5) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'zone')).toHaveCount(1)
      await expect(win.getByTestId('annotation')).toHaveCount(4)
      await next.app.close()
    } finally {
      await app.close().catch(() => undefined)
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

/** Экспорт «Всё видео целиком» с рисунками; возвращает путь к файлу. */
async function exportWhole(app: ElectronApplication, win: Page): Promise<string> {
  const out = makeOutDir()
  await stubDialog(app, out)
  await win.getByTestId('export-open').click()
  await expect(win.getByTestId('export-scope-whole')).toBeChecked()
  await expect(win.getByTestId('export-drawings')).toBeChecked()
  await win.getByTestId('export-start').click()
  await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 90_000 })
  await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
  return join(out, readdirSync(out)[0])
}

const luma = ([r, g, b]: [number, number, number]): number => 0.299 * r + 0.587 * g + 0.114 * b

test.describe('экспорт с новыми рисунками', () => {
  test('экран: прожектор, зона, связи и лупа попадают в видео (пиксели кадра экспорта)', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await screenProject(ctx, 'Экспорт инструментов')
      // Белые линии на цветных полосах хорошо видны.
      await win.getByTestId('tool-chain').click()
      await win.getByTestId('color-ffffff').click()
      await win.getByTestId('width-2').click()
      const chain: Frac[] = [
        [0.08, 0.9],
        [0.2, 0.93],
        [0.34, 0.9]
      ]
      for (const p of chain) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await win.keyboard.press('z')
      // С 0.16.4 новая зона лежит под игроками; на этом видео нет газона, поэтому кладём её поверх.
      await win.getByTestId('under-toggle').click()
      await win.getByTestId('color-111827').click()
      const zone: Frac[] = [
        [0.6, 0.55],
        [0.8, 0.55],
        [0.8, 0.8],
        [0.6, 0.8]
      ]
      for (const p of zone) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await win.keyboard.press('v')
      await setRange(win.getByTestId('prop-opacity'), 60)
      await win.keyboard.press('s')
      await clickAt(win, [0.36, 0.3])
      await win.keyboard.press('g')
      await dragPath(win, [
        [0.5, 0.5],
        [0.8, 0.25]
      ])
      await win.keyboard.press('v')
      await win.keyboard.press('Escape')
      await win.keyboard.press('Escape')
      await seekVideo(win, 1.5)
      await win.waitForTimeout(300)
      const layer = (await win.getByTestId('annotation-layer').boundingBox())!
      await win.screenshot({ path: join(SHOTS, `tools-export-screen${SUFFIX}.png`), clip: layer })

      const file = await exportWhole(app, win)
      // Кадр результата, где всё видно: время 1.5 с.
      const index = 38
      const rgb = frameRgb(file, index, W, H)
      const src = frameRgb(fixture('cfr25.mp4'), index, W, H)
      ff([
        '-i',
        file,
        '-vf',
        `select=eq(n\\,${index})`,
        '-frames:v',
        '1',
        '-y',
        join(SHOTS, `tools-export-frame${SUFFIX}.png`)
      ])
      const at = (frame: Buffer, fx: number, fy: number): [number, number, number] =>
        pixelAt(frame, W, Math.round(fx * W), Math.round(fy * H))

      // Прожектор: вне пятна темнее в (1 − 0.55) раза, в центре пятна — как в исходнике.
      const bright = at(src, 0.93, 0.1)
      expect(luma(bright)).toBeGreaterThan(60)
      const ratio = luma(at(rgb, 0.93, 0.1)) / luma(bright)
      console.log('Экспорт: прожектор вне пятна ×', ratio.toFixed(3), '(ожидалось 0.45)')
      expect(Math.abs(ratio - 0.45)).toBeLessThan(0.07)
      const center = Math.abs(luma(at(rgb, 0.36, 0.3)) - luma(at(src, 0.36, 0.3)))
      expect(center).toBeLessThan(14)

      // Зона (тёмная, непрозрачность 60 %): внутри зоны цвет заметно темнее исходного (после затемнения прожектором: сравниваем с ожидаемым).
      const zoneOut = luma(at(rgb, 0.7, 0.67))
      const zoneSrc = luma(at(src, 0.7, 0.67))
      console.log(
        'Экспорт: яркость внутри зоны',
        zoneOut.toFixed(0),
        'исходная',
        zoneSrc.toFixed(0)
      )
      // Ожидание: исходный цвет, затемнённый прожектором (×0.45), под тёмной заливкой #111827 (яркость ≈ 17) с непрозрачностью 60 %.
      const expectedZone = zoneSrc * 0.45 * 0.4 + 17 * 0.6
      expect(Math.abs(zoneOut - expectedZone)).toBeLessThan(14)

      // Связи (белая линия по звену): точка на середине звена светлая, а рядом — нет.
      const onLine = at(rgb, (chain[0][0] + chain[1][0]) / 2, (chain[0][1] + chain[1][1]) / 2)
      console.log('Экспорт: пиксель на линии связи', onLine.join(','))
      expect(luma(onLine)).toBeGreaterThan(90)

      // Лупа: линза показывает увеличенный центр кадра (цифры номера), а не то, что под ней.
      const g = loupeGeometry(
        { pos: { x: 0.8, y: 0.25 }, src: { x: 0.5, y: 0.5 }, radius: 0.12, zoom: 2 },
        W,
        H
      )
      let magnified = 0
      let plain = 0
      let n = 0
      for (let v = 6; v < g.d - 6; v += 4) {
        for (let u = 6; u < g.d - 6; u += 4) {
          if (Math.hypot(u + 0.5 - g.d / 2, v + 0.5 - g.d / 2) > g.d / 2 - 8) continue
          const sx = g.sx + ((u + 0.5) * g.sw) / g.d
          const sy = g.sy + ((v + 0.5) * g.sw) / g.d
          const got = pixelAt(rgb, W, g.ox + u, g.oy + v)
          // Лупа лежит вне пятна прожектора: затемнение 0.45 применяется и к ней (линза вставлена до PNG с затемнением).
          const dimmed = (c: [number, number, number]): [number, number, number] => [
            c[0] * 0.45,
            c[1] * 0.45,
            c[2] * 0.45
          ]
          const mag = pixelAt(src, W, Math.round(sx), Math.round(sy))
          const flat = pixelAt(src, W, g.ox + u, g.oy + v)
          magnified +=
            (Math.abs(got[0] - dimmed(mag)[0]) +
              Math.abs(got[1] - dimmed(mag)[1]) +
              Math.abs(got[2] - dimmed(mag)[2])) /
            3
          plain +=
            (Math.abs(got[0] - dimmed(flat)[0]) +
              Math.abs(got[1] - dimmed(flat)[1]) +
              Math.abs(got[2] - dimmed(flat)[2])) /
            3
          n += 1
        }
      }
      console.log(
        'Экспорт: лупа, расхождение с увеличенным',
        (magnified / n).toFixed(1),
        'с неувеличенным',
        (plain / n).toFixed(1)
      )
      expect(magnified / n).toBeLessThan(12)
      expect(plain / n).toBeGreaterThan((magnified / n) * 2)
    } finally {
      await app.close()
    }
  })

  test('поле: зона, прожектор, связи и перо в видео; кадр «Только кадр» замирает со всеми рисунками', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      const player = truth.players[0].world
      await win.keyboard.press('z')
      await win.getByTestId('color-ff3b30').click()
      for (const c of truth.points.penaltyArea) await clickAt(win, pt(c.image))
      await win.keyboard.press('Enter')
      await win.keyboard.press('s')
      await clickAt(win, world(player.x, player.y))
      await win.keyboard.press('n')
      await win.getByTestId('color-ffffff').click()
      for (const y of [16, 24, 33, 41]) await clickAt(win, world(12, y))
      await win.keyboard.press('Enter')
      await win.keyboard.press('v')
      await win.keyboard.press('Escape')
      await seekVideo(win, 1)
      await win.waitForTimeout(300)
      const layer = (await win.getByTestId('annotation-layer').boundingBox())!
      await win.screenshot({
        path: join(SHOTS, `tools-export-pitch-screen${SUFFIX}.png`),
        clip: layer
      })
      const file = await exportWhole(app, win)
      // Стоп-кадр (≈ секунда 1): кадры 25..99.
      const index = 25 + 20
      const PW = truth.frame.w
      const PH = truth.frame.h
      const rgb = frameRgb(file, index, PW, PH)
      const src = frameRgb(fixture('pitch.mp4'), 25, PW, PH)
      ff([
        '-i',
        file,
        '-vf',
        `select=eq(n\\,${index})`,
        '-frames:v',
        '1',
        '-y',
        join(SHOTS, `tools-export-pitch-frame${SUFFIX}.png`)
      ])
      const at = (frame: Buffer, p: Frac): [number, number, number] =>
        pixelAt(frame, PW, Math.round(p[0] * PW), Math.round(p[1] * PH))
      // Вне пятна прожектора кадр темнее; в зоне (красной) пиксель краснее, чем в исходнике.
      const far = [0.92, 0.1] as Frac
      const ratio = luma(at(rgb, far)) / Math.max(1, luma(at(src, far)))
      console.log('Экспорт на поле: яркость вне пятна ×', ratio.toFixed(3))
      expect(ratio).toBeLessThan(0.55)
      // Связь: подпись «Ширина линии» — светлый текст на тёмной плашке: в кадре есть светлые пиксели рядом с ожидаемой точкой.
      const inside = world(8, 30)
      const z = at(rgb, inside)
      const zs = at(src, inside)
      console.log('Экспорт на поле: цвет внутри зоны', z.join(','), 'в исходнике', zs.join(','))
      expect(z[0]).toBeGreaterThan(z[1] + 8)
      expect(luma(at(rgb, inside))).toBeGreaterThan(5)
    } finally {
      await app.close()
    }
  })
})
