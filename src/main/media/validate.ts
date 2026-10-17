// Проверка пути к видеофайлу без обращения к диску (чистые функции).
import { isAbsolute, extname, basename } from 'path'
import { VIDEO_EXTENSIONS } from '../../shared/ipc-contract'

export const MAX_PATH_LENGTH = 1024

export const MEDIA_ERRORS = {
  badPath: 'Некорректный путь к файлу',
  badExtension: 'Это не видеофайл. Выберите MP4, MOV, WebM, M4V или MKV',
  notFound: 'Файл не найден или недоступен',
  notFile: 'Выбранный объект не является файлом',
  empty: 'Файл пустой',
  badId: 'Некорректный идентификатор видео',
  unknownId: 'Видео не найдено — откройте файл заново',
  untrusted: 'Недоверенный источник запроса',
  unknown: 'Неизвестная ошибка'
} as const

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska'
}

export function extensionOf(path: string): string {
  return extname(path).slice(1).toLowerCase()
}

export function mimeForPath(path: string): string {
  return MIME_BY_EXT[extensionOf(path)] ?? 'application/octet-stream'
}

/** Возвращает текст ошибки или null, если путь выглядит допустимым. */
export function checkVideoPath(value: unknown): string | null {
  if (typeof value !== 'string') return MEDIA_ERRORS.badPath
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return MEDIA_ERRORS.badPath
  if (value.includes('\0')) return MEDIA_ERRORS.badPath
  if (!isAbsolute(value)) return MEDIA_ERRORS.badPath
  const ext = extensionOf(value)
  if (!(VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return MEDIA_ERRORS.badExtension
  return null
}

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Возвращает текст ошибки или null, если значение похоже на выданный идентификатор. */
export function checkMediaId(value: unknown): string | null {
  return typeof value === 'string' && MEDIA_ID.test(value) ? null : MEDIA_ERRORS.badId
}

export function fileNameOf(path: string): string {
  return basename(path)
}
