import { app, BrowserWindow } from 'electron'
import { isAbsolute } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/register'
import { registerMediaProtocol, registerMediaScheme } from './media/protocol'
import { applySessionSecurity, createMainWindow } from './window'

// Для автотестов: отдельная папка данных (настройки и т. п.), чтобы не трогать настоящие. Только абсолютный путь.
const customUserData = process.env['FLOW_USER_DATA']
if (customUserData && isAbsolute(customUserData)) app.setPath('userData', customUserData)

// Схема flow-media должна быть объявлена до готовности приложения.
registerMediaScheme()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.wr1d99.flowanalyzer')

  // F12 открывает DevTools только в разработке; Ctrl+R блокируется в готовой сборке.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  applySessionSecurity()
  registerMediaProtocol()
  registerIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
