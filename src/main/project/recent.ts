// Список недавних проектов: recent.json в папке данных приложения.
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import {
  MAX_PROJECT_PATH,
  MAX_RECENT,
  projectNameFromPath,
  type RecentProject
} from '../../shared/project'

export const RECENT_FILE = 'recent.json'

const RecentSchema = z.object({
  version: z.literal(1),
  items: z
    .array(
      z.object({
        path: z.string().min(1).max(MAX_PROJECT_PATH),
        name: z.string().min(1).max(255),
        openedAt: z.iso.datetime()
      })
    )
    .max(MAX_RECENT)
})

/** Ключ для сравнения путей: на Windows регистр и вид слэшей не важны. */
export function pathKey(path: string): string {
  return process.platform === 'win32' ? path.replace(/\//g, '\\').toLowerCase() : path
}

/** Проект — в начало списка; повтор по пути убирается; список ограничен. */
export function addToRecent(
  list: readonly RecentProject[],
  path: string,
  now: Date = new Date(),
  max: number = MAX_RECENT
): RecentProject[] {
  const key = pathKey(path)
  const entry: RecentProject = {
    path,
    name: projectNameFromPath(path),
    openedAt: now.toISOString()
  }
  return [entry, ...list.filter((r) => pathKey(r.path) !== key)].slice(0, max)
}

/** Оставляет записи, чьи файлы ещё существуют. */
export async function pruneMissing(
  list: readonly RecentProject[],
  exists: (path: string) => Promise<boolean>
): Promise<RecentProject[]> {
  const flags = await Promise.all(list.map((r) => exists(r.path)))
  return list.filter((_, i) => flags[i])
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Читает список как есть (без проверки существования файлов). Битый или отсутствующий файл — пустой список. */
export async function readRecent(dir: string): Promise<RecentProject[]> {
  try {
    const text = await readFile(join(dir, RECENT_FILE), 'utf8')
    if (text.length > 256 * 1024) return []
    const parsed = RecentSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data.items : []
  } catch {
    return []
  }
}

let writeQueue: Promise<unknown> = Promise.resolve()

async function writeRecent(dir: string, items: readonly RecentProject[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, RECENT_FILE)
  const temp = join(dir, `${RECENT_FILE}.${process.pid}.tmp`)
  try {
    await writeFile(temp, JSON.stringify({ version: 1, items }, null, 2), 'utf8')
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

export function saveRecent(dir: string, items: readonly RecentProject[]): Promise<void> {
  const run = writeQueue.then(() => writeRecent(dir, items))
  writeQueue = run.catch(() => undefined)
  return run
}

/** Список для показа: несуществующие файлы убираются (и из файла тоже). */
export async function listRecent(dir: string): Promise<RecentProject[]> {
  const all = await readRecent(dir)
  const alive = await pruneMissing(all, fileExists)
  if (alive.length !== all.length) await saveRecent(dir, alive).catch(() => undefined)
  return alive
}

/** Запоминает проект в списке недавних. Ошибка записи не должна мешать открытию и сохранению. */
export async function rememberProject(
  dir: string,
  path: string,
  now: Date = new Date()
): Promise<void> {
  try {
    await saveRecent(dir, addToRecent(await readRecent(dir), path, now))
  } catch {
    /* список недавних — удобство, не критично */
  }
}
