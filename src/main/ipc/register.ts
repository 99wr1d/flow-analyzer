import { registerAppHandlers } from './app'
import { registerSettingsHandlers } from './settings'
import { registerVideoHandlers } from './video'

export function registerIpcHandlers(): void {
  registerAppHandlers()
  registerVideoHandlers()
  registerSettingsHandlers()
}
