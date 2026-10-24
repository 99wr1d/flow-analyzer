/** Файлы досок (.flowboard) в папке «Доски» внутри папки проектов. */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { BoardCard } from '../../shared/board/ipc'
import { parseBoardText } from '../../shared/board/file'
import { BOARD_EXTENSION, boardToFile, type Board } from '../../shared/board/schema'
import { logWarn } from '../log/logger'
import { writeTextAtomic } from '../project/files'

export const BOARDS_FOLDER_NAME = 'Доски'
const MAX_BOARD_FILE_BYTES = 10 * 1024 * 1024
const MAX_CREATE_ATTEMPTS = 1000

export const boardsFolder = (projectsFolder: string): string =>
  join(projectsFolder, BOARDS_FOLDER_NAME)

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Свободный путь: «base.ext», потом «base (2).ext», «base (3).ext»… */
export async function uniquePath(folder: string, base: string, ext: string): Promise<string> {
  let candidate = join(folder, `${base}.${ext}`)
  for (let n = 2; await exists(candidate); n++) candidate = join(folder, `${base} (${n}).${ext}`)
  return candidate
}

/** Новая доска под свободным именем: имя занимается эксклюзивно, поэтому два сохранения подряд не затрут друг друга. */
export async function createBoardFile(folder: string, base: string, board: Board): Promise<string> {
  try {
    await mkdir(folder, { recursive: true })
  } catch (error) {
    throw new Error(writeErrorMessage(error), { cause: error })
  }
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const path = await uniquePath(folder, base, BOARD_EXTENSION)
    try {
      await writeFile(path, '', { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw new Error(writeErrorMessage(error), { cause: error })
    }
    try {
      await writeBoardFile(path, board)
    } catch (error) {
      // Не оставляем пустую заготовку, если содержимое записать не удалось.
      await rm(path, { force: true }).catch(() => undefined)
      throw error
    }
    return path
  }
  throw new Error('Не удалось подобрать свободное имя файла. Попробуйте другое название')
}

export type ReadBoardResult =
  { ok: true; board: Board } | { ok: false; error: string; message: string }

export async function readBoardFile(path: string): Promise<ReadBoardResult> {
  let text: string
  try {
    if ((await stat(path)).size > MAX_BOARD_FILE_BYTES) {
      return { ok: false, error: 'size', message: 'Файл доски слишком большой' }
    }
    text = await readFile(path, 'utf8')
  } catch {
    return { ok: false, error: 'read', message: 'Не удалось прочитать файл доски' }
  }
  const parsed = parseBoardText(text)
  if (!parsed.ok && parsed.detail)
    logWarn('board', `Файл доски не прошёл проверку: ${parsed.detail}`)
  return parsed
}

/** Понятный текст для ошибки записи (так же, как в writeTextAtomic). */
export function writeErrorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'EACCES' || code === 'EPERM')
    return 'Нет доступа к этой папке. Выберите другое место'
  if (code === 'ENOSPC') return 'На диске не хватает места'
  return 'Не удалось записать файл'
}

export async function writeBoardFile(path: string, board: Board): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
  } catch (error) {
    throw new Error(writeErrorMessage(error), { cause: error })
  }
  let text: string
  try {
    text = boardToFile(board)
  } catch (error) {
    throw new Error(writeErrorMessage(error), { cause: error })
  }
  await writeTextAtomic(path, text)
}

/** Карточки всех досок папки; повреждённый файл даёт карточку со status 'error'. Нет папки — пустой список. */
export async function listBoards(folder: string): Promise<BoardCard[]> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return []
  }
  const suffix = `.${BOARD_EXTENSION}`
  const cards = await Promise.all(
    names
      .filter((n) => extname(n).toLowerCase() === suffix)
      .map(async (name): Promise<BoardCard> => {
        const path = join(folder, name)
        const read = await readBoardFile(path)
        if (!read.ok) {
          return {
            path,
            title: basename(name, extname(name)),
            updatedAt: null,
            frames: 0,
            thumb: null,
            status: 'error',
            error: read.message
          }
        }
        const b = read.board
        return {
          path,
          title: b.title,
          updatedAt: b.updatedAt,
          frames: b.frameCount,
          thumb: b.thumb ?? null,
          status: 'ok'
        }
      })
  )
  // Свежие сверху, повреждённые в конце.
  return cards.sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return a.path.localeCompare(b.path)
    if (a.updatedAt === null) return 1
    if (b.updatedAt === null) return -1
    return a.updatedAt < b.updatedAt ? 1 : -1
  })
}
