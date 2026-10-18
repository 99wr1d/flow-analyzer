// IPC стартового экрана: список проектов, создание, правка описания, «Найти…», «Убрать из списка».
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { stat } from 'fs/promises'
import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc-contract'
import {
  CreateProjectRequestSchema,
  UpdateMetaRequestSchema,
  type LibraryListing
} from '../../shared/library'
import { PROJECT_EXTENSION, type ProjectOpenResult } from '../../shared/project'
import { buildCards } from '../library/cards'
import { resolveProjectsFolder } from '../library/folder'
import { updateMetaInFile } from '../library/meta'
import { isInsideFolder } from '../library/scan'
import { removeItem, replaceItemPath, updateLibrary } from '../library/store'
import { moveThumb, removeThumb } from '../library/thumbs'
import { getMediaEntry } from '../media/registry'
import { MEDIA_ERRORS } from '../media/validate'
import { PROJECT_ERRORS, checkProjectPath, readProjectFile } from '../project/files'
import { createProject, isTrustedPath, trustPath } from '../project/session'
import { isTrustedSender } from '../security'

const userData = (): string => app.getPath('userData')
const projectsFolder = (): string => resolveProjectsFolder(app.getPath('documents'))

const errorText = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : MEDIA_ERRORS.unknown

/** Путь из списка проектов: корректный и известный приложению. */
async function knownPath(value: unknown): Promise<string> {
  const problem = checkProjectPath(value)
  if (problem) throw new Error(problem)
  const path = value as string
  if (!(await isTrustedPath(userData(), path))) throw new Error(PROJECT_ERRORS.untrusted)
  return path
}

const exists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function list(): Promise<LibraryListing> {
  const folder = projectsFolder()
  const cards = await buildCards(userData(), folder)
  // Проекты из списка пользователь уже открывал или они лежат в его папке проектов: открыть их можно по клику.
  for (const card of cards) trustPath(card.path)
  return { cards, folder }
}

async function remove(raw: unknown): Promise<void> {
  const path = await knownPath(raw)
  if (isInsideFolder(projectsFolder(), path) && (await exists(path))) {
    throw new Error('Проект лежит в папке проектов FlowAnalyzer, поэтому из списка не убирается')
  }
  await updateLibrary(userData(), (items) => removeItem(items, path))
  await removeThumb(userData(), path)
}

/** Файл проекта уходит в Корзину (shell.trashItem), навсегда не удаляется. Только известные приложению файлы .flowproj. */
async function trash(raw: unknown): Promise<void> {
  const path = await knownPath(raw)
  if (!(await exists(path))) throw new Error(PROJECT_ERRORS.notFound)
  try {
    await shell.trashItem(path)
  } catch {
    throw new Error('Не удалось переместить файл в Корзину')
  }
  await updateLibrary(userData(), (items) => removeItem(items, path))
  await removeThumb(userData(), path)
}

async function reveal(raw: unknown): Promise<void> {
  const path = await knownPath(raw)
  if (!(await exists(path))) throw new Error(PROJECT_ERRORS.notFound)
  shell.showItemInFolder(path)
}

async function relocate(event: Electron.IpcMainInvokeEvent, raw: unknown): Promise<string | null> {
  const oldPath = await knownPath(raw)
  const options: Electron.OpenDialogOptions = {
    title: 'Найти проект',
    properties: ['openFile'],
    filters: [
      { name: 'Проект FlowAnalyzer', extensions: [PROJECT_EXTENSION] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (picked.canceled || picked.filePaths.length === 0) return null
  const chosen = picked.filePaths[0]
  const problem = checkProjectPath(chosen)
  if (problem) throw new Error(problem)
  const parsed = await readProjectFile(chosen)
  if (!parsed.ok) throw new Error(parsed.message)
  trustPath(chosen)
  await updateLibrary(userData(), (items) => replaceItemPath(items, oldPath, chosen))
  await moveThumb(userData(), oldPath, chosen)
  return chosen
}

async function updateMeta(rawPath: unknown, rawMeta: unknown): Promise<void> {
  const parsed = UpdateMetaRequestSchema.safeParse({ path: rawPath, meta: rawMeta })
  if (!parsed.success) {
    throw new Error(`Данные проекта не прошли проверку: ${parsed.error.issues[0].message}`)
  }
  const path = await knownPath(parsed.data.path)
  await updateMetaInFile(path, parsed.data.meta)
}

async function create(raw: unknown): Promise<ProjectOpenResult> {
  const parsed = CreateProjectRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      status: 'error',
      message: `Данные проекта не прошли проверку: ${parsed.error.issues[0].message}`
    }
  }
  const entry = getMediaEntry(parsed.data.videoId)
  if (!entry) return { status: 'error', message: MEDIA_ERRORS.unknownId }
  try {
    return await createProject(
      userData(),
      projectsFolder(),
      parsed.data,
      entry.path,
      app.getVersion()
    )
  } catch (error) {
    return { status: 'error', message: errorText(error) }
  }
}

export function registerLibraryHandlers(): void {
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

  strict(IPC_CHANNELS.libraryList, () => list())
  strict(IPC_CHANNELS.libraryRemove, (_e, path: unknown) => remove(path))
  strict(IPC_CHANNELS.libraryDelete, (_e, path: unknown) => trash(path))
  strict(IPC_CHANNELS.libraryReveal, (_e, path: unknown) => reveal(path))
  strict(IPC_CHANNELS.libraryRelocate, (e, path: unknown) => relocate(e, path))
  strict(IPC_CHANNELS.libraryUpdateMeta, (_e, path: unknown, meta: unknown) =>
    updateMeta(path, meta)
  )
  strict(IPC_CHANNELS.projectCreate, (_e, request: unknown) => create(request))
}
