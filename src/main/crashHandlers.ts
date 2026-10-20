// Сбои окна: интерфейс упал или завис. Пишем в журнал и предлагаем перезагрузить окно.
// Несохранённая работа автосохраняется отдельно (project/autosave), поэтому после перезагрузки программа предложит её восстановить.
import { BrowserWindow, app, dialog } from 'electron'
import { logError, logInfo, logWarn } from './log/logger'
import { isQuitting } from './closeGuard'

const CRASH_TEXT =
  'Окно программы аварийно закрылось. Нажмите «Перезагрузить окно»: если вы не успели сохранить работу, программа предложит восстановить её автоматическую копию.'
const HANG_TEXT =
  'Окно программы перестало отвечать. Возможно, идёт тяжёлая работа — тогда подождите. Если ничего не происходит, перезагрузите окно: автоматическая копия работы сохранится, и программа предложит её восстановить.'

async function ask(
  win: BrowserWindow,
  message: string,
  buttons: string[],
  title: string
): Promise<number> {
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      title,
      message: title,
      detail: message,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true
    })
    return result.response
  } catch (error) {
    logError('main', error, 'Не удалось показать окно сбоя')
    return buttons.length - 1
  }
}

function reload(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  logInfo('main', 'Окно перезагружено после сбоя')
  win.webContents.reload()
}

/** Подключает обработчики сбоев к окну. */
export function installCrashHandlers(win: BrowserWindow): void {
  const contents = win.webContents
  let asking = false

  contents.on('render-process-gone', (_event, details) => {
    logError(
      'main',
      new Error(`Процесс окна завершился: ${details.reason}, код ${details.exitCode}`)
    )
    if (isQuitting() || details.reason === 'clean-exit' || asking) return
    asking = true
    void ask(
      win,
      CRASH_TEXT,
      ['Перезагрузить окно', 'Закрыть программу'],
      'Окно закрылось из-за сбоя'
    )
      .then((choice) => {
        if (choice === 0) reload(win)
        else app.quit()
      })
      .finally(() => {
        asking = false
      })
  })

  contents.on('unresponsive', () => {
    logWarn('main', 'Окно перестало отвечать')
    if (isQuitting() || asking) return
    asking = true
    void ask(win, HANG_TEXT, ['Подождать', 'Перезагрузить окно'], 'Окно не отвечает')
      .then((choice) => {
        if (choice === 1) reload(win)
      })
      .finally(() => {
        asking = false
      })
  })

  contents.on('responsive', () => logInfo('main', 'Окно снова отвечает'))

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame)
      logError('main', new Error(`Не загрузился интерфейс (${code}): ${description}`), url)
  })
}

/** Ошибки самого main: в журнал, поведение Electron не меняется. */
export function installProcessLogging(): void {
  process.on('uncaughtExceptionMonitor', (error) =>
    logError('main', error, 'Необработанная ошибка')
  )
  process.on('unhandledRejection', (reason) =>
    logError('main', reason, 'Необработанное отклонение')
  )
  app.on('child-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') {
      logWarn('main', `Дочерний процесс ${details.type} завершился: ${details.reason}`)
    }
  })
}
