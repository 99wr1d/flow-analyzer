// Разметка поля (калибровка): точки поля ↔ точки кадра, из которых получается гомография.
// В файле проекта хранятся только точки; матрица пересчитывается при каждой загрузке и проверяется заново.
import { z } from 'zod'
import {
  fitHomography,
  reprojectionErrors,
  rms,
  type Correspondence,
  type HomographyErrorCode
} from './homography'
import { PITCH_LIMITS } from './landmarks'
import { makeProjector, type Projector } from './projector'
import { RECT_LIMITS, TEMPLATE_IDS } from './templates'

export const MAX_CALIBRATIONS = 200
export const MAX_CALIBRATION_POINTS = 24
/** Рисунок на поле показывается без предупреждения, пока время отличается от времени разметки не больше чем на столько секунд. */
export const CALIBRATION_VALIDITY = 1

const worldPoint = z.object({ x: z.number().min(-80).max(200), y: z.number().min(-80).max(160) })
/** Точка на кадре в долях кадра; за кадром допускается (угол поля может быть за краем картинки). */
const imagePoint = z.object({ x: z.number().min(-1).max(2), y: z.number().min(-1).max(2) })

export const CalibrationPointSchema = z.object({ world: worldPoint, image: imagePoint })

export const CalibrationSchema = z.object({
  id: z.uuid(),
  /** Время кадра, на котором сделана разметка, секунды. */
  time: z.number().min(0).max(1e7),
  /** Ширина/высота кадра в момент разметки (для расчёта ошибки в «квадратных» единицах). */
  aspect: z
    .number()
    .min(0.2)
    .max(10)
    .default(16 / 9),
  pitch: z.object({
    length: z.number().min(PITCH_LIMITS.minLength).max(PITCH_LIMITS.maxLength),
    width: z.number().min(PITCH_LIMITS.minWidth).max(PITCH_LIMITS.maxWidth)
  }),
  template: z.enum(TEMPLATE_IDS),
  /** Размер прямоугольника для шаблона «Свой прямоугольник». */
  rect: z
    .object({
      w: z.number().min(RECT_LIMITS.min).max(RECT_LIMITS.maxW),
      h: z.number().min(RECT_LIMITS.min).max(RECT_LIMITS.maxH)
    })
    .optional(),
  points: z.array(CalibrationPointSchema).min(4).max(MAX_CALIBRATION_POINTS),
  createdAt: z.iso.datetime()
})
export const CalibrationListSchema = z.array(CalibrationSchema)

export type Calibration = z.infer<typeof CalibrationSchema>
export type CalibrationPoint = z.infer<typeof CalibrationPointSchema>

export interface CalibrationFit {
  ok: true
  projector: Projector
  /** Ошибка каждой точки, пиксели кадра. */
  errors: number[]
  rms: number
}
export type CalibrationFitResult = CalibrationFit | { ok: false; code: HomographyErrorCode }

/** Считает гомографию по точкам и проверяет её. size — размер кадра в пикселях (для ошибки в пикселях). */
export function fitCalibration(
  points: readonly Correspondence[],
  aspect: number,
  size: { w: number; h: number }
): CalibrationFitResult {
  const fit = fitHomography(points, aspect)
  if (!fit.ok) return { ok: false, code: fit.code }
  const projector = makeProjector(fit.H)
  if (!projector) return { ok: false, code: 'singular' }
  const errors = reprojectionErrors(projector.H, points, size)
  return { ok: true, projector, errors, rms: rms(errors) }
}

const cache = new WeakMap<Calibration, Projector | null>()

/** Проектор разметки (с кэшем по объекту: изменённая разметка — новый объект). null — точки не дают корректной гомографии. */
export function projectorFor(c: Calibration): Projector | null {
  if (cache.has(c)) return cache.get(c) ?? null
  const fit = fitHomography(c.points, c.aspect)
  const projector = fit.ok ? makeProjector(fit.H) : null
  cache.set(c, projector)
  return projector
}

export interface NearestCalibration {
  calibration: Calibration
  /** time − calibration.time: больше нуля — разметка сделана раньше текущего момента. */
  offset: number
}

/** Разметка, ближайшая по времени (с любой стороны); при равенстве — более ранняя. */
export function nearestCalibration(
  list: readonly Calibration[],
  time: number
): NearestCalibration | null {
  let best: NearestCalibration | null = null
  for (const c of list) {
    const offset = time - c.time
    if (
      !best ||
      Math.abs(offset) < Math.abs(best.offset) - 1e-9 ||
      (Math.abs(Math.abs(offset) - Math.abs(best.offset)) <= 1e-9 && c.time < best.calibration.time)
    ) {
      best = { calibration: c, offset }
    }
  }
  return best
}

/** Применима ли разметка в момент time без предупреждения. */
export const isCalibrationFresh = (c: Pick<Calibration, 'time'>, time: number): boolean =>
  Math.abs(time - c.time) <= CALIBRATION_VALIDITY + 1e-9
