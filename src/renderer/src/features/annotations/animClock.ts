// «Часы анимации»: номер кадра, который сейчас показан. Движущиеся рисунки перерисовываются по ним — каждый показанный
// кадр, пока видео играет (requestVideoFrameCallback), и по перемотке на паузе. Часы — отдельное маленькое хранилище:
// перерисовываются только подписанные на него компоненты (движущиеся рисунки), а не всё дерево React.
import { useEffect } from 'react'
import { create } from 'zustand'
import { isMoving, resolveAt } from '../../../../shared/animation'
import type { Annotation } from '../../../../shared/annotations'
import { usePlayerStore } from '../../store/playerStore'
import { getVideoElement } from '../player/videoElement'

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, metadata: { mediaTime: number }) => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

interface ClockState {
  /** Номер показанного кадра (с 0). */
  frame: number
}

export const useAnimClock = create<ClockState>()(() => ({ frame: 0 }))

const EPS = 1e-6
/** Номер кадра, в котором лежит момент time. */
export const frameOfTime = (time: number, fps: number): number =>
  Math.floor(Math.max(0, time) * (fps > 0 ? fps : 25) + EPS)

/** Время середины кадра, который сейчас показан: по нему считается геометрия движущихся рисунков. */
export function clockTime(fps: number = usePlayerStore.getState().fps): number {
  const f = fps > 0 ? fps : 25
  return (useAnimClock.getState().frame + 0.5) / f
}

/** Сколько кадров показано за время проигрывания (для измерений в тестах). */
export const clockStats = { updates: 0 }

function setFrame(frame: number): void {
  if (useAnimClock.getState().frame === frame) return
  clockStats.updates += 1
  useAnimClock.setState({ frame })
}

/** Подключает часы к плееру. Вызывается один раз, из слоя рисунков. */
export function useAnimClockDriver(): void {
  const playing = usePlayerStore((s) => s.playing)
  const videoId = usePlayerStore((s) => s.source?.id)

  // Пауза и перемотка: берём положение из плеера. Пока видео играет, кадры сообщает сам <video>.
  useEffect(() => {
    const sync = (): void => {
      const { currentTime, fps } = usePlayerStore.getState()
      setFrame(frameOfTime(currentTime, fps))
    }
    sync()
    return usePlayerStore.subscribe((s, prev) => {
      if (s.currentTime === prev.currentTime && s.fps === prev.fps && s.playing === prev.playing) {
        return
      }
      const video = getVideoElement() as FrameVideo | null
      // Играем и можем получать кадры от <video>: часы ведёт он.
      if (s.playing && video?.requestVideoFrameCallback) return
      sync()
    })
  }, [videoId])

  // Воспроизведение: кадр за кадром по требованию видеоэлемента (mediaTime — метка именно показанного кадра).
  useEffect(() => {
    if (!playing) return
    const video = getVideoElement() as FrameVideo | null
    if (!video?.requestVideoFrameCallback) return
    let handle = 0
    const onFrame = (_now: number, metadata: { mediaTime: number }): void => {
      setFrame(frameOfTime(metadata.mediaTime, usePlayerStore.getState().fps))
      handle = video.requestVideoFrameCallback!(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)
    return () => {
      if (handle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle)
    }
  }, [playing, videoId])
}

/** Рисунок с геометрией на показанный кадр. Подписывается на часы только если рисунок движется. */
export function useLive<T extends Annotation>(a: T): T {
  const frame = useAnimClock((s) => (isMoving(a) ? s.frame : -1))
  const fps = usePlayerStore((s) => (isMoving(a) ? s.fps : 0))
  return frame < 0 ? a : resolveAt(a, (frame + 0.5) / (fps > 0 ? fps : 25))
}

/** То же для списка: перерисовывается на каждый кадр, только если среди рисунков есть движущийся. */
export function useLiveList<T extends Annotation>(items: readonly T[]): T[] {
  const anyMoving = items.some(isMoving)
  const frame = useAnimClock((s) => (anyMoving ? s.frame : -1))
  const fps = usePlayerStore((s) => (anyMoving ? s.fps : 0))
  const t = frame < 0 ? 0 : (frame + 0.5) / (fps > 0 ? fps : 25)
  // Рисунки без движения возвращаются теми же ссылками (resolveAt), поэтому мемоизация потребителей работает.
  return anyMoving ? items.map((a) => resolveAt(a, t)) : (items as T[])
}
