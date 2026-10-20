import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { existsSync, rmSync } from 'fs'
import { stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import {
  ExportRequestSchema,
  type ExportEncoderInfo,
  type ExportProgress,
  type ExportResult
} from '../../shared/export'
import { IPC_CHANNELS, IPC_EVENTS, type IpcResult } from '../../shared/ipc-contract'
import { probeEncoders } from '../ffmpeg/encoders'
import { ExportError, runExportJob } from '../ffmpeg/job'
import { compilationDefaultName } from '../ffmpeg/names'
import {
  disposeAllSync,
  disposePending,
  disposeStaged,
  holdStaged,
  stageFrames,
  stageOverlays,
  sweepStale,
  takeStaged,
  type Staged
} from '../ffmpeg/staging'
import { getFfmpegPath } from '../ffmpeg/path'
import { killAllFfmpeg } from '../ffmpeg/runner'
import { getMediaEntry } from '../media/registry'
import { MEDIA_ERRORS, checkMediaId } from '../media/validate'
import { logInfo } from '../log/logger'
import { isTrustedSender } from '../security'
import { testFlags } from '../testFlags'

export const EXPORT_IPC_ERRORS = {
  busy: 'Экспорт уже идёт. Дождитесь окончания или отмените его',
  badRequest: 'Некорректный запрос на экспорт',
  videoGone: 'Видеофайл не найден — возможно, его переместили или удалили',
  unknown: 'Не удалось выполнить экспорт',
  noOverlays: 'Рисунки для экспорта не найдены. Закройте окно экспорта и повторите'
} as const

interface ActiveJob {
  controller: AbortController
  done: Promise<unknown>
  part: string | null
}

let active: ActiveJob | null = null
/** Файлы последнего экспорта: только их можно показать в проводнике. */
let lastPaths: string[] = []

const OK: IpcResult<void> = { ok: true, data: undefined }

/** Диалог выбора места. null — пользователь отказался. */
async function chooseTarget(
  event: Electron.IpcMainInvokeEvent,
  mode: 'files' | 'compilation',
  videoPath: string,
  projectName: string | null
): Promise<string | null> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (mode === 'files') {
    const options: Electron.OpenDialogOptions = {
      title: 'Куда сохранить клипы',
      defaultPath: dirname(videoPath),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  }
  const stem = basename(videoPath, extname(videoPath))
  const options: Electron.SaveDialogOptions = {
    title: 'Сохранить подборку',
    defaultPath: join(dirname(videoPath), compilationDefaultName(projectName, stem)),
    filters: [{ name: 'Видео MP4', extensions: ['mp4'] }]
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : `${result.filePath}.mp4`
}

async function startExport(
  event: Electron.IpcMainInvokeEvent,
  raw: unknown
): Promise<IpcResult<ExportResult>> {
  try {
    if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
    if (active) return { ok: false, error: EXPORT_IPC_ERRORS.busy }

    const parsed = ExportRequestSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: EXPORT_IPC_ERRORS.badRequest }
    const request = parsed.data
    const problem = checkMediaId(request.videoId)
    if (problem) return { ok: false, error: problem }
    const entry = getMediaEntry(request.videoId)
    if (!entry) return { ok: false, error: MEDIA_ERRORS.unknownId }
    try {
      if (!(await stat(entry.path)).isFile()) throw new Error('not a file')
    } catch {
      return { ok: false, error: EXPORT_IPC_ERRORS.videoGone }
    }
    const ffmpeg = getFfmpegPath()
    if (!ffmpeg.ok) return { ok: false, error: ffmpeg.error }
    // Картинки с рисунками, загруженные заранее: забираем по билету. Удаляем их в любом исходе.
    let staged: Staged | null = null
    if (request.drawings) {
      staged = takeStaged(request.drawings.token)
      if (!staged) return { ok: false, error: EXPORT_IPC_ERRORS.noOverlays }
    }

    // Занимаем место сразу: пока открыт диалог выбора папки, второй запрос не пройдёт.
    const controller = new AbortController()
    const job: ActiveJob = { controller, done: Promise.resolve(), part: null }
    active = job
    try {
      const target = await chooseTarget(event, request.mode, entry.path, request.projectName)
      if (!target) {
        const result: ExportResult = {
          status: 'dialog-cancelled',
          mode: request.mode,
          total: 0,
          files: [],
          target: null,
          failures: [],
          elapsedMs: 0
        }
        return { ok: true, data: result }
      }
      const sender = event.sender
      const onProgress = (progress: ExportProgress): void => {
        if (!sender.isDestroyed()) sender.send(IPC_EVENTS.exportProgress, progress)
      }
      const run = runExportJob({
        ffmpegPath: ffmpeg.path,
        inputPath: entry.path,
        request,
        target,
        onProgress,
        overlays: staged ?? undefined,
        signal: controller.signal,
        log: (message) => logInfo('export', message),
        tuning: {
          fakeBrokenGpu: testFlags().gpuFail,
          ...(testFlags().exportChunkSeconds !== null
            ? { chunkSeconds: testFlags().exportChunkSeconds as number }
            : {})
        },
        onPartFile: (path) => {
          job.part = path
        }
      })
      job.done = run.catch(() => undefined)
      const { result, paths } = await run
      lastPaths = paths
      return { ok: true, data: result }
    } finally {
      active = null
      await disposeStaged(staged)
    }
  } catch (error) {
    if (error instanceof ExportError) return { ok: false, error: error.message }
    return { ok: false, error: EXPORT_IPC_ERRORS.unknown }
  }
}

export function registerExportHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.exportStart, startExport)

  // Картинки с рисунками приходят отдельно от запроса (двоичные данные, без base64) и ждут запуска экспорта.
  ipcMain.handle(
    IPC_CHANNELS.exportStageOverlays,
    async (event, raw: unknown): Promise<IpcResult<{ token: string }>> => {
      if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
      if (active) return { ok: false, error: EXPORT_IPC_ERRORS.busy }
      const result = await stageOverlays(raw)
      if (!result.ok) return { ok: false, error: result.error }
      await holdStaged(result.staged)
      return { ok: true, data: { token: result.staged.token } }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.exportStageFrames,
    async (event, raw: unknown): Promise<IpcResult<{ count: number }>> => {
      if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
      if (active) return { ok: false, error: EXPORT_IPC_ERRORS.busy }
      const result = await stageFrames(raw)
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, data: { count: result.count } }
    }
  )
  void sweepStale()

  // Каким кодером кодировать: проверка видеокарты делается один раз за запуск и запоминается.
  ipcMain.handle(
    IPC_CHANNELS.exportEncoders,
    async (event): Promise<IpcResult<ExportEncoderInfo>> => {
      if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
      const ffmpeg = getFfmpegPath()
      if (!ffmpeg.ok) return { ok: true, data: { gpuLabel: null } }
      const probe = await probeEncoders(ffmpeg.path, { fakeBrokenGpu: testFlags().gpuFail })
      if (probe.rejected.length > 0) {
        logInfo('export', `Кодеры видеокарты не прошли проверку: ${probe.rejected.join(', ')}`)
      }
      return { ok: true, data: { gpuLabel: probe.gpu?.label ?? null } }
    }
  )

  ipcMain.handle(IPC_CHANNELS.exportCancel, (event): IpcResult<void> => {
    if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
    if (active) active.controller.abort()
    else void disposePending()
    return OK
  })

  ipcMain.handle(IPC_CHANNELS.exportReveal, (event): IpcResult<void> => {
    if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
    // Показываем только то, что создал сам экспорт.
    const file = lastPaths.find((p) => existsSync(p))
    if (file) shell.showItemInFolder(file)
    return OK
  })

  // Выход из приложения во время экспорта: останавливаем ffmpeg и убираем недописанный файл.
  let quitting = false
  app.on('before-quit', (event) => {
    const job = active
    if (!job) {
      // Экспорта нет, но загруженные заранее картинки могли остаться.
      disposeAllSync()
      return
    }
    if (quitting) return
    quitting = true
    event.preventDefault()
    job.controller.abort()
    killAllFfmpeg()
    const finish = (): void => {
      if (job.part) rmSync(job.part, { force: true })
      disposeAllSync()
      app.quit()
    }
    // Ждём уборку, но не дольше нескольких секунд.
    void Promise.race([job.done, new Promise((r) => setTimeout(r, 4000))]).then(finish, finish)
  })
}
