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
import { geomAt } from '../../../../shared/animation'
import {
  anchorsOfGeom,
  applyTrackResult,
  footMarker,
  isLinkType,
  planSeconds,
  rememberBackend,
  planTracking,
  staleOtherPoints,
  startAskKind,
  stopMessage,
  type PlanFailure,
  type TrackPlan
} from './trackingApply'
import { useTrackingStore } from './trackingStore'
import { sendAnswer } from './answer'

/** Ответ тренера на вопрос «Кто из них ваш?»: номер рамки или «моего игрока тут нет». */
type PickAnswer = number | 'none'

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
  /** Ответ на вопрос «Кто из них ваш?»: рамка, «моего тут нет» или null (отмена). */
  answerPick: ((answer: PickAnswer | null) => void) | null
  cancelled: boolean
}

let running: Running | null = null

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

/** Щелчок по игроку в вопросе «Кто из них ваш?» либо кнопка «Моего игрока тут нет». */
export function answerPick(answer: PickAnswer): void {
  running?.answerPick?.(answer)
}

/** Где точка связки стоит на стартовом кадре (якорь): ею подсвечивается точка на картинке. Для одиночного слежения — null. */
function markerOf(plan: TrackPlan, target: number, t: number): { x: number; y: number } | null {
  if (!isLinkType(plan.base)) return null
  return anchorsOfGeom(plan.base, geomAt(plan.base, t))[target] ?? null
}

function runJob(
  plan: TrackPlan,
  videoId: string,
  picks: ReadonlyArray<FractionBox | null>
): Promise<JobEnd> {
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
        job.answerPick = (answer) => {
          job.answerPick = null
          useTrackingStore.getState().setPick(null)
          if (answer === null) return
          // Отклонённый ответ: задача отменяется и показывается обычное сообщение об ошибке слежения.
          void sendAnswer(window.api, ask.jobId, answer, ask.target).then((message) => {
            if (message !== null) job.finish({ kind: 'error', message })
          })
        }
        const link = isLinkType(plan.base)
        useTrackingStore.getState().setPick({
          candidates: ask.candidates,
          point: link ? ask.target : null,
          // Метка — у ног цели на кадре вопроса (текущая рамка из задачи), а не там, где связка нарисована до слежения.
          marker: link ? footMarker(ask.current) : null
        })
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
        anchors: plan.anchors,
        ...(picks.some((p) => p !== null) ? { picks: [...picks] } : {})
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
function waitStartPick(done: StartFailure, plan: TrackPlan): Promise<PickAnswer | null> {
  return new Promise((resolve) => {
    const store = useTrackingStore.getState()
    const job: Running = {
      jobId: null,
      finish: () => undefined,
      cancelled: false,
      answerPick: (answer) => {
        running = null
        useTrackingStore.getState().setPick(null)
        resolve(answer)
      }
    }
    running = job
    seekTo(plan.at)
    const link = isLinkType(plan.base)
    store.setPick({
      candidates: done.candidates ?? [],
      point: link ? done.target : null,
      marker: markerOf(plan, done.target, plan.at)
    })
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
  const link = isLinkType(plan.base)
  const result = applyTrackResult(current, done.samples, plan, { fps, aspect: videoAspect() })
  const stop = done.stop ? stopMessage(done.stop, link) : null
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
  if (plan.convertedFromPitch)
    parts.push(link ? ru.tracking.pitchToScreenLink : ru.tracking.pitchToScreen)
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
  const link = isLinkType(annotation)
  store.enter(annotationId, link)
  // Расчёт привязан к этому видео и этому рисунку: смена видео или проекта отменяет его молча (вопрос «Кто из них ваш?»
  // и кадры относятся к прежнему видео), правка или удаление рисунка — с сообщением. Ничего не применяется и не рисуется.
  let edited = false
  const sourceId = source.id
  const sameSource = (): boolean => usePlayerStore.getState().source?.id === sourceId
  const unwatch = [
    usePlayerStore.subscribe((s) => {
      if (s.source?.id !== sourceId) void cancelTrackingNow()
    }),
    useAnnotationsStore.subscribe((s) => {
      if (edited || s.items.find((a) => a.id === annotationId) === annotation) return
      edited = true
      void cancelTrackingNow()
    })
  ]
  try {
    getVideoElement()?.pause()
    const seconds = planSeconds(plan, player.fps)
    if (seconds > LONG_SECONDS && !(await confirmOnce(ru.tracking.longWarning(seconds)))) return
    if (
      plan.mode === 'continue' &&
      staleOtherPoints(plan.base, player.fps) &&
      !(await confirmOnce(ru.tracking.checkOthers))
    )
      return
    if (plan.replaceCount > 0 && !(await confirmOnce(ru.tracking.replaceManual(plan.replaceCount))))
      return

    // Рамки, выбранные тренером по целям. Каждая неоднозначная цель спрашивается отдельно (по одному вопросу на запуск).
    const picks: Array<FractionBox | null> = plan.anchors.map(() => null)
    let end = await runJob(plan, source.id, picks)
    for (let round = 0; round <= plan.anchors.length; round += 1) {
      if (!(end.kind === 'done' && 'error' in end.done && end.done.error === 'ambiguous-start'))
        break
      const failure = end.done
      const target = failure.target
      if (startAskKind(failure) === 'same-player') {
        // Две точки связки стоят на одном игроке — выбирать нечего.
        warn(
          failure.other === undefined
            ? ru.tracking.samePlayer(target + 1)
            : ru.tracking.samePlayerPoints(failure.other + 1, target + 1),
          LONG_TOAST_MS
        )
        return
      }
      // Эта цель уже отвечена, а старт опять неоднозначен: дальше спрашивать бесполезно.
      if (picks[target] !== null) {
        warn(link ? ru.tracking.pickFailedPoint(target + 1) : ru.tracking.pickFailed, LONG_TOAST_MS)
        return
      }
      const answer = await waitStartPick(failure, plan)
      if (answer === null) return
      if (answer === 'none') {
        warn(
          link ? ru.tracking.noPlayerStartPoint(target + 1) : ru.tracking.noPlayerStart,
          LONG_TOAST_MS
        )
        return
      }
      const box = failure.candidates?.[answer]
      if (!box) return
      picks[target] = box
      useTrackingStore.getState().startRunning()
      end = await runJob(plan, source.id, picks)
    }
    if (end.kind === 'cancelled') {
      if (edited && sameSource()) warn(ru.tracking.edited, LONG_TOAST_MS)
      return
    }
    if (!sameSource() || edited) {
      if (edited && sameSource()) warn(ru.tracking.edited, LONG_TOAST_MS)
      return
    }
    if (end.kind === 'error') {
      warn(ru.tracking.failed(end.message), LONG_TOAST_MS)
      return
    }
    const done = end.done
    if ('error' in done) {
      if (done.error === 'no-player')
        warn(
          link ? ru.tracking.noPlayerPoint(done.target + 1) : ru.tracking.noPlayer,
          LONG_TOAST_MS
        )
      else if (done.error === 'failed') warn(ru.tracking.failed(done.message), LONG_TOAST_MS)
      else
        warn(
          link ? ru.tracking.pickFailedPoint(done.target + 1) : ru.tracking.pickFailed,
          LONG_TOAST_MS
        )
      return
    }
    rememberBackend(done.backend)
    applySuccess(annotationId, plan, done)
  } finally {
    unwatch.forEach((off) => off())
    running = null
    confirmResolver = null
    useTrackingStore.getState().leave()
    // Вопрос «Кто из них ваш?» мог увести кадр: возвращаемся к месту, откуда начинали (но не на другом видео).
    if (sameSource()) seekTo(plan.at)
  }
}
