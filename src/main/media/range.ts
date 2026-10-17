// Разбор HTTP-заголовка Range. Чистая функция — без доступа к файлам и Electron.

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number } // end включительно
  | { kind: 'invalid' }

/**
 * Разбирает значение заголовка Range для файла размером size байт.
 * - нет заголовка или неподдерживаемая форма (не bytes, несколько диапазонов) → отдаём файл целиком;
 * - «bytes=100-», «bytes=100-199», «bytes=-500» → частичный ответ;
 * - диапазон за пределами файла или битый → invalid (ответ 416).
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (header === null || header === undefined || header.trim() === '') return { kind: 'full' }

  const match = /^\s*bytes\s*=\s*(.+)$/i.exec(header)
  if (!match) return { kind: 'full' }
  const spec = match[1].trim()
  if (spec.includes(',')) return { kind: 'full' }

  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(spec)
  if (!parts) return { kind: 'invalid' }
  const [, rawStart, rawEnd] = parts
  if (rawStart === '' && rawEnd === '') return { kind: 'invalid' }
  if (size <= 0) return { kind: 'invalid' }

  // Суффикс: последние N байт.
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'invalid' }
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start >= size) return { kind: 'invalid' }
  if (rawEnd === '') return { kind: 'partial', start, end: size - 1 }

  const end = Number(rawEnd)
  if (!Number.isSafeInteger(end) || end < start) return { kind: 'invalid' }
  return { kind: 'partial', start, end: Math.min(end, size - 1) }
}
