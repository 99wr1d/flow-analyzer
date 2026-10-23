// Задача слежения: кадры из ffmpeg → детектор → трекер → отсчёты TrackSample. Без Electron: кадры и детектор подаются снаружи,
// поэтому в тестах работают заглушки. Здесь же — единственное место, где рамка трекера (пиксели кадра детектора)
// превращается в доли кадра.
import { converges, MultiTracker, type MultiStart } from '../../shared/tracking/multi'
import { iou, pickStart } from '../../shared/tracking/tracker'
import type { TrackSample } from '../../shared/tracking/keys'
import type { FractionBox, StopReason } from '../../shared/tracking/trackingIpc'
import type { Box, Detection } from '../../shared/tracking/types'
import type { DecodedFrame } from './frames'
import type { Detector } from './detectorWindow'

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
  /** Вопрос «Кто из них ваш?» по цели target: индекс выбранной рамки или null, если отменили. Остальные цели ждут. */
  onAsk: (t: number, candidates: FractionBox[], target: number) => Promise<number | null>
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
    }
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
    if (starts.some((s) => converges(s.det.box, chosen.box))) {
      return {
        kind: 'failed',
        error: 'ambiguous-start',
        target,
        candidates: [toFraction(chosen.box, fw, fh)]
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
    let tracker: MultiTracker | null = null
    let coasting = false
    let forceFull = false
    let ordinal = 0
    // Последний уверенный (не «пережидаемый») отсчёт каждой цели: при потере всё после него — догадки по прогнозу.
    const lastGood: Array<{ len: number; t: number } | null> = opts.anchors.map(() => null)

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
          target
        )
        if (signal.aborted) return { kind: 'cancelled' }
        // Пустой или неверный ответ без отмены — сбой: интерфейс не должен ждать итога вечно.
        const chosen = index === null ? undefined : cands[index]
        if (!chosen) throw new Error('Не удалось определить выбранного игрока')
        step = tracker.resolve(target, chosen)
        forceFull = true
      }
      if (step.kind === 'lost') {
        // Стоп — на последнем кадре, где уверены все цели (спека, п. 8): отсчёты «пережидания» после него отбрасываем.
        let len = Infinity
        let t = frame.t
        for (const g of lastGood) {
          const l = g?.len ?? 0
          if (l < len) {
            len = l
            t = g?.t ?? frame.t
          }
        }
        return {
          kind: 'done',
          samples: samples.map((s) => s.slice(0, len)),
          stop: { t, reason: step.reason, target: step.target },
          backend: detector.backend
        }
      }
      coasting = step.coasting.some(Boolean)
      step.boxes.forEach((box, i) => {
        samples[i].push(boxToSample(box, frame.t, fw, fh))
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
