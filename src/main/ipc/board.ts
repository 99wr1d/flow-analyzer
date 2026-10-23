// IPC досок тренера: список, сохранение, открытие, удаление в Корзину, показ в проводнике, картинка PNG.
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { dirname, extname, join, resolve } from 'path'
import { safeFileName } from '../../shared/board/fileName'
import {
  BoardSaveRequestSchema,
  SaveImageRequestSchema,
  type BoardCard,
  type BoardOpenResult,
  type BoardSaveResult
} from '../../shared/board/ipc'
import { BOARD_EXTENSION } from '../../shared/board/schema'
import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc-contract'
import { boardsFolder, listBoards, readBoardFile, uniquePath, writeBoardFile } from '../board/files'
import { resolveProjectsFolder } from '../library/folder'
import { MEDIA_ERRORS } from '../media/validate'
import { isTrustedSender } from '../security'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const projectsFolder = (): string => resolveProjectsFolder(app.getPath('documents'))
const folder = (): string => boardsFolder(projectsFolder())

const errorText = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : MEDIA_ERRORS.unknown

const pathKey = (p: string): string =>
  process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p)

/** Пути, выданные saveBoard в этом запуске. */
const granted = new Set<string>()

const BAD_PATH = 'Этот файл не относится к доскам FlowAnalyzer'

/** Путь к .flowboard прямо в папке досок или выданный saveBoard в этом запуске; иначе ошибка. */
function boardPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024)
    throw new Error(BAD_PATH)
  if (extname(value).toLowerCase() !== `.${BOARD_EXTENSION}`) throw new Error(BAD_PATH)
  const inFolder = pathKey(dirname(resolve(value))) === pathKey(folder())
  if (!inFolder && !granted.has(pathKey(value))) throw new Error(BAD_PATH)
  return resolve(value)
}

async function save(raw: unknown): Promise<BoardSaveResult> {
  const parsed = BoardSaveRequestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Данные доски не прошли проверку: ${parsed.error.issues[0]?.message ?? ''}`)
  }
  const { path, board } = parsed.data
  const target =
    path === null
      ? await uniquePath(folder(), safeFileName(board.title), BOARD_EXTENSION)
      : boardPath(path)
  await writeBoardFile(target, board)
  granted.add(pathKey(target))
  return { path: target }
}

async function open(raw: unknown): Promise<BoardOpenResult> {
  const path = boardPath(raw)
  const read = await readBoardFile(path)
  if (!read.ok) return { ok: false, message: read.message }
  return { ok: true, path, board: read.board }
}

async function trash(raw: unknown): Promise<void> {
  const path = boardPath(raw)
  try {
    await shell.trashItem(path)
  } catch {
    throw new Error('Не удалось переместить файл в Корзину')
  }
  granted.delete(pathKey(path))
}

async function reveal(raw: unknown): Promise<void> {
  shell.showItemInFolder(boardPath(raw))
}

async function saveImage(
  event: Electron.IpcMainInvokeEvent,
  raw: unknown
): Promise<{ path: string } | null> {
  const parsed = SaveImageRequestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Картинка не прошла проверку: ${parsed.error.issues[0]?.message ?? ''}`)
  }
  const { suggestedName, png } = parsed.data
  if (png.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => png[i] !== b)) {
    throw new Error('Это не PNG-картинка')
  }
  const options: Electron.SaveDialogOptions = {
    title: 'Сохранить картинку',
    defaultPath: join(projectsFolder(), `${safeFileName(suggestedName)}.png`),
    filters: [{ name: 'PNG', extensions: ['png'] }]
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const picked = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return null
  const target =
    extname(picked.filePath).toLowerCase() === '.png' ? picked.filePath : `${picked.filePath}.png`
  try {
    await writeFile(target, png)
  } catch {
    throw new Error('Не удалось записать файл. Выберите другое место')
  }
  return { path: target }
}

export function registerBoardHandlers(): void {
  const strict = <A extends unknown[], T>(
    channel: string,
    run: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<T> | T
  ): void => {
    ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<T>> => {
      try {
        if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
        return { ok: true, data: await run(event, ...(args as A)) }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    })
  }

  strict(IPC_CHANNELS.boardList, (): Promise<BoardCard[]> => listBoards(folder()))
  strict(IPC_CHANNELS.boardSave, (_e, request: unknown) => save(request))
  strict(IPC_CHANNELS.boardOpen, (_e, path: unknown) => open(path))
  strict(IPC_CHANNELS.boardDelete, (_e, path: unknown) => trash(path))
  strict(IPC_CHANNELS.boardReveal, (_e, path: unknown) => reveal(path))
  strict(IPC_CHANNELS.boardSaveImage, (e, request: unknown) => saveImage(e, request))
}
