import { app, ipcMain } from 'electron'
import { IPC_CHANNELS, type AppInfo, type IpcResult } from '../../shared/ipc-contract'
import { isTrustedSender } from '../security'

export function registerAppHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appGetInfo, (event): IpcResult<AppInfo> => {
    try {
      if (!isTrustedSender(event)) {
        return { ok: false, error: 'Недоверенный источник запроса' }
      }
      return {
        ok: true,
        data: { name: app.getName(), version: app.getVersion(), platform: process.platform }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Неизвестная ошибка' }
    }
  })
}
