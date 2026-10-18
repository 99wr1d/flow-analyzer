import { registerCloseHandlers } from '../closeGuard'
import { registerAppHandlers } from './app'
import { registerExportHandlers } from './export'
import { registerProjectHandlers } from './project'
import { registerSettingsHandlers } from './settings'
import { registerVideoHandlers } from './video'

export function registerIpcHandlers(): void {
  registerAppHandlers()
  registerVideoHandlers()
  registerSettingsHandlers()
  registerProjectHandlers()
  registerExportHandlers()
  registerCloseHandlers()
}
