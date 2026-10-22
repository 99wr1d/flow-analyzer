// Световой столб (0.18): вертикальная полоса ПО ЭКРАНУ от верхнего края кадра до ног игрока.
// Один и тот же расчёт для экранного прожектора и для прожектора на поле; рисует его один общий рисовальщик.
import type { PxPt } from '../pitch/shapes'

/** Ширина столба в долях ширины следа прожектора (овала / пятна на траве): овал берут чуть шире фигуры. */
export const PILLAR_WIDTH_SHARE = 1.1
/** Столб короче этого (пикселей) не рисуется: ноги на самом краю кадра. */
const MIN_PILLAR_LENGTH = 0.5
/** Узкий столб всё равно можно нажать: минимальная полуширина области нажатия, пиксели. */
const MIN_HIT_HALF = 7

export interface PillarPaint {
  /** Ось столба: x ног (середина низа рисунка), пиксели кадра. */
  x: number
  /** Полуширина, пиксели. */
  half: number
  /** Верх (верхний край кадра) и низ (ноги), пиксели кадра. */
  top: number
  bottom: number
}

/** Столб по низу-середине следа (feet) и ширине следа; null — ноги у самого верха или выше кадра. */
export function pillarFromFooting(feet: PxPt, footingWidth: number): PillarPaint | null {
  if (!(feet.y > MIN_PILLAR_LENGTH) || !(footingWidth > 0)) return null
  return { x: feet.x, half: (footingWidth * PILLAR_WIDTH_SHARE) / 2, top: 0, bottom: feet.y }
}

/**
 * Многоугольник столба. Выше кадра он продолжается (extra), чтобы мягкий край затемнения не появлялся у верха кадра.
 * Для нажатия — не уже 2·MIN_HIT_HALF.
 */
export function pillarPoly(p: PillarPaint, extra = 0, forHit = false): PxPt[] {
  const half = forHit ? Math.max(p.half, MIN_HIT_HALF) : p.half
  return [
    { x: p.x - half, y: p.top - extra },
    { x: p.x + half, y: p.top - extra },
    { x: p.x + half, y: p.bottom },
    { x: p.x - half, y: p.bottom }
  ]
}

/** Слои столба: полуширина относительно полуширины столба и непрозрачность слоя (стопка даёт мягкие края и яркую ось). */
export const PILLAR_LAYERS = [
  { reach: 2.1, alpha: 0.03 },
  { reach: 1.7, alpha: 0.04 },
  { reach: 1.3, alpha: 0.06 },
  { reach: 0.98, alpha: 0.09 },
  { reach: 0.7, alpha: 0.13 },
  { reach: 0.45, alpha: 0.25 },
  { reach: 0.22, alpha: 0.5 }
] as const

/** Профиль по высоте (от верха кадра к ногам): доля яркости. Ярче к низу. */
export const PILLAR_VERTICAL_STOPS = [
  { offset: 0, alpha: 0.22 },
  { offset: 0.45, alpha: 0.7 },
  { offset: 1, alpha: 1 }
] as const
