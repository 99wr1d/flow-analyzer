// Перед прогоном удаляет временные папки данных, оставшиеся от прошлых запусков тестов.
import { readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { SHOTS, USERDATA_PREFIX } from './helpers'

export default function globalSetup(): void {
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
