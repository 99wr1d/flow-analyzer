import { registerAppHandlers } from './app'
import { registerVideoHandlers } from './video'

export function registerIpcHandlers(): void {
  registerAppHandlers()
  registerVideoHandlers()
}
