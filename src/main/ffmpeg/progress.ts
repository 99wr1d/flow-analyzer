// Разбор вывода ffmpeg: ход работы (-progress pipe:1), сведения о файле (ffmpeg -i), понятные ошибки.

/**
 * Читает поток «ключ=значение» из stdout. Куски могут обрываться посреди строки, поэтому хвост хранится до следующего вызова.
 * Время приходит в out_time_us (микросекунды); out_time_ms в ffmpeg тоже микросекунды, поэтому его не используем.
 */
export function createProgressParser(onTime: (seconds: number) => void): {
  feed: (chunk: string) => void
} {
  let rest = ''
  return {
    feed(chunk) {
      const lines = (rest + chunk).split(/\r?\n/)
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const eq = line.indexOf('=')
        if (eq < 0 || line.slice(0, eq) !== 'out_time_us') continue
        const value = Number(line.slice(eq + 1))
        if (Number.isFinite(value) && value >= 0) onTime(value / 1e6)
      }
    }
  }
}

export interface MediaFacts {
  /** Секунды; null — в метаданных длительности нет. */
  duration: number | null
  hasVideo: boolean
  hasAudio: boolean
  /** Размер картинки с учётом поворота; null — не удалось прочитать. */
  width: number | null
  height: number | null
  /** Частота кадров из заголовка потока (может быть средней); null — не указана. */
  fps: number | null
  /** Звук: частота дискретизации и «моно» ли он. */
  audioRate: number | null
  audioMono: boolean
}

/** Сведения о файле из текста, который ffmpeg печатает при `ffmpeg -i файл`. */
export function parseMediaInfo(stderr: string): MediaFacts {
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null
  // Обложка в mp3/mp4 — тоже «Video», но с пометкой attached pic: настоящим видео не считаем.
  const streams = stderr.split(/\r?\n/).filter((l) => /^\s*Stream #\d+:\d+/.test(l))
  const hasVideo = streams.some((l) => /: Video:/.test(l) && !/attached pic/.test(l))
  const hasAudio = streams.some((l) => /: Audio:/.test(l))
  const videoLine = streams.find((l) => /: Video:/.test(l) && !/attached pic/.test(l))
  const size = videoLine ? /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(videoLine) : null
  const fpsMatch = videoLine ? /(\d+(?:\.\d+)?)\s+fps/.exec(videoLine) : null
  // Поворот пишется отдельной строкой после потока («displaymatrix: rotation of -90.00 degrees»).
  const rotation = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr)
  const quarter = rotation ? Math.round(Math.abs(Number(rotation[1])) / 90) % 2 === 1 : false
  const audioLine = streams.find((l) => /: Audio:/.test(l))
  const audioMatch = audioLine ? /(\d+) Hz,\s*([^,]+)/.exec(audioLine) : null
  let width = size ? Number(size[1]) : null
  let height = size ? Number(size[2]) : null
  if (quarter && width !== null && height !== null) [width, height] = [height, width]
  return {
    duration: duration !== null && Number.isFinite(duration) ? duration : null,
    hasVideo,
    hasAudio,
    width,
    height,
    fps: fpsMatch ? Number(fpsMatch[1]) : null,
    audioRate: audioMatch ? Number(audioMatch[1]) : null,
    audioMono: audioMatch ? /^(mono|1 channels)/.test(audioMatch[2].trim()) : false
  }
}

export const EXPORT_MESSAGES = {
  noSpace: 'На диске не хватает места',
  noAccess: 'Нет доступа для записи в выбранное место. Выберите другую папку',
  badInput: 'Не удалось прочитать видеофайл: он повреждён или в неподдерживаемом формате',
  inputMissing: 'Видеофайл не найден — возможно, его переместили или удалили',
  noVideo: 'В файле нет видеодорожки',
  cantCreate: 'Не удалось создать файл в выбранной папке',
  stalled: 'Обработка зависла и была остановлена',
  generic: 'Не удалось вырезать клип'
} as const

/** Переводит вывод ffmpeg в понятное сообщение (технические строки остаются в подробностях). */
export function friendlyFfmpegError(lines: readonly string[]): string {
  const text = lines.join('\n')
  if (/No space left on device/i.test(text)) return EXPORT_MESSAGES.noSpace
  if (/Permission denied|Access is denied/i.test(text)) return EXPORT_MESSAGES.noAccess
  if (
    /Invalid data found when processing input|moov atom not found|Could not find codec parameters/i.test(
      text
    )
  ) {
    return EXPORT_MESSAGES.badInput
  }
  if (/Error opening output|Could not open file/i.test(text)) return EXPORT_MESSAGES.cantCreate
  if (/No such file or directory/i.test(text)) return EXPORT_MESSAGES.inputMissing
  return EXPORT_MESSAGES.generic
}
