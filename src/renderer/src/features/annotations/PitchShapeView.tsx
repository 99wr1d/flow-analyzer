// Рисунки на поле: отрисовка того, что посчитал paintPitch (фигуры уже спроецированы в пиксели кадра).
import { useMemo } from 'react'
import type { PitchAnnotation } from '../../../../shared/annotations'
import type { Projector } from '../../../../shared/pitch/projector'
import { paintPitch, type LabelPaint } from '../../../../shared/pitch/shapes'
import type { Size } from './geometry'
import { pathOf } from './pathOf'
import { isDarkColor } from './styles'
import { TEXT_FONT_FAMILY, TEXT_FONT_WEIGHT, measureTextWidth } from './textMetrics'

const HALO = 'rgba(43, 214, 123, 0.38)'
const ACCENT = '#2bd67b'
const LABEL_BG = 'rgba(10, 12, 16, 0.82)'

/** Подпись с плашкой: текст рисунка на поле и значение линейки. */
function PillLabel({
  label,
  color,
  background,
  ruler
}: {
  label: LabelPaint
  color: string
  background: boolean
  ruler: boolean
}): React.JSX.Element {
  const dark = isDarkColor(color)
  const x = label.x - label.w / 2
  const y = label.y - label.h / 2
  const plain = !ruler && !background
  return (
    <g data-testid={ruler ? 'ruler-label' : 'ground-label'}>
      {!plain && (
        <rect
          x={x}
          y={y}
          width={label.w}
          height={label.h}
          rx={label.fontPx * 0.32}
          fill={ruler ? LABEL_BG : dark ? 'rgba(255,255,255,0.88)' : 'rgba(10,12,16,0.68)'}
          stroke={ruler ? color : undefined}
          strokeWidth={ruler ? Math.max(1, label.fontPx * 0.07) : undefined}
        />
      )}
      <text
        x={label.x}
        y={label.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={label.fontPx}
        fontFamily={TEXT_FONT_FAMILY}
        fontWeight={TEXT_FONT_WEIGHT}
        fill={ruler ? '#ffffff' : color}
        stroke={plain ? (dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)') : undefined}
        strokeWidth={plain ? label.fontPx * 0.14 : undefined}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {label.text}
      </text>
    </g>
  )
}

interface PitchProps {
  annotation: PitchAnnotation
  size: Size
  selected: boolean
  projector: Projector | null | undefined
}

export function PitchBody({
  annotation: a,
  size,
  selected,
  projector
}: PitchProps): React.JSX.Element | null {
  const paint = useMemo(
    () => (projector ? paintPitch(a, projector, size, measureTextWidth) : null),
    [a, projector, size]
  )
  if (!paint || !paint.visible) return null
  const color = a.style.color
  const minStroke = Math.max(1, size.h / 600)
  return (
    <>
      {selected && paint.hit.length > 0 && (
        <path
          d={pathOf(paint.hit)}
          fill="none"
          stroke={HALO}
          strokeWidth={8}
          strokeLinejoin="round"
        />
      )}
      {paint.disc.length > 0 && (
        <path data-part="disc" d={pathOf(paint.disc)} fill={color} fillOpacity={0.18} />
      )}
      {paint.body.length > 0 && (
        <path
          data-part="body"
          d={pathOf(paint.body)}
          fill={color}
          stroke={color}
          strokeWidth={minStroke}
          strokeLinejoin="round"
        />
      )}
      {paint.label?.stem && (
        <line
          x1={paint.label.stem.x1}
          y1={paint.label.stem.y1}
          x2={paint.label.stem.x2}
          y2={paint.label.stem.y2}
          stroke={color}
          strokeWidth={Math.max(1.5, size.h / 400)}
          strokeLinecap="round"
        />
      )}
      {paint.dot && (
        <ellipse
          cx={paint.dot.x}
          cy={paint.dot.y}
          rx={Math.max(3, size.h / 150)}
          ry={Math.max(1.6, size.h / 300)}
          fill={color}
          stroke="rgba(0,0,0,0.5)"
          strokeWidth={1}
        />
      )}
      {paint.label && (
        <PillLabel
          label={paint.label}
          color={color}
          background={a.type === 'ptext' ? a.style.background : true}
          ruler={a.type === 'ruler'}
        />
      )}
    </>
  )
}

/** Белые круглые ручки поверх выбранного рисунка на поле. */
export function PitchHandlesView({
  annotation,
  size,
  projector
}: {
  annotation: PitchAnnotation
  size: Size
  projector: Projector | null | undefined
}): React.JSX.Element | null {
  if (!projector) return null
  const handles = paintPitch(annotation, projector, size, measureTextWidth).handles
  if (handles.length === 0) return null
  return (
    <g data-testid="handles">
      {handles.map((h) => (
        <circle
          key={h.id}
          className="anno-handle"
          data-handle={h.id}
          cx={h.point.x}
          cy={h.point.y}
          r={5.5}
          fill="#fff"
          stroke={ACCENT}
          strokeWidth={2}
        />
      ))}
    </g>
  )
}
