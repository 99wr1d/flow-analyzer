// Реестр выданных видеофайлов: рендереру доступны только файлы, которые пользователь выбрал сам.
import { randomUUID } from 'crypto'
import { stat } from 'fs/promises'
import type { VideoSource } from '../../shared/ipc-contract'
import { MEDIA_ERRORS, checkVideoPath, fileNameOf } from './validate'

export const MEDIA_SCHEME = 'flow-media'

export interface MediaEntry {
  path: string
}

const entries = new Map<string, MediaEntry>()

export function getMediaEntry(id: string): MediaEntry | undefined {
  return entries.get(id)
}

/** Проверяет файл на диске и выдаёт к нему доступ. Бросает Error с понятным текстом. */
export async function grantVideo(path: unknown): Promise<VideoSource> {
  const problem = checkVideoPath(path)
  if (problem) throw new Error(problem)
  const filePath = path as string

  let info
  try {
    info = await stat(filePath)
  } catch {
    throw new Error(MEDIA_ERRORS.notFound)
  }
  if (!info.isFile()) throw new Error(MEDIA_ERRORS.notFile)
  if (info.size <= 0) throw new Error(MEDIA_ERRORS.empty)

  const id = randomUUID()
  entries.set(id, { path: filePath })
  return {
    id,
    fileName: fileNameOf(filePath),
    sizeBytes: info.size,
    url: `${MEDIA_SCHEME}://video/${id}`
  }
}
