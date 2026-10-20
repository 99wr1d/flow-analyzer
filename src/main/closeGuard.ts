// Защита от случайной потери работы при закрытии окна.
// main не знает, есть ли несохранённое, поэтому спрашивает интерфейс; если тот не отвечает вовремя (завис или упал) — окно закрывается.
import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type IpcResult } from '../shared/ipc-contract'
import { bringToFront } from './bringToFront'
import { isTrustedSender } from './security'

/** Сколько ждать ответа интерфейса «есть ли несохранённое» (мс). Диалог пользователю на это время не влияет. */
export const CLOSE_REPLY_TIMEOUT_MS = 2500

type Phase = 'idle' | 'asking' | 'confirmed'
interface Guard {
  phase: Phase
  timer: NodeJS.Timeout | null
}

const guards = new WeakMap<BrowserWindow, Guard>()
let quitting = false

/** Выход из приложения (app.quit, завершение сеанса) не задерживается: несохранённое остаётся в копии работы. */
export function markQuitting(): void {
  quitting = true
}

export const isQuitting = (): boolean => quitting

function stopTimer(guard: Guard): void {
  if (guard.timer) clearTimeout(guard.timer)
  guard.timer = null
}

function closeNow(win: BrowserWindow, guard: Guard): void {
  stopTimer(guard)
  guard.phase = 'confirmed'
  if (!win.isDestroyed()) win.close()
}

export function installCloseGuard(win: BrowserWindow): void {
  const guard: Guard = { phase: 'idle', timer: null }
  guards.set(win, guard)

  win.on('close', (event) => {
    if (quitting || guard.phase === 'confirmed') return
    const contents = win.webContents
    if (contents.isDestroyed() || contents.isCrashed() || contents.isLoading()) return
    event.preventDefault()
    // Уже спрашиваем пользователя — просто показываем окно, а не задаём вопрос второй раз.
    if (guard.phase === 'asking') {
      bringToFront(win)
      return
    }
    guard.phase = 'asking'
    contents.send(IPC_EVENTS.closeRequested)
    guard.timer = setTimeout(() => closeNow(win, guard), CLOSE_REPLY_TIMEOUT_MS)
  })
}

function guardOf(event: Electron.IpcMainInvokeEvent): { win: BrowserWindow; guard: Guard } | null {
  if (!isTrustedSender(event)) return null
  const win = BrowserWindow.fromWebContents(event.sender)
  const guard = win ? guards.get(win) : undefined
  return win && guard ? { win, guard } : null
}

const OK: IpcResult<void> = { ok: true, data: undefined }

export function registerCloseHandlers(): void {
  // Интерфейс ответил, есть ли несохранённая работа. Нет — закрываем; да — ждём решения пользователя.
  ipcMain.handle(IPC_CHANNELS.appCloseResponse, (event, dirty: unknown): IpcResult<void> => {
    const found = guardOf(event)
    if (!found) return { ok: false, error: 'Недоверенный источник запроса' }
    if (found.guard.phase !== 'asking') return OK
    stopTimer(found.guard)
    if (dirty !== true) closeNow(found.win, found.guard)
    return OK
  })
  ipcMain.handle(IPC_CHANNELS.appConfirmClose, (event): IpcResult<void> => {
    const found = guardOf(event)
    if (!found) return { ok: false, error: 'Недоверенный источник запроса' }
    if (found.guard.phase === 'asking') closeNow(found.win, found.guard)
    return OK
  })
  ipcMain.handle(IPC_CHANNELS.appCancelClose, (event): IpcResult<void> => {
    const found = guardOf(event)
    if (!found) return { ok: false, error: 'Недоверенный источник запроса' }
    stopTimer(found.guard)
    if (found.guard.phase === 'asking') found.guard.phase = 'idle'
    return OK
  })
}
