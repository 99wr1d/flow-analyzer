// Форматирование чисел окна статистики.
import { formatTime } from '../player/format'

/** 3.4% / 38%: до десяти процентов один знак после точки. */
export function fmtPercent(value: number): string {
  const v = Number.isFinite(value) ? value : 0
  return `${v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)}%`
}

/** Короткие длительности — секунды с десятой («12.3 с»), от минуты — часы/минуты («01:05», «1:02:05»). */
export function fmtDuration(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  return s < 59.95 ? `${s.toFixed(1)} с` : formatTime(s)
}

/** Метка времени на оси: 00:00, 05:00, 1:00:00. */
export const fmtAxis = (seconds: number): string => formatTime(seconds)

/** Подпись размера отрезка для заголовка диаграммы: «1 с», «30 с», «5 мин». */
export function binSizeText(size: number): string {
  if (size >= 60 && size % 60 === 0) return `${size / 60} мин`
  return `${size} с`
}

/** Слово «эпизод» в нужной форме для числа n: 1 эпизод, 2 эпизода, 5 эпизодов. */
export function episodesWord(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'эпизод'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'эпизода'
  return 'эпизодов'
}
