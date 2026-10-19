// Лупа: пиксельная геометрия линзы. Один расчёт для экрана (canvas) и для экспорта (фильтр ffmpeg),
// поэтому увеличенный кусок на экране и в готовом видео совпадает.
import type { Ease, Loupe } from '../annotations'
import { segmentAt } from '../animation'

export interface LoupeGeometry {
  /** Диаметр линзы, пиксели видео (чётное число). */
  d: number
  /** Левый верхний угол линзы на кадре. */
  ox: number
  oy: number
  /** Сторона квадратного исходного участка, пиксели видео (чётное число). */
  sw: number
  /** Левый верхний угол исходного участка (внутри кадра, чётные числа). */
  sx: number
  sy: number
}

const even = (v: number): number => 2 * Math.round(v / 2)

/**
 * Геометрия лупы на кадре vw × vh. Линза: круг радиуса radius × высота кадра с центром pos.
 * Исходный участок: квадрат со стороной d / zoom вокруг src, сдвинутый внутрь кадра, если выходит за край.
 */
export function loupeGeometry(
  loupe: Pick<Loupe, 'pos' | 'src' | 'radius' | 'zoom'>,
  vw: number,
  vh: number
): LoupeGeometry {
  const d = Math.max(4, even(2 * loupe.radius * vh))
  const sw = Math.max(2, Math.min(even(d / loupe.zoom), even(Math.min(vw, vh))))
  const clamp = (v: number, hi: number): number => Math.min(Math.max(v, 0), Math.max(hi, 0))
  return {
    d,
    ox: Math.round(loupe.pos.x * vw - d / 2),
    oy: Math.round(loupe.pos.y * vh - d / 2),
    sw,
    sx: even(clamp(loupe.src.x * vw - sw / 2, vw - sw)),
    sy: even(clamp(loupe.src.y * vh - sw / 2, vh - sw))
  }
}

/** Ключ движущейся лупы: положение линзы и источника (доли кадра) в момент t. */
export interface LoupeKey {
  t: number
  ease?: Ease
  pos: { x: number; y: number }
  src: { x: number; y: number }
}

/** Геометрия лупы на момент t: между ключами положение меняется как у любого движущегося рисунка. */
export function loupeGeometryAt(
  loupe: Pick<Loupe, 'pos' | 'src' | 'radius' | 'zoom'>,
  keys: readonly LoupeKey[] | undefined,
  t: number,
  vw: number,
  vh: number
): LoupeGeometry {
  if (!keys || keys.length === 0) return loupeGeometry(loupe, vw, vh)
  const seg = segmentAt(keys, t)
  const a = keys[seg.index]
  if (seg.hold) return loupeGeometry({ ...loupe, pos: a.pos, src: a.src }, vw, vh)
  const b = keys[seg.index + 1]
  const mix = (
    p: { x: number; y: number },
    q: { x: number; y: number }
  ): { x: number; y: number } => ({
    x: p.x + (q.x - p.x) * seg.u,
    y: p.y + (q.y - p.y) * seg.u
  })
  return loupeGeometry({ ...loupe, pos: mix(a.pos, b.pos), src: mix(a.src, b.src) }, vw, vh)
}
