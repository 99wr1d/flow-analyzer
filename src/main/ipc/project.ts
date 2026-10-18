import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { basename, join } from 'path'
import { IPC_CHANNELS, VIDEO_EXTENSIONS, type IpcResult } from '../../shared/ipc-contract'
import {
  PROJECT_EXTENSION,
  ProjectSaveRequestSchema,
  type ProjectOpenResult,
  type ProjectSaveRequest,
  type ProjectSaveResult,
  type RecentProject,
  type RecoveryItem
} from '../../shared/project'
import { resolveProjectsFolder } from '../library/folder'
import { getMediaEntry } from '../media/registry'
import { MEDIA_ERRORS } from '../media/validate'
import { isTrustedSender } from '../security'
import { PROJECT_ERRORS, checkProjectPath, ensureProjectExtension } from '../project/files'
import { takeLaunchPath } from '../project/launch'
import { listRecent } from '../project/recent'
import { deleteRecovery, isRecoveryKey, listRecovery } from '../project/recovery'
import {
  autosave,
  hasTicket,
  isTrustedPath,
  keyForPath,
  openProjectFile,
  relinkVideo,
  restoreFromRecovery,
  saveToPath,
  trustPath,
  videoFacts
} from '../project/session'
import { checkTitleInput, composeTitle } from '../project/title'

const errorText = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : MEDIA_ERRORS.unknown

const userData = (): string => app.getPath('userData')

async function pick(
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
): Promise<string | null> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

const PROJECT_FILTER = { name: 'Проект FlowAnalyzer', extensions: [PROJECT_EXTENSION] }

/** Разбор запроса сохранения: возвращает данные и путь к видео из реестра либо текст ошибки. */
function parseRequest(
  raw: unknown
): { ok: true; request: ProjectSaveRequest; videoPath: string } | { ok: false; error: string } {
  const parsed = ProjectSaveRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `Данные проекта не прошли проверку: ${issue.message}` }
  }
  const entry = getMediaEntry(parsed.data.videoId)
  if (!entry) return { ok: false, error: MEDIA_ERRORS.unknownId }
  return { ok: true, request: parsed.data, videoPath: entry.path }
}

async function saveProject(
  event: Electron.IpcMainInvokeEvent,
  raw: unknown,
  saveAs: unknown
): Promise<ProjectSaveResult> {
  const parsed = parseRequest(raw)
  if (!parsed.ok) return { status: 'error', message: parsed.error }
  const { request, videoPath } = parsed

  let target = request.currentPath
  if (target) {
    if (checkProjectPath(target)) return { status: 'error', message: PROJECT_ERRORS.badPath }
    if (!(await isTrustedPath(userData(), target))) {
      return { status: 'error', message: PROJECT_ERRORS.untrusted }
    }
  }
  if (!target || saveAs === true) {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const base = basename(videoPath).replace(/\.[^.]*$/, '') || 'Проект'
    const options: Electron.SaveDialogOptions = {
      title: 'Сохранить проект',
      defaultPath:
        target ??
        join(resolveProjectsFolder(app.getPath('documents')), `${base}.${PROJECT_EXTENSION}`),
      filters: [PROJECT_FILTER]
    }
    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { status: 'cancelled' }
    target = ensureProjectExtension(result.filePath)
    if (checkProjectPath(target)) return { status: 'error', message: PROJECT_ERRORS.badPath }
    trustPath(target)
  }

  const facts = await videoFacts(videoPath)
  const saved = await saveToPath(userData(), request, facts, target, app.getVersion())
  return { status: 'saved', ...saved }
}

async function openProject(
  event: Electron.IpcMainInvokeEvent,
  path: unknown
): Promise<ProjectOpenResult> {
  let target: string
  if (path === null || path === undefined) {
    const chosen = await pick(event, {
      title: 'Открыть проект',
      properties: ['openFile'],
      filters: [PROJECT_FILTER, { name: 'Все файлы', extensions: ['*'] }]
    })
    if (!chosen) return { status: 'cancelled' }
    trustPath(chosen)
    target = chosen
  } else {
    const problem = checkProjectPath(path)
    if (problem) return { status: 'error', message: problem }
    target = path as string
    if (!(await isTrustedPath(userData(), target))) {
      return { status: 'error', message: PROJECT_ERRORS.untrusted }
    }
  }
  return openProjectFile(userData(), target)
}

async function relink(
  event: Electron.IpcMainInvokeEvent,
  ticket: unknown
): Promise<ProjectOpenResult> {
  if (!hasTicket(ticket)) {
    return { status: 'error', message: 'Сеанс открытия устарел. Откройте проект заново' }
  }
  const chosen = await pick(event, {
    title: 'Указать видео для проекта',
    properties: ['openFile'],
    filters: [
      { name: 'Видео', extensions: [...VIDEO_EXTENSIONS] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  })
  if (!chosen) return { status: 'cancelled' }
  return relinkVideo(userData(), ticket, chosen)
}

/** Оборачивает обработчик: проверка источника, единый вид результата, понятная ошибка. */
function handle<A extends unknown[], T>(
  channel: string,
  fallbackError: (message: string) => T,
  run: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<T>> => {
    if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
    try {
      return { ok: true, data: await run(event, ...(args as A)) }
    } catch (error) {
      return { ok: true, data: fallbackError(errorText(error)) }
    }
  })
}

export function registerProjectHandlers(): void {
  const failResult = (message: string): { status: 'error'; message: string } => ({
    status: 'error',
    message
  })
  const fail = (message: string): never => {
    throw new Error(message)
  }

  handle<[unknown, unknown], ProjectSaveResult>(
    IPC_CHANNELS.projectSave,
    failResult,
    (event, request: unknown, saveAs: unknown) => saveProject(event, request, saveAs)
  )
  handle<[unknown], ProjectOpenResult>(
    IPC_CHANNELS.projectOpen,
    failResult,
    (event, path: unknown) => openProject(event, path)
  )
  handle<[unknown], ProjectOpenResult>(
    IPC_CHANNELS.projectRelinkVideo,
    failResult,
    (event, ticket: unknown) => relink(event, ticket)
  )
  handle<[unknown], ProjectOpenResult>(
    IPC_CHANNELS.projectRecoveryRestore,
    failResult,
    async (_event, key: unknown) => {
      if (!isRecoveryKey(key)) return failResult('Некорректный ключ копии')
      return restoreFromRecovery(userData(), key)
    }
  )

  // Остальным вызовам «мягкий» ответ об ошибке не нужен: интерфейс покажет сообщение из исключения.
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

  strict(IPC_CHANNELS.projectRecent, (): Promise<RecentProject[]> => listRecent(userData()))
  strict(IPC_CHANNELS.projectAutosave, async (_event, raw: unknown): Promise<void> => {
    const parsed = parseRequest(raw)
    if (!parsed.ok) return fail(parsed.error)
    const facts = await videoFacts(parsed.videoPath)
    await autosave(userData(), parsed.request, facts, app.getVersion())
  })
  strict(IPC_CHANNELS.projectRecoveryList, (): Promise<RecoveryItem[]> => listRecovery(userData()))
  strict(IPC_CHANNELS.projectRecoveryDiscard, async (_event, key: unknown): Promise<void> => {
    if (!isRecoveryKey(key)) return fail('Некорректный ключ копии')
    await deleteRecovery(userData(), key)
  })
  strict(IPC_CHANNELS.projectClearRecovery, async (_event, path: unknown): Promise<void> => {
    if (path !== null && (typeof path !== 'string' || checkProjectPath(path))) {
      return fail(PROJECT_ERRORS.badPath)
    }
    await deleteRecovery(userData(), keyForPath(path))
  })
  strict(IPC_CHANNELS.projectTakeLaunchPath, (): string | null => takeLaunchPath())
  strict(IPC_CHANNELS.windowSetTitle, (event, name: unknown, dirty: unknown): void => {
    const input = checkTitleInput(name, dirty)
    if (!input) return fail('Некорректный заголовок')
    BrowserWindow.fromWebContents(event.sender)?.setTitle(composeTitle(input.name, input.dirty))
  })
}
