// Версия 0.16.3: разметка поля (отмена с вопросом, поле вокруг картинки, быстрый сдвиг и перетаскивание точек),
// размер экспорта в сводке, сворачиваемые теги и «Взять цвет газона с этого кадра».
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { join } from 'path'
import { SHOTS, SUFFIX, fixture, launch, makeUserData, seekVideo, stubDialog } from './helpers'
import { createProject, seedProject } from './startHelpers'
import { W, layerBox, openPitch } from './pitchHelpers'
import { parseHex, rgbToU, rgbToV } from '../../src/shared/grassKey'

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `polish3-${name}${SUFFIX}.png`) })

async function box(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox()
  expect(b).not.toBeNull()
  return b!
}

/** Центр кружка точки разметки (экранные пиксели). */
async function pointCenter(win: Page, index: number): Promise<{ x: number; y: number }> {
  const b = await box(win.getByTestId('cal-pt').nth(index).locator('circle').first())
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

async function startCal(win: Page): Promise<void> {
  await win.getByTestId('pitch-calibrate').click()
  await expect(win.getByTestId('calibration-mode')).toBeVisible()
}

test.describe('разметка поля: отмена и поле вокруг картинки', () => {
  test('«Отмена» с поставленными точками спрашивает; без точек закрывает сразу', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      // Без точек — сразу закрывается, вопроса нет.
      await startCal(win)
      await win.getByTestId('cal-cancel').click()
      await expect(win.getByTestId('calibration-mode')).toHaveCount(0)

      await startCal(win)
      const layer = await layerBox(win)
      await win.mouse.click(layer.x + layer.width * 0.3, layer.y + layer.height * 0.5)
      await win.mouse.click(layer.x + layer.width * 0.6, layer.y + layer.height * 0.5)
      await expect(win.getByTestId('cal-pt')).toHaveCount(2)

      await win.getByTestId('cal-cancel').click()
      await expect(win.getByTestId('cal-cancel-dialog')).toBeVisible()
      await expect(win.getByTestId('cal-cancel-dialog')).toContainText('Сбросить разметку?')
      await expect(win.getByTestId('cal-cancel-dialog')).toContainText('(2)')
      await expect(win.getByTestId('cal-cancel-keep')).toBeFocused()
      await shot(win, 'cancel-confirm')
      // Esc закрывает вопрос, но не сбрасывает разметку.
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('cal-cancel-dialog')).toHaveCount(0)
      await expect(win.getByTestId('cal-pt')).toHaveCount(2)
      // Enter при вопросе нажимает выбранную «Продолжить разметку»: не сохраняет разметку и не закрывает режим.
      await win.getByTestId('cal-cancel').click()
      await expect(win.getByTestId('cal-cancel-dialog')).toBeVisible()
      await win.keyboard.press('Enter')
      await expect(win.getByTestId('cal-cancel-dialog')).toHaveCount(0)
      await expect(win.getByTestId('calibration-mode')).toBeVisible()
      await expect(win.getByTestId('cal-pt')).toHaveCount(2)
      // Esc в самом режиме тоже спрашивает; «Сбросить» закрывает режим, ничего не сохраняя.
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('cal-cancel-dialog')).toBeVisible()
      await win.getByTestId('cal-cancel-discard').click()
      await expect(win.getByTestId('calibration-mode')).toHaveCount(0)
      await expect(win.getByTestId('calibration-item')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('картинка уменьшена, панель сбоку, вокруг свободное поле: точки за кадром ставятся щелчком со всех сторон', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await startCal(win)
      const surf = await box(win.getByTestId('cal-surface'))
      const layer = await layerBox(win)
      const panel = await box(win.getByTestId('cal-panel'))
      await shot(win, 'cal-margins')

      // Картинка занимает около 70 % области; свободное поле есть со всех сторон.
      const ratio = Math.max(layer.width / surf.width, layer.height / surf.height)
      expect(ratio).toBeGreaterThan(0.6)
      expect(ratio).toBeLessThan(0.75)
      const left = layer.x - surf.x
      const right = surf.x + surf.width - (layer.x + layer.width)
      const top = layer.y - surf.y
      const bottom = surf.y + surf.height - (layer.y + layer.height)
      console.log('Поля вокруг картинки (px):', { left, right, top, bottom }, 'область', surf)
      for (const m of [left, right]) expect(m).toBeGreaterThan(surf.width * 0.1)
      for (const m of [top, bottom]) expect(m).toBeGreaterThan(Math.min(surf.height * 0.1, 40))
      // Панель не наезжает на область щелчков.
      const overlapX =
        Math.min(panel.x + panel.width, surf.x + surf.width) - Math.max(panel.x, surf.x)
      expect(overlapX).toBeLessThanOrEqual(1)

      // Щелчки в середине поля с каждой стороны ставят точки там, куда щёлкнули.
      const cx = layer.x + layer.width / 2
      const cy = layer.y + layer.height / 2
      const targets = [
        { x: layer.x - left / 2, y: cy },
        { x: layer.x + layer.width + right / 2, y: cy },
        { x: cx, y: layer.y - top / 2 },
        { x: cx, y: layer.y + layer.height + bottom / 2 }
      ]
      for (const t of targets) await win.mouse.click(t.x, t.y)
      await expect(win.getByTestId('cal-pt')).toHaveCount(4)
      for (const [i, t] of targets.entries()) {
        const c = await pointCenter(win, i)
        expect(Math.hypot(c.x - t.x, c.y - t.y), `точка ${i + 1}`).toBeLessThan(2)
      }
      // Почти у самого края области (до целой ширины картинки в пределах -1..2 хватает с запасом).
      await win.getByTestId('cal-remove-last').click()
      await win.mouse.click(surf.x + 3, cy)
      const far = await pointCenter(win, 3)
      expect(far.x).toBeLessThan(surf.x + 8)
    } finally {
      await app.close()
    }
  })

  test('сдвиг точки клавишами: Alt 1 px, +Shift 5 px, +Ctrl 50 px; точку можно перетащить за кадр', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await startCal(win)
      const layer = await layerBox(win)
      await win.mouse.click(layer.x + layer.width * 0.5, layer.y + layer.height * 0.5)
      await expect(win.getByTestId('cal-pt')).toHaveCount(1)
      const perVideoPx = layer.width / W

      const start = await pointCenter(win, 0)
      await win.keyboard.press('Alt+ArrowRight')
      const a = await pointCenter(win, 0)
      expect(a.x - start.x).toBeCloseTo(1 * perVideoPx, 0)
      await win.keyboard.press('Alt+Shift+ArrowRight')
      const b = await pointCenter(win, 0)
      expect(b.x - a.x).toBeCloseTo(5 * perVideoPx, 0)
      await win.keyboard.press('Alt+Control+ArrowDown')
      const c = await pointCenter(win, 0)
      expect(c.y - b.y).toBeCloseTo(50 * perVideoPx, 0)
      expect(Math.abs(c.x - b.x)).toBeLessThan(0.6)
      await win.keyboard.press('Alt+Control+Shift+ArrowLeft')
      const d = await pointCenter(win, 0)
      expect(c.x - d.x).toBeCloseTo(50 * perVideoPx, 0)
      await expect(win.getByTestId('cal-offframe-hint')).toContainText('+Ctrl (50)')

      // Перетаскивание существующей точки в свободное поле за краем картинки (и дальше, поверх панели).
      const target = { x: layer.x - 60, y: layer.y - 25 }
      await win.mouse.move(d.x, d.y)
      await win.mouse.down()
      await win.mouse.move((d.x + target.x) / 2, (d.y + target.y) / 2, { steps: 4 })
      await win.mouse.move(target.x, target.y, { steps: 4 })
      await win.mouse.up()
      await expect(win.getByTestId('cal-pt')).toHaveCount(1)
      const moved = await pointCenter(win, 0)
      expect(Math.hypot(moved.x - target.x, moved.y - target.y)).toBeLessThan(2)
    } finally {
      await app.close()
    }
  })
})

test.describe('экспорт: оценка размера в сводке', () => {
  test('сводка показывает «не больше N МБ»; «Меньше размер» дешевле, «Быстро» — «около»', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await stubDialog(app, fixture('cfr25.mp4'))
      await win.getByTestId('open-video').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await win.keyboard.press('Control+e')
      await expect(win.getByTestId('export-dialog')).toBeVisible()
      const est = win.getByTestId('export-size-estimate')
      await expect(est).toContainText('Размер файлов — не больше')
      await expect(est).toContainText('МБ')
      const mb = async (): Promise<number> =>
        Number(/(\d+) МБ/.exec((await est.textContent()) ?? '')?.[1])
      const normal = await mb()
      await win.getByTestId('export-quality-small').check()
      expect(await mb()).toBeLessThanOrEqual(normal)
      await win.getByTestId('export-precision-fast').check()
      await expect(est).toContainText('Размер файлов — около')
    } finally {
      await app.close()
    }
  })
})

test.describe('список эпизодов: теги сворачиваются', () => {
  test('при 30 эпизодах после сворачивания тегов видно не меньше 8 строк; состояние запоминается', async () => {
    const userData = makeUserData()
    const file = seedProject(join(userData, 'many', 'many.flowproj'), {
      episodes: Array.from({ length: 30 }, (_, i) => ({
        n: i + 1,
        start: 0.1 + i * 0.1,
        end: 0.6 + i * 0.1
      }))
    })
    const visibleRows = async (win: Page): Promise<number> => {
      const list = await box(win.getByTestId('episode-list'))
      const rows = win.getByTestId('episode-row')
      const n = await rows.count()
      let seen = 0
      for (let i = 0; i < n; i += 1) {
        const b = await rows.nth(i).boundingBox()
        if (b && b.y >= list.y - 1 && b.y + b.height <= list.y + list.height + 1) seen += 1
      }
      return seen
    }
    const first = await launch({ userData, args: [file] })
    try {
      const { app, win } = first
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(1424, 861)
      })
      await expect(win.getByTestId('episode-count')).toHaveText('30')
      await expect(win.getByTestId('tag-panel')).toHaveAttribute('data-collapsed', 'false')
      const before = await visibleRows(win)
      await win.getByTestId('tag-panel-toggle').click()
      await expect(win.getByTestId('tag-panel')).toHaveAttribute('data-collapsed', 'true')
      await expect(win.getByTestId('tag-button').first()).toBeHidden()
      await win.waitForTimeout(150)
      const after = await visibleRows(win)
      console.log(
        `Видимых строк эпизодов при 30 эпизодах (1424x861): было ${before}, стало ${after}`
      )
      expect(after).toBeGreaterThanOrEqual(8)
      expect(after).toBeGreaterThan(before)
      await shot(win, 'tags-collapsed')
    } finally {
      await first.app.close()
    }
    // После перезапуска раздел остаётся свёрнутым; разворачивается обратно.
    const again = await launch({ userData, args: [file] })
    try {
      const { win } = again
      await expect(win.getByTestId('tag-panel')).toHaveAttribute('data-collapsed', 'true')
      await win.getByTestId('tag-panel-toggle').click()
      await expect(win.getByTestId('tag-panel')).toHaveAttribute('data-collapsed', 'false')
      await expect(win.getByTestId('tag-button').first()).toBeVisible()
    } finally {
      await again.app.close()
    }
  })
})

test.describe('газон: цвет с текущего кадра', () => {
  test('кнопка берёт цвет по кадру, показывает его время и сохраняет в проекте', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await createProject(ctx, { title: 'Газон кадр', video: fixture('players.mp4') })
      await seekVideo(win, 1)
      await win.keyboard.press('Escape')
      await win.getByTestId('grass-button').click()
      await expect(win.getByTestId('grass-popover')).toBeVisible()
      const swatch = win.getByTestId('grass-swatch')
      await expect(swatch).toHaveAttribute('data-auto', 'true')
      await expect(win.getByTestId('grass-mode')).toContainText('Цвет определён автоматически')
      const auto = (await swatch.getAttribute('data-color'))!

      await seekVideo(win, 1.5)
      await win.getByTestId('grass-sample').click()
      await expect(win.getByTestId('grass-mode')).toHaveText('Цвет взят с кадра 00:01.5')
      await expect(swatch).toHaveAttribute('data-auto', 'false')
      const taken = (await swatch.getAttribute('data-color'))!
      const [r1, g1, b1] = parseHex(auto)
      const [r2, g2, b2] = parseHex(taken)
      // Тот же газон, цвет по цветности почти тот же.
      expect(
        Math.hypot(rgbToU(r1, g1, b1) - rgbToU(r2, g2, b2), rgbToV(r1, g1, b1) - rgbToV(r2, g2, b2))
      ).toBeLessThan(8)

      // Кадр можно взять ещё раз с другого места; время обновляется.
      await seekVideo(win, 2)
      await win.getByTestId('grass-sample').click()
      await expect(win.getByTestId('grass-mode')).toHaveText('Цвет взят с кадра 00:02.0')

      // «Сбросить (авто)» возвращает автоопределение.
      await win.getByTestId('grass-reset').click()
      await expect(swatch).toHaveAttribute('data-auto', 'true')
      await win.getByTestId('grass-sample').click()
      await expect(win.getByTestId('grass-mode')).toContainText('Цвет взят с кадра')
    } finally {
      await app.close()
    }
  })
})
