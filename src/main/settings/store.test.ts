import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, parseSettings } from '../../shared/settings'
import { SETTINGS_FILE, loadSettings, saveSettingsFile } from './store'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-settings-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('чтение настроек', () => {
  it('нет файла: стандартные настройки без предупреждения', async () => {
    const result = await loadSettings(dir)
    expect(result.warning).toBeNull()
    expect(result.settings).toEqual(defaultSettings())
  })

  it('корректный файл читается', async () => {
    const settings = defaultSettings()
    settings.tags[0].name = 'Своя атака'
    await writeFile(join(dir, SETTINGS_FILE), JSON.stringify(settings), 'utf8')
    const result = await loadSettings(dir)
    expect(result.warning).toBeNull()
    expect(result.settings.tags[0].name).toBe('Своя атака')
  })

  it('файл со старой структурой (нет полей): дополняется по умолчанию', async () => {
    await writeFile(join(dir, SETTINGS_FILE), JSON.stringify({ version: 1 }), 'utf8')
    const result = await loadSettings(dir)
    expect(result.warning).toBeNull()
    expect(result.settings.tags).toHaveLength(9)
  })

  it('файл с BOM читается', async () => {
    await writeFile(join(dir, SETTINGS_FILE), '﻿' + JSON.stringify(defaultSettings()), 'utf8')
    expect((await loadSettings(dir)).warning).toBeNull()
  })

  it.each([
    ['не JSON', '{ это не json'],
    ['пустой файл', ''],
    ['не проходит схему', JSON.stringify({ version: 1, tags: [{ id: 'a' }] })],
    ['неизвестная версия', JSON.stringify({ version: 99 })]
  ])('повреждённый файл (%s): копия, стандартные настройки, предупреждение', async (_n, text) => {
    await writeFile(join(dir, SETTINGS_FILE), text, 'utf8')
    const now = new Date('2026-01-02T03:04:05.678Z')
    const result = await loadSettings(dir, now)
    expect(result.settings).toEqual(defaultSettings())
    expect(result.warning).toMatch(/повреждён/)
    const files = await readdir(dir)
    const backup = files.find((f) => f.startsWith('settings.corrupt-'))
    expect(backup).toBe('settings.corrupt-2026-01-02T03-04-05-678Z.json')
    expect(files).not.toContain(SETTINGS_FILE)
    expect(result.warning).toContain(backup)
    // Содержимое сохранено как было.
    expect(await readFile(join(dir, backup!), 'utf8')).toBe(text)
  })
})

describe('запись настроек', () => {
  it('записывает читаемый JSON, который проходит проверку', async () => {
    const settings = defaultSettings()
    settings.keybindings = {
      'playback:toggle': [{ code: 'KeyK', ctrl: false, alt: false, shift: false }]
    }
    await saveSettingsFile(dir, settings)
    const parsed = parseSettings(JSON.parse(await readFile(join(dir, SETTINGS_FILE), 'utf8')))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.settings.keybindings['playback:toggle'][0].code).toBe('KeyK')
  })

  it('временных файлов не остаётся', async () => {
    await saveSettingsFile(dir, defaultSettings())
    await saveSettingsFile(dir, defaultSettings())
    expect(await readdir(dir)).toEqual([SETTINGS_FILE])
  })

  it('перезаписывает существующий файл; последнее сохранение побеждает при гонке', async () => {
    const first = defaultSettings()
    first.tags[0].name = 'Первое'
    const last = defaultSettings()
    last.tags[0].name = 'Последнее'
    await Promise.all([saveSettingsFile(dir, first), saveSettingsFile(dir, last)])
    expect((await loadSettings(dir)).settings.tags[0].name).toBe('Последнее')
  })

  it('создаёт папку, если её нет', async () => {
    const nested = join(dir, 'a', 'b')
    await saveSettingsFile(nested, defaultSettings())
    expect(await readdir(nested)).toEqual([SETTINGS_FILE])
  })

  it('ошибка записи пробрасывается и очередь не ломается', async () => {
    // Вместо папки — файл: mkdir/запись невозможны.
    const blocker = join(dir, 'file')
    await writeFile(blocker, 'x')
    await expect(saveSettingsFile(blocker, defaultSettings())).rejects.toThrow()
    await saveSettingsFile(dir, defaultSettings())
    expect(await readdir(dir)).toContain(SETTINGS_FILE)
  })
})
