// IPC досок тренера: список, сохранение, открытие, удаление в Корзину, показ в проводнике, картинка PNG.
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { dirname, extname, join, resolve } from 'path'
import { safeFileName } from '../../shared/board/fileName'
import {
  BoardSaveRequestSchema,
  ExportVideoRequestSchema,
  SaveImageRequestSchema,
  StageFramesRequestSchema,
  type BoardCard,
  type BoardOpenResult,
  type BoardSaveResult
} from '../../shared/board/ipc'
import { BOARD_EXTENSION } from '../../shared/board/schema'
import { IPC_CHANNELS, IPC_EVENTS, type IpcResult } from '../../shared/ipc-contract'
import {
  boardsFolder,
  createBoardFile,
  listBoards,
  readBoardFile,
  writeBoardFile
} from '../board/files'
import { getFfmpegPath } from '../ffmpeg/path'
import {
  beginBoardVideo,
  cancelBoardVideo,
  finishBoardVideo,
  stageBoardFrames
} from '../board/video'
import { logWarn } from '../log/logger'
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
    logWarn('board', `Доска не прошла проверку: ${parsed.error.issues[0]?.message ?? ''}`)
    throw new Error('Данные доски не прошли проверку')
  }
  const { path, board } = parsed.data
  let target: string
  if (path === null) {
    target = await createBoardFile(folder(), safeFileName(board.title), board)
  } else {
    target = boardPath(path)
    await writeBoardFile(target, board)
  }
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
    logWarn('board', `Картинка доски не прошла проверку: ${parsed.error.issues[0]?.message ?? ''}`)
    throw new Error('Картинка не прошла проверку: слишком большая или повреждена')
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

async function exportVideo(
  event: Electron.IpcMainInvokeEvent,
  raw: unknown
): Promise<{ token: string; path: string } | null> {
  const parsed = ExportVideoRequestSchema.safeParse(raw)
  if (!parsed.success) {
    logWarn('board', `Запрос видео не прошёл проверку: ${parsed.error.issues[0]?.message ?? ''}`)
    throw new Error('Запрос видео не прошёл проверку')
  }
  const ffmpeg = getFfmpegPath()
  if (!ffmpeg.ok) throw new Error(ffmpeg.error)
  const { suggestedName, frameCount, fps } = parsed.data
  const options: Electron.SaveDialogOptions = {
    title: 'Сохранить видео',
    defaultPath: join(projectsFolder(), `${safeFileName(suggestedName)}.mp4`),
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const picked = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return null
  const target =
    extname(picked.filePath).toLowerCase() === '.mp4' ? picked.filePath : `${picked.filePath}.mp4`
  const job = await beginBoardVideo({ frameCount, fps, target })
  // Окно закрыли посреди сохранения: убираем временные кадры.
  event.sender.once?.('destroyed', () => cancelBoardVideo(job.token))
  return { token: job.token, path: target }
}

async function finishVideo(
  event: Electron.IpcMainInvokeEvent,
  token: unknown
): Promise<{ path: string }> {
  if (typeof token !== 'string') throw new Error('Сохранение видео не найдено — начните заново')
  const ffmpeg = getFfmpegPath()
  if (!ffmpeg.ok) {
    cancelBoardVideo(token)
    throw new Error(ffmpeg.error)
  }
  const sender = event.sender
  return finishBoardVideo(token, ffmpeg.path, (done, total) => {
    if (!sender.isDestroyed?.()) sender.send(IPC_EVENTS.boardVideoProgress, { token, done, total })
  })
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
  strict(IPC_CHANNELS.boardExportVideo, (e, request: unknown) => exportVideo(e, request))
  strict(IPC_CHANNELS.boardStageFrames, async (_e, request: unknown) => {
    const parsed = StageFramesRequestSchema.safeParse(request)
    if (!parsed.success) throw new Error('Кадры видео не прошли проверку')
    await stageBoardFrames(parsed.data.token, parsed.data.start, parsed.data.pngs)
  })
  strict(IPC_CHANNELS.boardFinishVideo, (e, token: unknown) => finishVideo(e, token))
  strict(IPC_CHANNELS.boardCancelVideo, (_e, token: unknown) => {
    if (typeof token === 'string') cancelBoardVideo(token)
  })
}
