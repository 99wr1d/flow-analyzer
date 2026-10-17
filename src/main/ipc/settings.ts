import { app, ipcMain } from 'electron'
import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc-contract'
import { parseSettings, type Settings, type SettingsLoadResult } from '../../shared/settings'
import { isTrustedSender } from '../security'
import { loadSettings, saveSettingsFile } from '../settings/store'

const UNTRUSTED = 'Недоверенный источник запроса'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

// Предупреждение о повреждённом файле показывается один раз: после выдачи интерфейсу оно сбрасывается.
let pendingWarning: string | null = null
let loadedOnce = false

export function registerSettingsHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.settingsGet,
    async (event): Promise<IpcResult<SettingsLoadResult>> => {
      try {
        if (!isTrustedSender(event)) return { ok: false, error: UNTRUSTED }
        const result = await loadSettings(app.getPath('userData'))
        if (!loadedOnce) {
          loadedOnce = true
          pendingWarning = result.warning
        }
        const warning = pendingWarning
        pendingWarning = null
        return { ok: true, data: { settings: result.settings, warning } }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.settingsSet,
    async (event, raw: unknown): Promise<IpcResult<Settings>> => {
      try {
        if (!isTrustedSender(event)) return { ok: false, error: UNTRUSTED }
        const parsed = parseSettings(raw)
        if (!parsed.ok) return { ok: false, error: `Настройки не прошли проверку: ${parsed.error}` }
        await saveSettingsFile(app.getPath('userData'), parsed.settings)
        return { ok: true, data: parsed.settings }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
  )
}
