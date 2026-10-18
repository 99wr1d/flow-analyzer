// Имена выходных файлов: очистка для Windows, формат NNN_Тег_ММ-СС, неперезаписывание существующих.

const MAX_STEM = 100
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FORBIDDEN = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
// Управляющие и невидимые символы (в том числе смена направления текста) — диапазоны кодов.
const INVISIBLE: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff]
]

function isForbidden(ch: string): boolean {
  if (FORBIDDEN.has(ch)) return true
  const code = ch.codePointAt(0) ?? 0
  return INVISIBLE.some(([from, to]) => code >= from && code <= to)
}

/** Делает из произвольного текста безопасную часть имени файла. Кириллица сохраняется. */
export function sanitizeName(text: string, fallback = 'клип'): string {
  let name = Array.from(text.normalize('NFC'))
    .filter((ch) => !isForbidden(ch))
    .join('')
    .replace(/\s+/g, '_')
  name = name.replace(/^[._]+|[. _]+$/g, '')
  if (name.length > MAX_STEM) name = name.slice(0, MAX_STEM).replace(/[. _]+$/g, '')
  if (name === '') return fallback
  // Зарезервированные имена Windows (CON, NUL, COM1…) недопустимы и с расширением: CON.mp4.
  if (RESERVED.test(name.split('.')[0])) name = `_${name}`
  return name
}

/** Имя файла из названия проекта: пробелы сохраняются, запрещённые для Windows символы убираются. */
export function sanitizeFileStem(text: string, fallback = 'Проект'): string {
  const clean = Array.from(text.normalize('NFC'))
    .filter((ch) => !isForbidden(ch))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, MAX_STEM)
    .replace(/[. ]+$/g, '')
  if (clean === '') return fallback
  return RESERVED.test(clean.split('.')[0]) ? `_${clean}` : clean
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** ММ-СС начала эпизода. Минуты не обрезаются до 59: для 90-минутного матча будет, например, 87-05. */
export function timeStamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${pad2(Math.floor(total / 60))}-${pad2(total % 60)}`
}

/** NNN_Тег_ММ-СС (без расширения). */
export function clipStem(number: number, label: string, episodeStart: number): string {
  const n = String(number).padStart(3, '0')
  return `${n}_${sanitizeName(label, 'эпизод')}_${timeStamp(episodeStart)}`
}

/**
 * Свободное имя в папке: «имя.mp4», «имя (2).mp4», «имя (3).mp4»…
 * taken — проверка, занято ли имя (файл на диске или уже выбранное в этом экспорте).
 */
export function uniqueFileName(
  stem: string,
  extension: string,
  taken: (fileName: string) => boolean
): string {
  let candidate = `${stem}.${extension}`
  for (let n = 2; taken(candidate); n += 1) {
    candidate = `${stem} (${n}).${extension}`
    if (n > 10_000) break
  }
  return candidate
}

/** Имя подборки по умолчанию: «<проект>_подборка.mp4». */
export function compilationDefaultName(projectName: string | null, videoStem: string): string {
  const base = sanitizeName(projectName ?? '', '') || sanitizeName(videoStem, 'видео')
  return `${base}_подборка.mp4`
}
