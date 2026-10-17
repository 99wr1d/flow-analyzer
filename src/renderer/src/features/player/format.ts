// Форматирование времени для плеера и линейки таймлайна.

export interface FormatOptions {
  /** Добавить десятые доли секунды: 00:05.3 */
  tenths?: boolean
  /** Всегда показывать часы (Ч:ММ:СС), даже если время меньше часа. */
  hours?: boolean
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** ММ:СС или Ч:ММ:СС (если час и больше). Некорректные значения показываются как 00:00. */
export function formatTime(seconds: number, options: FormatOptions = {}): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  // Работаем в десятых долях, чтобы 59.96 не превращалось в «00:59.10».
  const totalTenths = Math.floor(safe * 10 + 1e-6)
  const tenthPart = totalTenths % 10
  const total = Math.floor(totalTenths / 10)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const base = options.hours || h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  return options.tenths ? `${base}.${tenthPart}` : base
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
