// Рисование поверх видео: стрелки, линии, круги, текст; время показа, выбор и перемещение, отмена, таймлайн.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { join } from 'path'
import { SHOTS, SUFFIX, fixture, launch, stubDialog, videoState } from './helpers'

async function openFixture(name = 'cfr25.mp4') {
  const { app, win } = await launch()
  await stubDialog(app, fixture(name))
  await win.getByTestId('open-video').click()
  await expect(win.getByTestId('play-toggle')).toBeEnabled()
  await expect(win.getByTestId('annotation-layer')).toBeVisible()
  return { app, win }
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function layerBox(win: Page): Promise<Box> {
  const box = await win.getByTestId('annotation-layer').boundingBox()
  expect(box).not.toBeNull()
  return box!
}

/** Перетаскивание мышью в долях картинки (0..1). */
async function dragOnPicture(
  win: Page,
  from: [number, number],
  to: [number, number],
  opts: { shift?: boolean } = {}
): Promise<void> {
  const b = await layerBox(win)
  const at = ([fx, fy]: [number, number]): [number, number] => [
    b.x + fx * b.width,
    b.y + fy * b.height
  ]
  const [x0, y0] = at(from)
  const [x1, y1] = at(to)
  if (opts.shift) await win.keyboard.down('Shift')
  await win.mouse.move(x0, y0)
  await win.mouse.down()
  await win.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 })
  await win.mouse.move(x1, y1, { steps: 4 })
  await win.mouse.up()
  if (opts.shift) await win.keyboard.up('Shift')
}

async function clickPicture(win: Page, [fx, fy]: [number, number]): Promise<void> {
  const b = await layerBox(win)
  await win.mouse.click(b.x + fx * b.width, b.y + fy * b.height)
}

const shapes = (win: Page): Locator => win.getByTestId('annotation')

interface Geo {
  p1?: { x: number; y: number }
  p2?: { x: number; y: number }
  pos?: { x: number; y: number }
}
async function geoOf(shape: Locator): Promise<Geo> {
  return JSON.parse((await shape.getAttribute('data-geo')) ?? '{}') as Geo
}

/** Перемотка и ожидание, пока интерфейс увидит новое время. */
async function seek(win: Page, time: number): Promise<void> {
  await win.evaluate(
    (t) =>
      new Promise<void>((resolve) => {
        const v = document.querySelector('video')!
        v.addEventListener('seeked', () => resolve(), { once: true })
        v.currentTime = t
      }),
    time
  )
  await win.waitForTimeout(80)
}

/** Номер кадра (25 к/с), на котором стоит видео. */
const frameNow = async (win: Page): Promise<number> =>
  Math.floor((await videoState(win))!.currentTime * 25 + 1e-6)

const near = (value: number, expected: number, tol = 0.015): void => {
  expect(Math.abs(value - expected)).toBeLessThanOrEqual(tol)
}

const TOOLS = ['select', 'arrow', 'line', 'circle', 'text'] as const

test.describe('рисунки поверх видео', () => {
  test('инструменты недоступны без видео, потом выбираются кнопками и клавишами', async () => {
    const { app, win } = await launch()
    try {
      for (const tool of TOOLS) await expect(win.getByTestId(`tool-${tool}`)).toBeDisabled()
      await win.keyboard.press('a')
      await expect(win.getByTestId('tool-arrow')).toHaveAttribute('aria-pressed', 'false')

      await stubDialog(app, fixture('cfr25.mp4'))
      await win.getByTestId('open-video').click()
      await expect(win.getByTestId('annotation-layer')).toBeVisible()
      for (const tool of TOOLS) await expect(win.getByTestId(`tool-${tool}`)).toBeEnabled()
      await expect(win.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')

      await win.getByTestId('tool-arrow').click()
      await expect(win.getByTestId('tool-arrow')).toHaveAttribute('aria-pressed', 'true')
      await expect(win.getByTestId('annotation-layer')).toHaveAttribute('data-tool', 'arrow')
      await expect(win.getByTestId('tool-arrow')).toHaveAttribute('title', 'Стрелка (A)')

      await win.keyboard.press('Escape')
      await expect(win.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
      const keys: Record<string, (typeof TOOLS)[number]> = {
        a: 'arrow',
        l: 'line',
        c: 'circle',
        t: 'text',
        v: 'select'
      }
      for (const [key, tool] of Object.entries(keys)) {
        await win.keyboard.press(key)
        await expect(win.getByTestId(`tool-${tool}`)).toHaveAttribute('aria-pressed', 'true')
      }
      // Пробел по-прежнему управляет плеером, а не инструментом.
      await win.keyboard.press('Space')
      await expect.poll(async () => (await videoState(win))?.paused).toBe(false)
      await win.keyboard.press('Space')
      await expect.poll(async () => (await videoState(win))?.paused).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('стрелка: рисование, время показа, режим «Только кадр», дорожка', async () => {
    const { app, win } = await openFixture()
    try {
      await seek(win, 0.5)
      await win.keyboard.press('a')
      // Идущее видео ставится на паузу при начале рисования.
      await win.keyboard.press('Space')
      await expect.poll(async () => (await videoState(win))?.paused).toBe(false)
      await seek(win, 0.5)
      await dragOnPicture(win, [0.2, 0.3], [0.7, 0.6])
      await expect.poll(async () => (await videoState(win))?.paused).toBe(true)
      const t0 = (await videoState(win))!.currentTime

      await expect(shapes(win)).toHaveCount(1)
      const arrow = shapes(win).first()
      await expect(arrow).toHaveAttribute('data-type', 'arrow')
      const g = await geoOf(arrow)
      near(g.p1!.x, 0.2)
      near(g.p1!.y, 0.3)
      near(g.p2!.x, 0.7)
      near(g.p2!.y, 0.6)
      // Новый рисунок выбран: видна панель «Рисунок».
      await expect(win.getByTestId('inspector')).toBeVisible()
      await expect(win.getByTestId('mode-range')).toHaveAttribute('aria-pressed', 'true')
      await expect(win.getByTestId('duration-input')).toHaveValue('3')

      // Виден в начале и через 2 с, скрыт через 3.2 с.
      await seek(win, t0 + 2)
      await expect(shapes(win)).toHaveCount(1)
      await seek(win, t0 + 3.2)
      await expect(shapes(win)).toHaveCount(0)
      await expect(win.getByTestId('inspector')).toHaveCount(0) // выделение снято вместе с исчезновением
      await seek(win, t0)
      await expect(shapes(win)).toHaveCount(1)

      // Дорожка: полоса, клик выбирает рисунок и ведёт к его началу.
      const item = win.getByTestId('track-item')
      await expect(item).toHaveCount(1)
      await expect(item).toHaveAttribute('data-mode', 'range')
      await seek(win, 3)
      await item.click()
      await expect(shapes(win).first()).toHaveAttribute('data-selected', 'true')
      await expect.poll(async () => (await videoState(win))!.currentTime).toBeCloseTo(t0, 1)

      // «Только кадр»: виден ровно на одном кадре.
      const f0 = await frameNow(win)
      await win.getByTestId('mode-frame').click()
      await expect(win.getByTestId('mode-frame')).toHaveAttribute('aria-pressed', 'true')
      await expect(win.getByTestId('duration-input')).toHaveCount(0)
      await expect(item).toHaveAttribute('data-mode', 'frame')
      await expect(shapes(win)).toHaveCount(1)
      await win.keyboard.press('ArrowRight')
      await expect.poll(() => frameNow(win)).toBe(f0 + 1)
      await expect(shapes(win)).toHaveCount(0)
      await win.keyboard.press('ArrowLeft')
      await expect.poll(() => frameNow(win)).toBe(f0)
      await expect(shapes(win)).toHaveCount(1)
      await win.keyboard.press('ArrowLeft')
      await expect(shapes(win)).toHaveCount(0)

      // Возврат к «Отрезок»: снова виден 3 секунды от начала.
      await item.click()
      await win.getByTestId('mode-range').click()
      await expect(win.getByTestId('duration-input')).toHaveValue('3')
      await seek(win, t0 + 2.9)
      await expect(shapes(win)).toHaveCount(1)
      await seek(win, t0 + 3.4)
      await expect(shapes(win)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('начать с текущего момента и проверка длительности', async () => {
    const { app, win } = await openFixture()
    try {
      await win.keyboard.press('a')
      await dragOnPicture(win, [0.1, 0.2], [0.5, 0.2], { shift: true })
      const shape = shapes(win).first()
      await expect(shape).toHaveCount(1)
      await seek(win, 1.5)
      await win.getByTestId('track-item').click()
      await seek(win, 1.5)
      // Сам рисунок на 1.5 с не виден (начало 0, длительность 3 → виден!). Укоротим до 1 с.
      const input = win.getByTestId('duration-input')
      await input.fill('1')
      await expect(shapes(win)).toHaveCount(1) // выбранный остаётся, пока время не менялось
      await expect(win.getByTestId('duration-hint')).toHaveText(/^\s*$/)

      // Некорректный ввод: подсказка, значение не меняется, приложение живо.
      await input.fill('0.1')
      await expect(win.getByTestId('duration-hint')).toContainText('от 0.2 до 60')
      await input.fill('99')
      await expect(win.getByTestId('duration-hint')).toContainText('от 0.2 до 60')
      await input.fill('')
      await expect(win.getByTestId('duration-hint')).toContainText('Введите число')
      await input.fill('1.5')
      await expect(win.getByTestId('duration-hint')).toHaveText(/^\s*$/)

      await win.getByTestId('start-now').click()
      await expect(win.getByTestId('annotation-start')).toHaveText('00:01.5')
      await seek(win, 3.9)
      await expect(shapes(win)).toHaveCount(0)
      await seek(win, 2.9)
      await expect(shapes(win)).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('круг и текст, выбор, перемещение, ручки, удаление, отмена и повтор, стиль', async () => {
    const { app, win } = await openFixture()
    try {
      // Короткая тяга: меньше порога — рисунок не создаётся.
      await win.keyboard.press('c')
      await dragOnPicture(win, [0.5, 0.5], [0.5, 0.5])
      await expect(shapes(win)).toHaveCount(0)

      // Круг с Shift — идеальный круг (в пикселях).
      await dragOnPicture(win, [0.55, 0.3], [0.85, 0.5], { shift: true })
      const circle = shapes(win).first()
      await expect(circle).toHaveAttribute('data-type', 'circle')
      const cb = await layerBox(win)
      const cg = await geoOf(circle)
      near(Math.abs(cg.p2!.x - cg.p1!.x) * cb.width, Math.abs(cg.p2!.y - cg.p1!.y) * cb.height, 2)

      // Текст: клик, ввод, Enter.
      await win.keyboard.press('t')
      await clickPicture(win, [0.1, 0.1])
      const field = win.getByTestId('annotation-text-input')
      await expect(field).toBeFocused()
      await win.keyboard.type('Пас в центр')
      await win.keyboard.press('Enter')
      await expect(field).toHaveCount(0)
      const text = win.locator('[data-testid="annotation"][data-type="text"]')
      await expect(text).toHaveCount(1)
      await expect(text).toHaveAttribute('data-text', 'Пас в центр')
      await expect(text.locator('text')).toHaveText('Пас в центр')

      // Esc отменяет, пустой текст не создаётся.
      await clickPicture(win, [0.1, 0.8])
      await win.keyboard.type('лишнее')
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('annotation-text-input')).toHaveCount(0)
      await clickPicture(win, [0.1, 0.8])
      await win.keyboard.press('Enter')
      await expect(win.getByTestId('annotation-text-input')).toHaveCount(0)
      await expect(shapes(win)).toHaveCount(2)
      // Горячие клавиши не срабатывают, пока печатаем.
      await clickPicture(win, [0.1, 0.8])
      await win.keyboard.type('av')
      await expect(win.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true')
      await win.keyboard.press('Escape')

      // Выбор и перемещение круга.
      await win.getByTestId('tool-select').click()
      await clickPicture(win, [0.7, 0.4])
      await expect(circle).toHaveAttribute('data-selected', 'true')
      const before = await geoOf(circle)
      await dragOnPicture(win, [0.7, 0.4], [0.6, 0.55])
      const moved = await geoOf(circle)
      near(moved.p1!.x - before.p1!.x, -0.1)
      near(moved.p1!.y - before.p1!.y, 0.15)
      // Размер сохранился.
      near(moved.p2!.x - moved.p1!.x, before.p2!.x - before.p1!.x, 0.002)

      // Ручка: тянем юго-восточный угол.
      const handle = win.locator('[data-handle="se"]')
      await expect(handle).toBeVisible()
      const hb = (await handle.boundingBox())!
      await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
      await win.mouse.down()
      await win.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2 + 30, { steps: 5 })
      await win.mouse.up()
      const resized = await geoOf(circle)
      const bigger = Math.max(resized.p1!.x, resized.p2!.x) - Math.max(moved.p1!.x, moved.p2!.x)
      near(bigger, 40 / cb.width, 0.01)

      // Двойной щелчок по тексту — правка.
      const tb = (await text.boundingBox())!
      await win.mouse.dblclick(tb.x + tb.width / 2, tb.y + tb.height / 2)
      await expect(win.getByTestId('annotation-text-input')).toHaveValue('Пас в центр')
      await win.keyboard.press('Control+A')
      await win.keyboard.type('Прессинг')
      await win.keyboard.press('Enter')
      await expect(text).toHaveAttribute('data-text', 'Прессинг')
      await expect(shapes(win)).toHaveCount(2)

      // Цвет меняет выбранный рисунок; отмена возвращает.
      await clickPicture(win, [0.62, 0.72])
      await expect(circle).toHaveAttribute('data-selected', 'true')
      const oldColor = await circle.getAttribute('data-color')
      await win.getByTestId('color-ff3b30').click()
      await expect(circle).toHaveAttribute('data-color', '#ff3b30')
      await win.keyboard.press('Control+z')
      await expect(circle).toHaveAttribute('data-color', oldColor!)
      await win.keyboard.press('Control+y')
      await expect(circle).toHaveAttribute('data-color', '#ff3b30')

      // Удаление, отмена, повтор.
      await win.keyboard.press('Delete')
      await expect(shapes(win)).toHaveCount(1)
      await win.keyboard.press('Control+z')
      await expect(shapes(win)).toHaveCount(2)
      await win.keyboard.press('Control+y')
      await expect(shapes(win)).toHaveCount(1)
      await win.keyboard.press('Control+Shift+z')
      await expect(shapes(win)).toHaveCount(1)
      await win.keyboard.press('Control+z')
      await win.keyboard.press('Control+z') // отмена цвета... проверим, что приложение живо
      await expect(win.getByTestId('annotation-layer')).toBeVisible()
      await win.screenshot({ path: join(SHOTS, `anno-edit${SUFFIX}.png`) })
    } finally {
      await app.close()
    }
  })

  test('рисунки приклеены к картинке при изменении размера окна', async () => {
    const { app, win } = await openFixture()
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        if (w.isMaximized()) w.unmaximize()
        w.setContentSize(1280, 800)
      })
      await win.waitForTimeout(300)
      await win.keyboard.press('a')
      await dragOnPicture(win, [0.2, 0.3], [0.7, 0.6])
      const shape = shapes(win).first()
      const rel = async (): Promise<{ x: number; y: number; w: number; h: number }> => {
        const l = await layerBox(win)
        const s = (await shape.boundingBox())!
        return {
          x: (s.x - l.x) / l.width,
          y: (s.y - l.y) / l.height,
          w: s.width / l.width,
          h: s.height / l.height
        }
      }
      const a = await rel()
      const la = await layerBox(win)
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000)
      })
      await expect.poll(async () => (await layerBox(win)).width).not.toBeCloseTo(la.width, 0)
      await win.waitForTimeout(200)
      const lb = await layerBox(win)
      // Слой по-прежнему в точности по картинке 16:9.
      near(lb.width / lb.height, 640 / 360, 0.01)
      const video = (await win.locator('video').boundingBox())!
      expect(lb.x).toBeGreaterThanOrEqual(video.x - 1)
      expect(lb.x + lb.width).toBeLessThanOrEqual(video.x + video.width + 1)
      expect(lb.y).toBeGreaterThanOrEqual(video.y - 1)
      expect(lb.y + lb.height).toBeLessThanOrEqual(video.y + video.height + 1)
      const b = await rel()
      near(b.x, a.x, 0.01)
      near(b.y, a.y, 0.01)
      near(b.w, a.w, 0.015)
      near(b.h, a.h, 0.015)
      const g = await geoOf(shape)
      near(g.p1!.x, 0.2)
      near(g.p2!.y, 0.6)
    } finally {
      await app.close()
    }
  })

  test('новое видео очищает рисунки и историю', async () => {
    const { app, win } = await openFixture()
    try {
      await win.keyboard.press('l')
      await dragOnPicture(win, [0.2, 0.2], [0.8, 0.6])
      await expect(shapes(win)).toHaveCount(1)
      await expect(win.getByTestId('track-item')).toHaveCount(1)
      await expect(win.getByTestId('undo')).toBeEnabled()

      await stubDialog(app, fixture('cfr30.webm'))
      await win.keyboard.press('Control+o')
      await expect(win.getByTestId('file-name')).toHaveText('cfr30.webm')
      await expect(win.getByTestId('annotation-layer')).toBeVisible()
      await expect(shapes(win)).toHaveCount(0)
      await expect(win.getByTestId('track-item')).toHaveCount(0)
      await expect(win.getByTestId('undo')).toBeDisabled()
      await win.keyboard.press('Control+z')
      await expect(shapes(win)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('снимки экрана: стрелки, круги, текст, ручки, панель стиля, дорожка', async () => {
    const { app, win } = await openFixture()
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        if (w.isMaximized()) w.unmaximize()
        w.setContentSize(1440, 860)
      })
      await win.waitForTimeout(300)
      await seek(win, 1)
      // Жёлтая стрелка.
      await win.keyboard.press('a')
      await dragOnPicture(win, [0.15, 0.7], [0.45, 0.4])
      // Красная пунктирная стрелка «рывок»: повторный выбор инструмента снимает выделение,
      // и стиль относится к следующему рисунку.
      await win.keyboard.press('a')
      await win.getByTestId('color-ff3b30').click()
      await win.getByTestId('dash-dashed').click()
      await dragOnPicture(win, [0.2, 0.85], [0.7, 0.85])
      // Голубой круг (подсветка игрока), толстый.
      await win.keyboard.press('c')
      await win.getByTestId('color-4cc9f0').click()
      await win.getByTestId('width-2').click()
      await win.getByTestId('dash-solid').click()
      await dragOnPicture(win, [0.6, 0.25], [0.78, 0.6])
      // Белая тонкая линия.
      await win.keyboard.press('l')
      await win.getByTestId('width-0').click()
      await win.getByTestId('color-ffffff').click()
      await dragOnPicture(win, [0.5, 0.1], [0.9, 0.1])
      // Подпись.
      await win.keyboard.press('t')
      await win.getByTestId('width-1').click()
      await win.getByTestId('color-ffd60a').click()
      await clickPicture(win, [0.05, 0.08])
      await win.keyboard.type('Прессинг 4-4-2')
      await win
        .getByTestId('annotation-layer')
        .screenshot({ path: join(SHOTS, `anno-text-edit${SUFFIX}.png`) })
      await win.keyboard.press('Enter')
      // Тёмный текст без подложки.
      await win.keyboard.press('t')
      await win.getByTestId('color-111827').click()
      await win.getByTestId('text-background').click()
      await clickPicture(win, [0.05, 0.2])
      await win.keyboard.type('Свободная зона')
      await win.keyboard.press('Enter')
      // Рисунок в другой момент времени для дорожки.
      await seek(win, 2.6)
      await win.keyboard.press('a')
      await win.getByTestId('color-34d058').click()
      await dragOnPicture(win, [0.3, 0.5], [0.4, 0.3])
      await seek(win, 1)
      await win.keyboard.press('v')
      await clickPicture(win, [0.69, 0.42])
      await win.waitForTimeout(150)
      await win.screenshot({ path: join(SHOTS, `anno-scene${SUFFIX}.png`) })
      await win
        .getByTestId('annotation-layer')
        .screenshot({ path: join(SHOTS, `anno-picture${SUFFIX}.png`) })
      await win
        .getByTestId('style-bar')
        .screenshot({ path: join(SHOTS, `anno-stylebar${SUFFIX}.png`) })
      await win.locator('.timeline').screenshot({ path: join(SHOTS, `anno-timeline${SUFFIX}.png`) })
      await win.locator('.tool-rail').screenshot({ path: join(SHOTS, `anno-rail${SUFFIX}.png`) })
      await win
        .getByTestId('inspector')
        .screenshot({ path: join(SHOTS, `anno-inspector${SUFFIX}.png`) })
    } finally {
      await app.close()
    }
  })
})
