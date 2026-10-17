// Копии работы для восстановления после сбоя: userData/recovery/<ключ>.flowproj.recovery.
import { createHash } from 'crypto'
import { mkdir, readdir, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import {
  MAX_PROJECT_BYTES,
  MAX_PROJECT_PATH,
  ProjectSchema,
  UNTITLED_PROJECT,
  projectNameFromPath,
  type Project,
  type RecoveryItem
} from '../../shared/project'
import { writeTextAtomic } from './files'
import { pathKey } from './recent'

export const RECOVERY_DIR = 'recovery'
export const RECOVERY_SUFFIX = '.flowproj.recovery'
export const RECOVERY_FORMAT = 'flowanalyzer-recovery'

const KEY_PATTERN = /^(p-[0-9a-f]{16}|untitled-[0-9a-f]{8})$/
export const isRecoveryKey = (value: unknown): value is string =>
  typeof value === 'string' && KEY_PATTERN.test(value)

/** Имя копии: хэш пути проекта или «untitled-<сессия>» для проекта, который ещё не сохранялся. */
export function recoveryKey(projectPath: string | null, untitledId: string): string {
  if (projectPath === null) return `untitled-${untitledId}`
  return `p-${createHash('sha256').update(pathKey(projectPath)).digest('hex').slice(0, 16)}`
}

export const recoveryFileName = (key: string): string => `${key}${RECOVERY_SUFFIX}`

const RecoveryFileSchema = z.object({
  format: z.literal(RECOVERY_FORMAT),
  version: z.literal(1),
  projectPath: z.string().min(1).max(MAX_PROJECT_PATH).nullable(),
  savedAt: z.iso.datetime(),
  project: ProjectSchema
})
export type RecoveryFile = z.infer<typeof RecoveryFileSchema>

const dirOf = (userData: string): string => join(userData, RECOVERY_DIR)

export async function writeRecovery(
  userData: string,
  key: string,
  projectPath: string | null,
  project: Project,
  now: Date = new Date()
): Promise<void> {
  if (!isRecoveryKey(key)) throw new Error('Некорректный ключ копии')
  const file: RecoveryFile = {
    format: RECOVERY_FORMAT,
    version: 1,
    projectPath,
    savedAt: now.toISOString(),
    project
  }
  await mkdir(dirOf(userData), { recursive: true })
  await writeTextAtomic(join(dirOf(userData), recoveryFileName(key)), JSON.stringify(file))
}

export async function readRecovery(userData: string, key: string): Promise<RecoveryFile | null> {
  if (!isRecoveryKey(key)) return null
  const path = join(dirOf(userData), recoveryFileName(key))
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_PROJECT_BYTES + 1024 * 1024) return null
    const parsed = RecoveryFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function deleteRecovery(userData: string, key: string): Promise<void> {
  if (!isRecoveryKey(key)) return
  await rm(join(dirOf(userData), recoveryFileName(key)), { force: true }).catch(() => undefined)
}

/** Копии, которые удалось прочитать, от новых к старым. Повреждённые файлы пропускаются. */
export async function listRecovery(userData: string): Promise<RecoveryItem[]> {
  let names: string[]
  try {
    names = await readdir(dirOf(userData))
  } catch {
    return []
  }
  const items: RecoveryItem[] = []
  for (const name of names) {
    if (!name.endsWith(RECOVERY_SUFFIX)) continue
    const key = name.slice(0, -RECOVERY_SUFFIX.length)
    const file = await readRecovery(userData, key)
    if (!file) continue
    items.push({
      key,
      name: file.projectPath ? projectNameFromPath(file.projectPath) : UNTITLED_PROJECT,
      projectPath: file.projectPath,
      videoFileName: file.project.video.fileName,
      savedAt: file.savedAt
    })
  }
  return items.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}
