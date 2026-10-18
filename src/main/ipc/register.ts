import { registerCloseHandlers } from '../closeGuard'
import { registerAppHandlers } from './app'
import { registerExportHandlers } from './export'
import { registerLibraryHandlers } from './library'
import { registerProjectHandlers } from './project'
import { registerSettingsHandlers } from './settings'
import { registerStatsHandlers } from './stats'
import { registerVideoHandlers } from './video'

export function registerIpcHandlers(): void {
  registerAppHandlers()
  registerVideoHandlers()
  registerSettingsHandlers()
  registerProjectHandlers()
  registerLibraryHandlers()
  registerExportHandlers()
  registerStatsHandlers()
  registerCloseHandlers()
}
