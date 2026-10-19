import { memo, useMemo } from 'react'
import {
  isPitchAnnotation,
  type Annotation,
  type ScreenAnnotation
} from '../../../../shared/annotations'
import type { Projector } from '../../../../shared/pitch/projector'
import {
  paintScreenTool,
  isScreenTool,
  type ScreenToolAnnotation
} from '../../../../shared/tools/screenPaint'
import { arrowShape } from './arrowGeometry'
import { bboxOf, handlesOf, type Size } from './geometry'
import { textRect, toPx } from './hit'
import { PaintHandles, PaintParts, PitchBody, PitchHandlesView } from './PitchShapeView'
import { isDarkColor } from './styles'
import { TEXT_FONT_FAMILY, TEXT_FONT_WEIGHT, measureTextWidth } from './textMetrics'

const HALO = 'rgba(43, 214, 123, 0.38)'
const ACCENT = '#2bd67b'

function dashArray(width: number, dash: 'solid' | 'dashed'): string | undefined {
  return dash === 'dashed' ? `${width * 2.4} ${width * 1.8}` : undefined
}

interface ShapeProps {
  annotation: Annotation
  size: Size
  selected: boolean
  /** Показывать ручки (только с инструментом «Выбор»). */
  showHandles: boolean
  /** Проектор разметки поля — нужен рисункам на поле. */
  projector?: Projector | null
  /** Рисунок на поле показан далеко от кадра разметки: камера могла сдвинуться, рисуем бледнее. */
  dimmed?: boolean
}

/** Новые рисунки на экране (прожектор, кривая, перо, зона, лупа, связи): геометрию считает paintScreenTool. */
function ScreenToolBody({
  annotation: a,
  size,
  selected,
  shadowClass
}: {
  annotation: ScreenToolAnnotation
  size: Size
  selected: boolean
  shadowClass?: string
}): React.JSX.Element {
  const paint = useMemo(() => paintScreenTool(a, size), [a, size])
  return (
    <PaintParts
      paint={paint}
      id={a.id}
      color={a.style.color}
      size={size}
      selected={selected}
      shadowClass={shadowClass}
    />
  )
}

function ShapeBody({
  annotation: a,
  size,
  selected,
  shadowClass
}: ShapeProps & { annotation: ScreenAnnotation; shadowClass?: string }): React.JSX.Element {
  if (isScreenTool(a)) {
    return (
      <ScreenToolBody annotation={a} size={size} selected={selected} shadowClass={shadowClass} />
    )
  }
  if (a.type === 'text') {
    const font = a.style.size * size.h
    const width = measureTextWidth(a.text, font)
    const r = textRect(a, size, width)
    const dark = isDarkColor(a.style.color)
    const pad = font * 0.3
    return (
      <>
        {selected && (
          <rect
            x={r.x - 3}
            y={r.y - 3}
            width={r.w + 6}
            height={r.h + 6}
            rx={font * 0.22}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}
        {a.style.background && (
          <rect
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={font * 0.2}
            fill={dark ? 'rgba(255,255,255,0.88)' : 'rgba(10,12,16,0.68)'}
          />
        )}
        <text
          x={r.x + pad}
          y={r.y + r.h / 2}
          dominantBaseline="central"
          fontSize={font}
          fontFamily={TEXT_FONT_FAMILY}
          fontWeight={TEXT_FONT_WEIGHT}
          fill={a.style.color}
          stroke={
            a.style.background ? undefined : dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)'
          }
          strokeWidth={a.style.background ? undefined : font * 0.14}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {a.text}
        </text>
      </>
    )
  }

  const p1 = toPx(a.p1, size)
  const p2 = toPx(a.p2, size)
  const w = Math.max(1, a.style.width * size.h)
  const dash = dashArray(w, a.style.dash)
  const color = a.style.color

  if (a.type === 'circle') {
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2
    const rx = Math.abs(p2.x - p1.x) / 2
    const ry = Math.abs(p2.y - p1.y) / 2
    return (
      <>
        {selected && (
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={HALO} strokeWidth={w + 8} />
        )}
        <ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill={color}
          fillOpacity={0.16}
          stroke={color}
          strokeWidth={w}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      </>
    )
  }

  if (a.type === 'line') {
    return (
      <>
        {selected && (
          <line
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={HALO}
            strokeWidth={w + 8}
            strokeLinecap="round"
          />
        )}
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={color}
          strokeWidth={w}
          strokeDasharray={dash}
          strokeLinecap={a.style.dash === 'dashed' ? 'butt' : 'round'}
        />
      </>
    )
  }

  const arrow = arrowShape(p1, p2, w)
  const points = arrow.head.map((p) => `${p.x},${p.y}`).join(' ')
  return (
    <>
      {selected && (
        <>
          <line
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={HALO}
            strokeWidth={w + 8}
            strokeLinecap="round"
          />
        </>
      )}
      <line
        x1={p1.x}
        y1={p1.y}
        x2={arrow.lineEnd.x}
        y2={arrow.lineEnd.y}
        stroke={color}
        strokeWidth={w}
        strokeDasharray={dash}
        strokeLinecap={a.style.dash === 'dashed' ? 'butt' : 'round'}
      />
      <polygon
        points={points}
        fill={color}
        stroke={color}
        strokeWidth={w * 0.5}
        strokeLinejoin="round"
      />
    </>
  )
}

function geometryOf(a: Annotation): string {
  switch (a.type) {
    case 'text':
    case 'ptext':
      return JSON.stringify({ pos: a.pos })
    case 'ring':
      return JSON.stringify({ center: a.center, radius: a.radius })
    case 'pspot':
      return JSON.stringify({ center: a.center, radius: a.radius, dim: a.dim, beam: a.beam })
    case 'spot':
      return JSON.stringify({ p1: a.p1, p2: a.p2, dim: a.dim })
    case 'curve':
    case 'pcurve':
      return JSON.stringify({ p1: a.p1, p2: a.p2, c: a.c })
    case 'pen':
    case 'ppen':
      return JSON.stringify({ points: a.points, arrow: a.arrow })
    case 'zone':
    case 'chain':
    case 'pzone':
    case 'pchain':
      return JSON.stringify({ points: a.points })
    case 'loupe':
      return JSON.stringify({ pos: a.pos, src: a.src, radius: a.radius, zoom: a.zoom })
    default:
      return JSON.stringify({ p1: a.p1, p2: a.p2 })
  }
}

/** Виды рисунков с полупрозрачной подложкой (заливка зоны и связей, луч прожектора). */
const HAS_UNDERLAY = new Set(['zone', 'chain', 'pzone', 'pchain', 'spot', 'pspot'])

export const ShapeView = memo(function ShapeView(props: ShapeProps): React.JSX.Element | null {
  const a = props.annotation
  const dark = isDarkColor(a.style.color)
  // Рисунок на поле без рабочей разметки (её удалили или точки некорректны) не показывается.
  if (isPitchAnnotation(a) && !props.projector) return null
  const shadow = dark ? 'anno-shape anno-shape--dark' : 'anno-shape'
  // У рисунков с полупрозрачной заливкой тень на группе просвечивала бы сквозь заливку: тень получают только линии и подписи.
  const split = HAS_UNDERLAY.has(a.type)
  return (
    <g
      className={split ? undefined : shadow}
      data-testid="annotation"
      data-id={a.id}
      data-type={a.type}
      data-space={a.space}
      data-color={a.style.color}
      data-geo={geometryOf(a)}
      data-text={a.type === 'text' || a.type === 'ptext' ? a.text : undefined}
      data-selected={props.selected}
      data-dimmed={props.dimmed ? 'true' : undefined}
      opacity={props.dimmed ? 0.5 : undefined}
    >
      {isPitchAnnotation(a) ? (
        <PitchBody
          annotation={a}
          size={props.size}
          selected={props.selected}
          projector={props.projector}
          shadowClass={split ? shadow : undefined}
        />
      ) : (
        <ShapeBody {...props} annotation={a} shadowClass={split ? shadow : undefined} />
      )}
    </g>
  )
})

/** Белые круглые ручки поверх выбранного рисунка. */
export function HandlesView({
  annotation,
  size,
  projector,
  selectedNode
}: {
  annotation: Annotation
  size: Size
  projector?: Projector | null
  /** Выбранная вершина зоны или связи (подсвечивается). */
  selectedNode?: number | null
}): React.JSX.Element | null {
  if (isPitchAnnotation(annotation)) {
    return (
      <PitchHandlesView
        annotation={annotation}
        size={size}
        projector={projector}
        selectedNode={selectedNode}
      />
    )
  }
  if (isScreenTool(annotation)) {
    const paint = paintScreenTool(annotation, size)
    const box = annotation.type === 'spot' ? bboxOf(annotation) : null
    return (
      <>
        {box && (
          <rect
            x={box.x0 * size.w}
            y={box.y0 * size.h}
            width={(box.x1 - box.x0) * size.w}
            height={(box.y1 - box.y0) * size.h}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.8}
            pointerEvents="none"
          />
        )}
        <PaintHandles paint={paint} selectedNode={selectedNode} />
      </>
    )
  }
  const handles = handlesOf(annotation)
  if (handles.length === 0) return null
  const box = bboxOf(annotation)
  return (
    <g data-testid="handles">
      {annotation.type === 'circle' && (
        <rect
          x={box.x0 * size.w}
          y={box.y0 * size.h}
          width={(box.x1 - box.x0) * size.w}
          height={(box.y1 - box.y0) * size.h}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1}
          strokeDasharray="4 4"
          opacity={0.8}
        />
      )}
      {handles.map((h) => (
        <circle
          key={h.id}
          className="anno-handle"
          data-handle={h.id}
          cx={h.point.x * size.w}
          cy={h.point.y * size.h}
          r={5.5}
          fill="#fff"
          stroke={ACCENT}
          strokeWidth={2}
        />
      ))}
    </g>
  )
}
