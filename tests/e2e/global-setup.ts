// Перед прогоном удаляет временные папки данных, оставшиеся от прошлых запусков тестов.
import { execFileSync } from 'child_process'
import { existsSync, readdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { SHOTS, USERDATA_PREFIX } from './helpers'

export default function globalSetup(): void {
  // Список сторонних компонентов для окна «О программе» создаётся при сборке; для запуска из исходников — здесь.
  if (!existsSync(resolve('licenses/THIRD_PARTY_NOTICES.txt'))) {
    execFileSync(process.execPath, [resolve('scripts/gen-notices.mjs')], { stdio: 'ignore' })
  }
  try {
    for (const name of readdirSync(SHOTS)) {
      if (name.startsWith(`${USERDATA_PREFIX}-`)) {
        rmSync(join(SHOTS, name), { recursive: true, force: true })
      }
    }
  } catch {
    /* папки нет — чистить нечего */
  }
}
