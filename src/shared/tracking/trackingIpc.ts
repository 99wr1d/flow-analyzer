// Слежение за игроком: схемы и типы обмена между интерфейсом и main (задача слежения).
// Рамки здесь — доли кадра (0..1), а не пиксели детектора.
import { z } from 'zod'
import type { TrackSample } from './keys'
import type { DetectorBackend } from './detectorIpc'
import { ASK_MAX_CANDIDATES_TOTAL } from './tuning'

/** Самый длинный отрезок за одну задачу (секунды): защита от случайного «на всё видео». */
export const MAX_TRACK_SECONDS = 600

/** Сколько целей (игроков) за одну задачу слежения. */
export const MAX_TRACK_TARGETS = 8

const fraction = z.number().finite().min(0).max(1)
const fractionBox = z.object({ x: fraction, y: fraction, w: fraction, h: fraction })

export const TrackingStartSchema = z
  .object({
    /** Видео задаётся идентификатором из реестра (как у экспорта), не путём: интерфейс путей не знает. */
    videoId: z.string().min(1).max(100),
    from: z.number().finite().min(0),
    to: z.number().finite().min(0),
    /** Щелчки по целям (по одному на игрока): одиночное слежение — один якорь. */
    anchors: z
      .array(z.object({ x: fraction, y: fraction }))
      .min(1)
      .max(MAX_TRACK_TARGETS),
    /** Рамки, выбранные щелчком после ambiguous-start (доли кадра), по номеру цели; null — для цели выбора не было. */
    picks: z.array(fractionBox.nullable()).max(MAX_TRACK_TARGETS).optional()
  })
  .refine((v) => v.to > v.from && v.to - v.from <= MAX_TRACK_SECONDS)
  .refine((v) => (v.picks?.length ?? 0) <= v.anchors.length)

export const TrackingResolveSchema = z.object({
  jobId: z.string().min(1).max(100),
  /**
   * Номер варианта в списке вопроса (не больше ASK_MAX_CANDIDATES_TOTAL вариантов) либо 'none' — «моего игрока тут нет»:
   * слежение останавливается на последнем надёжном кадре.
   */
  index: z.union([
    z
      .number()
      .int()
      .min(0)
      .max(ASK_MAX_CANDIDATES_TOTAL - 1),
    z.literal('none')
  ]),
  /** Цель, на вопрос по которой отвечаем (должна совпасть с задаваемой); без неё — цель 0 (одиночное слежение). */
  target: z
    .number()
    .int()
    .min(0)
    .max(MAX_TRACK_TARGETS - 1)
    .default(0)
})

export const TrackingCancelSchema = z.object({ jobId: z.string().min(1).max(100) })

export type TrackingStartRequest = z.infer<typeof TrackingStartSchema>

/** Рамка в долях кадра. */
export interface FractionBox {
  x: number
  y: number
  w: number
  h: number
}

/** not-here — пользователь ответил «моего игрока тут нет». */
export type StopReason = 'cut' | 'out' | 'occluded' | 'not-here'

/** Ответ на вопрос «Кто из них ваш?»: номер варианта или «моего игрока тут нет». */
export type TrackingAnswer = number | 'none'

export interface TrackingProgress {
  jobId: string
  done: number
  total: number
}

export interface TrackingAsk {
  jobId: string
  t: number
  /** Номер цели, по которой вопрос; остальные цели ждут ответа. */
  target: number
  candidates: FractionBox[]
  /** Где цель сейчас (последняя уверенная рамка или прогноз, если она пережидает), доли кадра: от неё рисуется метка точки. */
  current: FractionBox
}

export type TrackingDone =
  | {
      jobId: string
      /** Отсчёты по целям (в порядке якорей), одинаковой длины. */
      samples: TrackSample[][]
      /** Потеря любой цели останавливает всю задачу; target — номер потерянной цели. */
      stop: null | { t: number; reason: StopReason; target: number }
      backend: DetectorBackend
    }
  | {
      jobId: string
      error: 'no-player' | 'ambiguous-start'
      /** Номер цели, для которой не удался старт. */
      target: number
      candidates?: FractionBox[]
      /** same-player: у цели та же рамка, что у цели other (две точки на одном игроке), выбирать нечего. */
      cause?: 'same-player'
      other?: number
    }
  | { jobId: string; error: 'failed'; message: string }

/** Секунд расчёта на кадр: замер spike/Task 4 (видеокарта и процессор). */
export const SECONDS_PER_FRAME_WEBGPU = 0.05
export const SECONDS_PER_FRAME_WASM = 0.25
/** Частота кадров, если неизвестна: единая для слежения (декодер, оценка времени, применение). */
export const FALLBACK_FPS = 25

/** Сколько секунд займёт слежение на отрезке длиной durationSec (для предупреждения перед запуском). */
export function estimateSeconds(
  durationSec: number,
  backend: DetectorBackend,
  fps: number = FALLBACK_FPS
): number {
  const perFrame = backend === 'webgpu' ? SECONDS_PER_FRAME_WEBGPU : SECONDS_PER_FRAME_WASM
  return Math.max(0, durationSec) * fps * perFrame
}
