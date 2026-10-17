// Настройки: теги и горячие клавиши, сохранение между запусками, повреждённый файл. Каждый тест — в своей папке данных.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  SHOTS,
  SUFFIX,
  fixture,
  launch,
  makeUserData,
  seekVideo,
  stubDialog,
  videoState
} from './helpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string }

async function openVideo(ctx: Ctx): Promise<void> {
  await stubDialog(ctx.app, fixture('cfr25.mp4'))
  await ctx.win.getByTestId('open-video').click()
  await expect(ctx.win.getByTestId('play-toggle')).toBeEnabled()
}

const dialog = (win: Page) => win.getByTestId('settings-dialog')
const rows = (win: Page) => win.getByTestId('episode-row')
const hotkeyEdit = (win: Page, command: string) =>
  win.locator(`[data-testid="hotkey-edit"][data-command="${command}"]`)
const hotkeyValue = (win: Page, command: string) =>
  win.locator(
    `[data-testid="hotkey-field"][data-command="${command}"] [data-testid="hotkey-value"]`
  )

async function openSettings(win: Page): Promise<void> {
  await win.getByTestId('open-settings').click()
  await expect(dialog(win)).toBeVisible()
}

async function save(win: Page): Promise<void> {
  await win.getByTestId('settings-save').click()
  await expect(dialog(win)).toHaveCount(0)
}

const readSettings = (userData: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

test.describe('настройки', () => {
  test('открытие: шестерёнка и Ctrl+, ; вкладки; Esc и Отмена; фокус не уходит из окна', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await expect(win.getByTestId('open-settings')).toHaveAttribute('title', 'Настройки (Ctrl+,)')
      await openSettings(win)
      await expect(dialog(win)).toHaveAttribute('aria-modal', 'true')
      await expect(win.getByTestId('settings-tab-tags')).toHaveAttribute('aria-selected', 'true')
      await expect(win.getByTestId('tag-row')).toHaveCount(9)
      await win.screenshot({ path: join(SHOTS, `settings-tags${SUFFIX}.png`) })

      await win.getByTestId('settings-tab-keys').click()
      await expect(win.getByTestId('settings-tab-keys')).toHaveAttribute('aria-selected', 'true')
      await expect(hotkeyValue(win, 'playback:toggle')).toHaveText('Пробел')
      await expect(hotkeyValue(win, 'general:redo')).toHaveText('Ctrl+YCtrl+Shift+Z')
      await expect(hotkeyValue(win, 'tag:goal')).toHaveText('7')
      await win.screenshot({ path: join(SHOTS, `settings-keys${SUFFIX}.png`) })

      // Табуляция по кругу остаётся внутри окна.
      for (let i = 0; i < 60; i++) {
        await win.keyboard.press('Tab')
        const inside = await win.evaluate(() =>
          document.querySelector('[role="dialog"]')?.contains(document.activeElement)
        )
        expect(inside).toBe(true)
      }
      for (let i = 0; i < 5; i++) {
        await win.keyboard.press('Shift+Tab')
        const inside = await win.evaluate(() =>
          document.querySelector('[role="dialog"]')?.contains(document.activeElement)
        )
        expect(inside).toBe(true)
      }

      await win.keyboard.press('Escape')
      await expect(dialog(win)).toHaveCount(0)

      await win.keyboard.press('Control+Comma')
      await expect(dialog(win)).toBeVisible()
      await win.getByTestId('settings-cancel').click()
      await expect(dialog(win)).toHaveCount(0)
      await openSettings(win)
      await win.getByTestId('settings-close').click()
      await expect(dialog(win)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('«Атака» на Q: Q создаёт эпизод, 1 больше нет; конфликт с Пробелом; запись: Esc, Backspace', async () => {
    const ctx = await launch()
    const { app, win, userData } = ctx
    try {
      await openVideo(ctx)
      await openSettings(win)

      // Запись клавиши: Esc отменяет запись, не закрывая окно.
      await hotkeyEdit(win, 'tag:attack').click()
      await expect(win.getByTestId('hotkey-capturing')).toBeVisible()
      await win.screenshot({ path: join(SHOTS, `settings-capture${SUFFIX}.png`) })
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('hotkey-capturing')).toHaveCount(0)
      await expect(dialog(win)).toBeVisible()
      await expect(hotkeyValue(win, 'tag:attack')).toHaveText('1')

      // Занятая клавиша: предупреждение с названием другой команды, пока не нажато «Заменить».
      await hotkeyEdit(win, 'tag:attack').click()
      await win.keyboard.press('Space')
      const conflict = win.getByTestId('hotkey-conflict')
      await expect(conflict).toBeVisible()
      await expect(conflict).toContainText('Пробел')
      await expect(conflict).toContainText('«Пуск / пауза»')
      await expect(hotkeyValue(win, 'tag:attack')).toHaveText('1')
      await win.screenshot({ path: join(SHOTS, `settings-conflict${SUFFIX}.png`) })
      await win.getByTestId('hotkey-conflict-cancel').click()
      await expect(conflict).toHaveCount(0)
      await expect(hotkeyValue(win, 'tag:attack')).toHaveText('1')

      // Backspace снимает клавишу.
      await hotkeyEdit(win, 'tag:defense').click()
      await win.keyboard.press('Backspace')
      await expect(hotkeyValue(win, 'tag:defense')).toHaveText('Не назначена')

      // Q для «Атаки».
      await hotkeyEdit(win, 'tag:attack').click()
      await win.keyboard.press('KeyQ')
      await expect(hotkeyValue(win, 'tag:attack')).toHaveText('Q')
      await save(win)

      const file = readSettings(userData) as { keybindings: Record<string, unknown[]> }
      expect(file.keybindings['tag:attack']).toEqual([
        { code: 'KeyQ', ctrl: false, alt: false, shift: false }
      ])
      expect(file.keybindings['tag:defense']).toEqual([])

      await seekVideo(win, 2.0)
      await win.keyboard.press('KeyQ')
      await expect(rows(win)).toHaveCount(1)
      await expect(rows(win).first()).toContainText('Атака')
      await win.keyboard.press('Digit1')
      await expect(rows(win)).toHaveCount(1) // «1» больше не работает
      await win.keyboard.press('Digit2')
      await expect(rows(win)).toHaveCount(1) // «Оборона» без клавиши
      // Кнопка и бейдж показывают новую клавишу.
      const attackBtn = win.locator('[data-testid="tag-button"][data-tag-id="attack"]')
      await expect(attackBtn.locator('kbd')).toHaveText('Q')
      await expect(
        win.locator('[data-testid="tag-button"][data-tag-id="defense"] kbd')
      ).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('воспроизведение на K: K переключает, Пробел нет; замена клавиши у другой команды', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openVideo(ctx)
      await openSettings(win)
      await win.getByTestId('settings-tab-keys').click()
      await hotkeyEdit(win, 'playback:toggle').click()
      await win.keyboard.press('KeyK')
      await expect(hotkeyValue(win, 'playback:toggle')).toHaveText('K')
      await expect(
        win.locator(
          '[data-testid="keys-row"][data-command="playback:toggle"] [data-testid="key-reset"]'
        )
      ).toBeEnabled()

      // Назначаем на «Метку Начало» клавишу K: конфликт → «Заменить» снимает K у воспроизведения.
      await hotkeyEdit(win, 'episodes:in').click()
      await win.keyboard.press('KeyK')
      await expect(win.getByTestId('hotkey-conflict')).toContainText('«Пуск / пауза»')
      await win.getByTestId('hotkey-replace').click()
      await expect(hotkeyValue(win, 'episodes:in')).toHaveText('K')
      await expect(hotkeyValue(win, 'playback:toggle')).toHaveText('Не назначена')
      // Возвращаем K воспроизведению (с заменой), а «Начало» — сбросом к стандартной клавише.
      await hotkeyEdit(win, 'playback:toggle').click()
      await win.keyboard.press('KeyK')
      await win.getByTestId('hotkey-replace').click()
      await win
        .locator('[data-testid="keys-row"][data-command="episodes:in"] [data-testid="key-reset"]')
        .click()
      await expect(hotkeyValue(win, 'episodes:in')).toHaveText('I')
      await expect(hotkeyValue(win, 'playback:toggle')).toHaveText('K')
      await save(win)

      await win.keyboard.press('KeyK')
      await expect.poll(async () => (await videoState(win))?.paused).toBe(false)
      await win.keyboard.press('KeyK')
      await expect.poll(async () => (await videoState(win))?.paused).toBe(true)
      await win.keyboard.press('Space')
      await win.waitForTimeout(250)
      expect((await videoState(win))?.paused).toBe(true)
      // Подсказка на кнопке следует за переназначением.
      await expect(win.getByTestId('play-toggle')).toHaveAttribute('title', 'Воспроизвести (K)')
      // Остальное не пострадало.
      await win.keyboard.press('ArrowRight')
      await expect.poll(async () => (await videoState(win))?.currentTime).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test('отмена отбрасывает изменения; «Сбросить все»; проверка полей', async () => {
    const ctx = await launch()
    const { app, win, userData } = ctx
    try {
      await openSettings(win)
      const name = win.getByTestId('tag-name').first()
      await name.fill('Что-то другое')
      await hotkeyEdit(win, 'tag:attack').click()
      await win.keyboard.press('KeyQ')
      await win.getByTestId('settings-cancel').click()
      await expect(win.locator('[data-testid="tag-button"]').first()).toContainText('Атака')
      expect(existsSync(join(userData, 'settings.json'))).toBe(false)
      await openSettings(win)
      await expect(win.getByTestId('tag-name').first()).toHaveValue('Атака')
      await expect(hotkeyValue(win, 'tag:attack')).toHaveText('1')

      // Проверка полей: Сохранить недоступно, пока есть ошибка.
      const save = win.getByTestId('settings-save')
      await name.fill('   ')
      await expect(save).toBeDisabled()
      await expect(win.getByTestId('tag-errors').first()).toContainText('Введите название')
      await expect(win.getByTestId('settings-error')).toContainText('Исправьте')
      await name.fill('Я'.repeat(41))
      await expect(save).toBeDisabled()
      await name.fill('Атака')
      await expect(save).toBeEnabled()
      await win.getByTestId('tag-hex').first().fill('#12')
      await expect(save).toBeDisabled()
      await expect(win.getByTestId('tag-errors').first()).toContainText('Цвет вида #2bd67b')
      await win.getByTestId('tag-swatch').nth(1).click()
      await expect(win.getByTestId('tag-hex').first()).toHaveValue('#4da3ff')
      await expect(save).toBeEnabled()
      await win.getByTestId('tag-pre').first().fill('61')
      await expect(save).toBeDisabled()
      await win.getByTestId('tag-pre').first().fill('2,5')
      await expect(save).toBeEnabled()

      // «Сбросить все» на вкладке клавиш.
      await win.getByTestId('settings-tab-keys').click()
      await expect(win.getByTestId('keys-reset-all')).toBeDisabled()
      await hotkeyEdit(win, 'draw:arrow').click()
      await win.keyboard.press('KeyQ')
      await expect(hotkeyValue(win, 'draw:arrow')).toHaveText('Q')
      await expect(win.getByTestId('keys-reset-all')).toBeEnabled()
      await win.getByTestId('keys-reset-all').click()
      await expect(hotkeyValue(win, 'draw:arrow')).toHaveText('A')
      await expect(win.getByTestId('keys-reset-all')).toBeDisabled()
    } finally {
      await app.close()
    }
  })

  test('теги: секунды до/после, добавление, порядок, удаление с подтверждением, сброс', async () => {
    const ctx = await launch()
    const { app, win, userData } = ctx
    try {
      await openVideo(ctx)
      await openSettings(win)

      // Удар: 1 с до и 1 с после (без обрезки по краям видео).
      const shotRow = win.locator('[data-testid="tag-row"][data-tag-id="shot"]')
      await shotRow.getByTestId('tag-pre').fill('1')
      await shotRow.getByTestId('tag-post').fill('1')

      // Новый тег с именем и клавишей.
      await win.getByTestId('tag-add').click()
      await expect(win.getByTestId('tag-row')).toHaveCount(10)
      const created = win.getByTestId('tag-row').last()
      await expect(created.getByTestId('tag-name')).toBeFocused()
      await created.getByTestId('tag-name').fill('Угловой')
      await created.getByTestId('hotkey-edit').click()
      await win.keyboard.press('KeyU')
      await expect(created.getByTestId('hotkey-value')).toHaveText('U')

      // Порядок: «Угловой» поднимаем на одну позицию вверх.
      await created.getByTestId('tag-up').click()
      await expect(win.getByTestId('tag-row').nth(8).getByTestId('tag-name')).toHaveValue('Угловой')
      await expect(win.getByTestId('tag-row').nth(0).getByTestId('tag-up')).toBeDisabled()

      // Удаление с подтверждением внутри окна: «Нет» оставляет, «Да» удаляет.
      const lossRow = win.locator('[data-testid="tag-row"][data-tag-id="loss"]')
      await lossRow.getByTestId('tag-remove').click()
      await expect(lossRow.getByTestId('tag-remove-yes')).toBeVisible()
      await lossRow.getByTestId('tag-remove-no').click()
      await expect(lossRow).toHaveCount(1)
      await lossRow.getByTestId('tag-remove').click()
      await lossRow.getByTestId('tag-remove-yes').click()
      await expect(win.getByTestId('tag-row')).toHaveCount(9)
      await save(win)

      await expect(win.getByTestId('tag-button')).toHaveCount(9)
      await expect(win.locator('[data-testid="tag-button"][data-tag-id="loss"]')).toHaveCount(0)
      await seekVideo(win, 2.0)
      await win.keyboard.press('Digit6')
      await expect(rows(win)).toHaveCount(1)
      await expect(rows(win).first()).toHaveAttribute('data-start', '1')
      await expect(rows(win).first()).toHaveAttribute('data-end', '3')
      await win.keyboard.press('KeyU')
      await expect(rows(win)).toHaveCount(2)
      await expect(win.locator('[data-testid="episode-row"]', { hasText: 'Угловой' })).toHaveCount(
        1
      )
      const file = readSettings(userData) as { tags: { name: string }[]; keybindings: object }
      expect(file.tags).toHaveLength(9)
      expect(file.tags.map((t) => t.name)).toContain('Угловой')
      expect(Object.keys(file.keybindings)).toHaveLength(1) // только клавиша нового тега

      // Сброс к стандартным.
      await openSettings(win)
      await win.getByTestId('tags-reset').click()
      await expect(win.getByTestId('tag-row')).toHaveCount(9)
      await expect(win.getByTestId('tags-reset-done')).toBeVisible()
      await expect(win.getByTestId('tag-name').nth(7)).toHaveValue('Потеря')
      await save(win)
      await expect(win.locator('[data-testid="tag-button"][data-tag-id="loss"]')).toHaveCount(1)
      expect(
        Object.keys((readSettings(userData) as { keybindings: object }).keybindings)
      ).toHaveLength(0)
      // Уже созданные эпизоды сохраняют своё имя.
      await expect(win.locator('[data-testid="episode-row"]', { hasText: 'Угловой' })).toHaveCount(
        1
      )
    } finally {
      await app.close()
    }
  })

  test('настройки сохраняются между запусками', async () => {
    const userData = makeUserData()
    const first = await launch({ userData })
    try {
      await openSettings(first.win)
      await first.win.getByTestId('tag-name').nth(6).fill('Гол!')
      await first.win.getByTestId('tag-row').nth(6).getByTestId('tag-swatch').nth(9).click()
      await hotkeyEdit(first.win, 'tag:attack').click()
      await first.win.keyboard.press('KeyQ')
      await first.win.getByTestId('settings-tab-keys').click()
      await hotkeyEdit(first.win, 'playback:toggle').click()
      await first.win.keyboard.press('KeyK')
      await save(first.win)
    } finally {
      await first.app.close()
    }

    const second = await launch({ userData })
    try {
      await expect(second.win.getByTestId('tag-button').nth(6)).toContainText('Гол!')
      await expect(
        second.win.locator('[data-testid="tag-button"][data-tag-id="attack"] kbd')
      ).toHaveText('Q')
      await expect(second.win.getByTestId('settings-warning')).toHaveCount(0)
      await openVideo(second)
      await seekVideo(second.win, 2.0)
      await second.win.keyboard.press('KeyQ')
      await expect(rows(second.win)).toHaveCount(1)
      await second.win.keyboard.press('KeyK')
      await expect.poll(async () => (await videoState(second.win))?.paused).toBe(false)
      await openSettings(second.win)
      await expect(second.win.getByTestId('tag-name').nth(6)).toHaveValue('Гол!')
      await expect(second.win.getByTestId('tag-hex').nth(6)).toHaveValue('#e056fd')
    } finally {
      await second.app.close()
    }
    // Тест работал только в своей папке данных.
    expect(readdirSync(userData)).toContain('settings.json')
  })

  test('повреждённый settings.json: стандартные настройки, одно предупреждение, копия файла', async () => {
    const ctx = await launch({ settingsFile: '{ это не json' })
    const { app, win, userData } = ctx
    try {
      const warning = win.getByTestId('settings-warning')
      await expect(warning).toBeVisible()
      await expect(warning).toContainText('Файл настроек повреждён')
      await expect(warning).toContainText('settings.corrupt-')
      await expect(win.getByTestId('tag-button')).toHaveCount(9)
      await expect(win.getByTestId('tag-button').first()).toContainText('Атака')
      await win.screenshot({ path: join(SHOTS, `settings-corrupt${SUFFIX}.png`) })

      const files = readdirSync(userData)
      const backup = files.find((f) => f.startsWith('settings.corrupt-'))
      expect(backup).toBeDefined()
      expect(readFileSync(join(userData, backup!), 'utf8')).toBe('{ это не json')
      expect(files).not.toContain('settings.json')

      // Работать можно, сохранение создаёт новый файл.
      await openVideo(ctx)
      await seekVideo(win, 2.0)
      await win.keyboard.press('Digit1')
      await expect(rows(win)).toHaveCount(1)
      await openSettings(win)
      await save(win)
      expect(existsSync(join(userData, 'settings.json'))).toBe(true)

      // Предупреждение показывается один раз: после перезагрузки окна его нет.
      await win.reload()
      await win.locator('.app[data-settings="loaded"]').waitFor()
      await expect(win.getByTestId('settings-warning')).toHaveCount(0)
      await expect(win.getByTestId('tag-button')).toHaveCount(9)
    } finally {
      await app.close()
    }
  })

  test('файл с неверными данными тоже считается повреждённым; старый файл без полей читается', async () => {
    const bad = await launch({
      settingsFile: {
        version: 1,
        tags: [{ id: 'a', name: '', color: 'red', preSeconds: 1, postSeconds: 1 }]
      }
    })
    try {
      await expect(bad.win.getByTestId('settings-warning')).toBeVisible()
      await expect(bad.win.getByTestId('tag-button')).toHaveCount(9)
      expect(readdirSync(bad.userData).some((f) => f.startsWith('settings.corrupt-'))).toBe(true)
    } finally {
      await bad.app.close()
    }

    const old = await launch({ settingsFile: { version: 1 } })
    try {
      await expect(old.win.getByTestId('settings-warning')).toHaveCount(0)
      await expect(old.win.getByTestId('tag-button')).toHaveCount(9)
    } finally {
      await old.app.close()
    }
  })

  test('main проверяет данные: плохие настройки отклоняются, файл не портится', async () => {
    const ctx = await launch()
    const { app, win, userData } = ctx
    try {
      const result = await win.evaluate(async () => {
        const bad = { version: 1, keybindings: {}, tags: [{ id: 'x', name: '', color: '#zzz' }] }
        try {
          await window.api.saveSettings(bad as never)
          return 'ok'
        } catch (e) {
          return (e as Error).message
        }
      })
      expect(result).toContain('Настройки не прошли проверку')
      expect(existsSync(join(userData, 'settings.json'))).toBe(false)
      const good = await win.evaluate(async () => {
        const loaded = await window.api.getSettings()
        return (await window.api.saveSettings(loaded.settings)).tags.length
      })
      expect(good).toBe(9)
      expect(existsSync(join(userData, 'settings.json'))).toBe(true)
    } finally {
      await app.close()
    }
  })
})
