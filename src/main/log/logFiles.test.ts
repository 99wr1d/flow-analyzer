import { describe, expect, it } from 'vitest'
import {
  LOG_KEEP_FILES,
  LOG_MAX_BYTES,
  createRateLimiter,
  dayStamp,
  formatLine,
  logFileName,
  parseLogName,
  pickLogFile,
  staleLogs
} from './logFiles'

describe('имена файлов журнала', () => {
  it('день в местном времени и имя файла', () => {
    expect(dayStamp(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(logFileName('2026-01-05', 0)).toBe('flowanalyzer-2026-01-05.log')
    expect(logFileName('2026-01-05', 2)).toBe('flowanalyzer-2026-01-05.2.log')
  })
  it('разбор имени: свои файлы разбираются, чужие нет', () => {
    expect(parseLogName('flowanalyzer-2026-01-05.log')).toEqual({ day: '2026-01-05', index: 0 })
    expect(parseLogName('flowanalyzer-2026-01-05.12.log')).toEqual({ day: '2026-01-05', index: 12 })
    expect(parseLogName('notes.log')).toBeNull()
    expect(parseLogName('flowanalyzer-2026-01-05.txt')).toBeNull()
    expect(parseLogName('flowanalyzer-2026-1-5.log')).toBeNull()
  })
})

describe('выбор файла для записи', () => {
  const day = '2026-03-01'
  it('нет файлов — первый файл дня', () => {
    expect(pickLogFile([], day, 100)).toEqual({ name: logFileName(day, 0), size: 0 })
  })
  it('есть место — тот же файл', () => {
    const f = [{ name: logFileName(day, 0), size: 1000 }]
    expect(pickLogFile(f, day, 100)).toEqual({ name: logFileName(day, 0), size: 1000 })
  })
  it('файл полон — следующий по номеру, предел не превышается', () => {
    const f = [
      { name: logFileName(day, 0), size: LOG_MAX_BYTES - 10 },
      { name: logFileName(day, 1), size: LOG_MAX_BYTES - 5 }
    ]
    expect(pickLogFile(f, day, 100).name).toBe(logFileName(day, 2))
    expect(pickLogFile(f, day, 5).name).toBe(logFileName(day, 0))
  })
  it('файлы других дней не мешают', () => {
    const f = [{ name: logFileName('2026-02-28', 0), size: LOG_MAX_BYTES }]
    expect(pickLogFile(f, day, 100).name).toBe(logFileName(day, 0))
  })
  it('запись длиннее предела всё равно уходит в пустой файл', () => {
    expect(pickLogFile([], day, LOG_MAX_BYTES * 2).name).toBe(logFileName(day, 0))
  })
})

describe('ротация: сколько файлов хранить', () => {
  it('оставляет 7 самых новых, чужие файлы не трогает', () => {
    const names = [
      ...Array.from({ length: 9 }, (_, i) =>
        logFileName(`2026-03-${String(i + 1).padStart(2, '0')}`, 0)
      ),
      logFileName('2026-03-09', 1),
      'settings.json',
      'readme.txt'
    ]
    const stale = staleLogs(names)
    expect(stale).toHaveLength(10 - LOG_KEEP_FILES)
    expect(stale.sort()).toEqual([
      logFileName('2026-03-01', 0),
      logFileName('2026-03-02', 0),
      logFileName('2026-03-03', 0)
    ])
  })
  it('внутри дня новее файл с большим номером', () => {
    const names = [
      logFileName('2026-03-01', 0),
      logFileName('2026-03-01', 1),
      logFileName('2026-03-01', 2)
    ]
    expect(staleLogs(names, 2)).toEqual([logFileName('2026-03-01', 0)])
  })
  it('мало файлов — ничего не удаляется', () => {
    expect(staleLogs([logFileName('2026-03-01', 0)])).toEqual([])
  })
})

describe('формат строки', () => {
  const date = new Date('2026-03-01T10:00:00.000Z')
  it('одна строка; переводы строк в сообщении заменяются', () => {
    expect(formatLine(date, 'error', 'main', 'a\nb')).toBe(
      '2026-03-01T10:00:00.000Z ERROR [main] a | b\n'
    )
  })
  it('стек идёт с отступом', () => {
    expect(formatLine(date, 'warn', 'renderer', 'x', 'at f\nat g')).toBe(
      '2026-03-01T10:00:00.000Z WARN  [renderer] x\n    at f\n    at g\n'
    )
  })
})

describe('ограничитель частоты', () => {
  it('пропускает max записей за окно, остальные отбрасывает и потом сообщает сколько', () => {
    const take = createRateLimiter(3, 1000)
    expect([0, 1, 2, 3, 4].map((t) => take(t).allowed)).toEqual([true, true, true, false, false])
    const next = take(1500)
    expect(next).toEqual({ allowed: true, dropped: 2 })
    expect(take(1600).dropped).toBe(0)
  })
  it('новое окно сбрасывает счётчик', () => {
    const take = createRateLimiter(1, 100)
    expect(take(0).allowed).toBe(true)
    expect(take(50).allowed).toBe(false)
    expect(take(200).allowed).toBe(true)
  })
})
