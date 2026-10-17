// Чтение и запись файлов проекта. Не зависит от Electron: пути передаются параметрами (так проще тестировать).
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'
import {
  MAX_PROJECT_BYTES,
  PROJECT_EXTENSION,
  parseProjectText,
  type Project,
  type ProjectParse
} from '../../shared/project'

export const PROJECT_ERRORS = {
  notFound: 'Файл проекта не найден',
  unreadable: 'Не удалось прочитать файл проекта',
  tooBig: 'Файл проекта слишком большой',
  badPath: 'Некорректный путь к файлу проекта',
  untrusted: 'Этот файл не выбран пользователем — откройте проект через диалог'
} as const

/** Допустимый путь к файлу проекта: абсолютный, с расширением .flowproj, без нулевых символов. */
export function checkProjectPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    return PROJECT_ERRORS.badPath
  }
  if (value.includes('\0') || !isAbsolute(value)) return PROJECT_ERRORS.badPath
  if (!value.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)) return PROJECT_ERRORS.badPath
  return null
}

/** Добавляет расширение .flowproj, если пользователь его не ввёл. */
export function ensureProjectExtension(path: string): string {
  return path.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)
    ? path
    : `${path}.${PROJECT_EXTENSION}`
}

/** Читает и проверяет файл проекта. Размер проверяется до чтения. */
export async function readProjectFile(path: string): Promise<ProjectParse> {
  let info
  try {
    info = await stat(path)
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    return { ok: false, message: missing ? PROJECT_ERRORS.notFound : PROJECT_ERRORS.unreadable }
  }
  if (!info.isFile()) return { ok: false, message: PROJECT_ERRORS.unreadable }
  if (info.size > MAX_PROJECT_BYTES) {
    return { ok: false, message: PROJECT_ERRORS.tooBig, details: `${info.size} байт` }
  }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return {
      ok: false,
      message: PROJECT_ERRORS.unreadable,
      details: error instanceof Error ? error.message : undefined
    }
  }
  return parseProjectText(text)
}

// Записи идут по очереди: два быстрых сохранения не перемешают временные файлы.
let writeQueue: Promise<unknown> = Promise.resolve()
let counter = 0

async function writeAtomic(target: string, data: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const temp = join(dirname(target), `.${process.pid}-${++counter}.flowtmp`)
  try {
    await writeFile(temp, data, 'utf8')
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Атомарная запись: сначала временный файл рядом, потом переименование. Бросает Error с понятным текстом. */
export function writeTextAtomic(target: string, data: string): Promise<void> {
  const run = writeQueue.then(() => writeAtomic(target, data))
  writeQueue = run.catch(() => undefined)
  return run.catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error('Нет доступа к этой папке. Выберите другое место для проекта')
    }
    if (code === 'ENOSPC') throw new Error('На диске не хватает места')
    throw new Error('Не удалось записать файл')
  })
}

export function writeProjectFile(target: string, project: Project): Promise<void> {
  return writeTextAtomic(target, JSON.stringify(project, null, 2))
}
