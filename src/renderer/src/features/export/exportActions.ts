// Действия экспорта: открыть окно, запустить, отменить, показать результат. Их вызывают и кнопки, и команда Ctrl+E.
import type { Episode } from '../../../../shared/episodes'
import type { ExportRequest } from '../../../../shared/export'
import { UNTITLED_PROJECT } from '../../../../shared/project'
import { usePlayerStore } from '../../store/playerStore'
import { sortEpisodes, useEpisodesStore } from '../episodes/episodesStore'
import { useProjectStore } from '../project/projectStore'
import { useExportStore } from './exportStore'
import { chooseEpisodes, parsePadding } from './selection'

const UNKNOWN_ERROR = 'Не удалось выполнить экспорт'

const set = useExportStore.setState
const get = useExportStore.getState

/** Экспорт возможен, когда видео открыто и есть хотя бы один эпизод. */
export function canExport(): boolean {
  return (
    usePlayerStore.getState().status === 'ready' && useEpisodesStore.getState().items.length > 0
  )
}

export const isExportRunning = (): boolean => get().open && get().phase === 'running'

/** Открывает окно настроек экспорта. Если экспорт уже идёт — просто показывает его. */
export function openExportDialog(): void {
  if (get().open) return
  if (!canExport()) return
  const { items, filter } = useEpisodesStore.getState()
  set({
    open: true,
    phase: 'form',
    scope: filter.length > 0 ? 'visible' : 'all',
    picked: items.map((e) => e.id),
    progress: null,
    startedAt: null,
    cancelling: false,
    result: null,
    error: null,
    closePrompt: false
  })
}

export function closeExportDialog(): void {
  if (get().phase === 'running') return
  set({ open: false, result: null, progress: null, error: null })
}

/** Эпизоды, которые сейчас выбраны в окне экспорта (по порядку начала). */
export function selectedForExport(): Episode[] {
  const { items, filter } = useEpisodesStore.getState()
  const { scope, picked } = get()
  return chooseEpisodes(scope, sortEpisodes(items), filter, new Set(picked))
}

let currentRun: Promise<void> | null = null

/** Запускает экспорт. Папку или файл спросит main системным диалогом. */
export function startExport(): Promise<void> {
  const state = get()
  if (state.phase === 'running') return currentRun ?? Promise.resolve()
  const source = usePlayerStore.getState().source
  const padding = parsePadding(state.padding)
  const episodes = selectedForExport()
  if (!source || !padding.ok || episodes.length === 0) return Promise.resolve()

  const project = useProjectStore.getState()
  const request: ExportRequest = {
    videoId: source.id,
    clips: episodes.map((e) => ({ start: e.start, end: e.end, label: e.tagName })),
    mode: state.mode,
    // Подборку без перекодирования собрать нельзя — всегда «Точно».
    precision: state.mode === 'compilation' ? 'precise' : state.precision,
    padding: padding.value,
    projectName: project.path !== null && project.name !== UNTITLED_PROJECT ? project.name : null
  }

  set({
    phase: 'running',
    progress: null,
    startedAt: Date.now(),
    cancelling: false,
    result: null,
    error: null
  })
  currentRun = window.api
    .startExport(request)
    .then((result) => {
      if (result.status === 'dialog-cancelled') set({ phase: 'form', startedAt: null })
      else set({ phase: 'result', result, startedAt: null, progress: null })
    })
    .catch((error: unknown) => {
      set({
        phase: 'form',
        startedAt: null,
        progress: null,
        error: error instanceof Error && error.message ? error.message : UNKNOWN_ERROR
      })
    })
    .finally(() => {
      set({ cancelling: false })
      currentRun = null
      // Окно хотели закрыть, а экспорт закончился сам — закрывать можно без вопроса.
      if (get().closePrompt) answerClosePrompt(true)
    })
  return currentRun
}

/** Просит остановить экспорт. Недописанный файл main удаляет сам. */
export async function cancelExport(): Promise<void> {
  if (get().phase !== 'running') return
  set({ cancelling: true })
  try {
    await window.api.cancelExport()
  } catch {
    /* если отменить не удалось, экспорт просто дойдёт до конца */
  }
}

/** Останавливает экспорт и ждёт, пока main уберёт недописанные файлы (для закрытия окна). */
export async function cancelExportAndWait(): Promise<void> {
  await cancelExport()
  await currentRun
}

export function revealExport(): void {
  window.api.revealExport().catch(() => undefined)
}

// --- Закрытие окна приложения во время экспорта ---

let closeResolver: ((stop: boolean) => void) | null = null

/** Спрашивает пользователя: остановить экспорт и закрыть окно (true) или продолжить экспорт (false). */
export function askStopForClose(): Promise<boolean> {
  closeResolver?.(false)
  return new Promise((resolve) => {
    closeResolver = resolve
    set({ closePrompt: true })
  })
}

export function answerClosePrompt(stop: boolean): void {
  const resolve = closeResolver
  closeResolver = null
  set({ closePrompt: false })
  resolve?.(stop)
}

/** Подписка на ход экспорта от main. */
export function installExportProgress(): () => void {
  return window.api.onExportProgress((progress) => {
    if (get().phase === 'running') set({ progress })
  })
}
