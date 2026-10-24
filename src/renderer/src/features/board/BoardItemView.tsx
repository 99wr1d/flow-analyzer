/* eslint-disable react-refresh/only-export-components -- константы и функции рамки — часть интерфейса по плану */
/** Отрисовка любого элемента доски (фигура, инвентарь, кружок, номер, змейка, штриховка, рисунок) и его рамка. */
import { useId } from 'react'
import type { JSX } from 'react'
import type { ResolvedItem } from '../../../../shared/board/resolve'
import type { BoardElement } from '../../../../shared/board/schema'
import type { ScreenAnnotation } from '../../../../shared/annotations'
import { ShapeView } from '../annotations/ShapeView'
import { bboxOf } from '../annotations/geometry'
import { BOARD_H, BOARD_W } from './art/constants'
import { EQUIP_HALF_WIDTH, EQUIP_HEIGHT, EquipmentArt } from './art/equipment'
import { FIGURE_ART_HEIGHT, FigureArt } from './art/figureArt'
import { luma } from './art/figures/kit'

/** Рост фигуры при `scale 1` как доля высоты доски. */
export const FIGURE_BASE_H = 0.3

const TOKEN_R = 0.022
const WAVE_STEP = 0.025
const WAVE_AMP = 0.008
const DARK = '#1c2026'
const SIZE = { w: BOARD_W, h: BOARD_H }

type Box = { x: number; y: number; w: number; h: number }
type Placed = Extract<BoardElement, { kind: 'figure' | 'equip' }>

const unitScale = (e: Placed): number => (e.scale * FIGURE_BASE_H * BOARD_H) / FIGURE_ART_HEIGHT
const uid = (raw: string): string => raw.replace(/[^a-zA-Z0-9]/g, '')

/** Рамка фигуры в единицах рисунка: (полуширина, высота), низ в 0. Лежачие позы вратаря широкие и низкие. */
function figureExtent(e: Extract<BoardElement, { kind: 'figure' }>): { hw: number; h: number } {
  if (e.set === 'gk' && ['dive-low', 'dive-high', 'smother'].includes(e.pose))
    return { hw: 125, h: 90 }
  return { hw: 35, h: FIGURE_ART_HEIGHT }
}

/** Рамка прямоугольника `[-hw, hw] × [-h, 0]` рисунка, повёрнутого вокруг начала и поставленного в pos. */
function placedBox(e: Placed, hw: number, h: number): Box {
  const k = unitScale(e)
  const a = (e.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const xs: number[] = []
  const ys: number[] = []
  for (const [px, py] of [
    [-hw, -h],
    [hw, -h],
    [hw, 0],
    [-hw, 0]
  ]) {
    xs.push(e.pos.x * BOARD_W + (px * cos - py * sin) * k)
    ys.push(e.pos.y * BOARD_H + (px * sin + py * cos) * k)
  }
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  return {
    x: x0 / BOARD_W,
    y: y0 / BOARD_H,
    w: (Math.max(...xs) - x0) / BOARD_W,
    h: (Math.max(...ys) - y0) / BOARD_H
  }
}

const MIN_BOX = 0.012

function spanBox(x0: number, y0: number, x1: number, y1: number, padX = 0, padY = 0): Box {
  const x = Math.min(x0, x1) - padX
  const y = Math.min(y0, y1) - padY
  return {
    x,
    y,
    w: Math.max(Math.abs(x1 - x0) + 2 * padX, MIN_BOX),
    h: Math.max(Math.abs(y1 - y0) + 2 * padY, MIN_BOX)
  }
}

/** Приблизительный прямоугольник подписи в пикселях доски (ShapeView меряет точнее, но рамке хватит оценки). */
function textBoxPx(text: string, size: number): { x: number; y: number; w: number; h: number } {
  return { x: 0, y: 0, w: text.length * size * BOARD_H * 0.58 + 16, h: size * BOARD_H * 1.4 }
}

/** Рамка элемента в долях доски (0..1): для попадания мышью и ручек. */
export function itemBox(item: ResolvedItem): Box {
  const e = item.el
  switch (e.kind) {
    case 'figure': {
      const { hw, h } = figureExtent(e)
      return placedBox(e, hw, h)
    }
    case 'equip':
      return placedBox(e, EQUIP_HALF_WIDTH[e.item], EQUIP_HEIGHT[e.item])
    case 'token':
    case 'number': {
      const r = TOKEN_R * e.scale
      return {
        x: e.pos.x - (r * BOARD_H) / BOARD_W,
        y: e.pos.y - r,
        w: (2 * r * BOARD_H) / BOARD_W,
        h: 2 * r
      }
    }
    case 'wavy':
      return spanBox(
        e.p1.x,
        e.p1.y,
        e.p2.x,
        e.p2.y,
        (WAVE_AMP * 2 * BOARD_H) / BOARD_W,
        WAVE_AMP * 2
      )
    case 'hatch':
      return spanBox(e.p1.x, e.p1.y, e.p2.x, e.p2.y)
    case 'shape': {
      const a = e.ann as unknown as ScreenAnnotation
      const tb = e.ann.type === 'text' ? textBoxPx(e.ann.text, e.ann.style.size) : null
      const b = bboxOf(a, tb, SIZE)
      const padX = (e.ann.type === 'text' ? 0 : 0.006 * BOARD_H) / BOARD_W
      const padY = e.ann.type === 'text' ? 0 : 0.006
      return spanBox(b.x0, b.y0, b.x1, b.y1, padX, padY)
    }
  }
}

function TokenView({
  x,
  y,
  r,
  color,
  label
}: {
  x: number
  y: number
  r: number
  color: string
  label: string
}): JSX.Element {
  const light = luma(color) > 150
  return (
    <g>
      <circle cx={x} cy={y + r * 0.12} r={r} fill="rgba(0,0,0,0.3)" />
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={color}
        stroke="#ffffff"
        strokeWidth={Math.max(2, r * 0.14)}
      />
      {label && (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight={700}
          fontSize={label.length > 1 ? r * 0.95 : r * 1.15}
          fill={light ? DARK : '#ffffff'}
        >
          {label}
        </text>
      )}
    </g>
  )
}

function NumberView({
  x,
  y,
  r,
  color,
  n
}: {
  x: number
  y: number
  r: number
  color: string
  n: number
}): JSX.Element {
  const paleDigit = luma(color) > 200
  return (
    <g>
      <circle cx={x} cy={y + r * 0.12} r={r} fill="rgba(0,0,0,0.3)" />
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="#ffffff"
        stroke={DARK}
        strokeWidth={Math.max(2, r * 0.14)}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight={800}
        fontSize={n > 9 ? r * 1.05 : r * 1.25}
        fill={color}
        stroke={paleDigit ? DARK : 'none'}
        strokeWidth={paleDigit ? 1.2 : 0}
        paintOrder="stroke"
      >
        {n}
      </text>
    </g>
  )
}

function WavyView({ e }: { e: Extract<BoardElement, { kind: 'wavy' }> }): JSX.Element {
  const x1 = e.p1.x * BOARD_W
  const y1 = e.p1.y * BOARD_H
  const x2 = e.p2.x * BOARD_W
  const y2 = e.p2.y * BOARD_H
  const len = Math.hypot(x2 - x1, y2 - y1)
  const w = e.width * BOARD_H
  const head = Math.min(Math.max(w * 4.5, 16), len * 0.6)
  const body = Math.max(len - head * 0.8, 0)
  const ux = len ? (x2 - x1) / len : 1
  const uy = len ? (y2 - y1) / len : 0
  const period = WAVE_STEP * BOARD_H
  const amp = WAVE_AMP * BOARD_H
  const n = Math.max(2, Math.ceil((body / period) * 8))
  const pts: string[] = []
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * body
    // у начала волна нарастает, чтобы змейка выходила из точки
    const ramp = Math.min(1, s / period)
    const off = amp * ramp * Math.sin((s / period) * Math.PI * 2)
    pts.push(`${(x1 + ux * s - uy * off).toFixed(1)} ${(y1 + uy * s + ux * off).toFixed(1)}`)
  }
  const d = `M${pts.join('L')}`
  const bx = x2 - ux * head
  const by = y2 - uy * head
  const hw = head * 0.5
  const tri = `M${x2.toFixed(1)} ${y2.toFixed(1)}L${(bx - uy * hw).toFixed(1)} ${(by + ux * hw).toFixed(1)}L${(bx + uy * hw).toFixed(1)} ${(by - ux * hw).toFixed(1)}Z`
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d={d} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={w + 3} />
      <path d={tri} fill="rgba(0,0,0,0.35)" stroke="rgba(0,0,0,0.35)" strokeWidth={3} />
      <path d={d} fill="none" stroke={e.color} strokeWidth={w} />
      <path d={tri} fill={e.color} stroke={e.color} strokeWidth={1} />
    </g>
  )
}

function HatchView({ e }: { e: Extract<BoardElement, { kind: 'hatch' }> }): JSX.Element {
  const id = uid(useId())
  const x0 = Math.min(e.p1.x, e.p2.x) * BOARD_W
  const x1 = Math.max(e.p1.x, e.p2.x) * BOARD_W
  const y0 = Math.min(e.p1.y, e.p2.y) * BOARD_H
  const y1 = Math.max(e.p1.y, e.p2.y) * BOARD_H
  const fill = `url(#${id})`
  const common = { fill, stroke: e.color, strokeWidth: 3, strokeLinejoin: 'round' as const }
  return (
    <g>
      <defs>
        <pattern
          id={id}
          width={12}
          height={12}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={12} stroke={e.color} strokeWidth={5} opacity={0.35} />
        </pattern>
      </defs>
      {e.shape === 'rect' && <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} {...common} />}
      {e.shape === 'ellipse' && (
        <ellipse
          cx={(x0 + x1) / 2}
          cy={(y0 + y1) / 2}
          rx={(x1 - x0) / 2}
          ry={(y1 - y0) / 2}
          {...common}
        />
      )}
      {e.shape === 'tri' && (
        <path d={`M${(x0 + x1) / 2} ${y0}L${x1} ${y1}L${x0} ${y1}Z`} {...common} />
      )}
    </g>
  )
}

function Body({ el }: { el: BoardElement }): JSX.Element {
  switch (el.kind) {
    case 'figure':
    case 'equip': {
      const t = `translate(${el.pos.x * BOARD_W} ${el.pos.y * BOARD_H}) rotate(${el.rotation}) scale(${unitScale(el)})`
      return (
        <g transform={t}>
          {el.kind === 'figure' ? (
            <FigureArt set={el.set} pose={el.pose} facing={el.facing} color={el.color} />
          ) : (
            <EquipmentArt item={el.item} color={el.color} />
          )}
        </g>
      )
    }
    case 'token':
      return (
        <TokenView
          x={el.pos.x * BOARD_W}
          y={el.pos.y * BOARD_H}
          r={TOKEN_R * BOARD_H * el.scale}
          color={el.color}
          label={el.label}
        />
      )
    case 'number':
      return (
        <NumberView
          x={el.pos.x * BOARD_W}
          y={el.pos.y * BOARD_H}
          r={TOKEN_R * BOARD_H * el.scale}
          color={el.color}
          n={el.n}
        />
      )
    case 'wavy':
      return <WavyView e={el} />
    case 'hatch':
      return <HatchView e={el} />
    case 'shape': {
      const annotation = {
        ...el.ann,
        timing: { mode: 'range', start: 0, duration: 60 }
      } as unknown as ScreenAnnotation
      return <ShapeView annotation={annotation} size={SIZE} selected={false} showHandles={false} />
    }
  }
}

export function BoardItemView({
  item,
  selected
}: {
  item: ResolvedItem
  selected: boolean
}): JSX.Element {
  const el = item.el
  const box = selected ? itemBox(item) : null
  const pad = 8
  return (
    <g
      data-board-item={item.id}
      data-kind={el.kind}
      data-pose={el.kind === 'figure' ? el.pose : undefined}
      data-facing={el.kind === 'figure' ? el.facing : undefined}
      opacity={item.opacity}
    >
      <Body el={el} />
      {box && (
        <rect
          data-selected="true"
          x={box.x * BOARD_W - pad}
          y={box.y * BOARD_H - pad}
          width={box.w * BOARD_W + 2 * pad}
          height={box.h * BOARD_H + 2 * pad}
          rx={6}
          fill="none"
          stroke="#2bd67b"
          strokeWidth={3}
          strokeDasharray="10 7"
          pointerEvents="none"
        />
      )}
    </g>
  )
}
