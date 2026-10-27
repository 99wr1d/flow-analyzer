// Отрисовка того, что посчитали paintPitch / paintScreenTool (фигуры уже в пикселях кадра).
// Один код для рисунков на поле, новых рисунков на экране и для экспорта.
import { useMemo } from 'react'
import type { PitchAnnotation } from '../../../../shared/annotations'
import { shiftLabel, type LabelShift } from '../../../../shared/pitch/labelNudge'
import type { Projector } from '../../../../shared/pitch/projector'
import {
  paintPitch,
  type LabelPaint,
  type PitchPaint,
  type StrokePaint
} from '../../../../shared/pitch/shapes'
import {
  TARGET_FILL_STOPS,
  TARGET_RING_OPACITY,
  LINE_CORE_SCALE,
  dashStyle,
  glowStack,
  lineCoreColor,
  lineGlowStack
} from '../../../../shared/styleFx'
import {
  PILLAR_LAYERS,
  PILLAR_VERTICAL_STOPS,
  pillarSplit,
  type PillarPaint
} from '../../../../shared/tools/pillar'
import type { Size } from './geometry'
import { pathOf } from './pathOf'
import { LabelText } from './LabelText'
import { isDarkColor } from './styles'
import { TEXT_FONT_FAMILY, TEXT_FONT_WEIGHT, measureTextWidth } from './textMetrics'

const HALO = 'rgba(43, 214, 123, 0.38)'
const ACCENT = '#2bd67b'
const LABEL_BG = 'rgba(10, 12, 16, 0.82)'

const LABEL_TEST_ID: Record<LabelPaint['kind'], string> = {
  ruler: 'ruler-label',
  text: 'ground-label',
  area: 'area-label',
  segment: 'segment-label',
  width: 'width-label'
}

/** Подпись с плашкой: текст рисунка на поле, значение линейки, длины звеньев, площадь. */
export function PillLabel({
  label,
  color,
  background,
  shadow
}: {
  label: LabelPaint
  color: string
  /** Только для подписей-текста: показывать ли плашку. */
  background: boolean
  /** Тень подписи-текста (нет поля — прежний контур без плашки). */
  shadow?: boolean
}): React.JSX.Element {
  const dark = isDarkColor(color)
  const x = label.x - label.w / 2
  const y = label.y - label.h / 2
  const measured = label.kind !== 'text'
  const framed = label.kind === 'width' || label.kind === 'area' || label.kind === 'ruler'
  return (
    <g data-testid={LABEL_TEST_ID[label.kind]} data-text={label.text}>
      {(measured || background) && (
        <rect
          x={x}
          y={y}
          width={label.w}
          height={label.h}
          rx={label.fontPx * 0.32}
          fill={measured ? LABEL_BG : dark ? 'rgba(255,255,255,0.88)' : 'rgba(10,12,16,0.68)'}
          stroke={framed ? color : undefined}
          strokeWidth={framed ? Math.max(1, label.fontPx * 0.07) : undefined}
        />
      )}
      {measured ? (
        <text
          x={label.x}
          y={label.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={label.fontPx}
          fontFamily={TEXT_FONT_FAMILY}
          fontWeight={TEXT_FONT_WEIGHT}
          fill="#ffffff"
        >
          {label.text}
        </text>
      ) : (
        <LabelText
          text={label.text}
          x={label.x}
          y={label.y}
          fontPx={label.fontPx}
          color={color}
          plate={background}
          shadow={shadow}
          anchor="middle"
        />
      )}
    </g>
  )
}

/** Радиальная заливка «мишени»: от цвета в центре к прозрачности у края (профиль — TARGET_FILL_STOPS). */
export function TargetGradient({ id, color }: { id: string; color: string }): React.JSX.Element {
  return (
    <radialGradient id={`target-${id}`}>
      {TARGET_FILL_STOPS.map((s) => (
        <stop key={s.offset} offset={s.offset} stopColor={color} stopOpacity={s.alpha} />
      ))}
    </radialGradient>
  )
}

/**
 * Световой столб: вертикальная полоса по экрану от верха кадра до ног. Стопка вертикальных полос разной ширины с одним
 * вертикальным градиентом (без SVG-фильтров: одинаково на экране и в экспорте) — ярче к низу и к оси, края мягко тают;
 * внизу лужица света на ногах.
 */
export function Pillar({
  id,
  pillar,
  color,
  section = 'all'
}: {
  id: string
  pillar: PillarPaint
  color: string
  /**
   * Какая часть столба: «lower» — от ног до pillarSplit (у рисунка «под игроками» — под игроками, с лужицей света),
   * «upper» — выше (всегда поверх кадра), «all» — весь. Градиент общий: части стыкуются без шва.
   */
  section?: 'all' | 'lower' | 'upper'
}): React.JSX.Element {
  const { x, half, top, bottom } = pillar
  const extra = half * 3
  const split = pillarSplit(pillar)
  const y0 = section === 'lower' ? split : top - extra
  const y1 = section === 'upper' ? split : bottom
  return (
    <g data-part="pillar" data-section={section} pointerEvents="none">
      <defs>
        <linearGradient
          id={`pillar-${id}`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1={top}
          x2="0"
          y2={bottom}
        >
          {PILLAR_VERTICAL_STOPS.map((s) => (
            <stop key={s.offset} offset={s.offset} stopColor={color} stopOpacity={s.alpha} />
          ))}
        </linearGradient>
        <radialGradient id={`pillar-pool-${id}`}>
          <stop offset="0" stopColor={color} stopOpacity="0.55" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      {PILLAR_LAYERS.map((l, i) => (
        <rect
          key={i}
          data-part="pillar-layer"
          x={x - half * l.reach}
          y={y0}
          width={2 * half * l.reach}
          height={Math.max(0, y1 - y0)}
          fill={`url(#pillar-${id})`}
          fillOpacity={l.alpha}
          stroke="none"
        />
      ))}
      {section !== 'upper' && (
        <ellipse
          data-part="pillar-pool"
          cx={x}
          cy={bottom}
          rx={half * 1.9}
          ry={half * 0.55}
          fill={`url(#pillar-pool-${id})`}
        />
      )}
    </g>
  )
}

/** Длина линии в пикселях (замкнутая — с замыкающим звеном): нужна точкам, чтобы лечь поровну. */
const strokeLength = (pts: readonly { x: number; y: number }[], closed: boolean): number => {
  let len = 0
  for (let i = 1; i < pts.length; i += 1)
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  if (closed && pts.length > 1)
    len += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y)
  return len
}

/** Штриховка линии рисунка на экране; точки раскладываются по длине всей линии (layoutLength), пока видна её часть. */
const strokeDash = (s: StrokePaint): ReturnType<typeof dashStyle> =>
  dashStyle(s.dash, s.widthPx, s.layoutLength ?? strokeLength(s.points, s.closed), s.closed)

const strokeD = (s: StrokePaint): string => pathOf([s.points]).replace(/Z$/, s.closed ? 'Z' : '')

const pointsAttr = (poly: readonly { x: number; y: number }[]): string =>
  poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

interface PaintProps {
  paint: PitchPaint
  /** Для уникального id градиента «луча». */
  id: string
  color: string
  size: Size
  selected: boolean
  /** Плашка под текстом (для ptext). */
  textBackground?: boolean
  /** Тень подписи (для ptext). */
  textShadow?: boolean
  /** Класс тени для всего, кроме полупрозрачных подложек (если не задан, тень задаёт родитель). */
  shadowClass?: string
  /**
   * Какую часть рисовать (рисунки «под игроками» делятся на две): «ground» — всё, что лежит на траве (заливка, линии, узлы),
   * «top» — то, что всегда поверх игроков (подписи, луч прожектора) и бледная обводка выбранного рисунка;
   * «all» — всё вместе (обычный рисунок).
   */
  part?: DrawPart
}

/** Часть рисунка: см. PaintProps.part. */
export type DrawPart = 'all' | 'ground' | 'top'

/** Всё, что нужно нарисовать по результату paintPitch / paintScreenTool. */
export function PaintParts({
  paint,
  id,
  color,
  size,
  selected,
  textBackground = true,
  textShadow,
  shadowClass,
  part = 'all'
}: PaintProps): React.JSX.Element | null {
  if (!paint.visible) return null
  const ground = part !== 'top'
  const top = part !== 'ground'
  const minStroke = Math.max(1, size.h / 600)
  const dark = isDarkColor(color)
  const lens = paint.lens
  // Полупрозрачные подложки (заливка зоны, луч) рисуются вне блока с тенью: иначе тень проглядывает сквозь них.
  const under = (
    <>
      {ground && paint.fills.length > 0 && (
        <path
          data-part="fill"
          d={pathOf(paint.fills)}
          fill={color}
          fillOpacity={paint.fillOpacity}
          stroke="none"
        />
      )}
      {paint.pillar && top && (
        <Pillar
          id={id}
          pillar={paint.pillar}
          color={color}
          section={part === 'all' ? 'all' : 'upper'}
        />
      )}
      {paint.pillar && part === 'ground' && (
        <Pillar id={id} pillar={paint.pillar} color={color} section="lower" />
      )}
      {top && paint.beam && (
        <>
          <defs>
            <linearGradient
              id={`beam-${id}`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1={paint.beam.bottom}
              x2="0"
              y2={paint.beam.top}
            >
              <stop offset="0" stopColor={color} stopOpacity="0.42" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            data-part="beam"
            points={pointsAttr(paint.beam.poly)}
            fill={`url(#beam-${id})`}
            stroke="none"
          />
        </>
      )}
    </>
  )
  // Обводка выбранного рисунка: у рисунка «под игроками» она рисуется поверх игроков, бледнее обычной.
  const halo = (
    <>
      {selected && paint.strokes.length === 0 && paint.hit.length > 0 && !lens && (
        <path
          d={pathOf(paint.hit)}
          fill="none"
          stroke={HALO}
          strokeWidth={8}
          strokeLinejoin="round"
        />
      )}
      {selected &&
        paint.strokes.map((s, i) => (
          <path
            key={`halo-${i}`}
            d={pathOf([s.points]).replace(/Z$/, s.closed ? 'Z' : '')}
            fill="none"
            stroke={HALO}
            strokeWidth={s.widthPx + 8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      {selected && lens && (
        <circle
          cx={lens.cx}
          cy={lens.cy}
          r={lens.r + 4}
          fill="none"
          stroke={HALO}
          strokeWidth={8}
        />
      )}
    </>
  )
  const rest = (
    <>
      {top && selected && (part === 'top' ? <g opacity={0.5}>{halo}</g> : halo)}
      {ground &&
        paint.glowPx !== undefined &&
        paint.body.length > 0 &&
        glowStack(0, paint.glowPx, paint.glowBoost).map((l, i) => (
          <path
            key={`glow-${i}`}
            data-part="glow"
            d={pathOf(paint.body)}
            fill="none"
            stroke={color}
            strokeOpacity={l.opacity}
            strokeWidth={l.width}
            strokeLinejoin="round"
          />
        ))}
      {ground &&
        paint.strokes.map((s, i) =>
          s.glow
            ? glowStack(s.widthPx, s.widthPx).map((l, k) => (
                <path
                  key={`ring-glow-${i}-${k}`}
                  data-part="glow"
                  d={strokeD(s)}
                  fill="none"
                  stroke={color}
                  strokeOpacity={l.opacity}
                  strokeWidth={l.width}
                  strokeLinejoin="round"
                />
              ))
            : null
        )}
      {ground &&
        paint.rings &&
        paint.rings.length > 0 &&
        glowStack(0, paint.ringGlowPx ?? 0).map((l, i) => (
          <path
            key={`pring-glow-${i}`}
            data-part="glow"
            d={pathOf(paint.rings ?? [])}
            fill="none"
            stroke={color}
            strokeOpacity={l.opacity}
            strokeWidth={l.width}
            strokeLinejoin="round"
          />
        ))}
      {ground &&
        paint.lineGlow === true &&
        paint.strokes
          .filter((s) => !s.ring)
          .map((s, i) => {
            const ds = strokeDash(s)
            return lineGlowStack(s.widthPx).map((l, k) => (
              <path
                key={`line-glow-${i}-${k}`}
                data-part="glow"
                d={strokeD(s)}
                fill="none"
                stroke={color}
                strokeOpacity={l.opacity}
                strokeWidth={l.width}
                strokeLinejoin="round"
                strokeLinecap={ds.cap}
                strokeDasharray={ds.array}
              />
            ))
          })}
      {ground && paint.disc.length > 0 && paint.target && (
        <defs>
          <TargetGradient id={id} color={color} />
        </defs>
      )}
      {ground && paint.disc.length > 0 && (
        <path
          data-part="disc"
          d={pathOf(paint.disc)}
          fill={paint.target ? `url(#target-${id})` : color}
          fillOpacity={paint.discOpacity ?? 0.18}
        />
      )}
      {ground &&
        paint.targetRings?.map((polys, i) => (
          <path
            key={`ring-${i}`}
            data-part="body"
            d={pathOf(polys)}
            fill={color}
            fillOpacity={TARGET_RING_OPACITY[i]}
            stroke="none"
          />
        ))}
      {ground && paint.body.length > 0 && !paint.targetRings && (
        <path
          data-part="body"
          d={pathOf(paint.body)}
          fill={color}
          stroke={color}
          strokeWidth={minStroke}
          strokeLinejoin="round"
        />
      )}
      {ground &&
        paint.strokes.map((s, i) => {
          const ds = strokeDash(s)
          return (
            <path
              key={`stroke-${i}`}
              data-part={s.ring ? 'ring' : 'stroke'}
              d={strokeD(s)}
              fill="none"
              stroke={color}
              strokeWidth={s.widthPx}
              strokeLinejoin="round"
              strokeLinecap={ds.cap}
              strokeDasharray={ds.array}
            />
          )
        })}
      {ground && paint.core && paint.core.length > 0 && (
        <path data-part="core" d={pathOf(paint.core)} fill={lineCoreColor(color)} stroke="none" />
      )}
      {ground &&
        paint.lineGlow === true &&
        paint.strokes
          .filter((s) => !s.ring)
          .map((s, i) => {
            const ds = strokeDash(s)
            return (
              <path
                key={`line-core-${i}`}
                data-part="core"
                d={strokeD(s)}
                fill="none"
                stroke={lineCoreColor(color)}
                strokeWidth={s.widthPx * LINE_CORE_SCALE}
                strokeLinejoin="round"
                strokeLinecap={ds.cap}
                strokeDasharray={ds.array}
              />
            )
          })}
      {ground && paint.rings && paint.rings.length > 0 && (
        <path
          data-part="ring"
          d={pathOf(paint.rings)}
          fill={color}
          stroke={color}
          strokeWidth={minStroke}
          strokeLinejoin="round"
        />
      )}
      {ground && paint.wave && paint.wave.body.length > 0 && (
        <path
          data-part="wave"
          d={pathOf(paint.wave.body)}
          fill={color}
          fillOpacity={paint.wave.opacity}
          stroke="none"
        />
      )}
      {ground &&
        paint.nodes.map((n, i) => (
          <circle
            key={`node-${i}`}
            data-part="node"
            cx={n.x}
            cy={n.y}
            r={paint.nodeRadius}
            fill={color}
            stroke={dark ? '#ffffff' : 'rgba(10,12,16,0.85)'}
            strokeWidth={Math.max(1.2, paint.nodeRadius * 0.28)}
          />
        ))}
      {top && paint.label?.stem && (
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
      {ground && paint.dot && (
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
      {top && paint.label && (
        <PillLabel
          label={paint.label}
          color={color}
          background={textBackground}
          shadow={textShadow}
        />
      )}
      {top &&
        paint.labels.map((l, i) => (
          <PillLabel key={`label-${i}`} label={l} color={color} background />
        ))}
      {ground && lens && (
        <>
          {lens.connector && (
            <line
              data-part="connector"
              x1={lens.connector[0].x}
              y1={lens.connector[0].y}
              x2={lens.connector[1].x}
              y2={lens.connector[1].y}
              stroke={color}
              strokeWidth={Math.max(1, size.h / 480)}
              strokeLinecap="round"
              opacity={0.9}
            />
          )}
          <circle
            data-part="source"
            cx={lens.sx}
            cy={lens.sy}
            r={lens.sr}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(1, size.h / 480)}
            strokeDasharray={`${Math.max(3, size.h / 160)} ${Math.max(2.5, size.h / 200)}`}
            opacity={0.95}
          />
          <circle
            data-part="lens-border"
            cx={lens.cx}
            cy={lens.cy}
            r={lens.r}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(2, size.h / 240)}
          />
          <circle
            cx={lens.cx}
            cy={lens.cy}
            r={lens.r - Math.max(2, size.h / 240) / 2 - 0.5}
            fill="none"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={1}
          />
        </>
      )}
    </>
  )
  return shadowClass ? (
    <>
      {under}
      <g className={shadowClass}>{rest}</g>
    </>
  ) : (
    <>
      {under}
      {rest}
    </>
  )
}

interface PitchProps {
  annotation: PitchAnnotation
  size: Size
  selected: boolean
  projector: Projector | null | undefined
  shadowClass?: string
  part?: DrawPart
  /** Сдвиги подписей по вертикали (пиксели), чтобы подписи измерений не ложились друг на друга. */
  labelShift?: LabelShift
  /** Время видео, секунды: нужно пульсу. */
  time?: number
}

export function PitchBody({
  annotation: a,
  size,
  selected,
  projector,
  shadowClass,
  part,
  labelShift,
  time
}: PitchProps): React.JSX.Element | null {
  const paint = useMemo(() => {
    if (!projector) return null
    const p = paintPitch(a, projector, size, measureTextWidth, time)
    if (!labelShift) return p
    return {
      ...p,
      label: p.label ? shiftLabel(p.label, labelShift.label) : p.label,
      labels: p.labels.map((l, i) => shiftLabel(l, labelShift.labels?.[i]))
    }
  }, [a, projector, size, labelShift, time])
  if (!paint) return null
  return (
    <PaintParts
      paint={paint}
      id={a.id}
      color={a.style.color}
      size={size}
      selected={selected}
      textBackground={a.type === 'ptext' ? a.style.background : true}
      textShadow={a.type === 'ptext' ? a.style.shadow : undefined}
      shadowClass={shadowClass}
      part={part}
    />
  )
}

/** Круглые ручки поверх выбранного рисунка (координаты уже в пикселях кадра). */
export function PaintHandles({
  paint,
  selectedNode
}: {
  paint: PitchPaint
  selectedNode?: number | null
}): React.JSX.Element | null {
  if (paint.handles.length === 0) return null
  return (
    <g data-testid="handles">
      {paint.handles.map((h) => {
        const chosen = selectedNode != null && h.id === `v${selectedNode}`
        return (
          <circle
            key={h.id}
            className="anno-handle"
            data-handle={h.id}
            data-chosen={chosen ? 'true' : undefined}
            cx={h.point.x}
            cy={h.point.y}
            r={chosen ? 6.5 : 5.5}
            fill={chosen ? ACCENT : '#fff'}
            stroke={chosen ? '#fff' : ACCENT}
            strokeWidth={2}
          />
        )
      })}
    </g>
  )
}

/** Белые круглые ручки поверх выбранного рисунка на поле. */
export function PitchHandlesView({
  annotation,
  size,
  projector,
  selectedNode
}: {
  annotation: PitchAnnotation
  size: Size
  projector: Projector | null | undefined
  selectedNode?: number | null
}): React.JSX.Element | null {
  if (!projector) return null
  return (
    <PaintHandles
      paint={paintPitch(annotation, projector, size, measureTextWidth)}
      selectedNode={selectedNode}
    />
  )
}
