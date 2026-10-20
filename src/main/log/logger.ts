// Журнал работы: userData/logs/flowanalyzer-ГГГГ-ММ-ДД.log. Хранится 7 файлов, каждый до 5 МБ.
// Пишет и main, и интерфейс (через проверенный IPC log:write с ограничением частоты и длины).
// Содержимое проектов (эпизоды, рисунки, заметки) в журнал не попадает; пути к файлам — допустимы, журнал лежит только на этом компьютере.
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { LogEntrySchema, type LogEntry, type LogLevel } from '../../shared/log'
import {
  LOG_MAX_BYTES,
  createRateLimiter,
  dayStamp,
  formatLine,
  pickLogFile,
  staleLogs,
  type LogFileInfo
} from './logFiles'

let dir: string | null = null
let current: { day: string; name: string; size: number } | null = null

/** Окно приёма записей из интерфейса: не больше 30 за 10 секунд. */
const takeRendererSlot = createRateLimiter(30, 10_000)

function listLogs(folder: string): LogFileInfo[] {
  try {
    return readdirSync(folder).map((name) => {
      let size = 0
      try {
        size = statSync(join(folder, name)).size
      } catch {
        /* файл исчез — считаем пустым */
      }
      return { name, size }
    })
  } catch {
    return []
  }
}

/** Удаляет файлы сверх положенных семи (чужие файлы в папке не трогает). */
export function pruneLogs(folder: string): void {
  for (const name of staleLogs(listLogs(folder).map((f) => f.name))) {
    try {
      rmSync(join(folder, name), { force: true })
    } catch {
      /* не удалось — не страшно */
    }
  }
}

/** Подготавливает папку журналов. Повторный вызов безопасен. */
export function initLogger(userDataDir: string): string {
  dir = join(userDataDir, 'logs')
  try {
    mkdirSync(dir, { recursive: true })
    pruneLogs(dir)
  } catch {
    /* журнал — не повод ронять приложение */
  }
  current = null
  return dir
}

export const logsDir = (): string | null => dir

/** Записывает строку. Никогда не бросает исключений. */
export function writeLog(
  level: LogLevel,
  source: string,
  message: string,
  stack?: string,
  now: Date = new Date()
): void {
  if (!dir) return
  try {
    const line = formatLine(now, level, source, message, stack)
    const bytes = Buffer.byteLength(line, 'utf8')
    const day = dayStamp(now)
    if (!current || current.day !== day || current.size + bytes > LOG_MAX_BYTES) {
      const picked = pickLogFile(listLogs(dir), day, bytes)
      const changed = !current || current.name !== picked.name
      current = { day, name: picked.name, size: picked.size }
      if (changed) pruneLogs(dir)
    }
    appendFileSync(join(dir, current.name), line, 'utf8')
    current.size += bytes
  } catch {
    /* диск полон или папка недоступна — журнал молча пропускаем */
  }
}

export const logInfo = (source: string, message: string): void => writeLog('info', source, message)
export const logWarn = (source: string, message: string): void => writeLog('warn', source, message)
export function logError(source: string, error: unknown, extra?: string): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  writeLog('error', source, extra ? `${extra}: ${message}` : message, stack)
}

/** Запись из интерфейса: схема, длина, частота. Ошибка проверки сама попадает в журнал (одной строкой). */
export function writeRendererLog(raw: unknown, now: number = Date.now()): boolean {
  const slot = takeRendererSlot(now)
  if (slot.dropped > 0) {
    writeLog('warn', 'renderer', `Пропущено записей из интерфейса: ${slot.dropped} (слишком часто)`)
  }
  if (!slot.allowed) return false
  const parsed = LogEntrySchema.safeParse(raw)
  if (!parsed.success) return false
  const entry: LogEntry = parsed.data
  writeLog(entry.level, `renderer:${entry.source ?? 'ui'}`, entry.message, entry.stack)
  return true
}
