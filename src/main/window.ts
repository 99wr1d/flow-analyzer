import { BrowserWindow, session } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { isBackgroundWindow } from './bringToFront'
import { installCloseGuard } from './closeGuard'
import { isAppUrl } from './security'

const BACKGROUND = '#0E1014'

export function applySessionSecurity(): void {
  // Приложению не нужны разрешения (камера, микрофон, геолокация...) — отклоняем все.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}

// Для автотестов: окно открывается за пределами экрана, без фокуса и без кнопки
// на панели задач, чтобы не мешать работе за компьютером.
const backgroundWindow = isBackgroundWindow

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...(backgroundWindow ? { x: -20000, y: -20000, skipTaskbar: true } : {}),
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'FlowAnalyzer',
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: !backgroundWindow
    }
  })

  win.removeMenu()
  installCloseGuard(win)
  win.on('ready-to-show', () => (backgroundWindow ? win.showInactive() : win.show()))

  // Страница не может поменять заголовок окна: его задаёт только main (см. project/title.ts).
  win.on('page-title-updated', (event) => event.preventDefault())

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
