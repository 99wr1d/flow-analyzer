// Карточки для стартового экрана: сводка из файла проекта (без рисунков и эпизодов целиком), состояние файла, эскиз.
import { stat } from 'fs/promises'
import { MAX_THUMBS_PER_LISTING, type LibraryCard } from '../../shared/library'
import { projectNameFromPath, resolveMeta, type Project } from '../../shared/project'
import { readProjectFile } from '../project/files'
import { isInsideFolder, scanProjectsFolder } from './scan'
import { mergeEntries, readLibrary, type MergedEntry } from './store'
import { readThumb, settleThumbs } from './thumbs'

export type CardSummary = Pick<
  LibraryCard,
  | 'title'
  | 'type'
  | 'date'
  | 'notes'
  | 'hasMeta'
  | 'videoFileName'
  | 'videoDuration'
  | 'episodes'
  | 'drawings'
  | 'updatedAt'
>

/** Сводка по прочитанному проекту. Чистая функция. */
export function summarizeProject(project: Project, path: string): CardSummary {
  const meta = resolveMeta(project.meta, projectNameFromPath(path))
  return {
    title: meta.title,
    type: meta.type,
    ...(meta.date ? { date: meta.date } : {}),
    ...(meta.notes ? { notes: meta.notes } : {}),
    hasMeta: project.meta !== undefined,
    videoFileName: project.video.fileName,
    ...(project.video.duration !== undefined ? { videoDuration: project.video.duration } : {}),
    episodes: project.episodes.length,
    drawings: project.annotations.length,
    updatedAt: project.updatedAt
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function buildCard(entry: MergedEntry, folder: string): Promise<LibraryCard> {
  const base = {
    path: entry.path,
    addedAt: entry.addedAt,
    lastOpenedAt: entry.lastOpenedAt,
    inDefaultFolder: isInsideFolder(folder, entry.path),
    thumb: null
  }
  const empty = {
    title: projectNameFromPath(entry.path),
    type: 'other' as const,
    hasMeta: false,
    videoFileName: null,
    episodes: 0,
    drawings: 0,
    updatedAt: null
  }
  if (!(await isFile(entry.path))) return { ...base, ...empty, status: 'missing' }
  const parsed = await readProjectFile(entry.path)
  if (!parsed.ok) return { ...base, ...empty, status: 'error', error: parsed.message }
  return { ...base, ...summarizeProject(parsed.project, entry.path), status: 'ok' }
}

/** Выполняет задания пачками, чтобы не открывать сотни файлов сразу. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(run))))
  }
  return out
}

/** Все известные проекты: библиотека плюс файлы из папки по умолчанию. */
export async function buildCards(userData: string, folder: string): Promise<LibraryCard[]> {
  await settleThumbs()
  const [library, scanned] = await Promise.all([readLibrary(userData), scanProjectsFolder(folder)])
  const cards = await inBatches(mergeEntries(library, scanned), 8, (entry) =>
    buildCard(entry, folder)
  )
  let thumbs = 0
  for (const card of cards) {
    if (card.status !== 'ok' || thumbs >= MAX_THUMBS_PER_LISTING) continue
    card.thumb = await readThumb(userData, card.path)
    if (card.thumb) thumbs += 1
  }
  return cards
}
