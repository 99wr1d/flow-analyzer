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

/** Размер и время изменения файла; null — файла нет (или это не файл). */
async function fileStamp(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null
  } catch {
    return null
  }
}

type ReadSummary = { status: 'ok'; summary: CardSummary } | { status: 'error'; error: string }

/**
 * Сводки уже прочитанных проектов. Ключ — путь; запись действует, пока не изменились размер и время изменения файла.
 * Возврат на стартовый экран (он обновляет список каждый раз) не перечитывает и не проверяет заново сотни файлов:
 * проверка схемой файла с тысячами эпизодов — десятки миллисекунд, а у большой библиотеки это секунды.
 */
const summaryCache = new Map<string, { size: number; mtimeMs: number; value: ReadSummary }>()
/** Предел памяти: сводка маленькая, но список не должен расти бесконечно. */
const SUMMARY_CACHE_MAX = 2000

/** Для тестов. */
export const clearSummaryCache = (): void => summaryCache.clear()

async function readSummary(
  path: string,
  stamp: { size: number; mtimeMs: number }
): Promise<ReadSummary> {
  const cached = summaryCache.get(path)
  if (cached && cached.size === stamp.size && cached.mtimeMs === stamp.mtimeMs) return cached.value
  const parsed = await readProjectFile(path)
  const value: ReadSummary = parsed.ok
    ? { status: 'ok', summary: summarizeProject(parsed.project, path) }
    : { status: 'error', error: parsed.message }
  if (summaryCache.size >= SUMMARY_CACHE_MAX) summaryCache.clear()
  summaryCache.set(path, { ...stamp, value })
  return value
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
  const stamp = await fileStamp(entry.path)
  if (!stamp) return { ...base, ...empty, status: 'missing' }
  const read = await readSummary(entry.path, stamp)
  if (read.status === 'error') return { ...base, ...empty, status: 'error', error: read.error }
  return { ...base, ...read.summary, status: 'ok' }
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
