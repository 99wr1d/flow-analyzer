// Проект, переданный приложению снаружи: двойной щелчок по .flowproj, командная строка, второй запуск.
import { isAbsolute, resolve } from 'path'
import { PROJECT_EXTENSION } from '../../shared/project'
import { fileExists } from './recent'

/** Первый аргумент командной строки, который выглядит как существующий файл проекта. Относительные пути считаются от cwd. */
export async function pickProjectArg(
  argv: readonly string[],
  cwd: string,
  exists: (path: string) => Promise<boolean> = fileExists
): Promise<string | null> {
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.startsWith('-') || arg.includes('\0')) continue
    if (!arg.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)) continue
    const full = isAbsolute(arg) ? arg : resolve(cwd, arg)
    if (await exists(full)) return full
  }
  return null
}

let pendingLaunchPath: string | null = null

export function setLaunchPath(path: string | null): void {
  pendingLaunchPath = path
}

/** Выдаёт путь запуска один раз. */
export function takeLaunchPath(): string | null {
  const path = pendingLaunchPath
  pendingLaunchPath = null
  return path
}
