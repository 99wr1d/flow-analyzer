// Единственный <video> приложения и команды управления им.
// Состояние (playing, currentTime, ...) обновляется событиями элемента — см. VideoView.
import { clamp } from './format'
import { stepRate } from './speed'
import { usePlayerStore } from '../../store/playerStore'

let element: HTMLVideoElement | null = null

export function setVideoElement(el: HTMLVideoElement | null): void {
  element = el
}

function ready(): HTMLVideoElement | null {
  return element && usePlayerStore.getState().status === 'ready' ? element : null
}

export function togglePlay(): void {
  const el = ready()
  if (!el) return
  if (el.paused || el.ended) {
    el.play().catch(() => {
      /* воспроизведение прервано (например, новая загрузка) — не ошибка */
    })
  } else {
    el.pause()
  }
}

/** Перематывает на указанное время (секунды), не выходя за границы видео. */
export function seekTo(time: number): void {
  const el = ready()
  if (!el || !Number.isFinite(time)) return
  const target = clamp(time, 0, el.duration || 0)
  el.currentTime = target
  usePlayerStore.getState().setCurrentTime(target)
}

export function seekBy(delta: number): void {
  if (element) seekTo(element.currentTime + delta)
}

export function setRate(rate: number): void {
  const el = ready()
  if (el) el.playbackRate = rate
}

export function changeRate(direction: -1 | 1): void {
  const el = ready()
  if (el) el.playbackRate = stepRate(el.playbackRate, direction)
}

export function setVolume(volume: number): void {
  if (!element) return
  const v = clamp(volume, 0, 1)
  element.volume = v
  if (v > 0 && element.muted) element.muted = false
}

export function toggleMute(): void {
  if (element) element.muted = !element.muted
}

export function getVideoElement(): HTMLVideoElement | null {
  return element
}
