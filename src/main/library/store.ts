// Библиотека проектов: library.json в папке данных приложения. Хранит все известные проекты без ограничения числа
// (список «Последние проекты» остаётся отдельным и коротким). Запись атомарная и идёт по очереди.
import { readFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { MAX_PROJECT_PATH } from '../../shared/project'
import { writeTextAtomic } from '../project/files'
import { pathKey } from '../project/recent'

export const LIBRARY_FILE = 'library.json'
export const MAX_LIBRARY_ITEMS = 5000

const LibrarySchema = z.object({
  version: z.literal(1),
  items: z
    .array(
      z.object({
        path: z.string().min(1).max(MAX_PROJECT_PATH),
        addedAt: z.iso.datetime(),
        lastOpenedAt: z.iso.datetime().nullable()
      })
    )
    .max(MAX_LIBRARY_ITEMS)
})

export type LibraryItem = z.infer<typeof LibrarySchema>['items'][number]

/** Проект создан, открыт или сохранён: запись добавляется (или обновляется) и получает время последнего открытия. */
export function touchItem(
  list: readonly LibraryItem[],
  path: string,
  now: Date = new Date()
): LibraryItem[] {
  const key = pathKey(path)
  const iso = now.toISOString()
  const known = list.find((i) => pathKey(i.path) === key)
  const entry: LibraryItem = known
    ? { ...known, path, lastOpenedAt: iso }
    : { path, addedAt: iso, lastOpenedAt: iso }
  return [entry, ...list.filter((i) => pathKey(i.path) !== key)].slice(0, MAX_LIBRARY_ITEMS)
}

export function removeItem(list: readonly LibraryItem[], path: string): LibraryItem[] {
  const key = pathKey(path)
  return list.filter((i) => pathKey(i.path) !== key)
}

/** Проект переехал: запись сохраняет дату добавления, но получает новый путь; прежний дубль убирается. */
export function replaceItemPath(
  list: readonly LibraryItem[],
  oldPath: string,
  newPath: string,
  now: Date = new Date()
): LibraryItem[] {
  const oldKey = pathKey(oldPath)
  const newKey = pathKey(newPath)
  const old = list.find((i) => pathKey(i.path) === oldKey)
  const rest = list.filter((i) => pathKey(i.path) !== oldKey && pathKey(i.path) !== newKey)
  const entry: LibraryItem = {
    path: newPath,
    addedAt: old?.addedAt ?? now.toISOString(),
    lastOpenedAt: now.toISOString()
  }
  return [entry, ...rest]
}

/** Источник найден сканированием папки, но в библиотеке его ещё нет. */
export interface ScannedFile {
  path: string
  /** Время изменения файла, ISO. */
  modifiedAt: string
}

export interface MergedEntry {
  path: string
  addedAt: string
  lastOpenedAt: string | null
  /** Запись есть в library.json (иначе — найден только в папке проектов). */
  inLibrary: boolean
}

/** Объединяет библиотеку и найденные в папке файлы без повторов (путь сравнивается без учёта регистра на Windows). */
export function mergeEntries(
  library: readonly LibraryItem[],
  scanned: readonly ScannedFile[]
): MergedEntry[] {
  const out = new Map<string, MergedEntry>()
  for (const item of library) {
    out.set(pathKey(item.path), { ...item, inLibrary: true })
  }
  for (const file of scanned) {
    const key = pathKey(file.path)
    if (!out.has(key)) {
      out.set(key, {
        path: file.path,
        addedAt: file.modifiedAt,
        lastOpenedAt: null,
        inLibrary: false
      })
    }
  }
  return [...out.values()]
}

export async function readLibrary(dir: string): Promise<LibraryItem[]> {
  try {
    const text = await readFile(join(dir, LIBRARY_FILE), 'utf8')
    if (text.length > 4 * 1024 * 1024) return []
    const parsed = LibrarySchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data.items : []
  } catch {
    return []
  }
}

let queue: Promise<unknown> = Promise.resolve()

/** Читает, меняет и записывает библиотеку; изменения идут строго по очереди, чтобы не затирать друг друга. */
export function updateLibrary(
  dir: string,
  change: (list: LibraryItem[]) => LibraryItem[]
): Promise<void> {
  const run = queue.then(async () => {
    const next = change(await readLibrary(dir))
    await writeTextAtomic(
      join(dir, LIBRARY_FILE),
      JSON.stringify({ version: 1, items: next }, null, 2)
    )
  })
  queue = run.catch(() => undefined)
  return run
}

/** Запоминает проект в библиотеке. Ошибка записи не должна мешать открытию и сохранению. */
export async function rememberInLibrary(
  dir: string,
  path: string,
  now: Date = new Date()
): Promise<void> {
  try {
    await updateLibrary(dir, (list) => touchItem(list, path, now))
  } catch {
    /* библиотека — удобство, не критично */
  }
}
