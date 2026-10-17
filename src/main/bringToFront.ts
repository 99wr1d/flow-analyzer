import type { BrowserWindow } from 'electron'

/** Окно автотестов (FLOW_BACKGROUND_WINDOW=1) не должно перехватывать фокус у пользователя. */
export const isBackgroundWindow = process.env['FLOW_BACKGROUND_WINDOW'] === '1'

export function bringToFront(win: BrowserWindow): void {
  if (isBackgroundWindow) return
  if (win.isMinimized()) win.restore()
  win.focus()
}
