// Шаблоны разметки поля: какие точки (в метрах) пользователь отмечает на кадре, в каком порядке и что показывать на схеме.
import {
  DEFAULT_PITCH,
  FIFA,
  centreSpot,
  goalAreaRect,
  goalPosts,
  penaltyAreaRect,
  penaltyArcEnds,
  penaltySpot,
  type PitchSize,
  type Side
} from './landmarks'
import type { Pt } from './linalg'

export const TEMPLATE_IDS = [
  'penalty-left',
  'penalty-right',
  'goal-left',
  'goal-right',
  'half-left',
  'half-right',
  'rect'
] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** Размер своей прямоугольной разметки, метры. */
export interface RectSize {
  w: number
  h: number
}
export const RECT_LIMITS = { min: 1, maxW: 120, maxH: 90 } as const
export const DEFAULT_RECT: RectSize = { w: 40.32, h: 16.5 }

export interface TemplatePoint {
  /** Устойчивое имя точки (по нему отличаем обязательные точки от дополнительных). */
  id: string
  label: string
  world: Pt
}

export interface Template {
  id: TemplateId
  /** Нужно обязательно отметить, по порядку. */
  required: TemplatePoint[]
  /** Можно добавить для точности. */
  extras: TemplatePoint[]
  /** Какая часть поля показана на схеме, метры. */
  view: { x0: number; y0: number; x1: number; y1: number }
}

export const TEMPLATE_REQUIRED_COUNT = 4

const pt = (id: string, label: string, world: Pt): TemplatePoint => ({ id, label, world })

function areaPoints(
  prefix: string,
  rect: [Pt, Pt, Pt, Pt],
  names: [string, string, string, string]
): TemplatePoint[] {
  return rect.map((p, i) => pt(`${prefix}${i + 1}`, names[i], p))
}

const penaltyNames: [string, string, string, string] = [
  'Угол штрафной у линии ворот, сверху',
  'Передний угол штрафной, сверху',
  'Передний угол штрафной, снизу',
  'Угол штрафной у линии ворот, снизу'
]
const goalNames: [string, string, string, string] = [
  'Угол вратарской у линии ворот, сверху',
  'Передний угол вратарской, сверху',
  'Передний угол вратарской, снизу',
  'Угол вратарской у линии ворот, снизу'
]

function sideExtras(size: PitchSize, side: Side, skip: 'penalty' | 'goal' | null): TemplatePoint[] {
  const out: TemplatePoint[] = []
  const s = side === 'left' ? 'l' : 'r'
  if (skip !== 'penalty') {
    out.push(...areaPoints(`pa-${s}`, penaltyAreaRect(size, side), penaltyNames))
  }
  if (skip !== 'goal') {
    out.push(...areaPoints(`ga-${s}`, goalAreaRect(size, side), goalNames))
  }
  out.push(pt(`ps-${s}`, 'Точка пенальти', penaltySpot(size, side)))
  const [a, b] = penaltyArcEnds(size, side)
  out.push(
    pt(`arc-${s}1`, 'Штрафная дуга: верхний конец', a),
    pt(`arc-${s}2`, 'Штрафная дуга: нижний конец', b)
  )
  const [p1, p2] = goalPosts(size, side)
  out.push(pt(`post-${s}1`, 'Штанга сверху', p1), pt(`post-${s}2`, 'Штанга снизу', p2))
  return out
}

/** Шаблон для размеров поля pitch (для шаблона 'rect' — размеры rect). */
export function buildTemplate(
  id: TemplateId,
  pitch: PitchSize = DEFAULT_PITCH,
  rect: RectSize = DEFAULT_RECT
): Template {
  const L = pitch.length
  const W = pitch.width
  const y0 = (W - FIFA.penaltyAreaWidth) / 2
  const y1 = y0 + FIFA.penaltyAreaWidth
  const sideView = (side: Side): Template['view'] =>
    side === 'left'
      ? { x0: -3, y0: y0 - 6, x1: 26, y1: y1 + 6 }
      : { x0: L - 26, y0: y0 - 6, x1: L + 3, y1: y1 + 6 }

  switch (id) {
    case 'penalty-left':
    case 'penalty-right': {
      const side: Side = id === 'penalty-left' ? 'left' : 'right'
      return {
        id,
        required: areaPoints(`pa-${side[0]}`, penaltyAreaRect(pitch, side), penaltyNames),
        extras: sideExtras(pitch, side, 'penalty'),
        view: sideView(side)
      }
    }
    case 'goal-left':
    case 'goal-right': {
      const side: Side = id === 'goal-left' ? 'left' : 'right'
      return {
        id,
        required: areaPoints(`ga-${side[0]}`, goalAreaRect(pitch, side), goalNames),
        extras: sideExtras(pitch, side, 'goal'),
        view: sideView(side)
      }
    }
    case 'half-left':
    case 'half-right': {
      const left = id === 'half-left'
      const x0 = left ? 0 : L / 2
      const x1 = left ? L / 2 : L
      const side: Side = left ? 'left' : 'right'
      return {
        id,
        required: [
          pt('h1', 'Угол половины поля: сверху слева', { x: x0, y: 0 }),
          pt('h2', 'Угол половины поля: сверху справа', { x: x1, y: 0 }),
          pt('h3', 'Угол половины поля: снизу справа', { x: x1, y: W }),
          pt('h4', 'Угол половины поля: снизу слева', { x: x0, y: W })
        ],
        extras: [
          ...sideExtras(pitch, side, null),
          pt('centre', 'Центр поля', centreSpot(pitch)),
          pt('circle-top', 'Центральный круг: сверху', {
            x: L / 2,
            y: W / 2 - FIFA.centreCircleRadius
          }),
          pt('circle-bottom', 'Центральный круг: снизу', {
            x: L / 2,
            y: W / 2 + FIFA.centreCircleRadius
          })
        ],
        view: { x0: x0 - 3, y0: -3, x1: x1 + 3, y1: W + 3 }
      }
    }
    default:
      return {
        id: 'rect',
        required: [
          pt('r1', 'Угол прямоугольника: сверху слева', { x: 0, y: 0 }),
          pt('r2', 'Угол прямоугольника: сверху справа', { x: rect.w, y: 0 }),
          pt('r3', 'Угол прямоугольника: снизу справа', { x: rect.w, y: rect.h }),
          pt('r4', 'Угол прямоугольника: снизу слева', { x: 0, y: rect.h })
        ],
        extras: [
          pt('rc', 'Центр прямоугольника', { x: rect.w / 2, y: rect.h / 2 }),
          pt('rt', 'Середина верхней стороны', { x: rect.w / 2, y: 0 }),
          pt('rb', 'Середина нижней стороны', { x: rect.w / 2, y: rect.h })
        ],
        view: { x0: -1, y0: -1, x1: rect.w + 1, y1: rect.h + 1 }
      }
  }
}

export const isRectTemplate = (id: TemplateId): boolean => id === 'rect'
