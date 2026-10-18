// Где лежит ffmpeg. В готовой сборке бинарник распакован из app.asar (его нельзя запустить из архива).
import { existsSync } from 'fs'
import ffmpegStatic from 'ffmpeg-static'

export const FFMPEG_ERRORS = {
  missing:
    'Не найден ffmpeg — программа для вырезания клипов. Переустановите FlowAnalyzer: без неё экспорт не работает.',
  unsupported: 'Экспорт клипов не поддерживается на этой системе (нет ffmpeg для неё).'
} as const

/** Заменяет «app.asar» в пути на «app.asar.unpacked» (только целый сегмент пути). */
export function toUnpackedPath(path: string): string {
  return path.replace(/([\\/])app\.asar(?=[\\/])/g, '$1app.asar.unpacked')
}

export type FfmpegLocation = { ok: true; path: string } | { ok: false; error: string }

/** Проверяет путь из пакета ffmpeg-static (string | null) и возвращает путь к реальному файлу. */
export function locateFfmpeg(
  raw: string | null | undefined,
  exists: (path: string) => boolean = existsSync
): FfmpegLocation {
  if (!raw) return { ok: false, error: FFMPEG_ERRORS.unsupported }
  const path = toUnpackedPath(raw)
  return exists(path) ? { ok: true, path } : { ok: false, error: FFMPEG_ERRORS.missing }
}

let cached: FfmpegLocation | null = null

/** Путь к ffmpeg для запуска (результат запоминается, пока не найден). */
export function getFfmpegPath(): FfmpegLocation {
  if (cached?.ok) return cached
  cached = locateFfmpeg(ffmpegStatic)
  return cached
}
