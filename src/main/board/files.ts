/** Файлы досок (.flowboard) в папке «Доски» внутри папки проектов. */
import { mkdir, readFile, readdir, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { BoardCard } from '../../shared/board/ipc'
import { BOARD_EXTENSION, boardToFile, parseBoardText, type Board } from '../../shared/board/schema'
import { writeTextAtomic } from '../project/files'

export const BOARDS_FOLDER_NAME = 'Доски'
const MAX_BOARD_FILE_BYTES = 10 * 1024 * 1024

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
  return parseBoardText(text)
}

export async function writeBoardFile(path: string, board: Board): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeTextAtomic(path, boardToFile(board))
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
