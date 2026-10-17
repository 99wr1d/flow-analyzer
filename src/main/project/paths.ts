// Где искать видео проекта и как записывать путь к нему. Чистые функции — проверяются тестами без диска.
import { dirname, isAbsolute, relative, resolve, sep } from 'path'
import type { ProjectVideoRef } from '../../shared/project'

/** Путь к видео относительно папки проекта (с «/»). null — относительного пути нет (другой диск). */
export function toRelativePath(projectPath: string, videoPath: string): string | null {
  const rel = relative(dirname(projectPath), videoPath)
  if (rel === '' || isAbsolute(rel)) return null
  return sep === '\\' ? rel.split('\\').join('/') : rel
}

export interface VideoCandidates {
  absolute: string
  relative: string | null
}

export function videoCandidates(
  projectPath: string | null,
  video: Pick<ProjectVideoRef, 'path' | 'relativePath'>
): VideoCandidates {
  return {
    absolute: video.path,
    relative:
      projectPath && video.relativePath ? resolve(dirname(projectPath), video.relativePath) : null
  }
}

export type VideoLocation = { path: string; via: 'absolute' | 'relative' } | null

/** Ищет видео: сначала по сохранённому пути, затем рядом с проектом. exists — проверка файла (подменяется в тестах). */
export async function locateVideo(
  projectPath: string | null,
  video: Pick<ProjectVideoRef, 'path' | 'relativePath'>,
  exists: (path: string) => Promise<boolean>
): Promise<VideoLocation> {
  const c = videoCandidates(projectPath, video)
  if (await exists(c.absolute)) return { path: c.absolute, via: 'absolute' }
  if (c.relative && (await exists(c.relative))) return { path: c.relative, via: 'relative' }
  return null
}
