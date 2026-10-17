// Покадровая математика (чистые функции, без DOM).
//
// Кадр n показывается на отрезке [n/fps, (n+1)/fps). Чтобы перемотка гарантированно попала именно в кадр n,
// целимся в СЕРЕДИНУ отрезка — (n + 0.5)/fps: ошибки округления времени (вплоть до половины кадра) не страшны.
import { clamp } from './format'

export const DEFAULT_FPS = 25
/** Допуск при округлении вниз: 0.2 * 25 = 5.000000000000001 не должно давать кадр 4. */
const EPS = 1e-6

export type FpsSource = 'container' | 'estimated' | 'default'

/** Сколько кадров в видео. Минимум 1, чтобы границы были определены даже у «пустого» значения. */
export function frameCount(duration: number, fps: number): number {
  if (!(duration > 0) || !(fps > 0)) return 1
  return Math.max(1, Math.round(duration * fps))
}

/** Номер кадра (с нуля) на момент времени t. Без учёта длительности. */
export function currentFrame(t: number, fps: number): number {
  if (!Number.isFinite(t) || !(fps > 0)) return 0
  return Math.max(0, Math.floor(t * fps + EPS))
}

/** Номер кадра на момент t, не выходя за [0, последний кадр]. */
export function frameIndexAt(t: number, fps: number, duration: number): number {
  return Math.min(currentFrame(t, fps), frameCount(duration, fps) - 1)
}

/** Время середины кадра n, не дальше чем «длительность − полкадра». */
export function frameCenterTime(n: number, fps: number, duration: number): number {
  const half = 0.5 / fps
  const max = Math.max(0, duration - half)
  return clamp((n + 0.5) / fps, 0, max)
}

/** Кадр, на который попадём, сдвинувшись на delta кадров от кадра base. */
export function targetFrame(base: number, delta: number, count: number): number {
  return clamp(base + delta, 0, Math.max(0, count - 1))
}

/** Время, на которое надо перемотать при сдвиге на delta кадров от момента t. */
export function stepTime(t: number, delta: number, fps: number, duration: number): number {
  const n = targetFrame(frameIndexAt(t, fps, duration), delta, frameCount(duration, fps))
  return frameCenterTime(n, fps, duration)
}

/** Сколько кадров в данном числе секунд (для Shift+←/→: 1 секунда). */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps)
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function timecodeOf(frame: number, fps: number): string {
  const nominal = Math.max(1, Math.round(fps))
  const totalSeconds = Math.floor(frame / nominal)
  const ff = frame - totalSeconds * nominal
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(ff, nominal >= 100 ? 3 : 2)}`
}

/** Таймкод ЧЧ:ММ:СС:КК (кадры считаются по целой номинальной частоте, без drop-frame). */
export function formatTimecode(t: number, fps: number, duration?: number): string {
  const frame = duration === undefined ? currentFrame(t, fps) : frameIndexAt(t, fps, duration)
  return timecodeOf(frame, fps)
}

/** Длительность в таймкоде: сколько кадров всего (последний кадр не вычитаем). */
export function formatDurationTimecode(duration: number, fps: number): string {
  return timecodeOf(duration > 0 ? frameCount(duration, fps) : 0, fps)
}

/** Частота для показа: 25 → «25», 29.97003 → «29.97». */
export function formatFps(fps: number): string {
  return Math.abs(fps - Math.round(fps)) < 0.005 ? String(Math.round(fps)) : fps.toFixed(2)
}

const STANDARD_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60]

/** Приблизительную оценку притягиваем к стандартной частоте (в пределах 0.7%), иначе оставляем как есть. */
export function snapFps(estimate: number): number {
  let best = STANDARD_RATES[0]
  for (const rate of STANDARD_RATES) {
    if (Math.abs(estimate - rate) < Math.abs(estimate - best)) best = rate
  }
  return Math.abs(estimate - best) / best < 0.007 ? best : Math.round(estimate * 100) / 100
}
