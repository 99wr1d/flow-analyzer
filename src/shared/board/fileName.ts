/** Имя файла из названия доски (общее для main и интерфейса). */
export const DEFAULT_BOARD_FILE_NAME = 'Доска'
const MAX_FILE_NAME = 80
/** Имена устройств Windows: файл с таким именем (даже с расширением) открывает устройство. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function safeFileName(title: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILE_NAME)
    // Windows не любит точки и пробелы в конце имени.
    .replace(/[. ]+$/, '')
  if (!cleaned) return DEFAULT_BOARD_FILE_NAME
  const dot = cleaned.indexOf('.')
  const stem = (dot === -1 ? cleaned : cleaned.slice(0, dot)).trimEnd()
  if (!RESERVED.test(stem)) return cleaned
  return `${stem}_${dot === -1 ? '' : cleaned.slice(dot)}`
}
