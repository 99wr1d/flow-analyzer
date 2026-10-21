// Доводка 0.16.2: точки разметки за краем картинки, режим «Меньше размер», подпись длительности на карточке.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { launch } from './helpers'
import {
  calibrate,
  drag,
  layerBox,
  openPitch,
  project,
  saveCalibration,
  truth
} from './pitchHelpers'

/** Центр кружка точки разметки с номером index на экране. */
async function pointCenter(win: Page, index: number): Promise<{ x: number; y: number }> {
  const b = await win
    .locator(`[data-testid="cal-pt"][data-index="${index}"] circle`)
    .first()
    .boundingBox()
  expect(b).not.toBeNull()
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 }
}

test.describe('разметка поля: точки за краем картинки', () => {
  test('щелчок в чёрных полях и рядом с панелью ставит точку за краем кадра; подсказка есть', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await win.getByTestId('pitch-calibrate').click()
      await expect(win.getByTestId('calibration-mode')).toBeVisible()
      await expect(win.getByTestId('cal-offframe-hint')).toContainText('+Shift (5)')

      const pic = await layerBox(win)
      const surface = (await win.getByTestId('cal-surface').boundingBox())!
      // Чёрное поле над картинкой: поверхность щелчка выше картинки.
      expect(surface.y).toBeLessThan(pic.y - 20)

      // 1) Над верхним краем картинки (в чёрном поле): y < 0 в долях кадра.
      const top = { x: pic.x + pic.width * 0.5, y: pic.y - 30 }
      await win.mouse.click(top.x, top.y)
      await expect(win.getByTestId('cal-pt')).toHaveCount(1)
      const p0 = await pointCenter(win, 0)
      expect(Math.abs(p0.x - top.x)).toBeLessThan(2)
      expect(Math.abs(p0.y - top.y)).toBeLessThan(2)

      // 2) Левее картинки, в узком промежутке между панелью и картинкой (поверхность щелчка шире окна разметки): x < 0 в долях кадра.
      const left = { x: pic.x - 6, y: pic.y + pic.height * 0.5 }
      await win.mouse.click(left.x, left.y)
      await expect(win.getByTestId('cal-pt')).toHaveCount(2)
      const p1 = await pointCenter(win, 1)
      expect(Math.abs(p1.x - left.x)).toBeLessThan(2)
      expect(Math.abs(p1.y - left.y)).toBeLessThan(2)

      // 3) Точку можно сдвинуть Alt+Shift+стрелкой (5 px видео за нажатие) и она остаётся там, где её поставили.
      await win.keyboard.press('Alt+Shift+ArrowRight')
      const p1b = await pointCenter(win, 1)
      expect(p1b.x).toBeGreaterThan(p1.x + 1)
    } finally {
      await app.close()
    }
  })
})

test.describe('линейки на поле: подписи не накладываются', () => {
  test('две линейки из одной точки с почти одинаковой длиной: плашки подписей не пересекаются', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      await win.getByTestId('tool-ruler').click()
      await win.getByTestId('color-ffd60a').click()
      const pa = truth.points.penaltyArea
      await drag(win, pa[0].image, pa[1].image)
      // Вторая — на метр глубже: середины рядом, подписи легли бы друг на друга.
      const second = project(pa[1].world.x, pa[1].world.y + 1)
      await drag(win, pa[0].image, second)
      const labels = win.getByTestId('ruler-label')
      await expect(labels).toHaveCount(2)
      const a = (await labels.nth(0).boundingBox())!
      const b = (await labels.nth(1).boundingBox())!
      const apart =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y
      expect(apart, `${JSON.stringify(a)} и ${JSON.stringify(b)}`).toBe(true)
    } finally {
      await app.close()
    }
  })
})
