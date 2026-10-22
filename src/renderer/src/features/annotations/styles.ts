// Палитра и размеры рисунков.
import {
  DEFAULT_REVEAL,
  type Annotation,
  type RingLook,
  type ShapeStyle,
  type SpotForm,
  type TextStyle
} from '../../../../shared/annotations'

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
  { value: '#111827', name: 'Тёмный' },
  // 0.18: цвета образцов (читаются на траве).
  { value: '#c6ff3d', name: 'Лайм' },
  { value: '#2e8bff', name: 'Ярко-синий' },
  { value: '#ff5a1f', name: 'Оранжево-красный' }
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
/** Размер новой подписи по умолчанию: «Мелкий» (0.032) — как у образца; до 0.18 был 0.065, в первой сборке 0.18 — 0.045. */
export const DEFAULT_TEXT_LEVEL: TextLevel = 1
/** Цвет новых подписей по умолчанию: лайм, читается на траве. Остальные рисунки по умолчанию жёлтые. */
export const DEFAULT_TEXT_COLOR = '#c6ff3d'

// Время проявления линии по умолчанию и пределы (секунды) определены вместе со схемой файла.
export { DEFAULT_REVEAL, MAX_REVEAL, MIN_REVEAL } from '../../../../shared/annotations'

export interface CurrentStyle {
  color: string
  /** Цвет подписей: запоминается отдельно, чтобы подпись цвета лайм не красила в лайм стрелки и кольца. */
  textColor: string
  level: Level
  /** Размер текста: индекс в TEXT_SIZES. */
  textLevel: TextLevel
  dash: 'solid' | 'dashed' | 'dotted'
  textBackground: boolean
  /** Толщина нового кольца/круга (по умолчанию «Тонкая»; остальные рисунки — level). */
  ringLevel: Level
  /** Свечение нового кольца/круга. */
  glow: boolean
  /** Вид нового кольца/круга. */
  look: RingLook
  /** Пульс «мишени». */
  pulse: boolean
  /** Вид нового прожектора. */
  form: SpotForm
  /** Свечение новых стрелок/линий/кривых. */
  lineGlow: boolean
  /** Проявление новых стрелок/линий/кривых, секунд; null — выключено. */
  reveal: number | null
  /** Время проявления, которое помнится, пока проявление выключено (при включении берётся оно). */
  revealSecs: number
  /** Тень под текстом новой подписи. */
  textShadow: boolean
}

export const DEFAULT_STYLE: CurrentStyle = {
  color: '#ffd60a',
  textColor: DEFAULT_TEXT_COLOR,
  level: 1,
  textLevel: DEFAULT_TEXT_LEVEL,
  dash: 'solid',
  // Новые рисунки 0.18 (старые без этих полей рисуются как раньше): кольцо со свечением, подпись без плашки с тенью.
  textBackground: false,
  ringLevel: 0,
  glow: true,
  look: 'ring',
  pulse: false,
  form: 'oval',
  lineGlow: false,
  reveal: null,
  revealSecs: DEFAULT_REVEAL,
  textShadow: true
}

export function shapeStyleOf(s: CurrentStyle): ShapeStyle {
  return { color: s.color, width: LEVELS[s.level].width, dash: s.dash }
}

export function textStyleOf(s: CurrentStyle): TextStyle {
  return {
    color: s.textColor,
    size: TEXT_SIZES[s.textLevel].size,
    background: s.textBackground,
    shadow: s.textShadow
  }
}

/** Виды линий, у которых есть свечение и проявление. */
const LINE_TYPES: ReadonlySet<string> = new Set([
  'arrow',
  'line',
  'curve',
  'parrow',
  'pline',
  'pcurve'
])

/** Вид линии со свечением и проявлением (стрелка, линия, кривая; на экране и на поле). */
export const isLineType = (type: string): boolean => LINE_TYPES.has(type)

/**
 * Поля стиля 0.18 НОВОГО рисунка этого вида (записываются явно, по выбору в панели).
 * У старых рисунков этих полей нет — они рисуются как раньше.
 */
export function newDrawingFx(type: string, s: CurrentStyle): Record<string, unknown> {
  if (type === 'circle' || type === 'ring') return { glow: s.glow, look: s.look, pulse: s.pulse }
  // «Столб» по умолчанию без затемнения кадра (затемнение включается вручную, в панели «Рисунок»).
  if (type === 'spot' || type === 'pspot') {
    return { form: s.form, ...(s.form === 'pillar' ? { dimmed: false } : {}) }
  }
  if (LINE_TYPES.has(type)) {
    return { glow: s.lineGlow, ...(s.reveal !== null ? { reveal: s.reveal } : {}) }
  }
  return {}
}

/**
 * Правка уже нарисованного рисунка из панели: меняются только поля, которые тренер переключил (patch).
 * Нет поля у рисунка и нет его в patch — рисунок остаётся как был.
 */
export function applyFxPatch(a: Annotation, patch: Partial<CurrentStyle>): Annotation {
  const out: Record<string, unknown> = { ...a }
  const circleLike = a.type === 'circle' || a.type === 'ring'
  if (circleLike) {
    if (patch.glow !== undefined) out.glow = patch.glow
    if (patch.look !== undefined) out.look = patch.look
    if (patch.pulse !== undefined) out.pulse = patch.pulse
  }
  if ((a.type === 'spot' || a.type === 'pspot') && patch.form !== undefined) out.form = patch.form
  if (LINE_TYPES.has(a.type)) {
    if (patch.lineGlow !== undefined) out.glow = patch.lineGlow
    if (patch.reveal !== undefined) {
      if (patch.reveal === null) delete out.reveal
      else out.reveal = patch.reveal
    }
  }
  return out as unknown as Annotation
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
