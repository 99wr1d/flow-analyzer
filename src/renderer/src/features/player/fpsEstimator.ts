// Оценка частоты кадров по воспроизведению: для файлов, где контейнер её не сообщает (WebM, MKV).
//
// Через requestVideoFrameCallback получаем mediaTime каждого показанного кадра. Пока кадры идут подряд
// (presentedFrames растёт на 1, время вперёд), считаем частоту как «кадров / прошедшее время» на всём отрезке:
// так погрешность округления меток времени (WebM хранит миллисекунды: 33 и 34 мс вместо 33.33) не копится,
// а с ростом отрезка оценка уточняется. Перемотка или пропуск кадров начинают отрезок заново.
import { usePlayerStore } from '../../store/playerStore'
import { snapFps } from './frames'

const MIN_FRAMES = 12
const MAX_FRAMES = 600

/** Частота по отрезку подряд идущих кадров. Чистая функция, чтобы её можно было проверить тестом. */
export function fpsFromRun(frames: number, seconds: number): number | null {
  if (frames < MIN_FRAMES || !(seconds > 0)) return null
  const fps = snapFps(frames / seconds)
  return Number.isFinite(fps) && fps > 1 && fps < 1000 ? fps : null
}

/** Запускает оценку для элемента. Возвращает функцию остановки. */
export function startFpsEstimate(el: HTMLVideoElement): () => void {
  if (typeof el.requestVideoFrameCallback !== 'function') return () => {}

  let runStart: { media: number; presented: number } | null = null
  let last: { media: number; presented: number } | null = null
  let reportedAt = 0
  let handle = 0
  let stopped = false

  const onFrame: VideoFrameRequestCallback = (_now, meta) => {
    if (stopped) return
    const state = usePlayerStore.getState()
    if (state.fpsSource === 'container') return // точное значение уже известно

    const contiguous =
      last !== null &&
      meta.presentedFrames - last.presented === 1 &&
      meta.mediaTime > last.media &&
      meta.mediaTime - last.media < 0.2 &&
      !el.seeking
    const current = { media: meta.mediaTime, presented: meta.presentedFrames }
    if (!contiguous || runStart === null) {
      runStart = current
      reportedAt = 0
    } else {
      const frames = current.presented - runStart.presented
      if (frames >= MIN_FRAMES && frames - reportedAt >= MIN_FRAMES) {
        reportedAt = frames
        const fps = fpsFromRun(frames, current.media - runStart.media)
        if (fps !== null) state.setFps(fps, 'estimated')
      }
      if (frames >= MAX_FRAMES) return // оценка достаточно точна
    }
    last = current
    handle = el.requestVideoFrameCallback(onFrame)
  }

  handle = el.requestVideoFrameCallback(onFrame)
  return () => {
    stopped = true
    el.cancelVideoFrameCallback(handle)
  }
}
