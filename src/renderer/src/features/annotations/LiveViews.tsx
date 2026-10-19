// Обёртки для движущихся рисунков: геометрия на показанный кадр берётся из часов анимации (animClock). Рисунок без
// движения возвращается как есть, поэтому для него обёртка ничего не стоит и перерисовок не вызывает.
import type { ComponentProps } from 'react'
import { useLive, useLiveList } from './animClock'
import { HandlesView, ShapeView } from './ShapeView'
import { SpotlightDim } from './SpotlightDim'

export function LiveShape(props: ComponentProps<typeof ShapeView>): React.JSX.Element | null {
  const annotation = useLive(props.annotation)
  return <ShapeView {...props} annotation={annotation} />
}

export function LiveHandles(props: ComponentProps<typeof HandlesView>): React.JSX.Element | null {
  const annotation = useLive(props.annotation)
  return <HandlesView {...props} annotation={annotation} />
}

export function LiveSpotlightDim(
  props: ComponentProps<typeof SpotlightDim>
): React.JSX.Element | null {
  const items = useLiveList(props.items)
  return <SpotlightDim {...props} items={items} />
}
