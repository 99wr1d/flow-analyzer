// Схема поля в режиме разметки: показывает часть поля, нужные точки и какую отметить следующей.
import { useMemo } from 'react'
import { ru } from '../../i18n/ru'
import { gridPrimitives } from './gridPaths'
import { arcPoints } from '../../../../shared/pitch/landmarks'
import { nextToPlace, placedRequired, templateOf, type CalibrationDraft } from './draft'

const MAP_WIDTH = 264
const MAP_MAX_HEIGHT = 140

function primitivePath(prim: ReturnType<typeof gridPrimitives>[number]): string {
  if (prim.kind === 'polyline') {
    return (
      'M' +
      prim.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L') +
      (prim.closed ? 'Z' : '')
    )
  }
  const n = Math.max(8, Math.ceil(Math.abs(prim.to - prim.from) / (Math.PI / 36)))
  return (
    'M' +
    arcPoints(prim.center, prim.radius, prim.from, prim.to, n)
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join('L')
  )
}

interface Props {
  draft: CalibrationDraft
  onPickExtra: (pointId: string) => void
}

export function MiniMap({ draft, onPickExtra }: Props): React.JSX.Element {
  const template = templateOf(draft)
  const { view } = template
  const vw = view.x1 - view.x0
  const vh = view.y1 - view.y0
  const scale = Math.min(MAP_WIDTH / vw, MAP_MAX_HEIGHT / vh)
  const width = Math.round(vw * scale)
  const height = Math.round(vh * scale)
  const field =
    draft.template === 'rect'
      ? { x: 0, y: 0, w: draft.rect.w, h: draft.rect.h }
      : { x: 0, y: 0, w: draft.pitch.length, h: draft.pitch.width }
  const paths = useMemo(
    () => gridPrimitives(draft.template, draft.pitch, draft.rect).map(primitivePath).join(''),
    [draft.template, draft.pitch, draft.rect]
  )
  const placedKeys = new Set(draft.points.map((p) => p.key))
  const next = nextToPlace(draft)
  const nextIndex = placedRequired(draft)
  const allRequired = nextIndex >= template.required.length
  // Радиус маркера в метрах: на экране около 9 пикселей.
  const r = 9 / scale
  const font = 11 / scale

  return (
    <svg
      className="cal-minimap"
      data-testid="cal-minimap"
      width={width}
      height={height}
      viewBox={`${view.x0} ${view.y0} ${vw} ${vh}`}
      role="img"
      aria-label={ru.pitch.mode.title}
    >
      <rect x={view.x0} y={view.y0} width={vw} height={vh} fill="#14301f" />
      <rect x={field.x} y={field.y} width={field.w} height={field.h} fill="#1f7a3d" />
      <path
        d={paths}
        fill="none"
        stroke="rgba(255,255,255,0.78)"
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {template.extras.map((p) => {
        const placed = placedKeys.has(p.id)
        const pending = draft.pendingExtra?.id === p.id
        const clickable = draft.addingExtra && !placed
        return (
          <g
            key={p.id}
            data-testid={`cal-extra-${p.id}`}
            data-state={placed ? 'placed' : pending ? 'pending' : 'free'}
            className={clickable ? 'cal-map-extra cal-map-extra--click' : 'cal-map-extra'}
            onClick={clickable ? () => onPickExtra(p.id) : undefined}
          >
            <title>{p.label}</title>
            <circle cx={p.world.x} cy={p.world.y} r={r * 1.6} fill="transparent" />
            <circle
              cx={p.world.x}
              cy={p.world.y}
              r={r * 0.62}
              fill={placed ? '#2bd67b' : pending ? '#ffd60a' : 'rgba(10,12,16,0.55)'}
              stroke={pending ? '#ffd60a' : placed ? '#2bd67b' : 'rgba(255,255,255,0.85)'}
              strokeWidth={1.3}
              vectorEffect="non-scaling-stroke"
              opacity={
                allRequired || placed ? (draft.addingExtra || placed || pending ? 1 : 0.7) : 0.4
              }
            />
          </g>
        )
      })}
      {template.required.map((p, i) => {
        const placed = placedKeys.has(p.id)
        const isNext = next?.id === p.id
        return (
          <g
            key={p.id}
            data-testid={`cal-point-${i + 1}`}
            data-state={placed ? 'placed' : isNext ? 'next' : 'todo'}
          >
            <title>{p.label}</title>
            {isNext && (
              <circle
                className="cal-map-pulse"
                cx={p.world.x}
                cy={p.world.y}
                r={r * 1.25}
                fill="none"
                stroke="#ffd60a"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <circle
              cx={p.world.x}
              cy={p.world.y}
              r={r}
              fill={placed ? '#2bd67b' : isNext ? '#ffd60a' : 'rgba(10,12,16,0.7)'}
              stroke={placed ? '#0b3d22' : isNext ? '#6b5600' : 'rgba(255,255,255,0.85)'}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={p.world.x}
              y={p.world.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={font}
              fontWeight={700}
              fill={placed || isNext ? '#08140d' : '#fff'}
            >
              {i + 1}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
