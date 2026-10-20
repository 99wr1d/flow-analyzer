// Тексты лицензий для окна «О программе»: лицензия FFmpeg и список сторонних компонентов (создаётся при сборке).
// Файлы лежат в папке licenses: рядом с программой (resources/licenses в установленной версии) или в корне проекта.
import { app } from 'electron'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { LicenseTexts } from '../../shared/log'

export const FFMPEG_LICENSE_FILE = 'ffmpeg-LICENSE.txt'
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt'
/** Файл больше этого размера не читается (защита от случайной подмены). */
const MAX_BYTES = 8 * 1024 * 1024

/** Где искать папку licenses, по порядку. */
export function licenseDirs(isPackaged: boolean, resourcesPath: string, appPath: string): string[] {
  return isPackaged
    ? [join(resourcesPath, 'licenses'), join(appPath, 'licenses')]
    : [join(appPath, 'licenses')]
}

async function readFirst(dirs: readonly string[], name: string): Promise<string | null> {
  for (const dir of dirs) {
    try {
      const file = join(dir, name)
      const info = await stat(file)
      if (!info.isFile() || info.size > MAX_BYTES) continue
      return await readFile(file, 'utf8')
    } catch {
      /* пробуем следующую папку */
    }
  }
  return null
}

export async function readLicenseTexts(): Promise<LicenseTexts> {
  const dirs = licenseDirs(app.isPackaged, process.resourcesPath, app.getAppPath())
  const [ffmpeg, notices] = await Promise.all([
    readFirst(dirs, FFMPEG_LICENSE_FILE),
    readFirst(dirs, NOTICES_FILE)
  ])
  return { ffmpeg, notices }
}
