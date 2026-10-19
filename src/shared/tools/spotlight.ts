// Прожектор: несколько прожекторов одного момента времени дают одну общую маску затемнения.
import type { PxPt } from '../pitch/shapes'
import { signedArea } from './polygon'

export interface SpotInput {
  /** Сила затемнения этого прожектора, 0..1. */
  dim: number
  /** Освещённые области (многоугольники в пикселях кадра). */
  lit: readonly (readonly PxPt[])[]
}

export interface SpotMask {
  /** Затемнение всего остального: берётся самое сильное из прожекторов. */
  dim: number
  /** Дыры в затемнении: объединение освещённых областей всех прожекторов. */
  holes: PxPt[][]
}

/** Общая маска: затемнение — максимум из заданных, дыры — все освещённые области. null — прожекторов нет. */
export function composeSpotlights(list: readonly SpotInput[]): SpotMask | null {
  const used = list.filter((s) => s.lit.length > 0)
  if (used.length === 0) return null
  return {
    dim: Math.max(...used.map((s) => s.dim)),
    // Все контуры обходятся в одну сторону: при заливке по ненулевому правилу пересечения не превращаются в дыры.
    holes: used.flatMap((s) =>
      s.lit.map((poly) => (signedArea(poly) < 0 ? [...poly].reverse() : [...poly]))
    )
  }
}

/** Размытие края светлого пятна, пиксели (доля высоты кадра). */
export const spotlightBlur = (frameHeight: number): number => Math.max(1.5, frameHeight * 0.012)
