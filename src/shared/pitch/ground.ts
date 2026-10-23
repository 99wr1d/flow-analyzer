// «Лежит на траве»: во сколько раз круг на земле выглядит ниже, чем шире (отношение высоты к ширине на экране).
import {
  nearestCalibration,
  isCalibrationFresh,
  projectorFor,
  type Calibration
} from './calibration'
import type { Projector } from './projector'

/** Отношение высоты к ширине эллипса у ног, когда разметки поля нет. */
export const GROUND_RATIO_FALLBACK = 0.35
const MIN_RATIO = 0.12
const MAX_RATIO = 1
/** Радиус пробного круга, метры (на отношение почти не влияет, пока круг мал по сравнению с расстоянием до камеры). */
const PROBE_RADIUS = 0.5
const STEPS = 36

/**
 * Каким эллипсом выглядел бы круг на траве в точке кадра `at` (доли кадра): отношение высоты к ширине в пикселях.
 * Считается по разметке поля; нет разметки, точка выше горизонта или проекция не получилась — 0.35.
 */
export function groundEllipseRatio(
  cal: Calibration | undefined | null,
  at: { x: number; y: number }
): number {
  if (!cal) return GROUND_RATIO_FALLBACK
  return groundEllipseRatioIn(projectorFor(cal), cal.aspect, at)
}

/** Разметка, по которой считается эллипс у ног рисунка на экране в момент time: ближайшая рабочая и не устаревшая; нет — null. */
export function ringCalibrationAt(
  calibrations: readonly Calibration[],
  time: number
): Calibration | null {
  const near = nearestCalibration(
    calibrations.filter((c) => projectorFor(c) !== null),
    time
  )
  return near && isCalibrationFresh(near.calibration, time) ? near.calibration : null
}

/** То же по готовому проектору; aspect — отношение ширины кадра к высоте. */
export function groundEllipseRatioIn(
  proj: Projector | null | undefined,
  aspect: number,
  at: { x: number; y: number }
): number {
  const center = proj?.toWorld(at)
  if (!proj || !center) return GROUND_RATIO_FALLBACK
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < STEPS; i += 1) {
    const t = (2 * Math.PI * i) / STEPS
    const p = proj.toImage({
      x: center.x + PROBE_RADIUS * Math.cos(t),
      y: center.y + PROBE_RADIUS * Math.sin(t)
    })
    if (!p) return GROUND_RATIO_FALLBACK
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const w = (maxX - minX) * aspect
  const h = maxY - minY
  if (!(w > 0) || !(h > 0)) return GROUND_RATIO_FALLBACK
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, h / w))
}
