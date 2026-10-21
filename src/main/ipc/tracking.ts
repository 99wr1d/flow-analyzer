// IPC слежения за игроком: запуск, вопрос «Кто из них ваш?», отмена. Одна задача одновременно.
// Ход работы и итог уходят интерфейсу событиями; отменённая задача итога не присылает.
import { app, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { readFile, stat } from 'fs/promises'
import { IPC_CHANNELS, IPC_EVENTS, type IpcResult } from '../../shared/ipc-contract'
import {
  TrackingCancelSchema,
  TrackingResolveSchema,
  TrackingStartSchema,
  type FractionBox,
  type TrackingDone
} from '../../shared/tracking/trackingIpc'
import { getFfmpegPath } from '../ffmpeg/path'
import { killAllFfmpeg } from '../ffmpeg/runner'
import { logError, logInfo } from '../log/logger'
import { getMediaEntry } from '../media/registry'
import { MEDIA_ERRORS, checkMediaId } from '../media/validate'
import { isTrustedSender } from '../security'
import { testFlags } from '../testFlags'
import { createDetector } from '../tracking/detectorWindow'
import { decodeFrames } from '../tracking/frames'
import { runTrackingJob } from '../tracking/job'
import {
  DEFAULT_STUB_PATTERN,
  createStubDetector,
  loadStubPattern,
  type StubPattern
} from '../tracking/stubDetector'

export const TRACKING_IPC_ERRORS = {
  busy: 'Слежение уже идёт. Дождитесь окончания или отмените его',
  badRequest: 'Некорректный запрос на слежение',
  videoGone: 'Видеофайл не найден — возможно, его переместили или удалили',
  unknownJob: 'Задача слежения не найдена',
  badAnswer: 'Нет такого игрока среди вариантов'
} as const

/** Не чаще раза в столько мс отправляем интерфейсу ход работы (последнее значение — всегда). */
const PROGRESS_INTERVAL_MS = 100
/** Сколько ждём остановки задачи после отмены, прежде чем ответить интерфейсу. */
const CANCEL_WAIT_MS = 5000

interface ActiveJob {
  id: string
  controller: AbortController
  done: Promise<void>
  /** Ждущий ответа вопрос: сколько вариантов и как его завершить. */
  asking: { count: number; answer: (index: number | null) => void } | null
}

let active: ActiveJob | null = null

const OK: IpcResult<void> = { ok: true, data: undefined }

/**
 * Останавливает слежение (если идёт): ffmpeg этой задачи (по сигналу), окно-детектор и ожидание ответа. Чужие ffmpeg
 * (экспорт, миниатюры) не трогаются. Возвращает, когда всё остановлено.
 */
export async function cancelActiveTracking(): Promise<void> {
  const job = active
  if (!job) return
  job.controller.abort()
  job.asking?.answer(null)
  await Promise.race([job.done, new Promise((r) => setTimeout(r, CANCEL_WAIT_MS))])
}

async function stubPattern(): Promise<StubPattern> {
  const file = testFlags().detectorStubPattern
  return file ? loadStubPattern(await readFile(file, 'utf8')) : DEFAULT_STUB_PATTERN
}

async function startTracking(
  event: Electron.IpcMainInvokeEvent,
  raw: unknown
): Promise<IpcResult<{ jobId: string }>> {
  try {
    if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
    if (active) return { ok: false, error: TRACKING_IPC_ERRORS.busy }
    const parsed = TrackingStartSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: TRACKING_IPC_ERRORS.badRequest }
    const request = parsed.data
    const problem = checkMediaId(request.videoId)
    if (problem) return { ok: false, error: problem }
    const entry = getMediaEntry(request.videoId)
    if (!entry) return { ok: false, error: MEDIA_ERRORS.unknownId }
    try {
      if (!(await stat(entry.path)).isFile()) throw new Error('not a file')
    } catch {
      return { ok: false, error: TRACKING_IPC_ERRORS.videoGone }
    }
    const ffmpeg = getFfmpegPath()
    if (!ffmpeg.ok) return { ok: false, error: ffmpeg.error }
    // Пока читали файл, другой запрос мог занять место.
    if (active) return { ok: false, error: TRACKING_IPC_ERRORS.busy }

    // Место занимаем сразу: пока читаем сценарий и частоту кадров, второй запрос не пройдёт.
    const controller = new AbortController()
    const job: ActiveJob = {
      id: randomUUID(),
      controller,
      done: Promise.resolve(),
      asking: null
    }
    active = job
    const flags = testFlags()
    let pattern: StubPattern | null
    try {
      pattern = flags.detectorStub ? await stubPattern() : null
    } catch (error) {
      active = null
      throw error
    }
    const sender = event.sender
    // Страница, с которой запускали, ушла (закрыта, перезагружена, упала): задача ей больше не нужна и отвечать некому.
    const onGone = (): void => void cancelActiveTracking()
    const onNavigate = (details: { isMainFrame?: boolean; isSameDocument?: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) onGone()
    }
    sender.on('did-start-navigation', onNavigate)
    sender.on('render-process-gone', onGone)
    sender.on('destroyed', onGone)
    const release = (): void => {
      if (sender.isDestroyed()) return
      sender.off('did-start-navigation', onNavigate)
      sender.off('render-process-gone', onGone)
      sender.off('destroyed', onGone)
    }
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }
    let lastProgress = 0
    const run = async (): Promise<void> => {
      let final: TrackingDone | null = null
      try {
        const outcome = await runTrackingJob({
          from: request.from,
          to: request.to,
          anchor: request.anchor,
          ...(request.pick ? { pick: request.pick } : {}),
          signal: controller.signal,
          frames: decodeFrames({
            videoPath: entry.path,
            from: request.from,
            to: request.to,
            signal: controller.signal
          }),
          createDetector: (signal) =>
            pattern
              ? Promise.resolve(createStubDetector({ pattern, delayMs: flags.detectorStubDelayMs }))
              : createDetector(signal),
          onProgress: (done, total) => {
            const now = Date.now()
            if (done < total && now - lastProgress < PROGRESS_INTERVAL_MS) return
            lastProgress = now
            send(IPC_EVENTS.trackingProgress, { jobId: job.id, done, total })
          },
          onAsk: (t, candidates: FractionBox[]) =>
            new Promise<number | null>((resolve) => {
              if (controller.signal.aborted) return resolve(null)
              job.asking = {
                count: candidates.length,
                answer: (index) => {
                  job.asking = null
                  resolve(index)
                }
              }
              send(IPC_EVENTS.trackingAsk, { jobId: job.id, t, candidates })
            })
        })
        if (outcome.kind === 'done') {
          final = {
            jobId: job.id,
            samples: outcome.samples,
            stop: outcome.stop,
            backend: outcome.backend
          }
        } else if (outcome.kind === 'failed') {
          final = {
            jobId: job.id,
            error: outcome.error,
            ...(outcome.candidates ? { candidates: outcome.candidates } : {})
          }
        }
      } catch (error) {
        logError('tracking', error)
        if (!controller.signal.aborted) {
          final = {
            jobId: job.id,
            error: 'failed',
            message: error instanceof Error ? error.message : 'Не удалось выполнить слежение'
          }
        }
      } finally {
        active = null
        release()
      }
      // Отменённая задача итога не присылает.
      if (final && !controller.signal.aborted) send(IPC_EVENTS.trackingDone, final)
    }
    logInfo('tracking', `слежение ${job.id}: ${request.from.toFixed(2)}–${request.to.toFixed(2)} с`)
    job.done = run()
    return { ok: true, data: { jobId: job.id } }
  } catch (error) {
    logError('tracking', error)
    return { ok: false, error: TRACKING_IPC_ERRORS.badRequest }
  }
}

export function registerTrackingHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.trackingStart, startTracking)

  ipcMain.handle(IPC_CHANNELS.trackingResolve, (event, raw: unknown): IpcResult<void> => {
    if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
    const parsed = TrackingResolveSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: TRACKING_IPC_ERRORS.badRequest }
    const job = active
    if (!job || job.id !== parsed.data.jobId || !job.asking) {
      return { ok: false, error: TRACKING_IPC_ERRORS.unknownJob }
    }
    if (parsed.data.index >= job.asking.count) {
      return { ok: false, error: TRACKING_IPC_ERRORS.badAnswer }
    }
    job.asking.answer(parsed.data.index)
    return OK
  })

  ipcMain.handle(
    IPC_CHANNELS.trackingCancel,
    async (event, raw: unknown): Promise<IpcResult<void>> => {
      if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
      const parsed = TrackingCancelSchema.safeParse(raw)
      if (!parsed.success) return { ok: false, error: TRACKING_IPC_ERRORS.badRequest }
      // Задача могла уже закончиться — это не ошибка. Ответ приходит, когда ffmpeg и окно-детектор остановлены.
      if (active && active.id === parsed.data.jobId) await cancelActiveTracking()
      return OK
    }
  )

  // Выход из приложения во время слежения: останавливаем ffmpeg, окно-детектор закроется вместе с отменой.
  app.on('before-quit', () => {
    if (!active) return
    active.controller.abort()
    active.asking?.answer(null)
    killAllFfmpeg()
  })
}
