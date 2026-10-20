import { app, BrowserWindow } from 'electron'
import { isAbsolute } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IPC_EVENTS } from '../shared/ipc-contract'
import { bringToFront } from './bringToFront'
import { markQuitting } from './closeGuard'
import { installProcessLogging } from './crashHandlers'
import { initLogger, logInfo } from './log/logger'
import { registerIpcHandlers } from './ipc/register'
import { registerMediaProtocol, registerMediaScheme } from './media/protocol'
import { pickProjectArg, setLaunchPath } from './project/launch'
import { trustPath } from './project/session'
import { applySessionSecurity, createMainWindow } from './window'

// Для автотестов: отдельная папка данных (настройки и т. п.), чтобы не трогать настоящие. Только абсолютный путь.
const customUserData = process.env['FLOW_USER_DATA']
if (customUserData && isAbsolute(customUserData)) app.setPath('userData', customUserData)

// Журнал работы: userData/logs. Включается сразу, чтобы ловить и ошибки запуска.
initLogger(app.getPath('userData'))
installProcessLogging()

// Схема flow-media должна быть объявлена до готовности приложения.
registerMediaScheme()

// Одно окно на пользователя: второй запуск (например, двойной щелчок по .flowproj) передаёт файл первому.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainWindow: BrowserWindow | null = null

/** Просит окно открыть проект (путь уже проверен: .flowproj, файл существует). */
function requestOpen(path: string): void {
  trustPath(path)
  const win = mainWindow
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    bringToFront(win)
    win.webContents.send(IPC_EVENTS.openProjectRequested, path)
  } else {
    setLaunchPath(path)
  }
}

if (gotLock) {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    void pickProjectArg(argv.slice(1), workingDirectory).then((path) => {
      if (path) return requestOpen(path)
      const win = mainWindow
      if (win && !win.isDestroyed()) {
        bringToFront(win)
      }
    })
  })

  // macOS: двойной щелчок по файлу приходит событием, а не аргументом.
  app.on('open-file', (event, path) => {
    event.preventDefault()
    void pickProjectArg([path], process.cwd()).then((found) => found && requestOpen(found))
  })

  app.on('before-quit', markQuitting)

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.wr1d99.flowanalyzer')
    logInfo(
      'main',
      `FlowAnalyzer ${app.getVersion()} запущен (Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, ${process.platform})`
    )

    // F12 открывает DevTools только в разработке; Ctrl+R блокируется в готовой сборке.
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    applySessionSecurity()
    registerMediaProtocol()
    registerIpcHandlers()

    // Проект из командной строки: в разработке первые аргументы — сам electron и путь к приложению.
    const launchPath = await pickProjectArg(process.argv.slice(1), process.cwd())
    if (launchPath) {
      trustPath(launchPath)
      setLaunchPath(launchPath)
    }
    mainWindow = createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
