// Задача слежения: кадры из ffmpeg → детектор → трекер → отсчёты TrackSample. Без Electron: кадры и детектор подаются снаружи,
// поэтому в тестах работают заглушки. Здесь же — единственное место, где рамка трекера (пиксели кадра детектора)
// превращается в доли кадра.
import { converges, MultiTracker, type MultiStart } from '../../shared/tracking/multi'
import { iou, pickStart } from '../../shared/tracking/tracker'
import type { TrackSample } from '../../shared/tracking/keys'
import type { FractionBox, StopReason, TrackingAnswer } from '../../shared/tracking/trackingIpc'
import type { Box, Detection } from '../../shared/tracking/types'
import type { DecodedFrame } from './frames'
import type { Detector } from './detectorWindow'
import { footX } from './footing'

/** Полный кадр показываем детектору раз в столько секунд; между ними — только вырез вокруг игрока. */
export const FULL_DETECT_SECONDS = 1.0
/** Насколько выбранная щелчком рамка должна совпадать с найденной на старте (IoU). */
const PICK_MIN_IOU = 0.5
/** Рамка, перекрывающая выбранную сильнее этого, считается стартовым соседом (её примету трекер запоминает). */
const START_NEIGHBOUR_IOU = 0.1
/** Вырез детектора: окно 640×384 вокруг центра выреза (detectorWindow.detect, stubDetector). */
const CROP_W = 640
const CROP_H = 384

export interface RunTrackingOptions {
  from: number
  to: number
  /** Щелчки пользователя по одному на цель (1..8), доли кадра. Одно слежение = один якорь. */
  anchors: Array<{ x: number; y: number }>
  /** Рамка цели, выбранная щелчком после ambiguous-start (доли кадра), по номеру цели: ею разрешается неоднозначный старт. */
  picks?: Array<FractionBox | null | undefined>
  signal: AbortSignal
  /** Кадры отрезка (decodeFrames); частота кадров — та, что использовал декодер (frame.fps). Итерация начинается после запуска детектора; по выходу ffmpeg останавливается. */
  frames: AsyncIterable<DecodedFrame>
  /** Создание прерывается сигналом: при отмене окно-детектор уничтожается, обещание отклоняется. */
  createDetector: (signal: AbortSignal) => Promise<Detector>
  onProgress?: (done: number, total: number) => void
  /**
   * Вопрос «Кто из них ваш?» по цели target: индекс выбранной рамки, 'none' («моего игрока тут нет» — стоп на последнем
   * надёжном кадре, причина not-here) или null, если отменили. Остальные цели ждут.
   */
  onAsk: (
    t: number,
    candidates: FractionBox[],
    target: number,
    /** Где цель сейчас: последняя уверенная рамка (или прогноз, если цель пережидает), доли кадра. */
    current: FractionBox
  ) => Promise<TrackingAnswer | null>
}

export type TrackingOutcome =
  | {
      kind: 'done'
      /** Отсчёты по целям (одинаковой длины). */
      samples: TrackSample[][]
      /** Потеря любой цели останавливает всю задачу на последнем кадре, где уверены все цели; target — потерянная. */
      stop: null | { t: number; reason: StopReason; target: number }
      backend: Detector['backend']
    }
  | {
      kind: 'failed'
      error: 'no-player' | 'ambiguous-start'
      /** Номер цели, для которой не удался старт. */
      target: number
      candidates?: FractionBox[]
      /** same-player: рамка цели уже занята другой целью other (а не выбор из нескольких игроков). */
      cause?: 'same-player'
      other?: number
    }
  | { kind: 'cancelled' }

const toFraction = (b: Box, w: number, h: number): FractionBox => ({
  x: b.x / w,
  y: b.y / h,
  w: b.w / w,
  h: b.h / h
})

/** Рамка игрока в пикселях → отсчёт: ноги — середина нижней кромки, высота — высота рамки. */
export function boxToSample(
  box: Box,
  t: number,
  w: number,
  h: number,
  rgba?: ArrayLike<number>
): TrackSample {
  // Если дан кадр — x ног по тому, что стоит на траве у низа рамки (footX): у бегущего игрока рамку растягивают
  // поднятая нога и руки, и середина кромки уходит от ног.
  const x = rgba ? footX(rgba, w, h, box) : box.x + box.w / 2
  return { t, foot: { x: x / w, y: (box.y + box.h) / h }, height: box.h / h }
}

/** Ответ «вот мой» дальше этого (в высотах игрока) от последнего отсчёта цели противоречит её недавнему следу. */
export const ANSWER_CONTRADICTS = 0.3
/** Наибольшая скорость игрока (высот за кадр) для проверки «надёжный отсчёт достижим из выбранной рамки». */
export const ANSWER_REACH_PER_FRAME = 0.25

/**
 * Ответ пользователя противоречит недоказанному возвращению (цель шла за неотличимым новичком, пока её игрок не
 * вернулся): отсчёты цели после последнего надёжного кадра (provenFrame) до кадра ответа заменяются прямой от надёжного
 * отсчёта к выбранной рамке — как отсчёты «пережидания» (догадка, а не чужой игрок). Противоречие — выбранная рамка дальше
 * ANSWER_CONTRADICTS высот от последнего отсчёта цели. Возвращает число заменённых отсчётов (0 — ничего не тронуто).
 * Границ может быть несколько (недоказанные возвращения с прошлого ответа, по возрастанию): берётся САМАЯ ПОЗДНЯЯ, чей
 * надёжный отсчёт достижим из выбранной рамки (ANSWER_CONTRADICTS + ANSWER_REACH_PER_FRAME высот за кадр между ними);
 * если ни одна не достижима — тоже самая поздняя (ранняя на быстром беге добавляла бы ошибку к верным отсчётам).
 * provenFrame (MultiTracker.answerProven): ответ у последнего доказанного места цели при недоказанном возвращении —
 * замена от этого кадра, даже если ответ согласен с последним отсчётом (чужой мог вернуться к своему вплотную).
 */
export function reconcileAnswer(
  samples: TrackSample[],
  sampleFrames: number[],
  bounds: number | null | readonly number[],
  answered: TrackSample,
  /** Ширина кадра / высота: доли ширины и высоты приводятся к долям высоты. */
  aspect = 1,
  fps = 25,
  provenFrame: number | null = null
): number {
  const last = samples.at(-1)
  if (!last) return 0
  const keepOf = (b: number): number => sampleFrames.filter((f) => f <= b).length
  if (provenFrame !== null) return replaceAfter(samples, keepOf(provenFrame), answered)
  const dist = Math.hypot((answered.foot.x - last.foot.x) * aspect, answered.foot.y - last.foot.y)
  if (dist <= ANSWER_CONTRADICTS * Math.max(answered.height, last.height)) return 0
  const list = bounds === null ? [] : typeof bounds === 'number' ? [bounds] : bounds
  const usable = list.map(keepOf).filter((k) => k < samples.length)
  let keep = usable.length > 0 ? usable[usable.length - 1] : samples.length
  for (let j = list.length - 1; j >= 0; j -= 1) {
    const k = keepOf(list[j])
    const proven = k > 0 ? samples[k - 1] : null
    // граница на последнем отсчёте ничего не заменяет — противоречит сам последний отсчёт
    if (!proven || k >= samples.length) continue
    const gap = Math.max(0, (answered.t - proven.t) * fps)
    const h = Math.max(answered.height, proven.height)
    const d = Math.hypot(
      (answered.foot.x - proven.foot.x) * aspect,
      answered.foot.y - proven.foot.y
    )
    if (d <= (ANSWER_CONTRADICTS + ANSWER_REACH_PER_FRAME * gap) * h) {
      keep = k
      break
    }
  }
  return replaceAfter(samples, keep, answered)
}

/** Отсчёты после первых keep заменяются прямой от последнего оставленного к ответу; возвращает число заменённых. */
function replaceAfter(samples: TrackSample[], keep: number, answered: TrackSample): number {
  if (keep >= samples.length) return 0
  const from = keep > 0 ? samples[keep - 1] : answered
  const span = answered.t - from.t
  for (let j = keep; j < samples.length; j += 1) {
    const k = span > 0 ? (samples[j].t - from.t) / span : 1
    samples[j] = {
      t: samples[j].t,
      foot: {
        x: from.foot.x + (answered.foot.x - from.foot.x) * k,
        y: from.foot.y + (answered.foot.y - from.foot.y) * k
      },
      height: from.height + (answered.height - from.height) * k
    }
  }
  return samples.length - keep
}

/** Вырез для нескольких целей: общая рамка их прогнозов с запасом, если помещается в окно детектора; иначе целый кадр. */
function sharedRoi(boxes: Box[]): Box | undefined {
  if (boxes.length === 1) return boxes[0]
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  const margin = 0.5 * Math.max(...boxes.map((b) => b.h))
  if (x1 - x0 + 2 * margin > CROP_W || y1 - y0 + 2 * margin > CROP_H) return undefined
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

type StartResult =
  { kind: 'ok'; starts: MultiStart[] } | Extract<TrackingOutcome, { kind: 'failed' }>

/** Старт всех целей по первому кадру: у каждой своя рамка; две цели на одной рамке — неоднозначный старт. */
function pickStarts(
  opts: RunTrackingOptions,
  dets: Detection[],
  fw: number,
  fh: number
): StartResult {
  const starts: MultiStart[] = []
  for (let target = 0; target < opts.anchors.length; target += 1) {
    const a = opts.anchors[target]
    const pickBox = opts.picks?.[target] ?? undefined
    const pick = pickStart(dets, { x: a.x * fw, y: a.y * fh })
    if (pick.kind === 'none') return { kind: 'failed', error: 'no-player', target }
    let start: Detection | null = pick.kind === 'ok' ? pick.det : null
    let dirty = false
    if (pick.kind === 'ambiguous' && pickBox) {
      // Тренер уже выбрал рамку из вариантов: берём найденную рамку, что на неё больше всего похожа.
      const want: Box = {
        x: pickBox.x * fw,
        y: pickBox.y * fh,
        w: pickBox.w * fw,
        h: pickBox.h * fh
      }
      let best = 0
      for (const d of dets) {
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
        target,
        candidates: pick.candidates.map((d) => toFraction(d.box, fw, fh))
      }
    }
    if (!start) throw new Error('Не удалось определить игрока на старте')
    const chosen = start
    // Две цели не могут стоять на одной рамке.
    const taken = starts.findIndex((s) => converges(s.det.box, chosen.box))
    if (taken >= 0) {
      return {
        kind: 'failed',
        error: 'ambiguous-start',
        target,
        candidates: [toFraction(chosen.box, fw, fh)],
        cause: 'same-player',
        other: taken
      }
    }
    starts.push({
      det: chosen,
      opts: dirty
        ? {
            dirtyStart: true,
            startNeighbours: dets.filter(
              (d) => d !== chosen && iou(d.box, chosen.box) > START_NEIGHBOUR_IOU
            )
          }
        : {}
    })
  }
  return { kind: 'ok', starts }
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

    const samples: TrackSample[][] = opts.anchors.map(() => [])
    // Кадр для уточнения точки ног (footX); у заглушки с точными рамками — нет.
    const feetFrame = (f: DecodedFrame): Uint8Array | undefined =>
      (detector as Detector).exactBoxes ? undefined : f.rgba
    let tracker: MultiTracker | null = null
    let coasting = false
    let forceFull = false
    let ordinal = 0
    // Последний уверенный (не «пережидаемый») отсчёт каждой цели: при потере всё после него — догадки по прогнозу.
    const lastGood: Array<{ len: number; t: number } | null> = opts.anchors.map(() => null)
    /** Номер кадра каждого отсчёта (у всех целей одинаковые). */
    const sampleFrames: number[] = []
    /** Стоп: все цели обрезаются до общей длины len (последний надёжный кадр у всех). */
    const stopAt = (
      len: number,
      t: number,
      reason: StopReason,
      target: number
    ): TrackingOutcome => ({
      kind: 'done',
      samples: samples.map((s) => s.slice(0, len)),
      stop: { t, reason, target },
      backend: (detector as Detector).backend
    })
    /**
     * Длина вывода при остановке (потеря, «моего тут нет»): у каждой цели — до её последнего уверенного отсчёта и не
     * дальше provenUntil (последний уверенный кадр перед недоказанным возвращением: перед остановкой могла быть короткая
     * подмена на неотличимом новичке). У всех целей одна длина — наименьшая; время — последнего оставленного кадра.
     */
    const trustedLen = (tr: MultiTracker, fallbackT: number): { len: number; t: number } => {
      let len = Infinity
      lastGood.forEach((g, k) => {
        const proven = tr.provenUntil(k)
        const upTo = proven === null ? 0 : sampleFrames.filter((f) => f <= proven).length
        len = Math.min(len, g?.len ?? 0, upTo)
      })
      if (!Number.isFinite(len)) len = 0
      const t = len > 0 ? samples[0][len - 1].t : fallbackT
      return { len, t }
    }

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

      // Целый кадр: старт, после вопроса, пока кто-то «пережидается» (иначе вернувшегося вне выреза не найти; не дольше
      // COAST/LOST_SECONDS подряд) и раз в секунду. Иначе — вырез вокруг прогнозов трекера на этот кадр (одним проходом
      // детектора на все цели; если цели далеко друг от друга и не помещаются в вырез — целый кадр).
      const needFull = tracker === null || forceFull || coasting || ordinal % fullEvery === 0
      forceFull = false
      const roi = needFull || !tracker ? undefined : sharedRoi(tracker.predictBoxes(frame.index))
      const out = await detector.detect(
        { rgba: frame.rgba, width: fw, height: fh, index: frame.index, t: frame.t },
        roi
      )
      if (signal.aborted) return { kind: 'cancelled' }

      if (tracker === null) {
        const started = pickStarts(opts, out.detections, fw, fh)
        if (started.kind === 'failed') return started
        tracker = new MultiTracker(started.starts, fps, { w: fw, h: fh })
      }

      let step = tracker.step({
        index: frame.index,
        t: frame.t,
        detections: out.detections,
        frameHist: out.frameHist
      })
      // Вопрос по цели ставит на паузу всех: следующий кадр не берём, пока все вопросы кадра не решены.
      while (step.kind === 'ask') {
        // Выбор возвращает исходный объект из списка трекера: чистоту рамки он проверяет по тождеству.
        const cands: Detection[] = step.candidates
        const target = step.target
        const index = await opts.onAsk(
          frame.t,
          cands.map((d) => toFraction(d.box, fw, fh)),
          target,
          toFraction(tracker.askBox(target), fw, fh)
        )
        if (signal.aborted) return { kind: 'cancelled' }
        if (index === 'none') {
          // «Моего игрока тут нет»: стоп на последнем надёжном кадре (см. trustedLen).
          const { len, t } = trustedLen(tracker, frame.t)
          return stopAt(len, t, 'not-here', target)
        }
        // Пустой или неверный ответ без отмены — сбой: интерфейс не должен ждать итога вечно.
        const chosen = index === null ? undefined : cands[index]
        if (!chosen) throw new Error('Не удалось определить выбранного игрока')
        // Ответ противоречит недоказанному возвращению — кадры на чужом заменяются догадкой (до ответа: он снимает сомнение).
        reconcileAnswer(
          samples[target],
          sampleFrames,
          tracker.answerBounds(target),
          boxToSample(chosen.box, frame.t, fw, fh, feetFrame(frame)),
          fw / fh,
          frame.fps,
          tracker.answerProven(target, chosen.box)
        )
        step = tracker.resolve(target, chosen)
        forceFull = true
      }
      if (step.kind === 'lost') {
        // Стоп — на последнем надёжном кадре всех целей (спека, п. 8): отсчёты «пережидания» и недоказанных
        // возвращений после него отбрасываем.
        const { len, t } = trustedLen(tracker, frame.t)
        return stopAt(len, t, step.reason, step.target)
      }
      coasting = step.coasting.some(Boolean)
      sampleFrames.push(frame.index)
      step.boxes.forEach((box, i) => {
        samples[i].push(boxToSample(box, frame.t, fw, fh, feetFrame(frame)))
        if (!step.coasting[i]) lastGood[i] = { len: samples[i].length, t: frame.t }
      })
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
