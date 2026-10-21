// Слежение за игроком: скрытое окно-детектор (onnxruntime-web + D-FINE-S) и обёртка над ним для главного процесса.
// Окно без Node и без сети; модель получает байтами отсюда. Окно не показывается и фокус не забирает; close() его уничтожает.
import { app, BrowserWindow, ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import {
  DETECTOR_CHANNELS as CH,
  type DetectRequest,
  type DetectorBackend,
  type DetectorInit
} from '../../shared/tracking/detectorIpc'
import { readySchema, resultSchema } from '../../shared/tracking/detectorSchemas'
import type { Box, Detection } from '../../shared/tracking/types'
import { logError, logInfo, logWarn } from '../log/logger'
import {
  DETECTOR_PARTITION,
  DETECTOR_URL,
  detectorRoot,
  isolateDevServer,
  serveDetectorScheme
} from './detectorScheme'
import { testFlags } from '../testFlags'

export const MODEL_FILE = 'dfine_s_coco.onnx'
/** Создание сессии (чтение модели, компиляция шейдеров WebGPU) — не дольше этого. */
/** Меньшие кадры сети не подаются (нет смысла, и вход должен быть не пуст). */
const MIN_FRAME_SIDE = 32
const READY_TIMEOUT_MS = 120_000

export interface DetectorFrame {
  /** RGBA, width×height×4 байт. */
  rgba: Uint8Array
  width: number
  height: number
  /** Номер и время кадра в видео: окно-детектор их не использует, заглушка тестов — да. */
  index?: number
  t?: number
}

export interface DetectOutput {
  detections: Detection[]
  /** Гистограмма всего кадра для смены плана. */
  frameHist: Float32Array
}

export interface Detector {
  backend: DetectorBackend
  /**
   * Люди в кадре: на целом кадре (roi не задан) или в вырезе 640×384 вокруг roi (координаты — всегда в системе кадра).
   * Запросы выполняются по очереди.
   */
  detect(frame: DetectorFrame, roi?: Box): Promise<DetectOutput>
  close(): void
}

/** Где лежит модель: рядом с программой (extraResources) в установленной версии, в resources/models при разработке. */
export function modelPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'models', MODEL_FILE)
    : join(app.getAppPath(), 'resources', 'models', MODEL_FILE)
}

interface Pending {
  resolve: (r: DetectOutput) => void
  reject: (e: Error) => void
}

export async function createDetector(): Promise<Detector> {
  const model = await readFile(modelPath()).catch(() => {
    throw new Error(
      'Не найдена модель распознавания игроков. Переустановите FlowAnalyzer (или выполните npm run models).'
    )
  })

  const win = new BrowserWindow({
    show: false,
    focusable: false,
    skipTaskbar: true,
    width: 320,
    height: 240,
    webPreferences: {
      preload: join(__dirname, '../preload/detector.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Своя временная сессия: настройки безопасности окна не задевают основное.
      partition: DETECTOR_PARTITION,
      // Скрытое окно иначе притормаживается: расчёт должен идти на полной скорости.
      backgroundThrottling: false
    }
  })
  win.removeMenu()
  const wc = win.webContents
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const devServer = is.dev && devUrl
  try {
    if (devServer) isolateDevServer(wc.session)
    else serveDetectorScheme(wc.session, detectorRoot(__dirname))
  } catch (error) {
    win.destroy()
    throw error
  }
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event) => event.preventDefault())
  // Окно сети не использует (CSP: connect-src 'self'), разрешений у него нет.
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  wc.session.setPermissionCheckHandler(() => false)

  const pending = new Map<number, Pending>()
  let nextId = 1
  let closed = false
  let failure: Error | null = null

  let resolveReady!: (backend: DetectorBackend) => void
  let rejectReady!: (e: Error) => void
  const ready = new Promise<DetectorBackend>((res, rej) => {
    resolveReady = res
    rejectReady = rej
  })
  // Если окно закрыли раньше, чем оно успело ответить, отказ не должен считаться необработанным.
  ready.catch(() => undefined)

  const fail = (error: Error): void => {
    failure ??= error
    rejectReady(error)
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  }

  const own = (event: Electron.IpcMainEvent): boolean => !closed && event.sender === wc

  const onHello = (event: Electron.IpcMainEvent): void => {
    if (!own(event)) return
    const init: DetectorInit = { model, backend: testFlags().detectorBackend }
    wc.send(CH.init, init)
  }
  const onReady = (event: Electron.IpcMainEvent, payload: unknown): void => {
    if (!own(event)) return
    const parsed = readySchema.safeParse(payload)
    if (!parsed.success) return rejectReady(new Error('Окно-детектор прислало непонятный ответ'))
    if (parsed.data.ok) resolveReady(parsed.data.backend)
    else rejectReady(new Error(`Детектор не запустился: ${parsed.data.error}`))
  }
  const onResult = (event: Electron.IpcMainEvent, payload: unknown): void => {
    if (!own(event)) return
    const parsed = resultSchema.safeParse(payload)
    if (!parsed.success) return fail(new Error('Окно-детектор прислало непонятный результат'))
    const entry = pending.get(parsed.data.id)
    if (!entry) return
    pending.delete(parsed.data.id)
    if (parsed.data.ok) {
      entry.resolve({ detections: parsed.data.detections, frameHist: parsed.data.frameHist })
    } else {
      entry.reject(new Error(`Детектор: ${parsed.data.error}`))
    }
  }
  ipcMain.on(CH.hello, onHello)
  ipcMain.on(CH.ready, onReady)
  ipcMain.on(CH.result, onResult)

  const dispose = (): void => {
    ipcMain.off(CH.hello, onHello)
    ipcMain.off(CH.ready, onReady)
    ipcMain.off(CH.result, onResult)
  }
  const close = (): void => {
    if (closed) return
    closed = true
    dispose()
    fail(new Error('Детектор закрыт'))
    if (!win.isDestroyed()) win.destroy()
  }

  // Ошибки страницы детектора попадают в журнал приложения.
  wc.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') {
      logWarn('detector', `${event.level}: ${event.message}`)
      if (testFlags().detectorDebug) console.error('[detector page]', event.message)
    }
  })
  wc.on('render-process-gone', (_event, details) => {
    logError('detector', `окно-детектор завершилось: ${details.reason}`)
    fail(new Error('Окно-детектор неожиданно завершилось'))
  })
  wc.on('did-fail-load', (_event, code, description) =>
    fail(new Error(`Окно-детектор не загрузилось: ${description} (${code})`))
  )
  win.on('closed', () => {
    closed = true
    dispose()
    fail(new Error('Детектор закрыт'))
  })

  void win.loadURL(devServer ? `${devUrl}/detector.html` : DETECTOR_URL)

  const timer = setTimeout(
    () => fail(new Error('Детектор не запустился за отведённое время')),
    READY_TIMEOUT_MS
  )
  let backend: DetectorBackend
  try {
    backend = await ready
  } catch (error) {
    close()
    throw error
  } finally {
    clearTimeout(timer)
  }
  logInfo('detector', `детектор запущен, бэкенд: ${backend}`)

  return {
    backend,
    detect(frame, roi) {
      if (closed || failure) return Promise.reject(failure ?? new Error('Детектор закрыт'))
      if (
        !Number.isInteger(frame.width) ||
        !Number.isInteger(frame.height) ||
        frame.width < MIN_FRAME_SIDE ||
        frame.height < MIN_FRAME_SIDE ||
        frame.rgba.byteLength !== frame.width * frame.height * 4
      ) {
        return Promise.reject(
          new Error(
            `Кадр для детектора задан неверно: ${frame.width}×${frame.height}, байт ${frame.rgba.byteLength} (нужно ширина×высота×4, сторона не меньше ${MIN_FRAME_SIDE})`
          )
        )
      }
      const id = nextId++
      const request: DetectRequest = {
        id,
        rgba: frame.rgba,
        width: frame.width,
        height: frame.height,
        roi: roi ?? null
      }
      return new Promise<DetectOutput>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        wc.send(CH.detect, request)
      })
    },
    close
  }
}
