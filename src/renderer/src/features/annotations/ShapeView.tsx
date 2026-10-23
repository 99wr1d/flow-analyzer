import { LabelText } from './LabelText'
import { memo, useMemo } from 'react'
import {
  LEGACY_CIRCLE_FILL,
  isPitchAnnotation,
  isUnderPlayers,
  type Annotation,
  type ScreenAnnotation
} from '../../../../shared/annotations'
import type { LabelShift } from '../../../../shared/pitch/labelNudge'
import { groundEllipseRatioIn } from '../../../../shared/pitch/ground'
import type { Projector } from '../../../../shared/pitch/projector'
import {
  paintScreenTool,
  isScreenTool,
  type ScreenToolAnnotation
} from '../../../../shared/tools/screenPaint'
import { arrowShape } from './arrowGeometry'
import { bboxOf, handlesOf, type Size } from './geometry'
import { textRect, toPx } from './hit'
import {
  PaintHandles,
  PaintParts,
  TargetGradient,
  PitchBody,
  PitchHandlesView,
  type DrawPart
} from './PitchShapeView'
import {
  LINE_CORE_SCALE,
  TARGET_CENTER_ALPHA,
  TARGET_LINE_SCALE,
  TARGET_RADII,
  TARGET_RING_OPACITY,
  dashStyle,
  glowStack,
  isTarget,
  isTimeVarying,
  lineCoreColor,
  lineGlowStack,
  LINE_GLOW_BOOST,
  LINE_GLOW_REACH,
  pulseActive,
  pulsePhase,
  revealFraction,
  WAVE_LINE_SCALE,
  waveOpacity,
  waveScale
} from '../../../../shared/styleFx'
import { isDarkColor } from './styles'
import { measureTextWidth } from './textMetrics'

const HALO = 'rgba(43, 214, 123, 0.38)'
const ACCENT = '#2bd67b'

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
  /** Какую часть рисовать: у рисунков «под игроков» экран и растр делят её между собой (см. PaintParts). */
  part?: DrawPart
  /**
   * Вместе с частью «top» оставить в разметке невидимую (visibility: hidden) копию «ground»: саму траву рисует WebGL-слой,
   * а копия хранит геометрию рисунка в DOM (рамки, точки, data-part) для проверки и измерений. Ничего не рисует.
   */
  keepGround?: boolean
  /** Сдвиги подписей на поле (пиксели): см. pitchLabelShifts. */
  labelShift?: LabelShift
  /** Время видео, секунды: нужно пульсу (нет — волны нет). */
  time?: number
}

/** Новые рисунки на экране (прожектор, кривая, перо, зона, лупа, связи): геометрию считает paintScreenTool. */
function ScreenToolBody({
  annotation: a,
  size,
  selected,
  shadowClass,
  part,
  time,
  projector
}: {
  annotation: ScreenToolAnnotation
  size: Size
  selected: boolean
  shadowClass?: string
  part?: DrawPart
  time?: number
  projector?: Projector | null
}): React.JSX.Element {
  // Кольца у ног связки на экране — плоские эллипсы «на траве»: наклон по разметке поля, если она есть.
  const paint = useMemo(
    () =>
      paintScreenTool(
        a,
        size,
        time,
        projector ? (at) => groundEllipseRatioIn(projector, size.w / size.h, at) : undefined
      ),
    [a, size, time, projector]
  )
  return (
    <PaintParts
      paint={paint}
      id={a.id}
      color={a.style.color}
      size={size}
      selected={selected}
      shadowClass={shadowClass}
      part={part}
    />
  )
}

/** Волна пульса экранного круга: эллипс растёт от центра к краю и бледнеет. */
function WaveEllipse(p: {
  cx: number
  cy: number
  rx: number
  ry: number
  phase: number
  color: string
  w: number
}): React.JSX.Element {
  return (
    <ellipse
      data-part="wave"
      cx={p.cx}
      cy={p.cy}
      rx={p.rx * waveScale(p.phase)}
      ry={p.ry * waveScale(p.phase)}
      fill="none"
      stroke={p.color}
      strokeOpacity={waveOpacity(p.phase)}
      strokeWidth={p.w * WAVE_LINE_SCALE}
    />
  )
}

function ShapeBody({
  annotation: a,
  size,
  selected,
  shadowClass,
  part = 'all',
  time,
  projector
}: ShapeProps & { annotation: ScreenAnnotation; shadowClass?: string }): React.JSX.Element {
  if (isScreenTool(a)) {
    return (
      <ScreenToolBody
        annotation={a}
        size={size}
        selected={selected}
        shadowClass={shadowClass}
        part={part}
        time={isTimeVarying(a) ? time : undefined}
        projector={projector}
      />
    )
  }
  // Обычные фигуры (стрелка, линия, круг) «под игроками»: сверху остаётся лишь бледная обводка выбранной.
  if (part === 'top')
    return selected && a.type !== 'text' ? <ClassicHalo annotation={a} size={size} /> : <></>
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
        <LabelText
          text={a.text}
          x={r.x + pad}
          y={r.y + r.h / 2}
          fontPx={font}
          color={a.style.color}
          plate={a.style.background}
          shadow={a.style.shadow}
        />
      </>
    )
  }

  const p1 = toPx(a.p1, size)
  const p2 = toPx(a.p2, size)
  const w = Math.max(1, a.style.width * size.h)
  const color = a.style.color

  if (a.type === 'circle') {
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2
    const rx = Math.abs(p2.x - p1.x) / 2
    const ry = Math.abs(p2.y - p1.y) / 2
    if (isTarget(a)) {
      // «Мишень»: три кольца (1, 0.66, 0.33), радиальная заливка от центра к краю, волна пульса.
      const phase = pulseActive(a) && time !== undefined ? pulsePhase(time) : undefined
      return (
        <>
          {selected && (
            <ellipse
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              fill="none"
              stroke={HALO}
              strokeWidth={w + 8}
            />
          )}
          <defs>
            <TargetGradient id={a.id} color={color} />
          </defs>
          <ellipse
            data-part="disc"
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill={`url(#target-${a.id})`}
            fillOpacity={TARGET_CENTER_ALPHA}
            stroke="none"
          />
          {TARGET_RADII.map((k, ki) => (
            <g key={k} data-part="target-ring" data-k={k}>
              {a.glow === true &&
                glowStack(w * TARGET_LINE_SCALE, w * TARGET_LINE_SCALE).map((l, i) => (
                  <ellipse
                    key={`glow-${i}`}
                    data-part="glow"
                    cx={cx}
                    cy={cy}
                    rx={rx * k}
                    ry={ry * k}
                    fill="none"
                    stroke={color}
                    strokeOpacity={l.opacity}
                    strokeWidth={l.width}
                  />
                ))}
              <ellipse
                data-part="core"
                cx={cx}
                cy={cy}
                rx={rx * k}
                ry={ry * k}
                fill="none"
                stroke={color}
                strokeOpacity={TARGET_RING_OPACITY[ki]}
                strokeWidth={w * TARGET_LINE_SCALE}
              />
            </g>
          ))}
          {phase !== undefined && (
            <WaveEllipse cx={cx} cy={cy} rx={rx} ry={ry} phase={phase} color={color} w={w} />
          )}
        </>
      )
    }
    const phase = pulseActive(a) && time !== undefined ? pulsePhase(time) : undefined
    const ellipseLen = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
    const ds = dashStyle(a.style.dash, w, ellipseLen, true)
    return (
      <>
        {selected && (
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={HALO} strokeWidth={w + 8} />
        )}
        {a.glow === true &&
          glowStack(w, w).map((l, i) => (
            <ellipse
              key={`glow-${i}`}
              data-part="glow"
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              fill="none"
              stroke={color}
              strokeOpacity={l.opacity}
              strokeWidth={l.width}
              strokeDasharray={ds.array}
              strokeLinecap={ds.cap}
            />
          ))}
        <ellipse
          data-part="core"
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill={color}
          fillOpacity={a.fillOpacity ?? LEGACY_CIRCLE_FILL}
          stroke={color}
          strokeWidth={w}
          strokeDasharray={ds.array}
          strokeLinecap="round"
        />
        {phase !== undefined && (
          <WaveEllipse cx={cx} cy={cy} rx={rx} ry={ry} phase={phase} color={color} w={w} />
        )}
      </>
    )
  }

  // Стрелка и линия: свечение (ореол стопкой слоёв и светлое ядро) и проявление (путь обрезается по длине).
  const arrow = a.type === 'arrow' ? arrowShape(p1, p2, w) : null
  const shaftEnd = arrow ? arrow.lineEnd : p2
  const shaftLen = Math.hypot(shaftEnd.x - p1.x, shaftEnd.y - p1.y)
  // Точки раскладываются по длине всей линии, а не видимой части: они не ползут, пока линия растёт.
  const ds = dashStyle(a.style.dash, w, shaftLen)
  const frac = time === undefined ? 1 : revealFraction(a, time)
  // Стержень проявляется по своей длине: наконечник появляется ровно тогда, когда стержень дорос.
  const k = Math.min(1, frac)
  const end =
    frac >= 1 ? shaftEnd : { x: p1.x + (shaftEnd.x - p1.x) * k, y: p1.y + (shaftEnd.y - p1.y) * k }
  const glow = a.glow === true
  const head = arrow && frac >= 1 ? arrow.head.map((p) => `${p.x},${p.y}`).join(' ') : null
  const stroke = (
    key: string,
    part: string,
    stroked: string,
    width: number,
    opacity?: number
  ): React.JSX.Element => (
    <line
      key={key}
      data-part={part}
      x1={p1.x}
      y1={p1.y}
      x2={end.x}
      y2={end.y}
      stroke={stroked}
      strokeOpacity={opacity}
      strokeWidth={width}
      strokeDasharray={ds.array}
      strokeLinecap={ds.cap}
    />
  )
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
      {glow &&
        frac > 0 &&
        lineGlowStack(w).map((l, i) => stroke(`glow-${i}`, 'glow', color, l.width, l.opacity))}
      {glow &&
        head &&
        glowStack(0, w * LINE_GLOW_REACH, LINE_GLOW_BOOST).map((l, i) => (
          <polygon
            key={`head-glow-${i}`}
            data-part="glow"
            points={head}
            fill="none"
            stroke={color}
            strokeOpacity={l.opacity}
            strokeWidth={l.width}
            strokeLinejoin="round"
          />
        ))}
      {frac > 0 && stroke('line', 'line', color, w)}
      {head && (
        <polygon
          data-part="head"
          points={head}
          fill={color}
          stroke={color}
          strokeWidth={w * 0.5}
          strokeLinejoin="round"
        />
      )}
      {glow && frac > 0 && stroke('core', 'core', lineCoreColor(color), w * LINE_CORE_SCALE)}
    </>
  )
}

/** Обводка выбранной обычной фигуры, лежащей «под игроками»: рисуется поверх игроков, бледнее обычной. */
function ClassicHalo({
  annotation: a,
  size
}: {
  annotation: Exclude<ScreenAnnotation, { type: 'text' }>
  size: Size
}): React.JSX.Element {
  if (a.type !== 'arrow' && a.type !== 'line' && a.type !== 'circle') return <></>
  const p1 = toPx(a.p1, size)
  const p2 = toPx(a.p2, size)
  const w = Math.max(1, a.style.width * size.h)
  if (a.type === 'circle') {
    return (
      <ellipse
        cx={(p1.x + p2.x) / 2}
        cy={(p1.y + p2.y) / 2}
        rx={Math.abs(p2.x - p1.x) / 2}
        ry={Math.abs(p2.y - p1.y) / 2}
        fill="none"
        stroke={HALO}
        strokeWidth={w + 8}
        opacity={0.6}
      />
    )
  }
  return (
    <line
      x1={p1.x}
      y1={p1.y}
      x2={p2.x}
      y2={p2.y}
      stroke={HALO}
      strokeWidth={w + 8}
      strokeLinecap="round"
      opacity={0.6}
    />
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
      return JSON.stringify({
        center: a.center,
        radius: a.radius,
        dim: a.dim,
        dimmed: a.dimmed,
        beam: a.beam,
        form: a.form
      })
    case 'spot':
      return JSON.stringify({
        p1: a.p1,
        p2: a.p2,
        dim: a.dim,
        dimmed: a.dimmed,
        beam: a.beam,
        form: a.form
      })
    case 'curve':
    case 'pcurve':
      return JSON.stringify({ p1: a.p1, p2: a.p2, c: a.c })
    case 'pen':
    case 'ppen':
      return JSON.stringify({ points: a.points, arrow: a.arrow })
    case 'zone':
    case 'chain':
    case 'link':
    case 'pzone':
    case 'pchain':
    case 'plink':
      return JSON.stringify({ points: a.points })
    case 'loupe':
      return JSON.stringify({ pos: a.pos, src: a.src, radius: a.radius, zoom: a.zoom })
    default:
      return JSON.stringify({ p1: a.p1, p2: a.p2 })
  }
}

/** Виды рисунков с полупрозрачной подложкой (заливка зоны и связей, луч прожектора). */
const HAS_UNDERLAY = new Set(['zone', 'chain', 'link', 'pzone', 'pchain', 'plink', 'spot', 'pspot'])

export const ShapeView = memo(function ShapeView(props: ShapeProps): React.JSX.Element | null {
  const a = props.annotation
  const dark = isDarkColor(a.style.color)
  // Пульс идёт только у рисунка-отрезка: «только кадр» — стоп-кадр, в нём волны нет ни на экране, ни в экспорте.
  const time = a.timing.mode === 'range' ? props.time : undefined
  // Рисунок на поле без рабочей разметки (её удалили или точки некорректны) не показывается.
  if (isPitchAnnotation(a) && !props.projector) return null
  // Кольцо и линия со свечением рисуются без тени: тёмная кайма под ореолом портила бы его.
  const glowing = 'glow' in a && a.glow === true
  // Подпись без плашки с полем shadow сама решает про тень (тонкая тёмная кайма букв или никакой); общая тень группы — только старым подписям.
  const ownShadow =
    (a.type === 'text' || a.type === 'ptext') && !a.style.background && a.style.shadow !== undefined
  const shadow =
    glowing || ownShadow ? undefined : dark ? 'anno-shape anno-shape--dark' : 'anno-shape'
  // У рисунков с полупрозрачной заливкой тень на группе просвечивала бы сквозь заливку: тень получают только линии и подписи.
  const split = HAS_UNDERLAY.has(a.type)
  const body = (part: DrawPart | undefined, selected: boolean): React.JSX.Element =>
    isPitchAnnotation(a) ? (
      <PitchBody
        annotation={a}
        size={props.size}
        selected={selected}
        projector={props.projector}
        shadowClass={split ? shadow : undefined}
        part={part}
        labelShift={props.labelShift}
        time={time}
      />
    ) : (
      <ShapeBody
        {...props}
        time={time}
        annotation={a}
        selected={selected}
        part={part}
        shadowClass={split ? shadow : undefined}
      />
    )
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
      data-under={isUnderPlayers(a) ? 'true' : 'false'}
      data-glow={glowing ? 'true' : undefined}
      data-form={a.type === 'spot' || a.type === 'pspot' ? (a.form ?? 'oval') : undefined}
      data-dimmed={props.dimmed ? 'true' : undefined}
      opacity={props.dimmed ? 0.5 : undefined}
    >
      {props.part === 'top' && props.keepGround && (
        <g visibility="hidden" aria-hidden="true" data-layer="ground" pointerEvents="none">
          {body('ground', false)}
        </g>
      )}
      {body(props.part, props.selected)}
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
