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

/** Три толщины линии (доли высоты видео). */
export const LEVELS = [
  { label: 'Тонкая', width: 0.006 },
  { label: 'Средняя', width: 0.011 },
  { label: 'Толстая', width: 0.018 }
] as const
export type Level = 0 | 1 | 2

/**
 * Пять размеров текста (доли высоты видео). До 0.16.4 было три: 0.045, 0.065, 0.09 — они остались
 * в шкале как есть, поэтому старые подписи выглядят так же; добавлены два мельче.
 */
export const TEXT_SIZES = [
  { label: 'Крошечный', size: 0.0225 },
  { label: 'Мелкий', size: 0.032 },
  { label: 'Небольшой', size: 0.045 },
  { label: 'Средний', size: 0.065 },
  { label: 'Крупный', size: 0.09 }
] as const
export type TextLevel = 0 | 1 | 2 | 3 | 4
/** Размер новой подписи по умолчанию: на шаг меньше прежнего (был 0.065, стало 0.045). */
export const DEFAULT_TEXT_LEVEL: TextLevel = 2

export interface CurrentStyle {
  color: string
  level: Level
  /** Размер текста: индекс в TEXT_SIZES. */
  textLevel: TextLevel
  dash: 'solid' | 'dashed'
  textBackground: boolean
}

export const DEFAULT_STYLE: CurrentStyle = {
  color: '#ffd60a',
  level: 1,
  textLevel: DEFAULT_TEXT_LEVEL,
  dash: 'solid',
  textBackground: true
}

export function shapeStyleOf(s: CurrentStyle): ShapeStyle {
  return { color: s.color, width: LEVELS[s.level].width, dash: s.dash }
}

export function textStyleOf(s: CurrentStyle): TextStyle {
  return { color: s.color, size: TEXT_SIZES[s.textLevel].size, background: s.textBackground }
}

/** Ближайший уровень толщины к сохранённому значению. */
export function levelOf(a: Annotation): Level {
  const value = a.type === 'text' || a.type === 'ptext' ? LEVELS[1].width : a.style.width
  let best: Level = 0
  let bestDiff = Infinity
  LEVELS.forEach((l, i) => {
    const diff = Math.abs(l.width - value)
    if (diff < bestDiff) {
      best = i as Level
      bestDiff = diff
    }
  })
  return best
}

/** Ближайший размер текста к сохранённому значению (точные старые значения 0.045/0.065/0.09 совпадают). */
export function textLevelOf(a: Annotation): TextLevel {
  const value =
    a.type === 'text' || a.type === 'ptext' ? a.style.size : TEXT_SIZES[DEFAULT_TEXT_LEVEL].size
  let best = 0
  let bestDiff = Infinity
  TEXT_SIZES.forEach((l, i) => {
    const diff = Math.abs(l.size - value)
    if (diff < bestDiff) {
      best = i
      bestDiff = diff
    }
  })
  return best as TextLevel
}

/** Тёмный ли цвет (для читаемой подложки/обводки текста). */
export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b < 110
}
