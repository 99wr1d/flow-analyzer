// Слежение за игроком: смена плана по гистограмме всего кадра.
import { CUT_THRESHOLD } from './tuning'

/** Длина гистограммы кадра: 3 канала RGB × 16 корзин. */
export const FRAME_HIST_LENGTH = 48
/** Шаг выборки пикселей по обеим осям (достаточно для гистограммы, в 16 раз быстрее). */
const STRIDE = 4

/** Гистограмма всего кадра: R, G, B по 16 корзин, каждый канал нормирован на 1. */
export function frameHistOf(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Float32Array {
  const h = new Float32Array(FRAME_HIST_LENGTH)
  let n = 0
  for (let y = 0; y < height; y += STRIDE) {
    for (let x = 0; x < width; x += STRIDE) {
      const i = (y * width + x) * 4
      h[rgba[i] >> 4] += 1
      h[16 + (rgba[i + 1] >> 4)] += 1
      h[32 + (rgba[i + 2] >> 4)] += 1
      n += 1
    }
  }
  if (n > 0) for (let i = 0; i < FRAME_HIST_LENGTH; i += 1) h[i] /= n
  return h
}

/** Разница гистограмм двух кадров, 0..1 (сумма |Δ| по каналам, делённая на 6). */
export function histDiff(prev: Float32Array, cur: Float32Array): number {
  let d = 0
  for (let i = 0; i < FRAME_HIST_LENGTH; i += 1) d += Math.abs(prev[i] - cur[i])
  return d / 6
}

/** Смена плана между соседними кадрами: разница гистограмм больше CUT_THRESHOLD (0.15). */
export function isSceneCut(prev: Float32Array, cur: Float32Array): boolean {
  return histDiff(prev, cur) > CUT_THRESHOLD
}
