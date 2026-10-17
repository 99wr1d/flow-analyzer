// Логика сохранения и открытия проектов (без диалогов — они в ipc/project.ts).
// Хранит состояние сеанса: какие пути выбрал сам пользователь, проекты, ожидающие указания видео, имя безымянной копии.
import { randomBytes, randomUUID } from 'crypto'
import { stat } from 'fs/promises'
import { basename } from 'path'
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  UNTITLED_PROJECT,
  projectNameFromPath,
  type LoadedProject,
  type Project,
  type ProjectOpenResult,
  type ProjectSaveRequest
} from '../../shared/project'
import { grantVideo } from '../media/registry'
import { MEDIA_ERRORS } from '../media/validate'
import { readProjectFile, writeProjectFile } from './files'
import { locateVideo, toRelativePath } from './paths'
import { fileExists, pathKey, readRecent, rememberProject } from './recent'
import { deleteRecovery, readRecovery, recoveryKey, writeRecovery } from './recovery'

// --- Доверенные пути ---

const trusted = new Set<string>()

/** Запоминает путь, выбранный пользователем (диалог, командная строка, список недавних). */
export function trustPath(path: string): void {
  trusted.add(pathKey(path))
}

/** Путь можно открывать или перезаписывать, только если приложение само его выдало или он в списке недавних. */
export async function isTrustedPath(userData: string, path: string): Promise<boolean> {
  if (trusted.has(pathKey(path))) return true
  const key = pathKey(path)
  return (await readRecent(userData)).some((r) => pathKey(r.path) === key)
}

// --- Имя копии для безымянного проекта ---

let untitledId = randomBytes(4).toString('hex')

export const keyForPath = (path: string | null): string => recoveryKey(path, untitledId)

// Запись проекта и автосохранение идут строго по очереди: запоздавшая копия работы не воскреснет после сохранения.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job)
  queue = run.catch(() => undefined)
  return run
}

// --- Сборка и сохранение ---

export interface VideoFacts {
  path: string
  sizeBytes: number
}

/** Собирает файл проекта из данных интерфейса. Чистая функция. */
export function buildProject(
  request: ProjectSaveRequest,
  video: VideoFacts,
  projectPath: string | null,
  appVersion: string,
  createdAt: string,
  now: Date
): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    createdAt,
    updatedAt: now.toISOString(),
    appVersion,
    video: {
      path: video.path,
      relativePath: projectPath ? toRelativePath(projectPath, video.path) : null,
      fileName: basename(video.path),
      sizeBytes: video.sizeBytes,
      ...(request.fps !== undefined ? { fps: request.fps } : {}),
      ...(request.fpsSource !== undefined ? { fpsSource: request.fpsSource } : {})
    },
    annotations: request.annotations,
    episodes: request.episodes,
    tags: request.tags,
    ui: { lastTime: request.lastTime }
  }
}

export async function videoFacts(path: string): Promise<VideoFacts> {
  let info
  try {
    info = await stat(path)
  } catch {
    throw new Error(MEDIA_ERRORS.notFound)
  }
  return { path, sizeBytes: info.size }
}

/** Записывает проект в файл. Копии работы (старого и нового имени) после успешной записи удаляются. */
export function saveToPath(
  userData: string,
  request: ProjectSaveRequest,
  video: VideoFacts,
  target: string,
  appVersion: string,
  now: Date = new Date()
): Promise<{ path: string; name: string; savedAt: string }> {
  return serial(() => doSave(userData, request, video, target, appVersion, now))
}

async function doSave(
  userData: string,
  request: ProjectSaveRequest,
  video: VideoFacts,
  target: string,
  appVersion: string,
  now: Date = new Date()
): Promise<{ path: string; name: string; savedAt: string }> {
  const previous = await readProjectFile(target)
  const createdAt = previous.ok ? previous.project.createdAt : now.toISOString()
  await writeProjectFile(target, buildProject(request, video, target, appVersion, createdAt, now))
  trustPath(target)
  await rememberProject(userData, target, now)
  await Promise.all(
    [request.currentPath, target, null].map((p) => deleteRecovery(userData, keyForPath(p)))
  )
  return { path: target, name: projectNameFromPath(target), savedAt: now.toISOString() }
}

/** Автосохранение: копия работы в папке данных, сам проект не трогается. */
export function autosave(
  userData: string,
  request: ProjectSaveRequest,
  video: VideoFacts,
  appVersion: string,
  now: Date = new Date()
): Promise<void> {
  return serial(() => doAutosave(userData, request, video, appVersion, now))
}

async function doAutosave(
  userData: string,
  request: ProjectSaveRequest,
  video: VideoFacts,
  appVersion: string,
  now: Date = new Date()
): Promise<void> {
  const project = buildProject(
    request,
    video,
    request.currentPath,
    appVersion,
    now.toISOString(),
    now
  )
  await writeRecovery(userData, keyForPath(request.currentPath), request.currentPath, project, now)
}

// --- Открытие ---

interface Pending {
  projectPath: string | null
  project: Project
  dirty: boolean
}

const MAX_TICKETS = 5
const tickets = new Map<string, Pending>()

function addTicket(pending: Pending): string {
  const ticket = randomUUID()
  tickets.set(ticket, pending)
  while (tickets.size > MAX_TICKETS) tickets.delete(tickets.keys().next().value as string)
  return ticket
}

const nameOf = (projectPath: string | null): string =>
  projectPath ? projectNameFromPath(projectPath) : UNTITLED_PROJECT

async function finishLoad(
  userData: string,
  pending: Pending,
  videoPath: string,
  relinked: boolean
): Promise<ProjectOpenResult> {
  let source
  try {
    source = await grantVideo(videoPath)
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : MEDIA_ERRORS.unknown
    }
  }
  const { project, projectPath } = pending
  const warning =
    source.sizeBytes !== project.video.sizeBytes
      ? 'Размер видеофайла отличается от сохранённого — возможно, это другое видео и разметка не совпадёт.'
      : null
  const loaded: LoadedProject = {
    path: projectPath,
    name: nameOf(projectPath),
    source,
    annotations: project.annotations,
    episodes: project.episodes,
    tags: project.tags,
    lastTime: project.ui?.lastTime ?? 0,
    ...(project.video.fps !== undefined ? { fps: project.video.fps } : {}),
    ...(project.video.fpsSource !== undefined ? { fpsSource: project.video.fpsSource } : {}),
    // Новый путь к видео ещё нигде не записан — предложим сохранить.
    dirty: pending.dirty || relinked,
    warning
  }
  if (projectPath) {
    trustPath(projectPath)
    if (!pending.dirty) await rememberProject(userData, projectPath)
  }
  return { status: 'opened', project: loaded }
}

async function resolvePending(userData: string, pending: Pending): Promise<ProjectOpenResult> {
  const location = await locateVideo(pending.projectPath, pending.project.video, fileExists)
  if (!location) {
    return {
      status: 'video-missing',
      ticket: addTicket(pending),
      name: nameOf(pending.projectPath),
      videoFileName: pending.project.video.fileName
    }
  }
  return finishLoad(userData, pending, location.path, false)
}

/** Открывает проект с диска. Путь уже должен быть проверен вызывающим. */
export async function openProjectFile(userData: string, path: string): Promise<ProjectOpenResult> {
  const parsed = await readProjectFile(path)
  if (!parsed.ok) return { status: 'error', message: parsed.message, details: parsed.details }
  return resolvePending(userData, { projectPath: path, project: parsed.project, dirty: false })
}

/** Продолжает открытие, когда пользователь указал видео вручную. */
export async function relinkVideo(
  userData: string,
  ticket: string,
  videoPath: string
): Promise<ProjectOpenResult> {
  const pending = tickets.get(ticket)
  if (!pending) {
    return { status: 'error', message: 'Сеанс открытия устарел. Откройте проект заново' }
  }
  const result = await finishLoad(userData, pending, videoPath, true)
  if (result.status === 'opened') tickets.delete(ticket)
  return result
}

export function hasTicket(ticket: unknown): ticket is string {
  return typeof ticket === 'string' && tickets.has(ticket)
}

/** Восстанавливает работу из копии. Файл копии остаётся, пока проект не сохранят или не закроют. */
export async function restoreFromRecovery(
  userData: string,
  key: string
): Promise<ProjectOpenResult> {
  const file = await readRecovery(userData, key)
  if (!file) return { status: 'error', message: 'Копия работы повреждена или уже удалена' }
  if (key.startsWith('untitled-')) untitledId = key.slice('untitled-'.length)
  if (file.projectPath) trustPath(file.projectPath)
  return resolvePending(userData, {
    projectPath: file.projectPath,
    project: file.project,
    dirty: true
  })
}
