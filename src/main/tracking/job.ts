// Задача слежения: кадры из ffmpeg → детектор → трекер → отсчёты TrackSample. Без Electron: кадры и детектор подаются снаружи,
// поэтому в тестах работают заглушки. Здесь же — единственное место, где рамка трекера (пиксели кадра детектора)
// превращается в доли кадра.
import { iou, pickStart, SingleTracker } from '../../shared/tracking/tracker'
import type { TrackSample } from '../../shared/tracking/keys'
import type { FractionBox, StopReason } from '../../shared/tracking/trackingIpc'
import type { Box, Detection } from '../../shared/tracking/types'
import type { DecodedFrame } from './frames'
import type { Detector } from './detectorWindow'

/** Полный кадр показываем детектору раз в столько секунд; между ними — только вырез вокруг игрока. */
export const FULL_DETECT_SECONDS = 1.0
/** Насколько выбранная щелчком рамка должна совпадать с найденной на старте (IoU). */
const PICK_MIN_IOU = 0.5

export interface RunTrackingOptions {
  from: number
  to: number
  /** Щелчок пользователя, доли кадра. */
  anchor: { x: number; y: number }
  /** Рамка игрока, выбранная щелчком после ambiguous-start (доли кадра): ею разрешается неоднозначный старт. */
  pick?: FractionBox
  signal: AbortSignal
  /** Кадры отрезка (decodeFrames); частота кадров — та, что использовал декодер (frame.fps). Итерация начинается после запуска детектора; по выходу ffmpeg останавливается. */
  frames: AsyncIterable<DecodedFrame>
  /** Создание прерывается сигналом: при отмене окно-детектор уничтожается, обещание отклоняется. */
  createDetector: (signal: AbortSignal) => Promise<Detector>
  onProgress?: (done: number, total: number) => void
  /** Вопрос «Кто из них ваш?»: индекс выбранной рамки или null, если отменили. */
  onAsk: (t: number, candidates: FractionBox[]) => Promise<number | null>
}

export type TrackingOutcome =
  | {
      kind: 'done'
      samples: TrackSample[]
      stop: null | { t: number; reason: StopReason }
      backend: Detector['backend']
    }
  | { kind: 'failed'; error: 'no-player' | 'ambiguous-start'; candidates?: FractionBox[] }
  | { kind: 'cancelled' }

const toFraction = (b: Box, w: number, h: number): FractionBox => ({
  x: b.x / w,
  y: b.y / h,
  w: b.w / w,
  h: b.h / h
})

/** Рамка игрока в пикселях → отсчёт: ноги — середина нижней кромки, высота — высота рамки. */
export function boxToSample(box: Box, t: number, w: number, h: number): TrackSample {
  return { t, foot: { x: (box.x + box.w / 2) / w, y: (box.y + box.h) / h }, height: box.h / h }
}

export async function runTrackingJob(opts: RunTrackingOptions): Promise<TrackingOutcome> {
  const { signal } = opts
  if (signal.aborted) return { kind: 'cancelled' }
  // Частота кадров приходит с кадрами (её определил ffmpeg): один источник для трекера, расписания и хода работы.
  let total = 1
  let fullEvery = 1
  let detector: Detector | null = null
  let iterator: AsyncIterator<DecodedFrame> | null = null
  try {
    detector = await opts.createDetector(signal)
    if (signal.aborted) return { kind: 'cancelled' }
    iterator = opts.frames[Symbol.asyncIterator]()

    const samples: TrackSample[] = []
    let tracker: SingleTracker | null = null
    let coasting = false
    let forceFull = false
    let ordinal = 0
    // Последний уверенный (не «пережидаемый») отсчёт: при потере всё после него — догадки по прогнозу.
    let lastGood: { len: number; t: number } | null = null

    for (;;) {
      const next = await iterator.next()
      if (signal.aborted) return { kind: 'cancelled' }
      if (next.done) break
      const frame = next.value
      const fw = frame.width
      const fh = frame.height
      const fps = frame.fps
      if (tracker === null) {
        total = Math.max(1, Math.round((opts.to - opts.from) * fps))
        fullEvery = Math.max(1, Math.round(FULL_DETECT_SECONDS * fps))
      }

      // Целый кадр: старт, после вопроса, пока игрок «пережидается» (иначе вернувшегося вне выреза не найти; не дольше
      // COAST/LOST_SECONDS подряд) и раз в секунду. Иначе — вырез вокруг прогноза трекера на этот кадр.
      const needFull = tracker === null || forceFull || coasting || ordinal % fullEvery === 0
      forceFull = false
      const roi = needFull || !tracker ? undefined : tracker.predictBox(frame.index)
      const out = await detector.detect(
        { rgba: frame.rgba, width: fw, height: fh, index: frame.index, t: frame.t },
        roi
      )
      if (signal.aborted) return { kind: 'cancelled' }

      if (tracker === null) {
        const pick = pickStart(out.detections, { x: opts.anchor.x * fw, y: opts.anchor.y * fh })
        if (pick.kind === 'none') return { kind: 'failed', error: 'no-player' }
        let start: Detection | null = pick.kind === 'ok' ? pick.det : null
        let dirty = false
        if (pick.kind === 'ambiguous' && opts.pick) {
          // Тренер уже выбрал рамку из вариантов: берём найденную рамку, что на неё больше всего похожа.
          const want: Box = {
            x: opts.pick.x * fw,
            y: opts.pick.y * fh,
            w: opts.pick.w * fw,
            h: opts.pick.h * fh
          }
          let best = 0
          for (const d of out.detections) {
            const v = iou(d.box, want)
            if (v > best) {
              best = v
              start = d
            }
          }
          // Рядом стоит другой игрок: приметы рамки «грязные», трекер их не запоминает.
          if (best >= PICK_MIN_IOU) dirty = true
          else start = null
        }
        if (!start && pick.kind === 'ambiguous') {
          return {
            kind: 'failed',
            error: 'ambiguous-start',
            candidates: pick.candidates.map((d) => toFraction(d.box, fw, fh))
          }
        }
        if (!start) throw new Error('Не удалось определить игрока на старте')
        tracker = new SingleTracker(start, fps, {
          frame: { w: fw, h: fh },
          ...(dirty ? { dirtyStart: true } : {})
        })
      }

      let step = tracker.step({
        index: frame.index,
        t: frame.t,
        detections: out.detections,
        frameHist: out.frameHist
      })
      if (step.kind === 'ask') {
        // Выбор возвращает исходный объект из списка трекера: чистоту рамки он проверяет по тождеству.
        const cands: Detection[] = step.candidates
        const index = await opts.onAsk(
          frame.t,
          cands.map((d) => toFraction(d.box, fw, fh))
        )
        if (signal.aborted) return { kind: 'cancelled' }
        // Пустой или неверный ответ без отмены — сбой: интерфейс не должен ждать итога вечно.
        const chosen = index === null ? undefined : cands[index]
        if (!chosen) throw new Error('Не удалось определить выбранного игрока')
        tracker.resolve(chosen)
        forceFull = true
        step = { kind: 'track', box: { ...chosen.box }, coasting: false }
      }
      if (step.kind === 'lost') {
        // Стоп — на последнем уверенном кадре (спека, п. 8): отсчёты «пережидания» после него отбрасываем.
        samples.length = lastGood?.len ?? 0
        return {
          kind: 'done',
          samples,
          stop: { t: lastGood?.t ?? frame.t, reason: step.reason },
          backend: detector.backend
        }
      }
      coasting = step.coasting
      samples.push(boxToSample(step.box, frame.t, fw, fh))
      if (!step.coasting) lastGood = { len: samples.length, t: frame.t }
      ordinal += 1
      opts.onProgress?.(Math.min(ordinal, total), total)
    }
    return { kind: 'done', samples, stop: null, backend: detector.backend }
  } catch (error) {
    // Отмена закрывает детектор и ffmpeg под ногами: ошибки при этом — не сбой слежения.
    if (signal.aborted) return { kind: 'cancelled' }
    throw error
  } finally {
    try {
      await iterator?.return?.()
    } catch {
      /* ffmpeg уже остановлен */
    }
    detector?.close()
  }
}
