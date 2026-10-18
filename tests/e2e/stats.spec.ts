// Статистика: окно, показатели, таблица, диаграммы, переходы и выгрузка CSV.
// Видео cfr25.mp4 (4 с): три эпизода двух тегов. Диалог сохранения и «Показать в проводнике» подменены.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  SHOTS,
  SUFFIX,
  fixture,
  launch,
  makeUserData,
  seekVideo,
  stubDialog,
  stubSaveDialog,
  saveDialogCalls,
  videoState
} from './helpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string }

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `${name}${SUFFIX}.png`) })

const dialog = (win: Page) => win.getByTestId('stats-dialog')
const rows = (win: Page) => win.getByTestId('stats-row')
const episodeRows = (win: Page) => win.getByTestId('episode-row')

async function openVideo(): Promise<Ctx> {
  const ctx = await launch()
  await stubDialog(ctx.app, fixture('cfr25.mp4'))
  await ctx.win.getByTestId('open-video').click()
  await expect(ctx.win.getByTestId('play-toggle')).toBeEnabled()
  await expect(ctx.win.getByTestId('annotation-layer')).toBeVisible()
  return ctx
}

async function addEpisode(win: Page, start: number, end: number, digit: number): Promise<void> {
  await seekVideo(win, start)
  await win.keyboard.press('i')
  await seekVideo(win, end)
  await win.keyboard.press('o')
  await win.keyboard.press(`Digit${digit}`)
}

/** «Атака» 0.5–1.5 и 2.0–3.0, «Удар» 1.0–2.5 (перекрывается с обеими «Атаками»). */
async function threeEpisodes(win: Page): Promise<void> {
  await addEpisode(win, 0.5, 1.5, 1)
  await addEpisode(win, 1.0, 2.5, 6)
  await addEpisode(win, 2.0, 3.0, 1)
  await expect(episodeRows(win)).toHaveCount(3)
}

const ATTACK = '#2bd67b'
const SHOT = '#ff8a3d'

async function stubReveal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __revealed: string[] }
    g.__revealed = []
    shell.showItemInFolder = (p: string) => {
      g.__revealed.push(p)
    }
  })
}
const revealed = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { __revealed?: string[] }).__revealed ?? [])

test.describe('статистика', () => {
  test('без видео кнопка недоступна, Ctrl+I ничего не открывает; команда есть в настройках', async () => {
    const { app, win } = await launch()
    try {
      const button = win.getByTestId('stats-open')
      await expect(button).toBeVisible()
      await expect(button).toBeDisabled()
      await expect(button).toContainText('Статистика')
      await win.keyboard.press('Control+i')
      await expect(dialog(win)).toHaveCount(0)

      await win.getByTestId('open-settings').click()
      await win.getByTestId('settings-tab-keys').click()
      const row = win.locator('[data-testid="keys-row"][data-command="stats:open"]')
      await expect(row).toBeVisible()
      await expect(row).toContainText('Статистика')
      await expect(row).toContainText('Ctrl')
      await expect(win.getByRole('region', { name: 'Анализ' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('без эпизодов: честное пустое состояние, выгрузка недоступна, Esc закрывает', async () => {
    const { app, win } = await openVideo()
    try {
      const button = win.getByTestId('stats-open')
      await expect(button).toBeEnabled()
      await expect(button).toHaveAttribute('title', /Ctrl\+I/)
      await button.click()
      await expect(dialog(win)).toBeVisible()
      await expect(win.getByTestId('stats-empty')).toContainText(
        'Пока нет эпизодов — отметьте их тегами, и здесь появится статистика'
      )
      await expect(win.getByTestId('stats-kpis')).toHaveCount(0)
      await expect(win.getByTestId('stats-export-csv')).toBeDisabled()
      await shot(win, 'stats-empty')
      await win.keyboard.press('Escape')
      await expect(dialog(win)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('показатели, таблица, сортировка, диаграммы, подсказка; Ctrl+I; фокус внутри окна', async () => {
    const { app, win } = await openVideo()
    try {
      await threeEpisodes(win)
      const duration = (await videoState(win))!.duration
      // Объединение отрезков: 0.5–3.0 = 2.5 с (пересечения один раз).
      const pct = Math.round((2.5 / duration) * 100)

      await win.keyboard.press('Control+i')
      await expect(dialog(win)).toBeVisible()
      await expect(win.getByTestId('stats-kpi-episodes-value')).toHaveText('3')
      await expect(win.getByTestId('stats-kpi-time-value')).toHaveText('2.5 с')
      await expect(win.getByTestId('stats-kpi-time-sub')).toHaveText(`${pct}% видео`)
      await expect(win.getByTestId('stats-kpi-tags-value')).toHaveText('2')
      // (1.0 + 1.5 + 1.0) / 3 = 1.17 → «1.2 с»
      await expect(win.getByTestId('stats-kpi-avg-value')).toHaveText('1.2 с')

      // Таблица: по умолчанию по числу эпизодов, «Атака» первой.
      await expect(rows(win)).toHaveCount(2)
      const attack = rows(win).nth(0)
      await expect(attack).toHaveAttribute('data-tag-id', 'attack')
      await expect(attack).toContainText('Атака')
      await expect(attack.locator('[data-col="count"]')).toHaveText('2')
      await expect(attack.locator('[data-col="total"]')).toHaveText('2.0 с')
      await expect(attack.locator('[data-col="avg"]')).toHaveText('1.0 с')
      await expect(attack.locator('[data-col="shareCount"]')).toHaveText('67%')
      await expect(attack.locator('[data-col="shareTime"]')).toHaveText('57%')
      const hit = rows(win).nth(1)
      await expect(hit).toContainText('Удар')
      await expect(hit.locator('[data-col="count"]')).toHaveText('1')
      await expect(hit.locator('[data-col="total"]')).toHaveText('1.5 с')
      await expect(hit.locator('[data-col="shareCount"]')).toHaveText('33%')
      await expect(hit.locator('[data-col="shareTime"]')).toHaveText('43%')

      // Сортировка: клик по заголовку «Время всего» (по убыванию — «Удар» 1.5 выше «Атаки» 2.0? нет: 2.0 больше).
      await win.getByTestId('stats-sort-total').click()
      await expect(win.getByTestId('stats-sort-total').locator('xpath=..')).toHaveAttribute(
        'aria-sort',
        'descending'
      )
      await expect(rows(win).first()).toHaveAttribute('data-tag-id', 'attack')
      await win.getByTestId('stats-sort-total').click()
      await expect(rows(win).first()).toHaveAttribute('data-tag-id', 'shot')
      await win.getByTestId('stats-sort-name').click()
      await expect(rows(win).first()).toHaveAttribute('data-tag-id', 'attack') // А < У
      await win.getByTestId('stats-sort-name').click()
      await expect(rows(win).first()).toHaveAttribute('data-tag-id', 'shot')
      await win.getByTestId('stats-sort-count').click()
      await expect(rows(win).first()).toHaveAttribute('data-tag-id', 'attack')

      // Диаграмма 1: столбцы в цветах тегов, значения подписаны.
      const bars = win.getByTestId('stats-bar')
      await expect(bars).toHaveCount(2)
      await expect(bars.nth(0)).toHaveAttribute('data-color', ATTACK)
      await expect(bars.nth(0).locator('path')).toHaveAttribute('fill', ATTACK)
      await expect(bars.nth(1).locator('path')).toHaveAttribute('fill', SHOT)
      await expect(bars.nth(0)).toHaveAttribute('aria-label', /Атака: 2/)
      await expect(bars.nth(0).locator('text').last()).toHaveText('2')
      const w0 = (await bars.nth(0).locator('path').boundingBox())!.width
      const w1 = (await bars.nth(1).locator('path').boundingBox())!.width
      expect(w0).toBeGreaterThan(w1 * 1.8)

      // Диаграмма 2: 4 отрезка по 1 с для видео в 4 секунды; ось в минутах и секундах.
      await expect(win.getByTestId('stats-dist-info')).toContainText('Отрезки по 1 с')
      const bins = win.getByTestId('stats-bin')
      await expect(bins).toHaveCount(4)
      await expect(bins.nth(0)).toHaveAttribute('data-total', '1')
      await expect(bins.nth(1)).toHaveAttribute('data-total', '1')
      await expect(bins.nth(2)).toHaveAttribute('data-total', '1')
      await expect(bins.nth(3)).toHaveAttribute('data-total', '0')
      await expect(win.getByTestId('stats-xtick').first()).toHaveText('00:00')
      await expect(bins.nth(1).locator('[data-testid="stats-segment"]')).toHaveAttribute(
        'data-color',
        SHOT
      )
      await expect(win.getByTestId('stats-legend').locator('li')).toHaveCount(2)

      // Подсказка при наведении: диапазон и теги.
      await bins.nth(1).hover()
      const tip = win.getByTestId('stats-tooltip')
      await expect(tip).toBeVisible()
      await expect(tip).toContainText('00:01–00:02')
      await expect(tip).toContainText('Удар')
      await shot(win, `stats-tooltip`)
      await win.mouse.move(5, 5)
      await expect(tip).toHaveCount(0)

      // Размер отрезка: 5 мин для короткого видео — один отрезок.
      await win.getByTestId('stats-bin-300').click()
      await expect(bins).toHaveCount(1)
      await expect(bins.first()).toHaveAttribute('data-total', '3')
      await win.getByTestId('stats-bin-auto').click()
      await expect(bins).toHaveCount(4)

      await shot(win, 'stats-dialog')

      // Фокус остаётся внутри окна, Esc закрывает, Ctrl+I открывает снова.
      for (let i = 0; i < 40; i++) {
        await win.keyboard.press('Tab')
        const inside = await win.evaluate(() =>
          document.querySelector('[data-testid="stats-dialog"]')?.contains(document.activeElement)
        )
        expect(inside).toBe(true)
      }
      await win.keyboard.press('Escape')
      await expect(dialog(win)).toHaveCount(0)
      await win.keyboard.press('Control+i')
      await expect(dialog(win)).toBeVisible()
      await win.getByTestId('stats-close').click()
      await expect(dialog(win)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('клавиатура: стрелки по столбцам, Enter перематывает', async () => {
    const { app, win } = await openVideo()
    try {
      await threeEpisodes(win)
      await win.getByTestId('stats-open').click()
      const bins = win.getByTestId('stats-bin')
      await bins.first().focus()
      await expect(win.getByTestId('stats-tooltip')).toBeVisible()
      await win.keyboard.press('ArrowRight')
      await win.keyboard.press('ArrowRight')
      await expect(bins.nth(2)).toBeFocused()
      await expect(win.getByTestId('stats-tooltip')).toContainText('00:02–00:03')
      await win.keyboard.press('Enter')
      await expect(dialog(win)).toHaveCount(0)
      expect((await videoState(win))!.currentTime).toBeCloseTo(2, 1)
    } finally {
      await app.close()
    }
  })

  test('клик по строке таблицы включает фильтр тега и закрывает окно', async () => {
    const { app, win } = await openVideo()
    try {
      await threeEpisodes(win)
      await win.getByTestId('stats-open').click()
      await rows(win).filter({ hasText: 'Удар' }).click()
      await expect(dialog(win)).toHaveCount(0)
      await expect(episodeRows(win)).toHaveCount(1)
      await expect(episodeRows(win).first()).toHaveAttribute('data-tag-id', 'shot')
      await expect(win.locator('[data-testid="filter-chip"][data-tag-id="shot"]')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(
        win.locator('[data-testid="filter-chip"][data-tag-id="attack"]')
      ).toHaveAttribute('aria-pressed', 'false')

      // С включённым фильтром в окне появляется переключатель; по умолчанию он выключен.
      await win.getByTestId('stats-open').click()
      const respect = win.getByTestId('stats-respect-filter')
      await expect(respect).not.toBeChecked()
      await expect(win.getByTestId('stats-kpi-episodes-value')).toHaveText('3')
      await respect.check()
      await expect(win.getByTestId('stats-kpi-episodes-value')).toHaveText('1')
      await expect(win.getByTestId('stats-kpi-tags-value')).toHaveText('1')
      await expect(rows(win)).toHaveCount(1)
      await win.keyboard.press('Escape')
    } finally {
      await app.close()
    }
  })

  test('клик по столбцу перематывает видео к началу отрезка и закрывает окно', async () => {
    const { app, win } = await openVideo()
    try {
      await threeEpisodes(win)
      await seekVideo(win, 0)
      await win.getByTestId('stats-open').click()
      await win.getByTestId('stats-bin').nth(2).click()
      await expect(dialog(win)).toHaveCount(0)
      expect((await videoState(win))!.currentTime).toBeCloseTo(2, 1)
    } finally {
      await app.close()
    }
  })

  test('выгрузка CSV: BOM, «;», экранирование, защита от формул, «Показать в папке»', async () => {
    const { app, win, userData } = await openVideo()
    try {
      await threeEpisodes(win)
      // Заметки: с формулой, и с «;», кавычкой.
      await episodeRows(win).nth(0).click()
      await win.getByTestId('episode-note').fill('=1+1')
      await episodeRows(win).nth(1).click()
      await win.getByTestId('episode-note').fill('Угловой; "быстро"')

      const out = join(makeUserData(), 'выгрузка статистики')
      mkdirSync(out)
      const target = join(out, 'Мой матч статистика.csv')
      await stubSaveDialog(app, target)
      await stubReveal(app)

      await win.getByTestId('stats-open').click()
      await win.getByTestId('stats-export-csv').click()
      await expect(win.getByTestId('stats-saved')).toHaveText('Сохранено: Мой матч статистика.csv')
      expect(await saveDialogCalls(app)).toBe(1)
      expect(existsSync(target)).toBe(true)

      const bytes = readFileSync(target)
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      const text = bytes.toString('utf8').slice(1)
      const lines = text.split('\r\n')
      expect(lines[0]).toBe('Статистика по тегам')
      expect(lines[1].split(';')).toHaveLength(8)
      expect(lines[2]).toMatch(/^Атака;2;2,0;1,0;66,7;57,1;00:00\.5;00:02\.0$/)
      expect(lines[3]).toMatch(/^Удар;1;1,5;1,5;33,3;42,9;00:01\.0;00:01\.0$/)
      expect(lines[4]).toBe('')
      expect(lines[5]).toBe('Эпизоды')
      expect(lines[6]).toBe('№;Тег;Начало;Конец;Длительность, с;Заметка')
      // По порядку начала: Атака 0.5, Удар 1.0, Атака 2.0.
      expect(lines[7]).toBe("1;Атака;00:00.5;00:01.5;1,0;'=1+1")
      expect(lines[8]).toBe('2;Удар;00:01.0;00:02.5;1,5;"Угловой; ""быстро"""')
      expect(lines[9]).toBe('3;Атака;00:02.0;00:03.0;1,0;')

      // «Показать в папке» открывает именно созданный файл.
      await win.getByTestId('stats-reveal').click()
      await expect.poll(() => revealed(app)).toEqual([target])
      void userData
    } finally {
      await app.close()
    }
  })

  test('отмена диалога сохранения ничего не пишет и не показывает «Сохранено»', async () => {
    const { app, win } = await openVideo()
    try {
      await threeEpisodes(win)
      await app.evaluate(({ dialog: d }) => {
        d.showSaveDialog = (async () => ({
          canceled: true,
          filePath: ''
        })) as unknown as typeof d.showSaveDialog
      })
      await win.getByTestId('stats-open').click()
      await win.getByTestId('stats-export-csv').click()
      await expect(win.getByTestId('stats-export-csv')).toBeEnabled()
      await expect(win.getByTestId('stats-saved')).toHaveCount(0)
      await expect(win.getByTestId('stats-save-error')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('переназначенная клавиша открывает окно', async () => {
    const ctx = await launch({
      settingsFile: {
        version: 1,
        keybindings: { 'stats:open': [{ code: 'KeyJ', ctrl: true, alt: false, shift: false }] }
      }
    })
    const { app, win } = ctx
    try {
      await stubDialog(app, fixture('cfr25.mp4'))
      await win.getByTestId('open-video').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await win.keyboard.press('Control+i')
      await expect(dialog(win)).toHaveCount(0)
      await win.keyboard.press('Control+j')
      await expect(dialog(win)).toBeVisible()
      await expect(win.getByTestId('stats-open')).toHaveAttribute('title', /Ctrl\+J/)
    } finally {
      await app.close()
    }
  })
})
