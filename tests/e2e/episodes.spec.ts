// Разметка эпизодов: быстрый и точный тег, список, дорожка на таймлайне, фильтр, правка, единая отмена.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join } from 'path'
import {
  SHOTS,
  SUFFIX,
  fixture,
  launch,
  pressRussian,
  seekVideo,
  stubDialog,
  videoState
} from './helpers'

async function openFixture(name = 'cfr25.mp4') {
  const ctx = await launch()
  await stubDialog(ctx.app, fixture(name))
  await ctx.win.getByTestId('open-video').click()
  await expect(ctx.win.getByTestId('play-toggle')).toBeEnabled()
  await expect(ctx.win.getByTestId('annotation-layer')).toBeVisible()
  return ctx
}

const rows = (win: Page) => win.getByTestId('episode-row')
const bars = (win: Page) => win.getByTestId('episode-bar')

async function dragArrow(win: Page): Promise<void> {
  const b = (await win.getByTestId('annotation-layer').boundingBox())!
  await win.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.3)
  await win.mouse.down()
  await win.mouse.move(b.x + b.width * 0.45, b.y + b.height * 0.45, { steps: 4 })
  await win.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6, { steps: 4 })
  await win.mouse.up()
}

test.describe('эпизоды', () => {
  test('панель тегов: стандартные теги, клавиши и подсказки', async () => {
    const { app, win } = await launch()
    try {
      const buttons = win.getByTestId('tag-button')
      await expect(buttons).toHaveCount(9)
      await expect(buttons.nth(0)).toContainText('Атака')
      await expect(buttons.nth(0).locator('kbd')).toHaveText('1')
      await expect(buttons.nth(8)).toContainText('Отбор')
      await expect(buttons.nth(8).locator('kbd')).toHaveText('9')
      // Без видео разметка недоступна.
      await expect(buttons.first()).toBeDisabled()
      await expect(win.getByTestId('set-in')).toBeDisabled()
      await expect(win.getByText('Меток пока нет').first()).toBeVisible()
      await expect(win.getByTestId('episode-count')).toHaveText('0')
    } finally {
      await app.close()
    }
  })

  test('быстрый тег: клавиша «1» у края видео обрезается; без паузы; кнопка; русская раскладка', async () => {
    const { app, win } = await openFixture()
    try {
      await expect(win.getByTestId('tag-button').first()).toBeEnabled()
      await seekVideo(win, 2.0)
      await win.keyboard.press('Digit1')
      await expect(rows(win)).toHaveCount(1)
      await expect(rows(win).first()).toContainText('Атака')
      await expect(rows(win).first()).toHaveAttribute('data-start', '0')
      await expect(rows(win).first()).toHaveAttribute('data-end', '4')
      await expect(win.getByTestId('toast')).toHaveText('Эпизод «Атака» 00:00.0–00:04.0')
      // Вспышка на кнопке тега.
      await expect(win.getByTestId('tag-flash')).toHaveCount(1)
      await expect(win.getByTestId('episode-count')).toHaveText('1')

      // Тегируем «на ходу»: воспроизведение не останавливается.
      await seekVideo(win, 0.2)
      await win.keyboard.press('Space')
      await expect.poll(async () => (await videoState(win))?.paused).toBe(false)
      await win.keyboard.press('Digit6')
      await expect(rows(win)).toHaveCount(2)
      expect((await videoState(win))?.paused).toBe(false)
      await win.keyboard.press('Space')
      await expect.poll(async () => (await videoState(win))?.paused).toBe(true)

      // Кнопка тега делает то же, что клавиша.
      await seekVideo(win, 3.5)
      await win.locator('[data-testid="tag-button"][data-tag-id="goal"]').click()
      await expect(rows(win)).toHaveCount(3)
      await expect(win.locator('[data-testid="episode-row"][data-tag-id="goal"]')).toHaveAttribute(
        'data-end',
        '4'
      )

      // Русская раскладка: «ш» на клавише I ставит метку «Начало».
      await seekVideo(win, 1)
      await pressRussian(win, 'KeyI', 'ш')
      await expect(win.getByTestId('mark-in-value')).toHaveText('00:01.0')
    } finally {
      await app.close()
    }
  })

  test('точная разметка: I и O, метки на линейке, тег по меткам, Esc и ошибки', async () => {
    const { app, win } = await openFixture()
    try {
      await seekVideo(win, 1.0)
      await win.keyboard.press('i')
      await expect(win.getByTestId('marks-status')).toHaveText('Начало 00:01.0 · Конец —')
      await expect(win.getByTestId('mark-in')).toBeVisible()
      await seekVideo(win, 2.5)
      await win.keyboard.press('o')
      await expect(win.getByTestId('marks-status')).toHaveText('Начало 00:01.0 · Конец 00:02.5')
      await expect(win.getByTestId('mark-out')).toBeVisible()
      await expect(win.getByTestId('mark-range')).toBeVisible()
      await win.screenshot({ path: join(SHOTS, `ep-marks${SUFFIX}.png`) })

      await win.keyboard.press('Digit6')
      await expect(rows(win)).toHaveCount(1)
      await expect(rows(win).first()).toContainText('Удар')
      await expect(rows(win).first()).toHaveAttribute('data-start', '1')
      await expect(rows(win).first()).toHaveAttribute('data-end', '2.5')
      await expect(win.getByTestId('marks-status')).toHaveText('Начало — · Конец —')
      await expect(win.getByTestId('mark-in')).toHaveCount(0)

      // Конец раньше начала: подсказка, эпизод не создаётся, метки остаются.
      await seekVideo(win, 3.0)
      await win.keyboard.press('i')
      await seekVideo(win, 1.0)
      await win.keyboard.press('o')
      await expect(win.getByTestId('marks-hint')).toHaveText('Конец должен быть позже начала.')
      await win.keyboard.press('Digit1')
      await expect(rows(win)).toHaveCount(1)
      await expect(win.getByTestId('toast')).toContainText('Конец раньше начала')
      await expect(win.getByTestId('marks-status')).toHaveText('Начало 00:03.0 · Конец 00:01.0')

      // Esc: сначала инструмент → «Выбор», потом сброс меток.
      await win.keyboard.press('a')
      await expect(win.getByTestId('tool-arrow')).toHaveAttribute('aria-pressed', 'true')
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
      await expect(win.getByTestId('mark-in')).toBeVisible()
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('mark-in')).toHaveCount(0)
      await expect(win.getByTestId('marks-status')).toHaveText('Начало — · Конец —')

      // Кнопки «Начало»/«Конец»/«Сбросить» работают так же, как клавиши.
      await seekVideo(win, 0.4)
      await win.getByTestId('set-in').click()
      await seekVideo(win, 1.9)
      await win.getByTestId('set-out').click()
      await expect(win.getByTestId('marks-status')).toHaveText('Начало 00:00.4 · Конец 00:01.9')
      await win.getByTestId('clear-marks').click()
      await expect(win.getByTestId('marks-status')).toHaveText('Начало — · Конец —')
    } finally {
      await app.close()
    }
  })

  test('список: переход к началу, воспроизведение с начала, дорожка, фильтр, правка', async () => {
    const { app, win } = await openFixture()
    try {
      // Три эпизода по меткам: два «Удар», один «Гол».
      const make = async (a: number, b: number, key: string): Promise<void> => {
        await seekVideo(win, a)
        await win.keyboard.press('i')
        await seekVideo(win, b)
        await win.keyboard.press('o')
        await win.keyboard.press(key)
      }
      await make(2.0, 3.0, 'Digit6')
      await make(0.4, 1.4, 'Digit7')
      await make(1.0, 2.2, 'Digit6')
      await expect(rows(win)).toHaveCount(3)
      // Порядок по началу.
      await expect(rows(win).nth(0)).toHaveAttribute('data-start', '0.4')
      await expect(rows(win).nth(1)).toHaveAttribute('data-start', '1')
      await expect(rows(win).nth(2)).toHaveAttribute('data-start', '2')

      // Полосы на таймлайне цвета тега; пересекающиеся — на разных строках.
      await expect(bars(win)).toHaveCount(3)
      const goal = win.locator('[data-testid="episode-bar"][data-tag-id="goal"]')
      await expect(goal).toBeVisible()
      await expect(goal).toHaveCSS('background-color', 'rgb(255, 77, 109)')
      const tops = await bars(win).evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).style.top)
      )
      expect(new Set(tops).size).toBeGreaterThan(1)

      // Клик по строке: выбор и переход к началу; воспроизведение остаётся на паузе.
      await rows(win).nth(2).click()
      await expect.poll(async () => (await videoState(win))?.currentTime).toBeCloseTo(2.0, 1)
      expect((await videoState(win))?.paused).toBe(true)
      await expect(rows(win).nth(2)).toHaveAttribute('aria-pressed', 'true')
      await expect(win.getByTestId('episode-editor')).toBeVisible()

      // Двойной щелчок — воспроизведение с начала.
      await rows(win).nth(0).dblclick()
      await expect.poll(async () => (await videoState(win))?.paused).toBe(false)
      await win.keyboard.press('Space')
      await expect.poll(async () => (await videoState(win))?.paused).toBe(true)

      // Клик по полосе на таймлайне выбирает эпизод и ведёт к началу.
      await goal.click()
      await expect.poll(async () => (await videoState(win))?.currentTime).toBeCloseTo(0.4, 1)
      await expect(win.locator('[data-testid="episode-row"][data-tag-id="goal"]')).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      // Фильтр по тегу: список сужается, неподходящие полосы тускнеют.
      const chips = win.getByTestId('filter-chip')
      await expect(chips).toHaveCount(2)
      await win.locator('[data-testid="filter-chip"][data-tag-id="shot"]').click()
      await expect(rows(win)).toHaveCount(2)
      await expect(win.locator('.ep-bar--dim')).toHaveCount(1)
      await expect(bars(win)).toHaveCount(3)
      await win.locator('[data-testid="filter-chip"][data-tag-id="goal"]').click()
      await expect(rows(win)).toHaveCount(3)
      await win.getByTestId('filter-reset').click()
      await expect(win.locator('.ep-bar--dim')).toHaveCount(0)
      await win.screenshot({ path: join(SHOTS, `ep-list${SUFFIX}.png`) })

      // Правка выбранного: «Текущее» для начала и конца, ошибка, заметка.
      await rows(win).nth(1).click() // [1.0, 2.2]
      await seekVideo(win, 1.2)
      await win.getByTestId('episode-start-now').click()
      await expect(win.getByTestId('episode-start-now-value')).toHaveText('00:01.2')
      await seekVideo(win, 2.0)
      await win.getByTestId('episode-end-now').click()
      await expect(win.getByTestId('episode-end-now-value')).toHaveText('00:02.0')
      await seekVideo(win, 1.25)
      await win.getByTestId('episode-end-now').click() // короче 0.2 с
      await expect(win.getByTestId('episode-edit-error')).toHaveText(
        'Эпизод не может быть короче 0.2 с'
      )
      await expect(win.getByTestId('episode-end-now-value')).toHaveText('00:02.0')
      await win.getByTestId('episode-note').fill('Пас в штрафную')
      await expect(win.getByTestId('episode-note')).toHaveValue('Пас в штрафную')
      await expect(win.locator('.ep-row__note')).toHaveText('Пас в штрафную')
      // Горячие клавиши молчат, пока печатаем в заметке.
      await win.getByTestId('episode-note').focus()
      await win.keyboard.type('1 a')
      await expect(win.getByTestId('episode-note')).toHaveValue('Пас в штрафную1 a')
      await expect(rows(win)).toHaveCount(3)
    } finally {
      await app.close()
    }
  })

  test('удаление: Delete и кнопка, Ctrl+Z возвращает; одна история с рисунками', async () => {
    const { app, win } = await openFixture()
    try {
      await seekVideo(win, 2.0)
      await win.keyboard.press('Digit1')
      await win.keyboard.press('Digit2')
      await expect(rows(win)).toHaveCount(2)

      // Delete удаляет выбранный эпизод, Ctrl+Z возвращает, Ctrl+Y удаляет снова.
      await rows(win).first().click()
      await win.keyboard.press('Delete')
      await expect(rows(win)).toHaveCount(1)
      await win.keyboard.press('Control+z')
      await expect(rows(win)).toHaveCount(2)
      await win.keyboard.press('Control+y')
      await expect(rows(win)).toHaveCount(1)
      await win.keyboard.press('Control+z')
      await expect(rows(win)).toHaveCount(2)

      // Кнопка корзины.
      await rows(win).last().hover()
      await win.getByTestId('episode-delete').last().click()
      await expect(rows(win)).toHaveCount(1)
      await win.keyboard.press('Control+z')
      await expect(rows(win)).toHaveCount(2)

      // Общая история: рисунок, потом эпизод. Первая отмена убирает эпизод, вторая — рисунок.
      await seekVideo(win, 0.5)
      await win.keyboard.press('a')
      await dragArrow(win)
      await expect(win.getByTestId('annotation')).toHaveCount(1)
      await seekVideo(win, 1.0)
      await win.keyboard.press('Digit3')
      await expect(rows(win)).toHaveCount(3)
      await win.keyboard.press('Control+z')
      await expect(rows(win)).toHaveCount(2)
      await expect(win.getByTestId('annotation')).toHaveCount(1)
      await win.keyboard.press('Control+z')
      await expect(win.getByTestId('annotation')).toHaveCount(0)
      await expect(rows(win)).toHaveCount(2)
      await win.keyboard.press('Control+Shift+z')
      await expect(win.getByTestId('annotation')).toHaveCount(1)
      await win.keyboard.press('Control+y')
      await expect(rows(win)).toHaveCount(3)
      // Кнопки отмены/повтора в панели стиля тоже общие.
      await win.getByTestId('undo').click()
      await expect(rows(win)).toHaveCount(2)
      await win.getByTestId('redo').click()
      await expect(rows(win)).toHaveCount(3)

      // Delete: побеждает то, что выбрано последним — рисунок или эпизод.
      await seekVideo(win, 1.0)
      await win.keyboard.press('i')
      await seekVideo(win, 2.0)
      await win.keyboard.press('o')
      await win.keyboard.press('Digit4')
      await expect(rows(win)).toHaveCount(4)
      await win.keyboard.press('v')
      const b = (await win.getByTestId('annotation-layer').boundingBox())!
      await win.mouse.click(b.x + b.width * 0.45, b.y + b.height * 0.45) // выбрать стрелку
      await expect(win.getByTestId('inspector')).toBeVisible()
      // Эпизод [1.0, 2.0]: переход к его началу оставляет стрелку видимой.
      await win.locator('[data-testid="episode-row"][data-start="1"]').click()
      await win.keyboard.press('Delete')
      await expect(rows(win)).toHaveCount(3)
      await expect(win.getByTestId('annotation')).toHaveCount(1)
      await win.keyboard.press('Delete') // эпизод удалён — удаляется рисунок
      await expect(win.getByTestId('annotation')).toHaveCount(0)
      await expect(rows(win)).toHaveCount(3)
    } finally {
      await app.close()
    }
  })

  test('другое видео очищает эпизоды и метки', async () => {
    const { app, win } = await openFixture()
    try {
      await win.keyboard.press('Digit1')
      await win.keyboard.press('i')
      await expect(rows(win)).toHaveCount(1)
      await stubDialog(app, fixture('cfr30.webm'))
      await win.getByTestId('open-video').click()
      // Эпизоды не сохранены в проект — приложение спрашивает, что делать.
      await win.getByTestId('unsaved-discard').click()
      await expect(win.getByTestId('file-name')).toHaveText('cfr30.webm')
      await expect(rows(win)).toHaveCount(0)
      await expect(win.getByTestId('episode-count')).toHaveText('0')
      await expect(win.getByTestId('marks-status')).toHaveText('Начало — · Конец —')
      await win.keyboard.press('Control+z')
      await expect(rows(win)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('снимки экрана: панель тегов, эпизоды и рисунки на таймлайне', async () => {
    const { app, win } = await openFixture()
    try {
      await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
      await win.screenshot({ path: join(SHOTS, `ep-empty${SUFFIX}.png`) })
      await seekVideo(win, 0.8)
      await win.keyboard.press('a')
      await dragArrow(win)
      await seekVideo(win, 1.0)
      await win.keyboard.press('Digit1')
      await seekVideo(win, 2.0)
      await win.keyboard.press('Digit6')
      await seekVideo(win, 3.0)
      await win.keyboard.press('Digit7')
      await seekVideo(win, 1.5)
      await win.keyboard.press('i')
      await rows(win).nth(1).click()
      await expect(rows(win)).toHaveCount(3)
      await win.screenshot({ path: join(SHOTS, `ep-full${SUFFIX}.png`) })
      await win
        .getByTestId('tag-panel')
        .screenshot({ path: join(SHOTS, `ep-tagpanel${SUFFIX}.png`) })
      await win
        .getByTestId('episode-track')
        .screenshot({ path: join(SHOTS, `ep-track${SUFFIX}.png`) })
    } finally {
      await app.close()
    }
  })
})
