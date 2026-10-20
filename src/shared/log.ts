// Запись в журнал из интерфейса: что можно присылать и какие у этого пределы.
import { z } from 'zod'

export const LOG_LEVELS = ['error', 'warn', 'info'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Пределы длины: журнал не должен раздуваться из-за одного сбоя и не должен принимать содержимое проектов целиком. */
export const LOG_LIMITS = {
  message: 2000,
  stack: 6000,
  source: 60
} as const

export const LogEntrySchema = z.object({
  level: z.enum(LOG_LEVELS),
  message: z.string().max(LOG_LIMITS.message),
  stack: z.string().max(LOG_LIMITS.stack).optional(),
  /** Где случилось: «window.onerror», «ErrorBoundary:episodes» и т. п. */
  source: z.string().max(LOG_LIMITS.source).optional()
})
export type LogEntry = z.infer<typeof LogEntrySchema>

/** Обрезает строки под пределы (на стороне интерфейса, чтобы длинная ошибка не отклонялась целиком). */
export function clampLogEntry(entry: LogEntry): LogEntry {
  const cut = (value: string, max: number): string =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value
  return {
    level: entry.level,
    message: cut(entry.message, LOG_LIMITS.message),
    ...(entry.stack ? { stack: cut(entry.stack, LOG_LIMITS.stack) } : {}),
    ...(entry.source ? { source: cut(entry.source, LOG_LIMITS.source) } : {})
  }
}

/** Сведения для окна «О программе». */
export interface AboutInfo {
  name: string
  version: string
  author: string
  electron: string
  chromium: string
  node: string
  /** Папка журналов (показывается пользователю; открывает её main). */
  logsDir: string
}

/** Тексты лицензий для окна «О программе». null — файла нет (например, в разработке без сборки). */
export interface LicenseTexts {
  ffmpeg: string | null
  notices: string | null
}
