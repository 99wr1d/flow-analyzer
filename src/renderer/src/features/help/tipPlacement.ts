// Где поставить карточку подсказки относительно элемента, на который она указывает. Чистая функция.
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Side = 'bottom' | 'top' | 'right' | 'left'

export interface Placement {
  left: number
  top: number
  side: Side
  /** Смещение «стрелки» вдоль края карточки (px от её левого или верхнего края), чтобы она смотрела на центр элемента. */
  arrow: number
}

const GAP = 14
const MARGIN = 12

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/**
 * Карточка размера card рядом с target внутри окна view. Предпочтение: снизу, сверху, справа, слева — первое,
 * куда карточка помещается целиком; если некуда — снизу с прижатием к краю окна.
 */
export function placeTip(
  target: Rect,
  card: { width: number; height: number },
  view: { width: number; height: number }
): Placement {
  const fits: Record<Side, boolean> = {
    bottom: target.top + target.height + GAP + card.height + MARGIN <= view.height,
    top: target.top - GAP - card.height - MARGIN >= 0,
    right: target.left + target.width + GAP + card.width + MARGIN <= view.width,
    left: target.left - GAP - card.width - MARGIN >= 0
  }
  const side: Side = (['bottom', 'top', 'right', 'left'] as const).find((s) => fits[s]) ?? 'bottom'
  const cx = target.left + target.width / 2
  const cy = target.top + target.height / 2
  const maxLeft = Math.max(MARGIN, view.width - card.width - MARGIN)
  const maxTop = Math.max(MARGIN, view.height - card.height - MARGIN)

  if (side === 'bottom' || side === 'top') {
    const left = clamp(cx - card.width / 2, MARGIN, maxLeft)
    const top =
      side === 'bottom'
        ? clamp(target.top + target.height + GAP, MARGIN, maxTop)
        : clamp(target.top - GAP - card.height, MARGIN, maxTop)
    return { left, top, side, arrow: clamp(cx - left, 16, card.width - 16) }
  }
  const top = clamp(cy - card.height / 2, MARGIN, maxTop)
  const left =
    side === 'right'
      ? clamp(target.left + target.width + GAP, MARGIN, maxLeft)
      : clamp(target.left - GAP - card.width, MARGIN, maxLeft)
  return { left, top, side, arrow: clamp(cy - top, 16, card.height - 16) }
}
