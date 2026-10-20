// Чистая логика журнала: имена файлов, выбор файла для записи, ротация, формат строки, ограничение частоты.
// Не зависит от Electron и файловой системы — всё проверяется юнит-тестами.
import type { LogLevel } from '../../shared/log'

export const LOG_PREFIX = 'flowanalyzer-'
export const LOG_EXT = '.log'
/** Сколько файлов журнала хранить. */
export const LOG_KEEP_FILES = 7
/** Предел размера одного файла. */
export const LOG_MAX_BYTES = 5 * 1024 * 1024

export interface LogFileInfo {
  name: string
  size: number
}

/** День в местном времени: ГГГГ-ММ-ДД. */
export function dayStamp(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** flowanalyzer-ГГГГ-ММ-ДД.log, а когда файл дня переполнен, — flowanalyzer-ГГГГ-ММ-ДД.1.log, .2.log … */
export function logFileName(day: string, index: number): string {
  return `${LOG_PREFIX}${day}${index > 0 ? `.${index}` : ''}${LOG_EXT}`
}

export function parseLogName(name: string): { day: string; index: number } | null {
  const m = /^flowanalyzer-(\d{4}-\d{2}-\d{2})(?:\.(\d{1,3}))?\.log$/.exec(name)
  return m ? { day: m[1], index: m[2] ? Number(m[2]) : 0 } : null
}

/** В какой файл писать: первый файл дня, в котором ещё есть место для записи длиной need байт. */
export function pickLogFile(
  files: readonly LogFileInfo[],
  day: string,
  need: number,
  maxBytes: number = LOG_MAX_BYTES
): { name: string; size: number } {
  const sizes = new Map(files.map((f) => [f.name, f.size]))
  for (let index = 0; index < 1000; index += 1) {
    const name = logFileName(day, index)
    const size = sizes.get(name) ?? 0
    // Пустой файл принимает любую запись (даже длиннее предела): иначе она не записалась бы никогда.
    if (size === 0 || size + need <= maxBytes) return { name, size }
  }
  return { name: logFileName(day, 999), size: sizes.get(logFileName(day, 999)) ?? 0 }
}

/** Какие файлы удалить, чтобы осталось не больше keep самых новых (по дню, затем по номеру). Чужие файлы не трогаем. */
export function staleLogs(names: readonly string[], keep: number = LOG_KEEP_FILES): string[] {
  const logs = names
    .map((name) => ({ name, parsed: parseLogName(name) }))
    .filter((x): x is { name: string; parsed: { day: string; index: number } } => x.parsed !== null)
    .sort((a, b) =>
      a.parsed.day === b.parsed.day
        ? b.parsed.index - a.parsed.index
        : a.parsed.day < b.parsed.day
          ? 1
          : -1
    )
  return logs.slice(keep).map((x) => x.name)
}

const LEVEL_TAG: Record<LogLevel, string> = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' }

/** Одна запись журнала: время, уровень, источник, сообщение; стек — на следующих строках с отступом. */
export function formatLine(
  date: Date,
  level: LogLevel,
  source: string,
  message: string,
  stack?: string
): string {
  const oneLine = message.replace(/\r?\n/g, ' | ')
  const head = `${date.toISOString()} ${LEVEL_TAG[level]} [${source}] ${oneLine}`
  if (!stack) return `${head}\n`
  return `${head}\n${stack
    .split(/\r?\n/)
    .map((l) => `    ${l}`)
    .join('\n')}\n`
}

/**
 * Ограничитель частоты: не больше max записей за окно windowMs. Лишние отбрасываются;
 * когда окно закончилось, ответ сообщает, сколько записей было отброшено (чтобы это попало в журнал одной строкой).
 */
export function createRateLimiter(
  max: number,
  windowMs: number
): (now: number) => { allowed: boolean; dropped: number } {
  let windowStart = -Infinity
  let count = 0
  let dropped = 0
  return (now) => {
    let report = 0
    if (now - windowStart >= windowMs) {
      report = dropped
      dropped = 0
      windowStart = now
      count = 0
    }
    if (count < max) {
      count += 1
      return { allowed: true, dropped: report }
    }
    dropped += 1
    return { allowed: false, dropped: 0 }
  }
}
