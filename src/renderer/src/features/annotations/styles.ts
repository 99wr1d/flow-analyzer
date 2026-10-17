// Палитра и размеры рисунков.
import type { Annotation, ShapeStyle, TextStyle } from '../../../../shared/annotations'

export interface PaletteColor {
  value: string
  name: string
}

/** Цвета, хорошо читаемые на зелёном газоне и в тени. */
export const PALETTE: PaletteColor[] = [
  { value: '#ffffff', name: 'Белый' },
  { value: '#ffd60a', name: 'Жёлтый' },
  { value: '#ff3b30', name: 'Красный' },
  { value: '#4cc9f0', name: 'Голубой' },
  { value: '#34d058', name: 'Зелёный' },
  { value: '#111827', name: 'Тёмный' }
]

/** Три толщины линии и три размера текста (доли высоты видео). */
export const LEVELS = [
  { label: 'Тонкая', width: 0.006, text: 0.045 },
  { label: 'Средняя', width: 0.011, text: 0.065 },
  { label: 'Толстая', width: 0.018, text: 0.09 }
] as const
export type Level = 0 | 1 | 2

export interface CurrentStyle {
  color: string
  level: Level
  dash: 'solid' | 'dashed'
  textBackground: boolean
}

export const DEFAULT_STYLE: CurrentStyle = {
  color: '#ffd60a',
  level: 1,
  dash: 'solid',
  textBackground: true
}

export function shapeStyleOf(s: CurrentStyle): ShapeStyle {
  return { color: s.color, width: LEVELS[s.level].width, dash: s.dash }
}

export function textStyleOf(s: CurrentStyle): TextStyle {
  return { color: s.color, size: LEVELS[s.level].text, background: s.textBackground }
}

/** Ближайший уровень к сохранённому значению. */
export function levelOf(a: Annotation): Level {
  const value = a.type === 'text' ? a.style.size : a.style.width
  let best: Level = 0
  let bestDiff = Infinity
  LEVELS.forEach((l, i) => {
    const diff = Math.abs((a.type === 'text' ? l.text : l.width) - value)
    if (diff < bestDiff) {
      best = i as Level
      bestDiff = diff
    }
  })
  return best
}

/** Тёмный ли цвет (для читаемой подложки/обводки текста). */
export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b < 110
}
