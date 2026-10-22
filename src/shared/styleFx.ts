// Время-зависимые эффекты рисунков (0.18): пульс «мишени» и проявление линии.
// Зависят только от времени видео, поэтому экран, перемотка и экспорт дают одну и ту же картинку для одного кадра.
import type { Annotation } from './annotations'

/** Период пульса, секунд. */
export const PULSE_PERIOD = 1.5
/** Если отрезок короче времени проявления, линия прорисовывается за эту долю отрезка. */
export const REVEAL_MAX_SHARE = 0.8

/** Рисунок меняется со временем без ключей: пульсирует или проявляется (экспорт рисует такие покадрово). */
export function isTimeVarying(a: Annotation): boolean {
  if ((a.type === 'circle' || a.type === 'ring') && a.pulse === true) return true
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
export const GLOW_REACH = 2.5
/** Слоёв в стопке ореола. */
export const GLOW_LAYERS = 8
/** Непрозрачность одного слоя: у самой обводки накапливается около 41%, к краю ореола спадает до 6,5%. */
export const GLOW_ALPHA = 0.065
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
