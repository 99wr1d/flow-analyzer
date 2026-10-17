// Чтение и запись settings.json. Не зависит от Electron: папка передаётся параметром (так проще тестировать).
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  defaultSettings,
  parseSettings,
  type Settings,
  type SettingsLoadResult
} from '../../shared/settings'

export const SETTINGS_FILE = 'settings.json'
/** Настройки — маленький файл; всё, что больше, точно не наш. */
const MAX_FILE_BYTES = 1024 * 1024

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

async function backupCorrupt(dir: string, now: Date): Promise<string | null> {
  const name = `settings.corrupt-${stamp(now)}.json`
  try {
    await rename(join(dir, SETTINGS_FILE), join(dir, name))
    return name
  } catch {
    return null
  }
}

/**
 * Загружает настройки. Нет файла — стандартные без предупреждения.
 * Файл повреждён или не проходит проверку — он переименовывается в settings.corrupt-<время>.json,
 * возвращаются стандартные настройки и предупреждение.
 */
export async function loadSettings(
  dir: string,
  now: Date = new Date()
): Promise<SettingsLoadResult> {
  let text: string
  try {
    text = await readFile(join(dir, SETTINGS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { settings: defaultSettings(), warning: null }
    }
    return {
      settings: defaultSettings(),
      warning: 'Не удалось прочитать файл настроек. Использованы стандартные настройки.'
    }
  }

  let problem: string
  if (text.length > MAX_FILE_BYTES) {
    problem = 'файл слишком большой'
  } else {
    try {
      const parsed = parseSettings(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text))
      if (parsed.ok) return { settings: parsed.settings, warning: null }
      problem = parsed.error
    } catch {
      problem = 'это не JSON'
    }
  }

  const backup = await backupCorrupt(dir, now)
  const where = backup ? ` Копия сохранена: ${backup}.` : ''
  return {
    settings: defaultSettings(),
    warning: `Файл настроек повреждён (${problem}). Использованы стандартные настройки.${where}`
  }
}

// Записи идут строго по очереди: два быстрых сохранения не перемешают временные файлы.
let writeQueue: Promise<unknown> = Promise.resolve()

async function writeAtomic(dir: string, settings: Settings): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, SETTINGS_FILE)
  const temp = join(dir, `${SETTINGS_FILE}.${process.pid}.tmp`)
  try {
    await writeFile(temp, JSON.stringify(settings, null, 2), 'utf8')
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Атомарная запись: сначала временный файл, потом переименование. Данные уже должны быть проверены. */
export function saveSettingsFile(dir: string, settings: Settings): Promise<void> {
  const run = writeQueue.then(() => writeAtomic(dir, settings))
  writeQueue = run.catch(() => undefined)
  return run
}
