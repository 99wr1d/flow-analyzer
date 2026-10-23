/** Форма фигуры: цвета футболки (с тенью и бликом), шорт/брюк, гетр и перчаток. */
import type { FigureSet } from '../../../../../../shared/board/ids'

export interface Kit {
  shirt: string
  shirtShade: string
  shirtLight: string
  shorts: string
  socks: string
  gloves?: string
}

export const DEFAULT_COLOR: Record<FigureSet, string> = {
  gk: '#f5c400',
  player: '#d9342b',
  coach: '#2a62d9'
}

const GK_SHORTS = '#1f2329'
const PLAYER_SHORTS = '#f4f4f1'
const COACH_TROUSERS = '#262a31'
const GLOVES = '#f7f7f4'

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6)
  const n = parseInt(full, 16)
  return Number.isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const hex2 = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0')

/** Смешать цвет с `to` в доле `t` (0 — исходный, 1 — `to`). */
export function mix(color: string, to: string, t: number): string {
  const a = parse(color)
  const b = parse(to)
  return '#' + a.map((c, i) => hex2(c + (b[i] - c) * t)).join('')
}

export const darken = (color: string, t: number): string => mix(color, '#000000', t)
export const lighten = (color: string, t: number): string => mix(color, '#ffffff', t)

/** Относительная яркость 0..255 — чтобы выбрать цвет номера поверх футболки. */
export function luma(color: string): number {
  const [r, g, b] = parse(color)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function kitFor(set: FigureSet, color: string): Kit {
  const shirt = '#' + parse(color).map(hex2).join('')
  const base = {
    shirt,
    shirtShade: darken(shirt, 0.24),
    shirtLight: lighten(shirt, 0.3)
  }
  if (set === 'gk') return { ...base, shorts: GK_SHORTS, socks: shirt, gloves: GLOVES }
  if (set === 'player') return { ...base, shorts: PLAYER_SHORTS, socks: shirt }
  return { ...base, shorts: COACH_TROUSERS, socks: COACH_TROUSERS }
}
