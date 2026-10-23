/** Имя файла из названия доски (общее для main и интерфейса). */
export const DEFAULT_BOARD_FILE_NAME = 'Доска'
const MAX_FILE_NAME = 80

export function safeFileName(title: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILE_NAME)
    // Windows не любит точки и пробелы в конце имени.
    .replace(/[. ]+$/, '')
  return cleaned || DEFAULT_BOARD_FILE_NAME
}
