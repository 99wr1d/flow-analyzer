// Модель футбольного поля в метрах и её линии для рисования сетки поверх видео.
// Начало координат — угол поля; x вдоль длины (по умолчанию 105 м), y вдоль ширины (по умолчанию 68 м).
import type { Pt } from './linalg'

export const DEFAULT_PITCH = { length: 105, width: 68 } as const
export const PITCH_LIMITS = { minLength: 90, maxLength: 120, minWidth: 45, maxWidth: 90 } as const

/** Размеры по правилам ФИФА, метры. */
export const FIFA = {
  centreCircleRadius: 9.15,
  penaltyAreaDepth: 16.5,
  penaltyAreaWidth: 40.32,
  goalAreaDepth: 5.5,
  goalAreaWidth: 18.32,
  penaltySpot: 11,
  penaltyArcRadius: 9.15,
  cornerArcRadius: 1,
  goalWidth: 7.32
} as const

export interface PitchSize {
  length: number
  width: number
}

export type Side = 'left' | 'right'

/** Часть линии разметки: ломаная (closed — замкнутая) или дуга окружности. */
export type PitchPrimitive =
  | { kind: 'polyline'; points: Pt[]; closed: boolean }
  | { kind: 'arc'; center: Pt; radius: number; from: number; to: number }

/** Точки дуги (радианы; to > from), n — число отрезков. */
export function arcPoints(center: Pt, radius: number, from: number, to: number, n: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= n; i += 1) {
    const a = from + ((to - from) * i) / n
    out.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) })
  }
  return out
}

/** Отражение по длине: левая половина → правая. */
export const mirrorX = (p: Pt, size: PitchSize): Pt => ({ x: size.length - p.x, y: p.y })

/** Прямоугольник штрафной площади у левых ворот: [x0, x1] × [y0, y1]. */
export function penaltyAreaRect(size: PitchSize, side: Side = 'left'): [Pt, Pt, Pt, Pt] {
  const y0 = (size.width - FIFA.penaltyAreaWidth) / 2
  const y1 = y0 + FIFA.penaltyAreaWidth
  const d = FIFA.penaltyAreaDepth
  const pts: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: y0 },
    { x: d, y: y0 },
    { x: d, y: y1 },
    { x: 0, y: y1 }
  ]
  return side === 'left' ? pts : (pts.map((p) => mirrorX(p, size)) as [Pt, Pt, Pt, Pt])
}

/** Вратарская площадка: 5.5 × 18.32. */
export function goalAreaRect(size: PitchSize, side: Side = 'left'): [Pt, Pt, Pt, Pt] {
  const y0 = (size.width - FIFA.goalAreaWidth) / 2
  const y1 = y0 + FIFA.goalAreaWidth
  const d = FIFA.goalAreaDepth
  const pts: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: y0 },
    { x: d, y: y0 },
    { x: d, y: y1 },
    { x: 0, y: y1 }
  ]
  return side === 'left' ? pts : (pts.map((p) => mirrorX(p, size)) as [Pt, Pt, Pt, Pt])
}

export function penaltySpot(size: PitchSize, side: Side = 'left'): Pt {
  const p = { x: FIFA.penaltySpot, y: size.width / 2 }
  return side === 'left' ? p : mirrorX(p, size)
}

export function centreSpot(size: PitchSize): Pt {
  return { x: size.length / 2, y: size.width / 2 }
}

/** Штрафная дуга (часть окружности вокруг пенальти, вне штрафной площади). */
function penaltyArc(size: PitchSize, side: Side): PitchPrimitive {
  const spot = penaltySpot(size, side)
  const half = Math.acos((FIFA.penaltyAreaDepth - FIFA.penaltySpot) / FIFA.penaltyArcRadius)
  return side === 'left'
    ? { kind: 'arc', center: spot, radius: FIFA.penaltyArcRadius, from: -half, to: half }
    : {
        kind: 'arc',
        center: spot,
        radius: FIFA.penaltyArcRadius,
        from: Math.PI - half,
        to: Math.PI + half
      }
}

/** Точки пересечения штрафной дуги со штрафной площадью (по краям дуги). */
export function penaltyArcEnds(size: PitchSize, side: Side = 'left'): [Pt, Pt] {
  const dy = Math.sqrt(FIFA.penaltyArcRadius ** 2 - (FIFA.penaltyAreaDepth - FIFA.penaltySpot) ** 2)
  const x = side === 'left' ? FIFA.penaltyAreaDepth : size.length - FIFA.penaltyAreaDepth
  return [
    { x, y: size.width / 2 - dy },
    { x, y: size.width / 2 + dy }
  ]
}

/** Штанги ворот. */
export function goalPosts(size: PitchSize, side: Side = 'left'): [Pt, Pt] {
  const x = side === 'left' ? 0 : size.length
  return [
    { x, y: size.width / 2 - FIFA.goalWidth / 2 },
    { x, y: size.width / 2 + FIFA.goalWidth / 2 }
  ]
}

/** Все линии поля целиком: границы, средняя линия, центральный круг, площади, дуги и угловые дуги. */
export function pitchLines(size: PitchSize): PitchPrimitive[] {
  const { length: L, width: W } = size
  const lines: PitchPrimitive[] = [
    {
      kind: 'polyline',
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L, y: W },
        { x: 0, y: W }
      ]
    },
    {
      kind: 'polyline',
      closed: false,
      points: [
        { x: L / 2, y: 0 },
        { x: L / 2, y: W }
      ]
    },
    {
      kind: 'arc',
      center: centreSpot(size),
      radius: FIFA.centreCircleRadius,
      from: 0,
      to: Math.PI * 2
    }
  ]
  for (const side of ['left', 'right'] as const) {
    for (const rect of [penaltyAreaRect(size, side), goalAreaRect(size, side)]) {
      // Две стороны, не совпадающие с линией ворот, плюс фронт — рисуем как незамкнутую «скобку».
      const [a, b, c, d] = rect
      lines.push({ kind: 'polyline', closed: false, points: [a, b, c, d] })
    }
    lines.push(penaltyArc(size, side))
  }
  const r = FIFA.cornerArcRadius
  lines.push(
    { kind: 'arc', center: { x: 0, y: 0 }, radius: r, from: 0, to: Math.PI / 2 },
    { kind: 'arc', center: { x: L, y: 0 }, radius: r, from: Math.PI / 2, to: Math.PI },
    { kind: 'arc', center: { x: L, y: W }, radius: r, from: Math.PI, to: (Math.PI * 3) / 2 },
    { kind: 'arc', center: { x: 0, y: W }, radius: r, from: (Math.PI * 3) / 2, to: Math.PI * 2 }
  )
  return lines
}

/** Отмеченные точки поля, которые можно кликнуть как опорные (центр, пенальти, углы площадей, штанги, края средней линии). */
export function pitchPoints(size: PitchSize): Pt[] {
  const pts: Pt[] = [
    { x: 0, y: 0 },
    { x: size.length, y: 0 },
    { x: size.length, y: size.width },
    { x: 0, y: size.width },
    { x: size.length / 2, y: 0 },
    { x: size.length / 2, y: size.width },
    centreSpot(size)
  ]
  for (const side of ['left', 'right'] as const) {
    pts.push(...penaltyAreaRect(size, side), ...goalAreaRect(size, side), penaltySpot(size, side))
  }
  return pts
}
