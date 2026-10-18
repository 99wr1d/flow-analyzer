// Поиск файлов проектов в папке по умолчанию: сама папка и подпапки первого уровня (глубже не заходим).
import { mkdir, readdir, stat } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { PROJECT_EXTENSION } from '../../shared/project'
import { pathKey } from '../project/recent'
import type { ScannedFile } from './store'

export const MAX_SCANNED = 500
const SUFFIX = `.${PROJECT_EXTENSION}`

async function projectsIn(dir: string): Promise<string[]> {
  let names
  try {
    names = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return names
    .filter((n) => n.isFile() && !n.name.startsWith('.') && n.name.toLowerCase().endsWith(SUFFIX))
    .map((n) => join(dir, n.name))
}

export async function scanProjectsFolder(folder: string): Promise<ScannedFile[]> {
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => join(folder, e.name))
  const paths = [...(await projectsIn(folder))]
  for (const sub of dirs) paths.push(...(await projectsIn(sub)))
  const files: ScannedFile[] = []
  for (const path of paths.slice(0, MAX_SCANNED)) {
    try {
      files.push({ path, modifiedAt: (await stat(path)).mtime.toISOString() })
    } catch {
      /* файл исчез, пока шёл поиск */
    }
  }
  return files
}

/** Создаёт папку проектов, если её нет. */
export async function ensureProjectsFolder(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true })
}

/** Файл лежит в папке проектов по умолчанию или в её подпапке первого уровня. */
export function isInsideFolder(folder: string, filePath: string): boolean {
  const root = pathKey(resolve(folder))
  const dir = dirname(resolve(filePath))
  return pathKey(dir) === root || pathKey(dirname(dir)) === root
}
