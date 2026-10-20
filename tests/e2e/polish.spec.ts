// Этап 17, доводка: «О программе», подсказки первого запуска, журнал, экран ошибки, сбой окна.
// Тестовая поломка отрисовки (FLOW_TEST_CRASH=1) работает только при заданной папке данных FLOW_USER_DATA — как и во всех этих тестах.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { APP_VERSION, SHOTS, SUFFIX, launch } from './helpers'
import { addEpisode, quickOpen } from './startHelpers'

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `${name}${SUFFIX}.png`) })

/** Все файлы журнала одним текстом. */
function readLogs(userData: string): string {
  const dir = join(userData, 'logs')
  if (!existsSync(dir)) return ''
  return readdirSync(dir)
    .sort()
    .map((n) => readFileSync(join(dir, n), 'utf8'))
    .join('\n')
}

type FlowTest = { crash?: (area: string) => void }
const crash = (win: Page, area: string): Promise<void> =>
  win.evaluate((a) => (window as unknown as { __flowTest: FlowTest }).__flowTest.crash!(a), area)

test.describe('О программе', () => {
  test('версия, версии компонентов, автор, лицензии и кнопка «Открыть папку журналов»', async () => {
    const { app, win, userData } = await launch()
    try {
      // Тестовые функции в обычном запуске недоступны.
      expect(await win.evaluate(() => '__flowTest' in window)).toBe(false)

      await app.evaluate(({ shell }) => {
        const g = globalThis as unknown as { __opened: string[] }
        g.__opened = []
        shell.openPath = async (p: string) => {
          g.__opened.push(p)
          return ''
        }
      })

      await win.getByTestId('help-menu-button').click()
      await expect(win.getByTestId('help-menu')).toBeVisible()
      await win.getByTestId('help-about').click()
      const dialog = win.getByTestId('about-dialog')
      await expect(dialog).toBeVisible()

      await expect(win.getByTestId('about-version')).toHaveText(`Версия ${APP_VERSION}`)
      await expect(win.getByTestId('about-author')).toContainText('99wr1d')
      const versions = await app.evaluate(() => ({
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        node: process.versions.node
      }))
      await expect(win.getByTestId('about-electron')).toHaveText(versions.electron)
      await expect(win.getByTestId('about-chromium')).toHaveText(versions.chromium)
      await expect(win.getByTestId('about-node')).toHaveText(versions.node)

      // Лицензии: сторонние компоненты (список из сборки) и FFmpeg (GPL), оба текста прокручиваются.
      const license = win.getByTestId('about-license')
      await expect(license).toContainText('Компонентов:')
      await expect(license).toContainText('zod@')
      await expect(license).toContainText('ffmpeg-static@')
      expect(await license.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
      await win.getByTestId('about-tab-ffmpeg').click()
      await expect(license).toHaveAttribute('data-tab', 'ffmpeg')
      await expect(license).toContainText('GNU GENERAL PUBLIC LICENSE')
      await win.getByTestId('about-tab-notices').click()
      await shot(win, 'about')

      // Папка журналов.
      await expect(win.getByTestId('about-logs-dir')).toHaveText(join(userData, 'logs'))
      await win.getByTestId('about-open-logs').click()
      await expect
        .poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened))
        .toEqual([join(userData, 'logs')])

      // Esc закрывает окно.
      await win.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)

      // Из рабочей области меню тоже доступно.
      await quickOpen({ app, win })
      await win.getByTestId('help-menu-button').click()
      await win.getByTestId('help-about').click()
      await expect(dialog).toBeVisible()
      // Пока окно открыто, горячие клавиши молчат.
      await win.keyboard.press('Digit1')
      await win.getByTestId('about-close').click()
      await expect(dialog).toHaveCount(0)
      await expect(win.getByTestId('episode-count')).toHaveText('0')
    } finally {
      await app.close()
    }
  })
})

test.describe('подсказки первого запуска', () => {
  const settingsOf = (userData: string): { onboardingSeen?: boolean } =>
    JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
      onboardingSeen?: boolean
    }

  async function boxOf(
    win: Page,
    testId: string
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await win.getByTestId(testId).boundingBox()
    expect(box).not.toBeNull()
    return box!
  }

  test('тур показывается один раз, указывает на настоящие элементы, закрывается и открывается из «Справки»', async () => {
    const first = await launch({ tips: true })
    const { app, win, userData } = first
    try {
      const tip = win.getByTestId('tip')
      await expect(tip).toBeVisible()
      await expect(win.getByTestId('tip-step')).toHaveText('Шаг 1 из 4')
      await expect(win.getByTestId('tip-title')).toHaveText('Откройте видео')
      // Карточка стоит рядом с кнопкой «Просто открыть видео» и не закрывает её.
      const target = await boxOf(win, 'open-video')
      const card = await boxOf(win, 'tip')
      const overlapsX = card.x < target.x + target.width && card.x + card.width > target.x
      const overlapsY = card.y < target.y + target.height && card.y + card.height > target.y
      expect(overlapsX && overlapsY).toBe(false)
      expect(
        Math.abs(card.y - (target.y + target.height)) < 40 ||
          Math.abs(card.x - (target.x + target.width)) < 40 ||
          Math.abs(card.y + card.height - target.y) < 40
      ).toBe(true)
      await shot(win, 'onboarding')

      // Подсказки ничего не блокируют: кнопки под ними работают. Дальше — шаг про теги ждёт рабочей области.
      await win.getByTestId('tip-next').click()
      await expect(win.getByTestId('tip-waiting')).toBeVisible()
      await expect(tip).toHaveCount(0)
      await quickOpen({ app, win })
      await expect(tip).toBeVisible()
      await expect(win.getByTestId('tip-step')).toHaveText('Шаг 2 из 4')
      // Шаг про теги указывает на панель тегов.
      const tagPanel = await boxOf(win, 'tag-panel')
      const ring = await win.locator('.tip-ring').boundingBox()
      expect(Math.abs(ring!.x - (tagPanel.x - 4))).toBeLessThan(3)
      expect(Math.abs(ring!.y - (tagPanel.y - 4))).toBeLessThan(3)
      await shot(win, 'onboarding-tags')

      await win.getByTestId('tip-next').click()
      await expect(win.getByTestId('tip-step')).toHaveText('Шаг 3 из 4')
      await expect(win.getByTestId('tip-title')).toHaveText('Рисуйте и размечайте поле')
      await win.getByTestId('tip-back').click()
      await expect(win.getByTestId('tip-step')).toHaveText('Шаг 2 из 4')
      await win.getByTestId('tip-next').click()
      await win.getByTestId('tip-next').click()
      await expect(win.getByTestId('tip-step')).toHaveText('Шаг 4 из 4')
      await expect(win.getByTestId('tip-next')).toHaveText('Готово')
      // Настоящая кнопка «Экспорт» под подсказкой.
      const exportBtn = await boxOf(win, 'export-open')
      const ring4 = await win.locator('.tip-ring').boundingBox()
      expect(Math.abs(ring4!.x - (exportBtn.x - 4))).toBeLessThan(3)
      await win.getByTestId('tip-next').click()
      await expect(tip).toHaveCount(0)
      expect(settingsOf(userData).onboardingSeen).toBe(true)
    } finally {
      await app.close()
    }

    // Второй запуск с теми же настройками: подсказок нет.
    const second = await launch({ tips: true, userData: first.userData })
    try {
      await second.win.waitForTimeout(1200)
      await expect(second.win.getByTestId('tip')).toHaveCount(0)
      await expect(second.win.getByTestId('tip-waiting')).toHaveCount(0)
      // Из «Справки» тур открывается снова; крестик закрывает.
      await second.win.getByTestId('help-menu-button').click()
      await second.win.getByTestId('help-tips').click()
      await expect(second.win.getByTestId('tip')).toBeVisible()
      await expect(second.win.getByTestId('tip-step')).toHaveText('Шаг 1 из 4')
      await second.win.getByTestId('tip-close').click()
      await expect(second.win.getByTestId('tip')).toHaveCount(0)
      expect(settingsOf(first.userData).onboardingSeen).toBe(true)
    } finally {
      await second.app.close()
    }
  })

  test('закрытие подсказки Esc или кнопкой «Пропустить» тоже запоминается; настройки не сбрасывают флаг', async () => {
    const { app, win, userData } = await launch({ tips: true })
    try {
      await expect(win.getByTestId('tip')).toBeVisible()
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('tip')).toHaveCount(0)
      expect(settingsOf(userData).onboardingSeen).toBe(true)
      // Сохранение настроек (например, смена тега) не стирает признак «подсказки показаны».
      await win.getByTestId('open-settings').click()
      await win.getByTestId('settings-save').click()
      await expect(win.getByTestId('settings-dialog')).toHaveCount(0)
      expect(settingsOf(userData).onboardingSeen).toBe(true)
    } finally {
      await app.close()
    }
  })
})

test.describe('журнал работы', () => {
  test('создаётся при запуске, принимает ошибки интерфейса, отбрасывает лишнее и не принимает чужие записи', async () => {
    const { app, win, userData } = await launch()
    try {
      const dir = join(userData, 'logs')
      await expect.poll(() => existsSync(dir)).toBe(true)
      const files = readdirSync(dir)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^flowanalyzer-\d{4}-\d{2}-\d{2}\.log$/)
      expect(readLogs(userData)).toContain(`FlowAnalyzer ${APP_VERSION} запущен`)

      // Ошибки страницы попадают в журнал.
      await win.evaluate(() => {
        setTimeout(() => {
          throw new Error('Проверка журнала: ошибка')
        }, 0)
        void Promise.reject(new Error('Проверка журнала: отклонение'))
      })
      await expect
        .poll(() => readLogs(userData))
        .toContain('renderer:window.onerror] Проверка журнала: ошибка')
      expect(readLogs(userData)).toContain(
        'renderer:unhandledrejection] Проверка журнала: отклонение'
      )

      // Неправильные и слишком длинные записи не принимаются (и не ломают приложение).
      await win.evaluate(async () => {
        const w = window.api.writeLog as (e: unknown) => Promise<void>
        await w({ level: 'fatal', message: 'НЕВЕРНЫЙ-УРОВЕНЬ' })
        await w({ level: 'error', message: 'Д'.repeat(5000) })
        await w('просто строка')
        await w({ level: 'info', message: 'ХОРОШАЯ-ЗАПИСЬ', source: 'тест' })
      })
      await expect.poll(() => readLogs(userData)).toContain('[renderer:тест] ХОРОШАЯ-ЗАПИСЬ')
      const text = readLogs(userData)
      expect(text).not.toContain('НЕВЕРНЫЙ-УРОВЕНЬ')
      expect(text).not.toContain('ДДДДДДДДДД')

      // Ограничение частоты: из 80 быстрых записей принимается не больше 30 за окно.
      await win.evaluate(async () => {
        for (let i = 0; i < 80; i += 1) {
          await window.api.writeLog({ level: 'info', message: `поток-${i}`, source: 'burst' })
        }
      })
      const burst = readLogs(userData)
        .split('\n')
        .filter((l) => l.includes('[renderer:burst]'))
      expect(burst.length).toBeGreaterThan(0)
      expect(burst.length).toBeLessThanOrEqual(30)
      expect(burst.length).toBeLessThan(80)
    } finally {
      await app.close()
    }
  })

  test('содержимое проекта в журнал не попадает', async () => {
    const { app, win, userData } = await launch({ env: { FLOW_TEST_CRASH: '1' } })
    try {
      await quickOpen({ app, win })
      await win.getByTestId('tag-button').first().click()
      await crash(win, 'episodes')
      await expect(win.getByTestId('error-boundary')).toBeVisible()
      await expect.poll(() => readLogs(userData)).toContain('ErrorBoundary:episodes')
      const text = readLogs(userData)
      expect(text).not.toContain('cfr25')
      expect(text).not.toContain('Атака')
    } finally {
      await app.close()
    }
  })
})

test.describe('экран ошибки', () => {
  const env = { FLOW_TEST_CRASH: '1' }

  test('сломалась одна панель: остальное работает, можно попробовать снова', async () => {
    const { app, win, userData } = await launch({ env })
    try {
      await quickOpen({ app, win })
      await addEpisode(win, 1, 2)
      await expect(win.getByTestId('episode-row')).toHaveCount(1)

      await crash(win, 'episodes')
      const box = win.locator('[data-testid="error-boundary"][data-area="episodes"]')
      await expect(box).toBeVisible()
      await expect(box.getByTestId('error-title')).toHaveText('Что-то пошло не так')
      await expect(box).toContainText('эпизоды')
      await shot(win, 'error-panel')
      // Остальные области на месте: видео играет, таймлайн с полосой эпизода, инструменты.
      await expect(win.locator('video')).toHaveCount(1)
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(win.getByTestId('episode-bar')).toHaveCount(1)
      await expect(win.getByTestId('tool-arrow')).toBeEnabled()
      await expect(win.getByTestId('episode-list')).toHaveCount(0)

      // Запись в журнале есть, с названием области.
      await expect
        .poll(() => readLogs(userData))
        .toContain('[renderer:ErrorBoundary:episodes] Тестовая поломка: episodes')

      await box.getByTestId('error-retry').click()
      await expect(win.getByTestId('error-boundary')).toHaveCount(0)
      await expect(win.getByTestId('episode-row')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('сломалось всё окно: сообщение на весь экран, «Скопировать подробности», «Перезапустить окно» возвращает работу и копию', async () => {
    const { app, win, userData } = await launch({ env })
    try {
      await quickOpen({ app, win })
      await addEpisode(win, 1, 2)
      await expect(win.getByTestId('project-dirty')).toBeVisible()

      await crash(win, 'app')
      const box = win.locator('[data-testid="error-boundary"][data-area="app"]')
      await expect(box).toBeVisible()
      await expect(box.getByTestId('error-retry')).toHaveCount(0)
      await shot(win, 'error-screen')

      await box.getByTestId('error-copy').click()
      await expect(box.getByTestId('error-copy-status')).toHaveText('Подробности скопированы')
      // Буфер обмена Windows бывает занят доли секунды — читаем с повтором.
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
        .toContain('Тестовая поломка: app')
      const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(clip).toContain(`FlowAnalyzer ${APP_VERSION}`)
      expect(clip).toContain('Тестовая поломка: app')
      expect(clip).toContain('Область: программа')

      // Перезапуск окна: интерфейс загружается заново, а копия работы предлагается к восстановлению.
      await box.getByTestId('error-restart').click()
      await expect(win.getByTestId('recovery-banner')).toBeVisible({ timeout: 20_000 })
      await expect(win.getByTestId('error-boundary')).toHaveCount(0)
      expect(readLogs(userData)).toContain('ErrorBoundary:app')
      await win.getByTestId('recovery-restore').click()
      await expect(win.getByTestId('episode-count')).toHaveText('1')
    } finally {
      await app.close()
    }
  })
})

test.describe('сбой окна (main)', () => {
  async function stubMessageBox(app: ElectronApplication, response: number): Promise<void> {
    await app.evaluate(({ dialog }, r) => {
      const g = globalThis as unknown as {
        __boxes: Array<{ message?: string; buttons?: string[] }>
      }
      g.__boxes = []
      dialog.showMessageBox = (async (...args: unknown[]) => {
        g.__boxes.push(args[args.length - 1] as { message?: string; buttons?: string[] })
        return { response: r, checkboxChecked: false }
      }) as unknown as typeof dialog.showMessageBox
    }, response)
  }
  const boxes = (
    app: ElectronApplication
  ): Promise<Array<{ message?: string; buttons?: string[] }>> =>
    app.evaluate(
      () =>
        (globalThis as unknown as { __boxes?: Array<{ message?: string; buttons?: string[] }> })
          .__boxes ?? []
    )

  test('окно аварийно закрылось: пишем в журнал, предлагаем перезагрузить, после перезагрузки приложение работает', async () => {
    const { app, userData } = await launch()
    try {
      await stubMessageBox(app, 0)
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
      })
      await expect.poll(async () => (await boxes(app)).length, { timeout: 20_000 }).toBe(1)
      const [box] = await boxes(app)
      expect(box.message).toBe('Окно закрылось из-за сбоя')
      expect(box.buttons).toEqual(['Перезагрузить окно', 'Закрыть программу'])
      await expect
        .poll(
          () =>
            app.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0]
                .webContents.executeJavaScript(
                  'document.querySelector(\'[data-testid="open-video"]\') !== null'
                )
                .catch(() => false)
            ),
          { timeout: 30_000 }
        )
        .toBe(true)
      expect(readLogs(userData)).toContain('Процесс окна завершился: crashed')
      expect(readLogs(userData)).toContain('Окно перезагружено после сбоя')
    } finally {
      await app.close()
    }
  })
})
