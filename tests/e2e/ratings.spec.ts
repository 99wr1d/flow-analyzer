// Оценки эпизодов: «хорошо», «плохо», «разобрать» — кнопки, горячие клавиши, подсказка, фильтры, таймлайн, статистика, файл.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  SHOTS,
  SUFFIX,
  fixture,
  launch,
  makeUserData,
  pressRussian,
  seekVideo,
  stubDialog,
  stubSaveDialog
} from './helpers'
import { addEpisode, quickOpen, seedProject, type Ctx } from './startHelpers'

// Небольшая пауза: переходы цвета у кнопок должны закончиться, иначе на снимке они «наполовину».
const shot = async (win: Page, name: string): Promise<Buffer> => {
  await win.waitForTimeout(300)
  return win.screenshot({ path: join(SHOTS, `${name}${SUFFIX}.png`) })
}

const list = (win: Page) => win.getByTestId('episode-list')
const rows = (win: Page) => win.getByTestId('episode-row')
const bars = (win: Page) => win.getByTestId('episode-bar')
const toast = (win: Page) => win.getByTestId('toast')

/** Кнопка оценки в строке списка (по порядку строк). */
const rowBtn = (win: Page, row: number, kind: 'good' | 'bad' | 'review') =>
  list(win).locator('li').nth(row).getByTestId(`rate-${kind}`)

async function open(): Promise<Ctx> {
  const ctx = await launch()
  await quickOpen(ctx)
  return ctx
}

const state = async (
  win: Page,
  row: number
): Promise<{ good: boolean; bad: boolean; review: boolean }> => ({
  good: (await rowBtn(win, row, 'good').getAttribute('aria-pressed')) === 'true',
  bad: (await rowBtn(win, row, 'bad').getAttribute('aria-pressed')) === 'true',
  review: (await rowBtn(win, row, 'review').getAttribute('aria-pressed')) === 'true'
})

/** Три эпизода: «Атака» 0.2–1.2, «Удар» 1.4–2.4, «Атака» 2.6–3.6 (видео cfr25.mp4 — 4 секунды). */
async function threeEpisodes(win: Page): Promise<void> {
  await addEpisode(win, 0.2, 1.2, 1)
  await addEpisode(win, 1.4, 2.4, 6)
  await addEpisode(win, 2.6, 3.6, 1)
  await expect(rows(win)).toHaveCount(3)
}

test.describe('оценки эпизодов', () => {
  test('у каждой строки три кнопки-иконки с подсказками и клавишами; новый эпизод без оценки', async () => {
    const { app, win } = await open()
    try {
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await expect(rows(win)).toHaveCount(1)
      const good = rowBtn(win, 0, 'good')
      const bad = rowBtn(win, 0, 'bad')
      const review = rowBtn(win, 0, 'review')
      for (const b of [good, bad, review]) {
        await expect(b).toBeVisible()
        // Иконка — векторная картинка, а не слова и не эмодзи.
        await expect(b.locator('svg')).toHaveCount(1)
        await expect(b).toHaveText('')
        await expect(b).toHaveAttribute('aria-pressed', 'false')
      }
      await expect(good).toHaveAttribute('title', 'Хорошо (=)')
      await expect(bad).toHaveAttribute('title', 'Плохо (-)')
      await expect(review).toHaveAttribute('title', 'Разобрать (/)')
      expect(await state(win, 0)).toEqual({ good: false, bad: false, review: false })
    } finally {
      await app.close()
    }
  })

  test('клик: хорошо → активна; плохо → переключает; повтор снимает; «разобрать» независима', async () => {
    const { app, win } = await open()
    try {
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await expect(win.getByTestId('project-dirty')).toBeVisible()

      await rowBtn(win, 0, 'good').click()
      expect(await state(win, 0)).toEqual({ good: true, bad: false, review: false })
      await rowBtn(win, 0, 'bad').click()
      expect(await state(win, 0)).toEqual({ good: false, bad: true, review: false })
      await rowBtn(win, 0, 'review').click()
      expect(await state(win, 0)).toEqual({ good: false, bad: true, review: true })
      await rowBtn(win, 0, 'bad').click()
      expect(await state(win, 0)).toEqual({ good: false, bad: false, review: true })
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 0, 'review').click()
      expect(await state(win, 0)).toEqual({ good: true, bad: false, review: false })
      // Кнопка не оставляет фокус: пробел продолжает управлять плеером.
      await expect(rowBtn(win, 0, 'good')).not.toBeFocused()
    } finally {
      await app.close()
    }
  })

  test('отмена и повтор: Ctrl+Z возвращает оценку, Ctrl+Y повторяет; оценка делает проект несохранённым', async () => {
    const { app, win } = await open()
    try {
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 0, 'review').click()
      await win.keyboard.press('Control+z')
      expect(await state(win, 0)).toEqual({ good: true, bad: false, review: false })
      await win.keyboard.press('Control+z')
      expect(await state(win, 0)).toEqual({ good: false, bad: false, review: false })
      await win.keyboard.press('Control+y')
      await win.keyboard.press('Control+y')
      expect(await state(win, 0)).toEqual({ good: true, bad: false, review: true })
    } finally {
      await app.close()
    }
  })

  test('горячие клавиши = - / : последний созданный эпизод, выбранный эпизод, русская раскладка, подсказка без эпизодов', async () => {
    const { app, win } = await open()
    try {
      // Эпизодов нет — краткая подсказка.
      await win.keyboard.press('Equal')
      await expect(toast(win)).toHaveAttribute('data-kind', 'warn')
      await expect(toast(win)).toContainText('Нет эпизода для оценки')

      await addEpisode(win, 0.2, 1.2, 1)
      await addEpisode(win, 2.0, 3.0, 6)
      await expect(rows(win)).toHaveCount(2)

      // Без выбора — на последнем созданном (строка 2).
      await win.keyboard.press('Equal')
      expect(await state(win, 1)).toEqual({ good: true, bad: false, review: false })
      expect(await state(win, 0)).toEqual({ good: false, bad: false, review: false })
      await win.keyboard.press('Minus')
      expect(await state(win, 1)).toEqual({ good: false, bad: true, review: false })
      await win.keyboard.press('Slash')
      expect(await state(win, 1)).toEqual({ good: false, bad: true, review: true })

      // Выбранный эпизод важнее последнего.
      await rows(win).nth(0).click()
      await win.keyboard.press('Equal')
      await win.keyboard.press('Slash')
      expect(await state(win, 0)).toEqual({ good: true, bad: false, review: true })
      expect(await state(win, 1)).toEqual({ good: false, bad: true, review: true })

      // Русская раскладка: клавиши привязаны к физическому положению.
      await pressRussian(win, 'Minus', '-')
      expect(await state(win, 0)).toEqual({ good: false, bad: true, review: true })

      // В текстовом поле клавиши печатают, а не оценивают.
      await win.getByTestId('episode-note').fill('')
      await win.getByTestId('episode-note').focus()
      await win.keyboard.type('=-/')
      await expect(win.getByTestId('episode-note')).toHaveValue('=-/')
      expect(await state(win, 0)).toEqual({ good: false, bad: true, review: true })
    } finally {
      await app.close()
    }
  })

  test('подсказка после тега: три значка, клик оценивает; работает, пока подсказка видна', async () => {
    const { app, win } = await open()
    try {
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      const t = toast(win)
      await expect(t).toContainText('Эпизод «Атака»')
      const good = t.getByTestId('rate-good')
      const bad = t.getByTestId('rate-bad')
      const review = t.getByTestId('rate-review')
      await expect(good).toBeVisible()
      await expect(bad).toBeVisible()
      await expect(review).toBeVisible()
      await expect(good.locator('svg')).toHaveCount(1)
      await shot(win, 'ratings-toast')

      await good.click()
      await expect(toast(win)).toContainText('Оценка: хорошо')
      expect(await state(win, 0)).toEqual({ good: true, bad: false, review: false })
      await expect(toast(win).getByTestId('rate-good')).toHaveAttribute('aria-pressed', 'true')
      await toast(win).getByTestId('rate-review').click()
      expect(await state(win, 0)).toEqual({ good: true, bad: false, review: true })
      await toast(win).getByTestId('rate-bad').click()
      expect(await state(win, 0)).toEqual({ good: false, bad: true, review: true })
    } finally {
      await app.close()
    }
  })

  test('фильтры по оценке: «или» внутри группы, «и» с тегами, «Без оценки», сброс, тусклые полосы на таймлайне', async () => {
    const { app, win } = await open()
    try {
      await threeEpisodes(win)
      // Атака#1 — хорошо, Удар — плохо + разобрать, Атака#2 — без оценки.
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 1, 'bad').click()
      await rowBtn(win, 1, 'review').click()

      const chip = (kind: string) =>
        win.locator(`[data-testid="rating-chip"][data-rating="${kind}"]`)
      await expect(chip('good')).toContainText('1')
      await expect(chip('bad')).toContainText('1')
      await expect(chip('review')).toContainText('1')
      await expect(chip('none')).toContainText('Без оценки')
      await expect(chip('none')).toContainText('1')
      await shot(win, 'ratings-filters')

      await chip('good').click()
      await expect(rows(win)).toHaveCount(1)
      await expect(chip('good')).toHaveAttribute('aria-pressed', 'true')
      // Остальные полосы на таймлайне притушены.
      await expect(win.locator('[data-testid="episode-bar"].ep-bar--dim')).toHaveCount(2)

      await chip('bad').click() // good или bad
      await expect(rows(win)).toHaveCount(2)
      await chip('good').click()
      await chip('bad').click()

      await chip('none').click()
      await expect(rows(win)).toHaveCount(1)
      await expect(rows(win).first()).toHaveAttribute('data-tag-id', 'attack')

      // Теги + оценки: «и».
      await chip('none').click()
      await win.locator('[data-testid="filter-chip"][data-tag-id="attack"]').click()
      await expect(rows(win)).toHaveCount(2)
      await chip('good').click()
      await expect(rows(win)).toHaveCount(1)
      await chip('review').click() // good или review среди «Атаки»: только хороший
      await expect(rows(win)).toHaveCount(1)
      await chip('good').click()
      await expect(list(win)).toContainText('Нет эпизодов с выбранными тегами и оценками')

      await win.getByTestId('filter-reset').click()
      await expect(rows(win)).toHaveCount(3)
      await expect(win.locator('[data-testid="rating-chip"][aria-pressed="true"]')).toHaveCount(0)
      await expect(win.locator('[data-testid="filter-chip"][aria-pressed="true"]')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('экспорт: «видимые по фильтру» учитывает оценки', async () => {
    const { app, win } = await open()
    try {
      await threeEpisodes(win)
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 2, 'good').click()
      await win.locator('[data-testid="rating-chip"][data-rating="good"]').click()
      await expect(rows(win)).toHaveCount(2)
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-scope-visible')).toBeChecked()
      await expect(win.getByTestId('export-scope-visible')).toHaveAccessibleName(
        'Видимые по фильтру (2)'
      )
      await expect(win.getByTestId('export-scope-all')).toHaveAccessibleName('Все (3)')
      await win.keyboard.press('Escape')
    } finally {
      await app.close()
    }
  })

  test('таймлайн: на полосе эпизода значки оценки; без оценки значков нет', async () => {
    const { app, win } = await open()
    try {
      await addEpisode(win, 0.2, 3.8, 1)
      await expect(bars(win)).toHaveCount(1)
      await expect(bars(win).first().getByTestId('episode-bar-marks')).toHaveCount(0)
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 0, 'review').click()
      const marks = bars(win).first().getByTestId('episode-bar-marks')
      await expect(marks).toBeVisible()
      await expect(marks.locator('[data-mark="good"]')).toBeVisible()
      await expect(marks.locator('[data-mark="review"]')).toBeVisible()
      await expect(bars(win).first()).toHaveAttribute('data-rating', 'good')
      await expect(bars(win).first()).toHaveAttribute('data-review', 'true')
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 0, 'bad').click()
      await expect(marks.locator('[data-mark="bad"]')).toBeVisible()
      await expect(marks.locator('[data-mark="good"]')).toHaveCount(0)
      await shot(win, 'ratings-timeline')
    } finally {
      await app.close()
    }
  })

  test('статистика: колонки «хорошо», «плохо», «разобрать», % хороших; CSV с новыми колонками', async () => {
    const { app, win } = await open()
    try {
      await threeEpisodes(win)
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 2, 'bad').click()
      await rowBtn(win, 2, 'review').click()
      await win.getByTestId('stats-open').click()
      await expect(win.getByTestId('stats-dialog')).toBeVisible()
      const attack = win.locator('[data-testid="stats-row"][data-tag-id="attack"]')
      const shotRow = win.locator('[data-testid="stats-row"][data-tag-id="shot"]')
      await expect(attack.locator('[data-col="good"]')).toHaveText('1')
      await expect(attack.locator('[data-col="bad"]')).toHaveText('1')
      await expect(attack.locator('[data-col="review"]')).toHaveText('1')
      await expect(attack.locator('[data-col="goodPercent"]')).toHaveText('50%')
      // У «Удара» оценок нет: процент хороших — прочерк.
      await expect(shotRow.locator('[data-col="goodPercent"]')).toHaveText('—')
      await expect(win.getByTestId('stats-kpi-good-value')).toHaveText('50%')
      await expect(win.getByTestId('stats-kpi-good-sub')).toHaveText('Хорошо: 1 · Плохо: 1')
      // Сортировка по новой колонке.
      await win.getByTestId('stats-sort-good').click()
      await expect(win.getByTestId('stats-sort-good')).toHaveAttribute('title', /Сортировать/)
      await shot(win, 'ratings-stats')

      const out = join(makeUserData(), 'csv')
      mkdirSync(out, { recursive: true })
      const target = join(out, 'оценки статистика.csv')
      await stubSaveDialog(app, target)
      await win.getByTestId('stats-export-csv').click()
      await expect(win.getByTestId('stats-saved')).toBeVisible()
      const lines = readFileSync(target, 'utf8').slice(1).split('\r\n')
      expect(lines[1]).toBe(
        'Тег;Эпизодов;Время всего, с;Средняя длительность, с;Доля эпизодов, %;Доля времени, %;Первое начало;Последнее начало;Хорошо;Плохо;Разобрать;Хороших, %'
      )
      expect(lines[2]).toMatch(/^Атака;2;.*;1;1;1;50,0$/)
      expect(lines[3]).toMatch(/^Удар;1;.*;0;0;0;—$/)
      expect(lines[5]).toBe('Эпизоды')
      expect(lines[6]).toBe('№;Тег;Начало;Конец;Длительность, с;Оценка;Разобрать;Заметка')
      expect(lines[7]).toMatch(/^1;Атака;.*;Хорошо;нет;$/)
      expect(lines[8]).toMatch(/^2;Удар;.*;—;нет;$/)
      expect(lines[9]).toMatch(/^3;Атака;.*;Плохо;да;$/)
    } finally {
      await app.close()
    }
  })

  test('сохранить и открыть: оценки сохраняются в файле и возвращаются', async () => {
    const { app, win, userData } = await open()
    const file = join(userData, 'оценённый.flowproj')
    try {
      await threeEpisodes(win)
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 1, 'bad').click()
      await rowBtn(win, 1, 'review').click()
      await stubSaveDialog(app, file)
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      expect(
        saved.episodes.map((e: { rating: string | null; review: boolean }) => [e.rating, e.review])
      ).toEqual([
        ['good', false],
        ['bad', true],
        [null, false]
      ])
      await app.close()

      const again = await launch({ args: [file] })
      try {
        await expect(rows(again.win)).toHaveCount(3)
        expect(await state(again.win, 0)).toEqual({ good: true, bad: false, review: false })
        expect(await state(again.win, 1)).toEqual({ good: false, bad: true, review: true })
        expect(await state(again.win, 2)).toEqual({ good: false, bad: false, review: false })
        await expect(bars(again.win).nth(1)).toHaveAttribute('data-rating', 'bad')
      } finally {
        await again.app.close()
      }
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('старый проект без полей оценок открывается без ошибок; оценить можно и сохранить', async () => {
    const dir = join(makeUserData(), 'старые')
    const file = seedProject(join(dir, 'старый.flowproj'), {
      episodes: [
        { n: 1, start: 0.5, end: 1.5, legacy: true },
        {
          n: 2,
          start: 2,
          end: 3,
          legacy: true,
          tagId: 'shot',
          tagName: 'Удар',
          tagColor: '#ff8a3d'
        }
      ]
    })
    expect(readFileSync(file, 'utf8')).not.toContain('"rating"')
    const { app, win } = await launch({ args: [file] })
    try {
      await expect(win.getByTestId('project-error')).toHaveCount(0)
      await expect(rows(win)).toHaveCount(2)
      expect(await state(win, 0)).toEqual({ good: false, bad: false, review: false })
      expect(await state(win, 1)).toEqual({ good: false, bad: false, review: false })
      await expect(win.locator('[data-testid="rating-chip"][data-rating="none"]')).toContainText(
        '2'
      )
      await rowBtn(win, 1, 'bad').click()
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      expect(saved.episodes[0]).toMatchObject({ rating: null, review: false })
      expect(saved.episodes[1]).toMatchObject({ rating: 'bad', review: false })
    } finally {
      await app.close()
    }
  })

  test('настройки: три команды оценки в группе «Эпизоды» с клавишами = - /', async () => {
    const { app, win } = await open()
    try {
      await win.getByTestId('open-settings').click()
      await win.getByRole('tab', { name: 'Горячие клавиши' }).click()
      const row = (id: string) => win.locator(`[data-testid="keys-row"][data-command="${id}"]`)
      await expect(row('episodes:rate-good')).toContainText('Оценка: хорошо')
      await expect(row('episodes:rate-good')).toContainText('=')
      await expect(row('episodes:rate-bad')).toContainText('Оценка: плохо')
      await expect(row('episodes:rate-bad')).toContainText('-')
      await expect(row('episodes:review')).toContainText('Разобрать')
      await expect(row('episodes:review')).toContainText('/')
    } finally {
      await app.close()
    }
  })

  test('снимок: список эпизодов с иконками оценки и фильтрами', async () => {
    const { app, win } = await open()
    try {
      await threeEpisodes(win)
      await rowBtn(win, 0, 'good').click()
      await rowBtn(win, 1, 'bad').click()
      await rowBtn(win, 1, 'review').click()
      await rowBtn(win, 2, 'review').click()
      await rows(win).nth(1).click()
      await win.mouse.move(5, 5)
      await shot(win, 'ratings-episodes-list')
      await stubDialog(app, fixture('cfr25.mp4'))
    } finally {
      await app.close()
    }
  })
})
