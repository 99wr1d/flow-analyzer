import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { confirmLeaveProject, startUntitledProject } from '../project/actions'
import { useViewStore } from '../../app/viewStore'
import { probeFps } from './probeFps'
import type { VideoSource } from '../../../../shared/ipc-contract'

function accept(source: VideoSource): void {
  // Рисунки и эпизоды принадлежат видео: новое видео — новый чистый проект (прежний уже сохранён или сброшен по решению пользователя).
  startUntitledProject(true)
  usePlayerStore.getState().loadSource(source)
  useViewStore.getState().setView('workspace')
  void probeFps(source)
  // Фокус не должен оставаться на кнопке «Открыть видео»: иначе Пробел откроет диалог снова.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

function fail(error: unknown): void {
  const message = error instanceof Error && error.message ? error.message : ru.stage.importFailed
  usePlayerStore.getState().setImportError(message)
}

/** Открыть видео через системный диалог. Если в проекте есть несохранённое — сначала спрашиваем. */
export async function openVideoFromDialog(): Promise<void> {
  try {
    if (!(await confirmLeaveProject())) return
    const source = await window.api.openVideoDialog()
    if (source) accept(source)
  } catch (error) {
    fail(error)
  }
}

/** Открыть видео, перетащенное в окно. */
export async function importDroppedFile(file: File): Promise<void> {
  try {
    if (!(await confirmLeaveProject())) return
    accept(await window.api.importDroppedVideo(file))
  } catch (error) {
    fail(error)
  }
}
