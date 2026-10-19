// Прожектор: общее затемнение кадра с «дырами» там, где светят прожекторы. Все прожекторы одного момента
// складываются в одну маску (SVG mask): затемнение — самое сильное из прожекторов, светлые пятна объединяются.
import { useMemo } from 'react'
import type { Annotation } from '../../../../shared/annotations'
import { composeSpotlights, spotlightBlur } from '../../../../shared/tools/spotlight'
import type { Size } from './geometry'
import { pathOf } from './pathOf'
import { spotInputs, type ProjectorOf } from './spotInputs'

export function SpotlightDim({
  items,
  size,
  projectorOf
}: {
  items: readonly Annotation[]
  size: Size
  projectorOf: ProjectorOf
}): React.JSX.Element | null {
  const mask = useMemo(
    () => composeSpotlights(spotInputs(items, size, projectorOf)),
    [items, size, projectorOf]
  )
  if (!mask) return null
  const blur = spotlightBlur(size.h)
  return (
    <g
      data-testid="spotlight-dim"
      data-dim={mask.dim}
      data-holes={mask.holes.length}
      pointerEvents="none"
    >
      <defs>
        <filter
          id="spot-soft"
          filterUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={size.w}
          height={size.h}
        >
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <mask id="spot-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={size.w} height={size.h}>
          <rect x={0} y={0} width={size.w} height={size.h} fill="#fff" />
          <path d={pathOf(mask.holes)} fill="#000" filter="url(#spot-soft)" />
        </mask>
      </defs>
      <rect
        x={0}
        y={0}
        width={size.w}
        height={size.h}
        fill="#000"
        fillOpacity={mask.dim}
        mask="url(#spot-mask)"
      />
    </g>
  )
}
