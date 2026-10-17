import type { VideoSource } from '../../../../shared/ipc-contract'
import { usePlayerStore } from '../../store/playerStore'

/** Узнаёт частоту кадров из файла. Если не вышло — остаётся «по умолчанию», потом уточнит оценка по воспроизведению. */
export async function probeFps(source: VideoSource): Promise<void> {
  try {
    const info = await window.api.probeVideo(source.id)
    const state = usePlayerStore.getState()
    if (state.source?.id !== source.id || info.fps === null) return
    state.setFps(info.fps, 'container', info.variable)
  } catch {
    /* не страшно: частоту оценим по воспроизведению */
  }
}
