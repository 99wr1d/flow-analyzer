import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import type { VideoSource } from '../../../../shared/ipc-contract'

/** Узнаёт частоту кадров из файла. Если не вышло — остаётся «по умолчанию», потом уточнит оценка по воспроизведению. */
async function probeFps(source: VideoSource): Promise<void> {
  try {
    const info = await window.api.probeVideo(source.id)
    const state = usePlayerStore.getState()
    if (state.source?.id !== source.id || info.fps === null) return
    state.setFps(info.fps, 'container', info.variable)
  } catch {
    /* не страшно: частоту оценим по воспроизведению */
  }
}

function accept(source: VideoSource): void {
  usePlayerStore.getState().loadSource(source)
  void probeFps(source)
  // Фокус не должен оставаться на кнопке «Открыть видео»: иначе Пробел откроет диалог снова.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

function fail(error: unknown): void {
  const message = error instanceof Error && error.message ? error.message : ru.stage.importFailed
  usePlayerStore.getState().setImportError(message)
}

/** Открыть видео через системный диалог. */
export async function openVideoFromDialog(): Promise<void> {
  try {
    const source = await window.api.openVideoDialog()
    if (source) accept(source)
  } catch (error) {
    fail(error)
  }
}

/** Открыть видео, перетащенное в окно. */
export async function importDroppedFile(file: File): Promise<void> {
  try {
    accept(await window.api.importDroppedVideo(file))
  } catch (error) {
    fail(error)
  }
}
