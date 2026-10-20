import { app, ipcMain, shell } from 'electron'
import { stat } from 'fs/promises'
import { IPC_CHANNELS, type AppInfo, type IpcResult } from '../../shared/ipc-contract'
import type { AboutInfo, LicenseTexts } from '../../shared/log'
import { readLicenseTexts } from '../about/licenses'
import { logsDir, writeRendererLog } from '../log/logger'
import { isTrustedSender } from '../security'
import { testFlags } from '../testFlags'
import { autosaveInterval } from '../project/autosave'

const UNTRUSTED = 'Недоверенный источник запроса'
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Неизвестная ошибка'

/** Выполняет обработчик с проверкой отправителя; ошибки превращаются в понятный ответ. */
function handle<T>(channel: string, run: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<T>> => {
    try {
      if (!isTrustedSender(event)) return { ok: false, error: UNTRUSTED }
      return { ok: true, data: await run(...args) }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  })
}

export function registerAppHandlers(): void {
  handle<AppInfo>(IPC_CHANNELS.appGetInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    autosaveMs: autosaveInterval(),
    testFlags: testFlags()
  }))

  handle<AboutInfo>(IPC_CHANNELS.appAbout, () => ({
    name: app.getName(),
    version: app.getVersion(),
    author: '99wr1d',
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    logsDir: logsDir() ?? ''
  }))

  handle<LicenseTexts>(IPC_CHANNELS.appLicenses, () => readLicenseTexts())

  handle<void>(IPC_CHANNELS.appOpenLogs, async () => {
    const dir = logsDir()
    if (!dir) throw new Error('Папка журналов недоступна')
    await stat(dir)
    const problem = await shell.openPath(dir)
    if (problem) throw new Error('Не удалось открыть папку журналов')
  })

  // Запись из интерфейса: ответ всегда успешный, чтобы сбой журнала не порождал новых сбоев в интерфейсе.
  handle<void>(IPC_CHANNELS.logWrite, (raw) => {
    writeRendererLog(raw)
  })
}
