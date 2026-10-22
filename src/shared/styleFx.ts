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
