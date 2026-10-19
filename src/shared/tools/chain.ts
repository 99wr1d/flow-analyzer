// Связи игроков (линия обороны): длины звеньев и ширина линии. Координаты — метры.
import type { Pt2 } from './curve'

export interface ChainMeasure {
  /** Длина каждого звена, м. */
  segments: number[]
  /** Сумма длин звеньев, м. */
  total: number
  /** Ширина линии: расстояние между крайними игроками (первым и последним узлом), м. */
  width: number
}

export function measureChain(points: readonly Pt2[]): ChainMeasure {
  const segments: number[] = []
  for (let i = 1; i < points.length; i += 1) {
    segments.push(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  }
  const total = segments.reduce((a, b) => a + b, 0)
  const width =
    points.length >= 2
      ? Math.hypot(
          points[points.length - 1].x - points[0].x,
          points[points.length - 1].y - points[0].y
        )
      : 0
  return { segments, total, width }
}

const round1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1)

/** «Ширина линии: 32.4 м». */
export const formatLineWidth = (m: number): string => `Ширина линии: ${round1(m)} м`

/** «665 м²»: от 100 м² — целые, меньше — один знак после точки. */
export function formatArea(m2: number): string {
  return m2 >= 100 ? `${Math.round(m2)} м²` : `${round1(m2)} м²`
}
