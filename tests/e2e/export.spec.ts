// Экспорт клипов: окно, режимы, прогресс, отмена, результат, закрытие окна во время экспорта.
// Настоящий ffmpeg вырезает файлы в временные папки; системные диалоги и «Показать в проводнике» подменены.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import { countFrames, durationOf } from '../../src/main/ffmpeg/ffmpeg.testkit'
import {
  SHOTS,
  SUFFIX,
  closeWindow,
  fixture,
  launch,
  makeUserData,
  seekVideo,
  stubDialog
} from './helpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string }

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `${name}${SUFFIX}.png`) })

const dialog = (win: Page) => win.getByTestId('export-dialog')
const rows = (win: Page) => win.getByTestId('episode-row')

/** Новая пустая папка для результатов экспорта (чистится вместе с папками данных). */
function makeOutDir(): string {
  const dir = join(makeUserData(), 'out')
  mkdirSync(dir)
  return dir
}

async function openVideo(ctx: Ctx, video: string): Promise<void> {
  await stubDialog(ctx.app, video)
  await ctx.win.getByTestId('open-video').click()
  await expect(ctx.win.getByTestId('play-toggle')).toBeEnabled()
  await expect(ctx.win.getByTestId('annotation-layer')).toBeVisible()
}

/** Эпизод по меткам «Начало» и «Конец» и тегу с клавишей digit. */
async function addEpisode(win: Page, start: number, end: number, digit: number): Promise<void> {
  await seekVideo(win, start)
  await win.keyboard.press('i')
  await seekVideo(win, end)
  await win.keyboard.press('o')
  await win.keyboard.press(`Digit${digit}`)
}

/** Два коротких эпизода на cfr25.mp4: «Атака» 1.0–2.0 и «Удар» 2.5–3.5. */
async function twoEpisodes(win: Page): Promise<void> {
  await addEpisode(win, 1.0, 2.0, 1)
  await addEpisode(win, 2.5, 3.5, 6)
  await expect(rows(win)).toHaveCount(2)
}

/** Подменяет «Показать в проводнике»: вызовы записываются, окно проводника не открывается. */
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

/** Диалог «Сохранить»: возвращает заданный путь и запоминает параметры вызова. */
async function stubSave(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog: d }, p) => {
    const g = globalThis as unknown as { __saveOptions: Array<{ defaultPath?: string }> }
    g.__saveOptions = []
    d.showSaveDialog = (async (...args: unknown[]) => {
      g.__saveOptions.push(args[args.length - 1] as { defaultPath?: string })
      return { canceled: false, filePath: p }
    }) as unknown as typeof d.showSaveDialog
  }, path)
}
const saveOptions = (app: ElectronApplication): Promise<Array<{ defaultPath?: string }>> =>
  app.evaluate(
    () =>
      (globalThis as unknown as { __saveOptions?: Array<{ defaultPath?: string }> })
        .__saveOptions ?? []
  )

/** Длинный ролик, чтобы успеть отменить экспорт: создаётся при запуске теста, в репозиторий не кладётся. */
function makeLongVideo(dir: string, seconds: number): string {
  const out = join(dir, 'long.mp4')
  execFileSync(
    ffmpegPath as string,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-y',
      out
    ],
    { windowsHide: true }
  )
  return out
}

const percentOf = async (win: Page, id: string): Promise<number> =>
  Number((await win.getByTestId(id).getAttribute('data-percent')) ?? '0')

test.describe('экспорт клипов', () => {
  test('кнопка и Ctrl+E открывают окно; на стартовом экране Ctrl+E молчит, без эпизодов — «Всё видео»; команда есть в настройках', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await expect(win.getByTestId('export-open')).toHaveCount(0)
      await win.keyboard.press('Control+e')
      await expect(dialog(win)).toHaveCount(0)

      await openVideo(ctx, fixture('cfr25.mp4'))
      // Видео есть, эпизодов нет: экспорт доступен, предлагается всё видео целиком.
      await expect(win.getByTestId('export-open')).toBeEnabled()
      await win.keyboard.press('Control+e')
      await expect(dialog(win)).toBeVisible()
      await expect(win.getByTestId('export-scope-whole')).toBeChecked()
      await expect(win.getByTestId('export-scope-all')).toBeDisabled()
      await expect(win.getByTestId('export-start')).toBeEnabled()
      await win.keyboard.press('Escape')
      await expect(dialog(win)).toHaveCount(0)

      await twoEpisodes(win)
      await expect(win.getByTestId('export-open')).toBeEnabled()

      await win.getByTestId('export-open').click()
      await expect(dialog(win)).toBeVisible()
      await expect(dialog(win)).toHaveAttribute('data-phase', 'form')
      await expect(win.getByTestId('export-summary')).toContainText('Будет создано: 2 файла')
      await shot(win, 'export-dialog')
      // Фокус внутри окна, Tab не уходит наружу.
      for (let i = 0; i < 25; i += 1) {
        await win.keyboard.press('Tab')
        expect(await win.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
          true
        )
      }
      await win.keyboard.press('Escape')
      await expect(dialog(win)).toHaveCount(0)

      // Ctrl+E тоже открывает; пока окно открыто, горячие клавиши приложения не срабатывают.
      await win.keyboard.press('Control+e')
      await expect(dialog(win)).toBeVisible()
      await win.keyboard.press('Digit1')
      await expect(rows(win)).toHaveCount(2)
      await win.getByTestId('export-cancel-form').click()
      await expect(dialog(win)).toHaveCount(0)

      // В настройках команда с клавишей Ctrl+E.
      await win.getByTestId('open-settings').click()
      await win.getByTestId('settings-tab-keys').click()
      const row = win.locator('[data-testid="keys-row"][data-command="export:open"]')
      await expect(row).toBeVisible()
      await expect(row.getByTestId('hotkey-value')).toHaveText('Ctrl+E')
    } finally {
      await app.close()
    }
  })

  test('выбор эпизодов: фильтр, все, вручную; сводка; запас по краям', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openVideo(ctx, fixture('cfr25.mp4'))
      await twoEpisodes(win)

      // Без фильтра пункта «Видимые» нет.
      await win.keyboard.press('Control+e')
      await expect(win.getByTestId('export-scope-visible')).toHaveCount(0)
      await expect(win.getByTestId('export-scope-all')).toBeChecked()
      await win.keyboard.press('Escape')

      // С фильтром по тегу «Удар» — по умолчанию «Видимые по фильтру (1)».
      await win.locator('[data-testid="filter-chip"][data-tag-id="shot"]').click()
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-scope-visible')).toBeChecked()
      await expect(win.getByTestId('export-scope-visible')).toHaveAccessibleName(
        'Видимые по фильтру (1)'
      )
      await expect(win.getByTestId('export-summary')).toContainText(
        'Будет создано: 1 файл · общая длительность 0:01'
      )
      await win.getByTestId('export-scope-all').check()
      await expect(win.getByTestId('export-summary')).toContainText(
        'Будет создано: 2 файла · общая длительность 0:02'
      )

      // Вручную: список с цветами, «Снять все» / «Выбрать все».
      await win.getByTestId('export-scope-pick').check()
      await expect(win.getByTestId('export-pick-row')).toHaveCount(2)
      await shot(win, 'export-pick')
      await win.getByTestId('export-pick-none').click()
      await expect(win.getByTestId('export-summary')).toHaveText('Не выбрано ни одного эпизода')
      await expect(win.getByTestId('export-start')).toBeDisabled()
      await win.getByTestId('export-pick-row').first().check()
      await expect(win.getByTestId('export-summary')).toContainText('Будет создано: 1 файл')
      await win.getByTestId('export-pick-all').click()
      await expect(win.getByTestId('export-summary')).toContainText('2 файла')

      // Запас: 3 с с обеих сторон; [1,2]→[0,4], [2.5,3.5]→[0,4] (видео 4 с) = 4 + 4 = 8 с.
      await win.getByTestId('export-padding').fill('3')
      await expect(win.getByTestId('export-summary')).toContainText('общая длительность 0:08')
      // Некорректный запас: сообщение, запуск выключен.
      await win.getByTestId('export-padding').fill('15')
      await expect(win.getByTestId('export-padding-hint')).toContainText('от 0 до 10')
      await expect(win.getByTestId('export-start')).toBeDisabled()
      await win.getByTestId('export-padding').fill('abc')
      await expect(win.getByTestId('export-start')).toBeDisabled()
      await win.getByTestId('export-padding').fill('1,5')
      await expect(win.getByTestId('export-start')).toBeEnabled()

      // Подборка: «Быстро» недоступно и объяснено.
      await win.getByTestId('export-mode-compilation').check()
      await expect(win.getByTestId('export-precision-fast')).toBeDisabled()
      await expect(win.getByTestId('export-precision-precise')).toBeChecked()
      await expect(dialog(win)).toContainText('нельзя надёжно склеить без перекодирования')
      await expect(win.getByTestId('export-summary')).toContainText('Подборка из 2 эпизодов')
      await win.getByTestId('export-mode-files').check()
      await expect(win.getByTestId('export-precision-fast')).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  test('отдельные файлы: имена NNN_Тег_ММ-СС, длительность и результат; «Открыть папку» только для своих файлов', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = makeOutDir()
    try {
      await openVideo(ctx, fixture('cfr25.mp4'))
      await twoEpisodes(win)
      await stubDialog(app, out) // выбор папки
      await stubReveal(app)

      await win.getByTestId('export-open').click()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 30_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      await expect(win.getByTestId('export-result-title')).toHaveText('Готово: создано 2 файла')
      await expect(win.getByTestId('export-file')).toHaveText([
        '001_Атака_00-01.mp4',
        '002_Удар_00-02.mp4'
      ])
      await shot(win, 'export-result')

      expect(readdirSync(out).sort()).toEqual(['001_Атака_00-01.mp4', '002_Удар_00-02.mp4'])
      expect(countFrames(join(out, '001_Атака_00-01.mp4'))).toBe(25)
      expect(countFrames(join(out, '002_Удар_00-02.mp4'))).toBe(25)

      // «Открыть папку» показывает файл, созданный экспортом (а не произвольный путь).
      await win.getByTestId('export-reveal').click()
      await expect.poll(async () => (await revealed(app)).length).toBe(1)
      expect((await revealed(app))[0]).toBe(join(out, '001_Атака_00-01.mp4'))
      await win.getByTestId('export-done').click()
      await expect(dialog(win)).toHaveCount(0)

      // Повторный экспорт в ту же папку ничего не затирает.
      await win.keyboard.press('Control+e')
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 30_000 })
      await expect(win.getByTestId('export-file')).toHaveText([
        '001_Атака_00-01 (2).mp4',
        '002_Удар_00-02 (2).mp4'
      ])
      expect(readdirSync(out)).toHaveLength(4)
    } finally {
      await app.close()
    }
  })

  test('одна подборка: имя по умолчанию «<видео>_подборка.mp4», длительность ≈ сумме', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = makeOutDir()
    const target = join(out, 'моя подборка.mp4')
    try {
      await openVideo(ctx, fixture('cfr25.mp4'))
      await twoEpisodes(win)
      await stubSave(app, target)

      await win.keyboard.press('Control+e')
      await win.getByTestId('export-mode-compilation').check()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 30_000 })
      await expect(win.getByTestId('export-result-title')).toHaveText('Подборка готова')

      const opts = await saveOptions(app)
      expect(opts).toHaveLength(1)
      expect(opts[0].defaultPath).toMatch(/cfr25_подборка\.mp4$/)

      expect(readdirSync(out)).toEqual(['моя подборка.mp4'])
      const frames = countFrames(target)
      expect(frames).toBeGreaterThanOrEqual(49)
      expect(frames).toBeLessThanOrEqual(51)
      expect(durationOf(target) ?? 0).toBeGreaterThan(1.9)
      expect(durationOf(target) ?? 0).toBeLessThan(2.1)
    } finally {
      await app.close()
    }
  })

  test('отказ в диалоге выбора папки возвращает к настройкам без ошибок', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openVideo(ctx, fixture('cfr25.mp4'))
      await twoEpisodes(win)
      await app.evaluate(({ dialog: d }) => {
        d.showOpenDialog = (async () => ({
          canceled: true,
          filePaths: []
        })) as unknown as typeof d.showOpenDialog
      })
      await win.keyboard.press('Control+e')
      await win.getByTestId('export-start').click()
      await expect(dialog(win)).toHaveAttribute('data-phase', 'form')
      await expect(win.getByTestId('export-error')).toHaveText('')
    } finally {
      await app.close()
    }
  })

  test('отмена посреди экспорта: недописанного файла нет, «Отменено», готовые клипы остаются', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = makeOutDir()
    const long = makeLongVideo(makeUserData(), 60)
    try {
      await openVideo(ctx, long)
      await addEpisode(win, 0.5, 1.5, 1) // короткий — успеет сохраниться
      await addEpisode(win, 2, 58, 6) // длинный — его отменяем
      await expect(rows(win)).toHaveCount(2)
      await stubDialog(app, out)

      await win.keyboard.press('Control+e')
      await win.getByTestId('export-start').click()
      await expect(dialog(win)).toHaveAttribute('data-phase', 'running')
      // Ждём, пока пойдёт второй клип и заполнится хотя бы немного.
      await expect(win.getByTestId('export-current')).toContainText('Клип 2 из 2', {
        timeout: 30_000
      })
      await expect
        .poll(() => percentOf(win, 'export-clip-progress'), { timeout: 30_000 })
        .toBeGreaterThan(3)
      await shot(win, 'export-progress')
      // Пока идёт экспорт, закрыть окно нельзя — только отмена.
      await expect(win.getByTestId('export-close')).toHaveCount(0)
      await win.keyboard.press('Escape')
      await expect(dialog(win)).toHaveAttribute('data-phase', 'running')
      // Старт второго экспорта невозможен: все кнопки старта скрыты.
      await expect(win.getByTestId('export-start')).toHaveCount(0)

      await win.getByTestId('export-cancel').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 30_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'cancelled')
      await expect(win.getByTestId('export-result-title')).toHaveText('Отменено')
      await expect(dialog(win)).toContainText('Успели создать 1 файл')
      await shot(win, 'export-cancelled')

      // На диске только готовый клип, ни .part, ни обрывков.
      expect(readdirSync(out)).toEqual(['001_Атака_00-00.mp4'])
      await win.getByTestId('export-done').click()
    } finally {
      await app.close()
    }
  })

  test('закрытие окна во время экспорта: вопрос, «Продолжить» или «Остановить и закрыть» без остатков', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = makeOutDir()
    const long = makeLongVideo(makeUserData(), 60)
    try {
      await openVideo(ctx, long)
      await addEpisode(win, 1, 58, 6)
      await stubDialog(app, out)
      await win.keyboard.press('Control+e')
      await win.getByTestId('export-start').click()
      await expect
        .poll(() => percentOf(win, 'export-progress'), { timeout: 30_000 })
        .toBeGreaterThan(3)

      await closeWindow(app)
      await expect(win.getByTestId('export-close-prompt')).toBeVisible()
      await shot(win, 'export-close-prompt')
      await win.getByTestId('export-close-keep').click()
      await expect(win.getByTestId('export-close-prompt')).toHaveCount(0)
      // Экспорт продолжается.
      const before = await percentOf(win, 'export-progress')
      await expect
        .poll(() => percentOf(win, 'export-progress'), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(before)
      expect(await win.getByTestId('export-cancel').isVisible()).toBe(true)

      const closed = app.waitForEvent('close')
      await closeWindow(app)
      await expect(win.getByTestId('export-close-prompt')).toBeVisible()
      await win.getByTestId('export-close-stop').click()
      // Эпизоды не сохранены в проект — после остановки экспорта приложение спросит и об этом.
      await expect(win.getByTestId('unsaved-dialog')).toBeVisible({ timeout: 30_000 })
      await win.getByTestId('unsaved-discard').click()
      await closed
      // Приложение закрылось, недописанный файл удалён.
      expect(readdirSync(out)).toEqual([])
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('ошибка до начала: видео удалено с диска — понятное сообщение, окно остаётся', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = makeOutDir()
    const dir = makeUserData()
    const copy = join(dir, 'copy.mp4')
    try {
      const { copyFileSync, rmSync } = await import('fs')
      copyFileSync(fixture('cfr25.mp4'), copy)
      await openVideo(ctx, copy)
      await twoEpisodes(win)
      await stubDialog(app, out)
      rmSync(copy)
      await win.keyboard.press('Control+e')
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-error')).toContainText('Видеофайл не найден')
      await expect(dialog(win)).toHaveAttribute('data-phase', 'form')
      expect(existsSync(out) && readdirSync(out)).toEqual([])
    } finally {
      await app.close()
    }
  })
})
