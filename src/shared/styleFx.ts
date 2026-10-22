// Время-зависимые эффекты рисунков (0.18): пульс «мишени» и проявление линии.
// Зависят только от времени видео, поэтому экран, перемотка и экспорт дают одну и ту же картинку для одного кадра.
import type { Annotation } from './annotations'

/** Период пульса, секунд. */
export const PULSE_PERIOD = 1.5
/** Если отрезок короче времени проявления, линия прорисовывается за эту долю отрезка. */
export const REVEAL_MAX_SHARE = 0.8

/** Рисунок меняется со временем без ключей: пульсирует или проявляется (экспорт рисует такие покадрово). */
export function isTimeVarying(a: Annotation): boolean {
  // Пульс идёт только у рисунка-отрезка: «только кадр» — стоп-кадр без волны.
  if ((a.type === 'circle' || a.type === 'ring') && a.pulse === true && a.timing.mode === 'range')
    return true
  return 'reveal' in a && a.reveal !== undefined && a.timing.mode === 'range'
}

/**
 * Доля пути, уже прорисованная в момент t (0..1). Нет поля reveal — 1 (целиком).
 * Отсчёт от начала отрезка; если отрезок короче N, N ужимается до 80% отрезка.
 * В режиме «кадр» рисунок виден одним кадром — проявления нет, линия целиком.
 */
export function revealFraction(a: Annotation, t: number): number {
  if (!('reveal' in a) || a.reveal === undefined || a.timing.mode !== 'range') return 1
  const n = Math.min(a.reveal, REVEAL_MAX_SHARE * a.timing.duration)
  if (!(n > 0)) return 1
  return Math.min(1, Math.max(0, (t - a.timing.start) / n))
}

/** Фаза пульса в момент t: 0 (волна у центра) .. 1 (у края), период PULSE_PERIOD. Всегда в [0, 1). */
export function pulsePhase(t: number): number {
  const x = (((t % PULSE_PERIOD) + PULSE_PERIOD) % PULSE_PERIOD) / PULSE_PERIOD
  return x >= 1 ? 0 : x
}

/** Ореол: во сколько раз его вылет за край обводки больше толщины обводки. */
export const GLOW_REACH = 2
/** Слоёв в стопке ореола. */
export const GLOW_LAYERS = 8
/** Непрозрачность одного слоя: у самой обводки накапливается около 15%, к краю ореола спадает до 2%. */
export const GLOW_ALPHA = 0.02
/** Толщина обводки, меньше которой ореол не считается (иначе у тончайшей линии ореол был бы незаметен). */
const GLOW_MIN_CORE = 2

export interface GlowLayer {
  /** Толщина линии слоя, пиксели. */
  width: number
  opacity: number
}

/**
 * Ореол свечения «стопкой» полупрозрачных линий того же цвета (вместо SVG-размытия: быстро и одинаково на экране и в экспорте).
 * Слои от внешнего (самый широкий) к внутреннему. base — толщина линии, вдоль которой кладётся ореол
 * (для обводки по оси — её толщина, для кромки контура — 0); corePx — толщина видимой обводки.
 */
export function glowStack(base: number, corePx: number): GlowLayer[] {
  const reach = GLOW_REACH * Math.max(corePx, GLOW_MIN_CORE)
  const layers: GlowLayer[] = []
  for (let i = GLOW_LAYERS; i >= 1; i -= 1) {
    layers.push({ width: base + (2 * reach * i) / GLOW_LAYERS, opacity: GLOW_ALPHA })
  }
  return layers
}

export interface TextShadowLayer {
  /** Сдвиг вниз, пиксели. */
  dy: number
  /** Толщина тёмной каймы вокруг букв, пиксели. */
  width: number
  opacity: number
}

/**
 * Тень подписи без плашки «стопкой» тёмных копий текста (без SVG-фильтра: одинаково на экране и в экспорте).
 * От широкой мягкой к узкой плотной; вместе дают тонкую тёмную кайму, чуть смещённую вниз.
 */
export function textShadowLayers(fontPx: number): TextShadowLayer[] {
  return [
    { dy: fontPx * 0.07, width: fontPx * 0.2, opacity: 0.22 },
    { dy: fontPx * 0.05, width: fontPx * 0.12, opacity: 0.35 },
    { dy: fontPx * 0.03, width: fontPx * 0.05, opacity: 0.55 }
  ]
}

/** «Мишень»: радиусы колец относительно внешнего. */
export const TARGET_RADII = [1, 0.66, 0.33] as const
/** «Мишень»: непрозрачность заливки в центре (к краю спадает до 0). Заливка — главное в мишени, линии еле заметны. */
export const TARGET_CENTER_ALPHA = 0.55
/** «Мишень»: толщина линий колец относительно обычного кольца (тонкие, как граница зон). */
export const TARGET_LINE_SCALE = 0.35
/** «Мишень»: непрозрачность колец от внешнего к центру. */
export const TARGET_RING_OPACITY = [0.3, 0.45, 0.6] as const
/**
 * «Мишень»: профиль заливки — мягкие зоны между кольцами (ступеньки у радиусов 0.33 и 0.66): центр светлее всего,
 * к краю тает до нуля (смещение от центра к краю, доля непрозрачности центра).
 */
export const TARGET_FILL_STOPS = [
  { offset: 0, alpha: 1 },
  { offset: 0.28, alpha: 0.95 },
  { offset: 0.38, alpha: 0.6 },
  { offset: 0.6, alpha: 0.55 },
  { offset: 0.72, alpha: 0.3 },
  { offset: 0.94, alpha: 0.25 },
  { offset: 1, alpha: 0 }
] as const
/** Волна пульса: радиус относительно внешнего кольца в фазе phase (0..1). */
export const waveScale = (phase: number): number => Math.min(1, Math.max(0, phase))
/** Волна пульса: непрозрачность линии в фазе phase — мягкая, тает к краю. */
export const waveOpacity = (phase: number): number => 0.65 * (1 - Math.min(1, Math.max(0, phase)))
/** Волна пульса: толщина линии относительно обычного кольца. */
export const WAVE_LINE_SCALE = 1.2

/** Рисунок — «мишень» (а не кольцо). */
export const isTarget = (a: { look?: string }): boolean => a.look === 'target'
