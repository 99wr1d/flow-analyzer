// Слежение за игроком: действия интерфейса. План → вопросы перед стартом → расчёт в main (IPC) → ключи рисунка одной
// записью истории. Отмена и Esc ничего не меняют в рисунке.
import type { Annotation } from '../../../../shared/annotations'
import { frameCenter } from '../../../../shared/annotations'
import type { FractionBox, TrackingDone } from '../../../../shared/tracking/trackingIpc'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { useFeedbackStore } from '../episodes/feedbackStore'
import { useCalibrationsStore } from '../pitch/calibrationsStore'
import { formatTime } from '../player/format'
import { getVideoElement, seekTo } from '../player/videoElement'
import {
  applyTrackResult,
  planSeconds,
  planTracking,
  stopMessage,
  type PlanFailure,
  type TrackPlan
} from './trackingApply'
import { useTrackingStore } from './trackingStore'

/** Предупреждение «это займёт около N с», если расчёт дольше этого (секунды). */
export const LONG_SECONDS = 60
/** Сколько показывать длинные сообщения слежения, мс. */
const LONG_TOAST_MS = 9000

const warn = (text: string, ms?: number): void =>
  useFeedbackStore.getState().show({ text, kind: 'warn', ...(ms ? { ms } : {}) })

export const FAILURE_TEXT: Record<PlanFailure, string> = {
  'not-trackable': ru.tracking.needRange,
  outside: ru.tracking.outside,
  'too-short': ru.tracking.tooShort,
  'no-calibration': ru.tracking.noCalibration
}

/** Середина кадра, на котором стоит видео. */
function currentFrame(): number {
  const { currentTime, fps } = usePlayerStore.getState()
  return frameCenter(getVideoElement()?.currentTime ?? currentTime, fps)
}

/** План слежения для рисунка на текущем кадре (для кнопки и для старта). */
export function planFor(a: Annotation): ReturnType<typeof planTracking> {
  const { fps, duration } = usePlayerStore.getState()
  const calibration =
    a.space === 'pitch'
      ? (useCalibrationsStore.getState().items.find((c) => c.id === a.calibrationId) ?? null)
      : null
  return planTracking(a, { now: currentFrame(), fps, videoDuration: duration, calibration })
}

// --- Подтверждения перед стартом ---

let confirmResolver: ((ok: boolean) => void) | null = null

function confirmOnce(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmResolver = resolve
    useTrackingStore.getState().askConfirm(text)
  })
}

/** Ответ на вопрос перед стартом (кнопки «Продолжить» / «Отмена»). */
export function answerConfirm(ok: boolean): void {
  const resolve = confirmResolver
  confirmResolver = null
  resolve?.(ok)
}

// --- Расчёт ---

type StartFailure = Extract<TrackingDone, { error: 'no-player' | 'ambiguous-start' }>

type JobEnd =
  { kind: 'done'; done: TrackingDone } | { kind: 'cancelled' } | { kind: 'error'; message: string }

interface Running {
  jobId: string | null
  finish: (end: JobEnd) => void
  /** Ответ на вопрос «Кто из них ваш?»: индекс или null (отмена). */
  answerPick: ((index: number | null) => void) | null
  cancelled: boolean
}

let running: Running | null = null

/** Идёт ли сейчас расчёт или вопрос (для Esc и кнопок). */
export const isTrackingActive = (): boolean => useTrackingStore.getState().phase !== 'idle'

/** Отмена слежения на любой стадии: ничего не меняет в рисунке. */
export async function cancelTrackingNow(): Promise<void> {
  const state = useTrackingStore.getState()
  if (state.phase === 'idle') return
  if (state.phase === 'confirm') {
    answerConfirm(false)
    return
  }
  const job = running
  if (!job || job.cancelled) return
  job.cancelled = true
  state.setCancelling()
  job.answerPick?.(null)
  // Идентификатор задачи приходит ответом на запуск; если его ещё нет, отмену довершит запуск.
  if (job.jobId) {
    try {
      await window.api.cancelTracking(job.jobId)
    } catch {
      /* задача уже закончилась — нечего отменять */
    }
    job.finish({ kind: 'cancelled' })
  }
}

/** Щелчок по игроку в вопросе «Кто из них ваш?». */
export function answerPick(index: number): void {
  running?.answerPick?.(index)
}

function runJob(plan: TrackPlan, videoId: string, pick?: FractionBox): Promise<JobEnd> {
  return new Promise<JobEnd>((resolve) => {
    const store = useTrackingStore.getState()
    const job: Running = {
      jobId: null,
      finish: () => undefined,
      answerPick: null,
      cancelled: false
    }
    const offs: Array<() => void> = []
    let ended = false
    job.finish = (end) => {
      if (ended) return
      ended = true
      offs.forEach((off) => off())
      running = null
      resolve(end)
    }
    running = job
    // События приходят по идентификатору задачи, который известен только после ответа на запуск: до этого
    // события складываются в очередь (запоздавшее событие отменённой задачи не достанется новой).
    type Ev =
      | { kind: 'progress'; p: { jobId: string; done: number; total: number } }
      | { kind: 'ask'; ask: Parameters<Parameters<typeof window.api.onTrackingAsk>[0]>[0] }
      | { kind: 'done'; done: TrackingDone }
    const queue: Ev[] = []
    const handle = (ev: Ev): void => {
      if (ev.kind === 'progress') {
        if (ev.p.jobId === job.jobId) store.setProgress(ev.p.done, ev.p.total)
      } else if (ev.kind === 'ask') {
        const ask = ev.ask
        if (ask.jobId !== job.jobId || job.cancelled) return
        // Рамки лежат на кадре вопроса: показываем именно его.
        seekTo(ask.t)
        job.answerPick = (index) => {
          job.answerPick = null
          useTrackingStore.getState().setPick(null)
          if (index === null) return
          void window.api.resolveTracking(ask.jobId, index).catch(() => undefined)
        }
        useTrackingStore.getState().setPick({ candidates: ask.candidates })
      } else if (ev.done.jobId === job.jobId) {
        job.finish({ kind: 'done', done: ev.done })
      }
    }
    const feed = (ev: Ev): void => {
      if (job.jobId === null) queue.push(ev)
      else handle(ev)
    }
    offs.push(
      window.api.onTrackingProgress((p) => feed({ kind: 'progress', p })),
      window.api.onTrackingAsk((ask) => feed({ kind: 'ask', ask })),
      window.api.onTrackingDone((done) => feed({ kind: 'done', done }))
    )
    store.startRunning()
    window.api
      .startTracking({
        videoId,
        from: plan.from,
        to: plan.to,
        anchor: plan.anchor,
        ...(pick ? { pick } : {})
      })
      .then((r) => {
        job.jobId = r.jobId
        queue.splice(0).forEach(handle)
        // Отмену нажали, пока запуск ещё не вернул идентификатор.
        if (job.cancelled) {
          void window.api
            .cancelTracking(r.jobId)
            .catch(() => undefined)
            .then(() => job.finish({ kind: 'cancelled' }))
        }
      })
      .catch((error: unknown) => {
        job.finish({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      })
  })
}

/** Ждёт щелчка по одной из рамок на стартовом кадре (ambiguous-start). */
function waitStartPick(done: StartFailure, plan: TrackPlan): Promise<number | null> {
  return new Promise((resolve) => {
    const store = useTrackingStore.getState()
    const job: Running = {
      jobId: null,
      finish: () => undefined,
      cancelled: false,
      answerPick: (index) => {
        running = null
        useTrackingStore.getState().setPick(null)
        resolve(index)
      }
    }
    running = job
    seekTo(plan.at)
    store.setPick({ candidates: done.candidates ?? [] })
  })
}

// --- Применение ---

function videoAspect(): number {
  const el = getVideoElement()
  return el && el.videoWidth > 0 && el.videoHeight > 0 ? el.videoWidth / el.videoHeight : 16 / 9
}

function applySuccess(
  annotationId: string,
  plan: TrackPlan,
  done: Extract<TrackingDone, { samples: unknown }>
): void {
  const store = useAnnotationsStore.getState()
  const current = store.items.find((a) => a.id === annotationId)
  if (!current) return
  const { fps } = usePlayerStore.getState()
  const result = applyTrackResult(current, done.samples, plan, { fps, aspect: videoAspect() })
  const stop = done.stop ? stopMessage(done.stop) : null
  if (!result.ok) {
    if (result.reason === 'diverged' && result.diverged) {
      warn(ru.tracking.diverged(formatTime(result.diverged.t, { tenths: true })), LONG_TOAST_MS)
    } else if (result.reason === 'too-many') {
      warn(ru.tracking.tooMany)
    } else {
      warn(stop ?? ru.tracking.nothing, stop ? LONG_TOAST_MS : undefined)
    }
    return
  }
  // Одна запись в истории: ключи и перевод «поле → экран» отменяются вместе.
  store.replaceAnnotation(annotationId, result.annotation)
  store.select(annotationId)
  const parts: string[] = []
  if (stop) parts.push(stop)
  else if (result.diverged)
    parts.push(ru.tracking.diverged(formatTime(result.diverged.t, { tenths: true })))
  if (plan.convertedFromPitch) parts.push(ru.tracking.pitchToScreen)
  if (parts.length > 0) warn(parts.join(' '), LONG_TOAST_MS)
  else useFeedbackStore.getState().show({ text: ru.tracking.done, kind: 'info', color: '#2bd67b' })
}

/**
 * «Следить за игроком» (или «Продолжить слежение»): от текущего кадра до конца отрезка рисунка, либо от последнего
 * ключа, если отрезок растянут дальше него. Перед стартом — вопросы про долгий расчёт и про замену ручных ключей.
 */
export async function startTracking(annotationId: string): Promise<void> {
  if (useTrackingStore.getState().phase !== 'idle') return
  const player = usePlayerStore.getState()
  const source = player.source
  const annotation = useAnnotationsStore.getState().items.find((a) => a.id === annotationId)
  if (!source || !annotation || player.status !== 'ready') return
  const plan = planFor(annotation)
  if (!plan.ok) {
    warn(FAILURE_TEXT[plan.reason])
    return
  }
  const store = useTrackingStore.getState()
  store.enter(annotationId)
  try {
    getVideoElement()?.pause()
    const seconds = planSeconds(plan, player.fps)
    if (seconds > LONG_SECONDS && !(await confirmOnce(ru.tracking.longWarning(seconds)))) return
    if (plan.replaceCount > 0 && !(await confirmOnce(ru.tracking.replaceManual(plan.replaceCount))))
      return

    let end = await runJob(plan, source.id)
    if (end.kind === 'done' && 'error' in end.done && end.done.error === 'ambiguous-start') {
      const index = await waitStartPick(end.done, plan)
      const box = index === null ? undefined : end.done.candidates?.[index]
      if (!box) return
      useTrackingStore.getState().startRunning()
      end = await runJob(plan, source.id, box)
      if (end.kind === 'done' && 'error' in end.done && end.done.error === 'ambiguous-start') {
        warn(ru.tracking.pickFailed, LONG_TOAST_MS)
        return
      }
    }
    if (end.kind === 'cancelled') return
    if (end.kind === 'error') {
      warn(ru.tracking.failed(end.message), LONG_TOAST_MS)
      return
    }
    const done = end.done
    if ('error' in done) {
      if (done.error === 'no-player') warn(ru.tracking.noPlayer, LONG_TOAST_MS)
      else if (done.error === 'failed') warn(ru.tracking.failed(done.message), LONG_TOAST_MS)
      else warn(ru.tracking.pickFailed, LONG_TOAST_MS)
      return
    }
    applySuccess(annotationId, plan, done)
  } finally {
    running = null
    confirmResolver = null
    useTrackingStore.getState().leave()
    // Вопрос «Кто из них ваш?» мог увести кадр: возвращаемся к месту, откуда начинали.
    seekTo(plan.at)
  }
}
