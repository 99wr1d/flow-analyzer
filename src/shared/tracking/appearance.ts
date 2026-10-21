// Слежение за игроком: примета игрока — HSV-гистограммы верхней (майка) и нижней (трусы/гетры) половин рамки.
import type { Box } from './types'

export const BINS = 16
/** Длина look: 2 половины × 3 канала (H, S, V) × 16 корзин. */
export const LOOK_LENGTH = 2 * 3 * BINS
/** Вес канала при сравнении: цвет (H) важнее насыщенности и яркости. */
const CHANNEL_WEIGHT = [2, 1, 1]
/** Доля ширины рамки, отбрасываемая с каждой стороны (фон по бокам рамки). */
const SIDE_TRIM = 0.2

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((((g - b) / d) % 6) + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h, max === 0 ? 0 : d / max, max / 255]
}

const bin = (v: number): number => Math.min(BINS - 1, Math.max(0, Math.floor(v * BINS)))

function addHalf(
  out: Float32Array,
  offset: number,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): void {
  let n = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4
      const [h, s, v] = rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2])
      out[offset + bin(h)] += 1
      out[offset + BINS + bin(s)] += 1
      out[offset + 2 * BINS + bin(v)] += 1
      n += 1
    }
  }
  if (n > 0) for (let k = 0; k < 3 * BINS; k += 1) out[offset + k] /= n
}

/**
 * Примета игрока по пикселям кадра: гистограммы H, S, V (по 16 корзин, каждая нормирована) для верхней и нижней
 * половин рамки. Рамка обрезается по кадру; по бокам отбрасывается 20 % ширины (фон).
 */
export function lookOf(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  box: Box
): Float32Array {
  const out = new Float32Array(LOOK_LENGTH)
  const trim = box.w * SIDE_TRIM
  const x0 = Math.max(0, Math.floor(box.x + trim))
  const x1 = Math.min(width, Math.ceil(box.x + box.w - trim))
  const y0 = Math.max(0, Math.floor(box.y))
  const y1 = Math.min(height, Math.ceil(box.y + box.h))
  if (x1 <= x0 || y1 <= y0) return out
  const mid = Math.floor((y0 + y1) / 2)
  addHalf(out, 0, rgba, width, x0, x1, y0, Math.max(mid, y0 + 1))
  addHalf(out, 3 * BINS, rgba, width, x0, x1, Math.min(mid, y1 - 1), y1)
  return out
}

/**
 * Расстояние Бхаттачарьи между приметами, 0..1 (0 — одинаковые). Гистограммы сравниваются по каналам
 * (H вдвое весомее), результат усредняется. Пустая гистограмма (нет пикселей) даёт максимальное расстояние.
 */
export function appearanceDistance(a: Float32Array, b: Float32Array): number {
  const chunks = Math.min(a.length, b.length) / BINS
  let sum = 0
  let weights = 0
  for (let c = 0; c < chunks; c += 1) {
    let bc = 0
    for (let k = 0; k < BINS; k += 1) bc += Math.sqrt(a[c * BINS + k] * b[c * BINS + k])
    const w = CHANNEL_WEIGHT[c % 3]
    sum += w * Math.sqrt(Math.max(0, 1 - Math.min(1, bc)))
    weights += w
  }
  return weights > 0 ? sum / weights : 1
}

/** Скользящее среднее приметы: ref ← (1−k)·ref + k·cur (на месте). */
export function blendLook(ref: Float32Array, cur: Float32Array, k: number): void {
  for (let i = 0; i < ref.length; i += 1) ref[i] = (1 - k) * ref[i] + k * cur[i]
}
