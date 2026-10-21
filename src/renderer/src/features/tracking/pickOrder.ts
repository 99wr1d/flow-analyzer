import type { FractionBox } from '../../../../shared/tracking/trackingIpc'

/**
 * Порядок вывода рамок: по площади, от большой к малой. Позже в DOM — выше, поэтому малая рамка внутри большой остаётся
 * кликабельной, а у большой остаётся её свободная часть. Индекс — исходный (его получает ответ).
 */
export function pickOrder(candidates: FractionBox[]): Array<{ c: FractionBox; i: number }> {
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((p, q) => q.c.w * q.c.h - p.c.w * p.c.h || p.i - q.i)
}
