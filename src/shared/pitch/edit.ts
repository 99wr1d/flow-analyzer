// Правки рисунков на поле в метрах: сдвиг, ручки, привязка углов к осям поля.
import { MAX_RING_RADIUS, MIN_RING_RADIUS, type PitchAnnotation } from '../annotations'
import type { Pt } from './linalg'
import type { PitchHandleId } from './shapes'

const clampX = (v: number): number => Math.min(200, Math.max(-80, v))
const clampY = (v: number): number => Math.min(160, Math.max(-80, v))
export const clampWorld = (p: Pt): Pt => ({ x: clampX(p.x), y: clampY(p.y) })

/** Шаг привязки угла при Shift на поле: 0°, 45°, 90° … относительно осей поля. */
export const WORLD_SNAP_STEP_DEG = 45

/** Направление origin→point округляется до step градусов от оси x поля; длина сохраняется. */
export function snapWorldAngle(origin: Pt, point: Pt, stepDeg = WORLD_SNAP_STEP_DEG): Pt {
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return point
  const step = (stepDeg * Math.PI) / 180
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: origin.x + Math.cos(angle) * len, y: origin.y + Math.sin(angle) * len }
}

/** Сдвиг рисунка на (dx, dy) метров. */
export function moveWorld(a: PitchAnnotation, dx: number, dy: number): PitchAnnotation {
  const sh = (p: Pt): Pt => clampWorld({ x: p.x + dx, y: p.y + dy })
  if (a.type === 'ring') return { ...a, center: sh(a.center) }
  if (a.type === 'ptext') return { ...a, pos: sh(a.pos) }
  return { ...a, p1: sh(a.p1), p2: sh(a.p2) }
}

/** Ручка перетаскивается в точку to (метры). */
export function moveWorldHandle(
  a: PitchAnnotation,
  handle: PitchHandleId,
  to: Pt
): PitchAnnotation {
  if (a.type === 'ring') {
    if (handle !== 'radius') return a
    const r = Math.hypot(to.x - a.center.x, to.y - a.center.y)
    return { ...a, radius: Math.min(MAX_RING_RADIUS, Math.max(MIN_RING_RADIUS, r)) }
  }
  if (a.type === 'ptext') return a
  const p = clampWorld(to)
  if (handle === 'p1') return { ...a, p1: p }
  if (handle === 'p2') return { ...a, p2: p }
  return a
}

/** Точка, которую «держит» ручка (метры): нужна, чтобы Shift привязывал угол относительно противоположной точки. */
export function handleAnchor(a: PitchAnnotation, handle: PitchHandleId): Pt | null {
  if (a.type === 'ring') return a.center
  if (a.type === 'ptext') return null
  return handle === 'p1' ? a.p2 : a.p1
}
