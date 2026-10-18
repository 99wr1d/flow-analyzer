// Действия с проектом: сохранить, открыть, новый, восстановить. Их вызывают и команды (клавиши), и кнопки меню.
import type { CreateProjectRequest } from '../../../../shared/library'
import type { LoadedProject, ProjectOpenResult, RecoveryItem } from '../../../../shared/project'
import { useViewStore } from '../../app/viewStore'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { useFeedbackStore } from '../episodes/feedbackStore'
import { loadWork, resetWork } from '../history/unified'
import { refreshLibrary } from '../library/libraryActions'
import { useDialogsStore } from '../library/dialogsStore'
import { probeFps } from '../player/probeFps'
import { seekTo } from '../player/videoElement'
import { withoutDirty } from './dirty'
import { useProjectStore } from './projectStore'
import { buildSaveRequest } from './snapshot'
import { askUnsaved } from './unsavedStore'

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : ru.project.unknownError

function fail(message: string, details?: string): void {
  useProjectStore.getState().setProblem({ message, details })
}

/** Есть ли что сохранять: нужно загруженное видео. */
export const canSave = (): boolean => usePlayerStore.getState().source !== null

// --- Сохранение ---

/** Сохраняет проект. true — файл записан. false — отмена или ошибка (ошибка показана пользователю). */
export async function saveProject(saveAs = false): Promise<boolean> {
  const project = useProjectStore.getState()
  if (project.saving) return false
  const request = buildSaveRequest(project.path)
  if (!request) return false
  const version = project.version
  project.setSaving(true)
  try {
    const result = await window.api.saveProject(request, saveAs)
    if (result.status === 'cancelled') return false
    if (result.status === 'error') {
      fail(result.message, result.details)
      return false
    }
    useProjectStore.getState().setProblem(null)
    useProjectStore
      .getState()
      .markSaved(result.path, result.name, Date.parse(result.savedAt), version)
    useFeedbackStore.getState().show({ text: ru.project.savedToast(result.name), kind: 'info' })
    return true
  } catch (error) {
    fail(ru.project.saveFailed, messageOf(error))
    return false
  } finally {
    useProjectStore.getState().setSaving(false)
  }
}

export const saveProjectAs = (): Promise<boolean> => saveProject(true)

/**
 * Перед тем как заменить текущий проект: если есть несохранённое — спрашивает пользователя.
 * true — можно продолжать (сохранено или решено не сохранять), false — пользователь отменил.
 */
export async function confirmLeaveProject(): Promise<boolean> {
  if (!useProjectStore.getState().dirty) return true
  const choice = await askUnsaved()
  if (choice === 'cancel') return false
  if (choice === 'save') return saveProject()
  return true
}

/** Убирает копию работы текущего проекта (она больше не нужна). */
export async function dropCurrentRecovery(): Promise<void> {
  try {
    await window.api.clearRecovery(useProjectStore.getState().path)
  } catch {
    /* копия работы — запасной вариант, ошибка не должна мешать */
  }
}

// --- Новый проект ---

/** Начинает чистый безымянный проект на месте текущего. Видео остаётся, если keepVideo. */
export function startUntitledProject(keepVideo: boolean): void {
  void dropCurrentRecovery()
  withoutDirty(() => {
    if (!keepVideo) usePlayerStore.getState().clear()
    resetWork()
    useProjectStore.getState().reset()
  })
}

/**
 * «Новый проект» (Ctrl+N): открывает окно с названием, типом и видео. Если в рабочей области есть несохранённое,
 * сначала спрашивает про него; сама работа заменится, только когда проект будет создан.
 */
export async function newProject(): Promise<void> {
  if (useViewStore.getState().view === 'workspace' && !(await confirmLeaveProject())) return
  useDialogsStore.setState({ newProject: true })
}

/** Окно «Новый проект»: создаёт файл в папке проектов и открывает его. true — проект создан. */
export async function createProjectFromDialog(request: CreateProjectRequest): Promise<boolean> {
  try {
    const result = await window.api.createProject(request)
    if (result.status === 'error') {
      fail(result.message, result.details)
      return false
    }
    return applyOpenResult(result, null)
  } catch (error) {
    fail(ru.project.createFailed, messageOf(error))
    return false
  }
}

/** «На главную»: спрашивает про несохранённое, закрывает проект и показывает список проектов. */
export async function goHome(): Promise<void> {
  if (useViewStore.getState().view !== 'workspace') return
  if (!(await confirmLeaveProject())) return
  startUntitledProject(false)
  useViewStore.getState().setView('start')
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  void refreshLibrary()
}

// --- Открытие ---

/** Когда видео загрузится, перематывает на сохранённое время. */
function restoreTimeWhenReady(sourceId: string, time: number): void {
  if (!(time > 0)) return
  let finished = false
  let off: (() => void) | null = null
  const finish = (): void => {
    finished = true
    off?.()
  }
  // Перемотка меняет состояние плеера и снова вызывает проверку, поэтому «готово» отмечаем до неё.
  const check = (): void => {
    if (finished) return
    const s = usePlayerStore.getState()
    if (s.source?.id !== sourceId || s.status === 'error') return finish()
    if (s.status !== 'ready') return
    finish()
    seekTo(Math.min(time, s.duration))
  }
  off = usePlayerStore.subscribe(check)
  check()
}

function applyLoaded(loaded: LoadedProject): void {
  const player = usePlayerStore.getState()
  withoutDirty(() => {
    player.loadSource(loaded.source)
    loadWork(loaded.annotations, loaded.episodes)
  })
  if (loaded.fps !== undefined && loaded.fpsSource && loaded.fpsSource !== 'default') {
    usePlayerStore.getState().setFps(loaded.fps, loaded.fpsSource)
  }
  const store = useProjectStore.getState()
  store.setLoaded({ path: loaded.path, name: loaded.name, dirty: loaded.dirty, meta: loaded.meta })
  useViewStore.getState().setView('workspace')
  store.setWarning(loaded.warning)
  void probeFps(loaded.source)
  restoreTimeWhenReady(loaded.source.id, loaded.lastTime)
  // Фокус не должен оставаться на кнопке меню: иначе Пробел нажмёт её снова.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

/** Применяет ответ main на открытие. true — проект загружен. recoveryKey — ключ копии работы, если открываем из неё. */
function applyOpenResult(result: ProjectOpenResult, recoveryKey: string | null): boolean {
  const store = useProjectStore.getState()
  switch (result.status) {
    case 'opened':
      // Копия работы прежнего проекта больше не нужна — если пользователь не восстанавливает именно её.
      if (recoveryKey === null) void dropCurrentRecovery()
      applyLoaded(result.project)
      if (recoveryKey !== null) dropRecoveryItem(recoveryKey)
      return true
    case 'video-missing':
      store.setRelink({
        ticket: result.ticket,
        name: result.name,
        videoFileName: result.videoFileName,
        recoveryKey
      })
      return false
    case 'error':
      fail(result.message, result.details)
      return false
    default:
      return false
  }
}

/** Открыть проект: path = null — выбрать файл в диалоге. */
export async function openProject(path: string | null = null): Promise<void> {
  if (!(await confirmLeaveProject())) return
  try {
    applyOpenResult(await window.api.openProject(path), null)
  } catch (error) {
    fail(ru.project.openFailed, messageOf(error))
  }
}

/** Пользователь указывает перенесённое видео. */
export async function relinkVideo(): Promise<void> {
  const request = useProjectStore.getState().relink
  if (!request) return
  try {
    const result = await window.api.relinkProjectVideo(request.ticket)
    if (result.status === 'cancelled') return
    useProjectStore.getState().setRelink(null)
    applyOpenResult(result, request.recoveryKey)
  } catch (error) {
    useProjectStore.getState().setRelink(null)
    fail(ru.project.openFailed, messageOf(error))
  }
}

export function cancelRelink(): void {
  useProjectStore.getState().setRelink(null)
}

// --- Восстановление после сбоя ---

export async function refreshRecovery(): Promise<void> {
  try {
    useProjectStore.getState().setRecovery(await window.api.listRecovery())
  } catch {
    /* копий нет или не прочитались — баннер просто не покажется */
  }
}

export async function restoreRecovery(item: RecoveryItem): Promise<void> {
  if (!(await confirmLeaveProject())) return
  try {
    applyOpenResult(await window.api.restoreRecovery(item.key), item.key)
  } catch (error) {
    fail(ru.project.openFailed, messageOf(error))
  }
}

function dropRecoveryItem(key: string): void {
  const store = useProjectStore.getState()
  store.setRecovery(store.recovery.filter((r) => r.key !== key))
}

export async function discardRecovery(item: RecoveryItem): Promise<void> {
  dropRecoveryItem(item.key)
  try {
    await window.api.discardRecovery(item.key)
  } catch {
    /* файл уже удалён или недоступен */
  }
}
