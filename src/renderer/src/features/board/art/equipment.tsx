/* eslint-disable react-refresh/only-export-components -- константы и функции рамки — часть интерфейса по плану */
/**
 * Инвентарь доски: мяч, фишка, конус, манекен, мини-ворота. Рисунки плоские с мягкой тенью, как у фигур.
 * Единицы как у фигур: низ в (0, 0), рисунок растёт вверх (отрицательный y); рост — `EQUIP_HEIGHT`.
 */
import { useId } from 'react'
import type { JSX } from 'react'
import type { EquipmentId } from '../../../../../shared/board/ids'
import { darken, lighten } from './figures/kit'

export const EQUIPMENT_LABEL: Record<EquipmentId, string> = {
  ball: 'Мяч',
  disc: 'Фишка',
  cone: 'Конус',
  mannequin: 'Манекен',
  'mini-goal': 'Мини-ворота'
}

export const DEFAULT_EQUIP_COLOR: Record<EquipmentId, string> = {
  ball: '#ffffff',
  disc: '#ff7a00',
  cone: '#ff7a00',
  mannequin: '#e8e8e8',
  'mini-goal': '#ffffff'
}

/** Высота рисунка. */
export const EQUIP_HEIGHT: Record<EquipmentId, number> = {
  ball: 22,
  disc: 14,
  cone: 40,
  mannequin: 180,
  'mini-goal': 90
}

/** Половина ширины рисунка (для рамки выбора). */
export const EQUIP_HALF_WIDTH: Record<EquipmentId, number> = {
  ball: 11,
  disc: 21,
  cone: 15,
  mannequin: 30,
  'mini-goal': 71
}

const SHADOW = 'rgba(0,0,0,0.28)'
const OUTLINE = '#1c2026'

const uid = (raw: string): string => raw.replace(/[^a-zA-Z0-9]/g, '')

function Shadow({
  rx,
  ry = rx * 0.22,
  dy = 0
}: {
  rx: number
  ry?: number
  dy?: number
}): JSX.Element {
  return <ellipse cx={0} cy={dy} rx={rx} ry={ry} fill={SHADOW} />
}

/** Правильный пятиугольник с центром (cx, cy), радиусом r, повёрнутый на `rot` градусов. */
function pentagon(cx: number, cy: number, r: number, rot: number): string {
  const pts = Array.from({ length: 5 }, (_, i) => {
    const a = ((rot + i * 72 - 90) * Math.PI) / 180
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
  })
  return `M${pts.join('L')}Z`
}

function Ball({ color }: { color: string }): JSX.Element {
  const id = uid(useId())
  const R = 11
  const cy = -R
  const dark = '#20242b'
  const spokes = Array.from({ length: 5 }, (_, i) => (i * 72 - 90) * (Math.PI / 180))
  return (
    <g>
      <Shadow rx={R * 0.95} ry={3} dy={-0.5} />
      <defs>
        <radialGradient id={`${id}g`} cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor={lighten(color, 0.4)} />
          <stop offset="0.6" stopColor={color} />
          <stop offset="1" stopColor={darken(color, 0.28)} />
        </radialGradient>
        <clipPath id={`${id}c`}>
          <circle cx={0} cy={cy} r={R} />
        </clipPath>
      </defs>
      <circle cx={0} cy={cy} r={R} fill={`url(#${id}g)`} />
      <g clipPath={`url(#${id}c)`}>
        <g fill={dark}>
          <path d={pentagon(0, cy, 4.3, 0)} />
          {spokes.map((a, i) => (
            <path
              key={i}
              d={pentagon(11.4 * Math.cos(a), cy + 11.4 * Math.sin(a), 4.8, i * 72 + 36)}
            />
          ))}
        </g>
        <g stroke={dark} strokeWidth={0.7} opacity={0.8}>
          {spokes.map((a, i) => (
            <line
              key={i}
              x1={4.3 * Math.cos(a)}
              y1={cy + 4.3 * Math.sin(a)}
              x2={7.2 * Math.cos(a)}
              y2={cy + 7.2 * Math.sin(a)}
            />
          ))}
        </g>
      </g>
      <circle cx={0} cy={cy} r={R} fill="none" stroke={OUTLINE} strokeWidth={1} opacity={0.75} />
      <ellipse cx={-3.5} cy={cy - 5} rx={2.6} ry={1.6} fill="#ffffff" opacity={0.55} />
    </g>
  )
}

function Disc({ color }: { color: string }): JSX.Element {
  const id = uid(useId())
  return (
    <g>
      <Shadow rx={22} ry={4.5} dy={0.5} />
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={lighten(color, 0.35)} />
          <stop offset="0.55" stopColor={color} />
          <stop offset="1" stopColor={darken(color, 0.3)} />
        </linearGradient>
      </defs>
      <ellipse cx={0} cy={-1} rx={21} ry={4.6} fill={darken(color, 0.38)} />
      <path
        d="M-20 -2 C-20 -9 -11 -14 0 -14 C11 -14 20 -9 20 -2 C20 2 11 3.6 0 3.6 C-11 3.6 -20 2 -20 -2Z"
        fill={`url(#${id}g)`}
        stroke={darken(color, 0.5)}
        strokeWidth={0.9}
      />
      <ellipse cx={0} cy={-8.6} rx={10} ry={2.4} fill={lighten(color, 0.5)} opacity={0.45} />
    </g>
  )
}

function Cone({ color }: { color: string }): JSX.Element {
  const id = uid(useId())
  const hw = (y: number): number => (12 * (40 + y)) / 40
  const stripe = (y0: number, y1: number): string =>
    `M${-hw(y0)} ${y0}L${hw(y0)} ${y0}L${hw(y1)} ${y1}L${-hw(y1)} ${y1}Z`
  return (
    <g>
      <Shadow rx={17} ry={4} dy={0.5} />
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={darken(color, 0.25)} />
          <stop offset="0.35" stopColor={lighten(color, 0.3)} />
          <stop offset="1" stopColor={darken(color, 0.32)} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c9ccd1" />
          <stop offset="0.35" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b6bac0" />
        </linearGradient>
      </defs>
      <rect
        x={-15}
        y={-4.5}
        width={30}
        height={5.5}
        rx={2}
        fill={darken(color, 0.3)}
        stroke={darken(color, 0.55)}
        strokeWidth={0.8}
      />
      <path
        d={`M${-hw(-4)} -4 L-1.6 -40 Q0 -41.5 1.6 -40 L${hw(-4)} -4Z`}
        fill={`url(#${id}g)`}
        stroke={darken(color, 0.5)}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <path d={stripe(-15, -24)} fill={`url(#${id}s)`} />
    </g>
  )
}

function Mannequin({ color }: { color: string }): JSX.Element {
  const id = uid(useId())
  const edge = darken(color, 0.45)
  return (
    <g>
      <Shadow rx={32} ry={6} dy={0.5} />
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={darken(color, 0.22)} />
          <stop offset="0.38" stopColor={lighten(color, 0.4)} />
          <stop offset="1" stopColor={darken(color, 0.3)} />
        </linearGradient>
        <radialGradient id={`${id}h`} cx="36%" cy="32%" r="75%">
          <stop offset="0" stopColor={lighten(color, 0.5)} />
          <stop offset="1" stopColor={darken(color, 0.28)} />
        </radialGradient>
      </defs>
      <ellipse
        cx={0}
        cy={-1}
        rx={29}
        ry={6.5}
        fill={darken(color, 0.4)}
        stroke={edge}
        strokeWidth={0.9}
      />
      <ellipse
        cx={0}
        cy={-4}
        rx={29}
        ry={6.5}
        fill={`url(#${id}g)`}
        stroke={edge}
        strokeWidth={0.9}
      />
      <path
        d="M-7 -6 L-6 -62 L6 -62 L7 -6Z"
        fill={`url(#${id}g)`}
        stroke={edge}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path
        d="M-17 -60 C-27 -62 -29 -76 -28 -98 C-28 -118 -26 -128 -18 -133 C-12 -137 -6 -138 0 -138 C6 -138 12 -137 18 -133 C26 -128 28 -118 28 -98 C29 -76 27 -62 17 -60 C8 -57 -8 -57 -17 -60Z"
        fill={`url(#${id}g)`}
        stroke={edge}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <rect x={-5} y={-146} width={10} height={11} fill={darken(color, 0.15)} />
      <ellipse
        cx={0}
        cy={-164}
        rx={16}
        ry={16}
        fill={`url(#${id}h)`}
        stroke={edge}
        strokeWidth={1}
      />
      <path
        d="M-20 -108 C-10 -104 10 -104 20 -108"
        stroke={edge}
        strokeWidth={0.9}
        fill="none"
        opacity={0.45}
      />
    </g>
  )
}

function MiniGoal({ color }: { color: string }): JSX.Element {
  const edge = darken(color, 0.55)
  const net = darken(color, 0.12)
  // передняя рама и задняя рама (дальше от зрителя: выше и уже)
  const F = { l: -68, r: 68, t: -80, b: 0 }
  const B = { l: -56, r: 56, t: -90, b: -12 }
  const cols = 9
  const rows = 6
  const grid: JSX.Element[] = []
  for (let i = 0; i <= cols; i++) {
    const x = B.l + ((B.r - B.l) * i) / cols
    grid.push(<line key={`v${i}`} x1={x} y1={B.t} x2={x} y2={B.b} />)
  }
  for (let j = 0; j <= rows; j++) {
    const y = B.t + ((B.b - B.t) * j) / rows
    grid.push(<line key={`h${j}`} x1={B.l} y1={y} x2={B.r} y2={y} />)
  }
  const roof = Array.from({ length: 7 }, (_, i) => {
    const u = (i + 1) / 8
    return <line key={i} x1={F.l + (F.r - F.l) * u} y1={F.t} x2={B.l + (B.r - B.l) * u} y2={B.t} />
  })
  const bar = (w: number, c: string, children: JSX.Element[]): JSX.Element => (
    <g stroke={c} strokeWidth={w} strokeLinecap="round" fill="none">
      {children}
    </g>
  )
  const back = [
    <line key="a" x1={B.l} y1={B.t} x2={B.r} y2={B.t} />,
    <line key="b" x1={B.l} y1={B.t} x2={B.l} y2={B.b} />,
    <line key="c" x1={B.r} y1={B.t} x2={B.r} y2={B.b} />
  ]
  const arms = [
    <line key="a" x1={F.l} y1={F.t} x2={B.l} y2={B.t} />,
    <line key="b" x1={F.r} y1={F.t} x2={B.r} y2={B.t} />
  ]
  const front = [
    <path
      key="f"
      d={`M${F.l} ${F.b}L${F.l} ${F.t}L${F.r} ${F.t}L${F.r} ${F.b}`}
      strokeLinejoin="round"
    />
  ]
  return (
    <g>
      <Shadow rx={74} ry={6} dy={1} />
      <path
        d={`M${B.l} ${B.t}L${B.r} ${B.t}L${B.r} ${B.b}L${B.l} ${B.b}Z`}
        fill="rgba(235,240,245,0.24)"
      />
      <g stroke={net} strokeWidth={0.8} opacity={0.7}>
        {grid}
        {roof}
        <line x1={F.l} y1={F.b} x2={B.l} y2={B.b} />
        <line x1={F.r} y1={F.b} x2={B.r} y2={B.b} />
      </g>
      {bar(5.5, edge, back)}
      {bar(3.6, color, back)}
      {bar(5, edge, arms)}
      {bar(3, color, arms)}
      {bar(7.5, edge, front)}
      {bar(5, color, front)}
      <path
        d={`M${F.l - 1} ${F.b - 6}L${F.l - 1} ${F.t + 1}L${F.r - 10} ${F.t + 1}`}
        stroke="#ffffff"
        strokeWidth={1.2}
        opacity={0.7}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  )
}

export function EquipmentArt({ item, color }: { item: EquipmentId; color: string }): JSX.Element {
  switch (item) {
    case 'ball':
      return <Ball color={color} />
    case 'disc':
      return <Disc color={color} />
    case 'cone':
      return <Cone color={color} />
    case 'mannequin':
      return <Mannequin color={color} />
    case 'mini-goal':
      return <MiniGoal color={color} />
    default:
      return <g />
  }
}
