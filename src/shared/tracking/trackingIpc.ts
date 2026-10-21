// Слежение за игроком: схемы и типы обмена между интерфейсом и main (задача слежения).
// Рамки здесь — доли кадра (0..1), а не пиксели детектора.
import { z } from 'zod'
import type { TrackSample } from './keys'
import type { DetectorBackend } from './detectorIpc'

/** Самый длинный отрезок за одну задачу (секунды): защита от случайного «на всё видео». */
export const MAX_TRACK_SECONDS = 600

const fraction = z.number().finite().min(0).max(1)
const fractionBox = z.object({ x: fraction, y: fraction, w: fraction, h: fraction })

export const TrackingStartSchema = z
  .object({
    /** Видео задаётся идентификатором из реестра (как у экспорта), не путём: интерфейс путей не знает. */
    videoId: z.string().min(1).max(100),
    from: z.number().finite().min(0),
    to: z.number().finite().min(0),
    anchor: z.object({ x: fraction, y: fraction }),
    /** Рамка, выбранная щелчком после ambiguous-start (доли кадра). */
    pick: fractionBox.optional()
  })
  .refine((v) => v.to > v.from && v.to - v.from <= MAX_TRACK_SECONDS)

export const TrackingResolveSchema = z.object({
  jobId: z.string().min(1).max(100),
  index: z.number().int().min(0).max(100)
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

export type StopReason = 'cut' | 'out' | 'occluded'

export interface TrackingProgress {
  jobId: string
  done: number
  total: number
}

export interface TrackingAsk {
  jobId: string
  t: number
  candidates: FractionBox[]
}

export type TrackingDone =
  | {
      jobId: string
      samples: TrackSample[]
      stop: null | { t: number; reason: StopReason }
      backend: DetectorBackend
    }
  | {
      jobId: string
      error: 'no-player' | 'ambiguous-start'
      candidates?: FractionBox[]
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
