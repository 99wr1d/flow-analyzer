// RGBA-кадр → оттенки серого заданной ширины (для оценки движения камеры).
import type { Gray } from '../../shared/camera/estimate'
import type { DecodedFrame } from '../tracking/frames'

export const GRAY_WIDTH = 480

/**
 * Яркость целыми весами (77 + 150 + 29 = 256), затем уменьшение до ширины width усреднением по блокам.
 * Пропорции сохраняются; кадр уже не шире width не увеличивается.
 */
export function toGray(frame: DecodedFrame, width: number = GRAY_WIDTH): Gray {
  const { width: sw, height: sh, rgba } = frame
  const ow = Math.max(1, Math.min(sw, Math.round(width)))
  const oh = Math.max(1, Math.round((sh * ow) / sw))
  const data = new Uint8Array(ow * oh)
  // Границы блоков исходного кадра для каждого выходного столбца.
  const xs = new Int32Array(ow + 1)
  for (let x = 0; x <= ow; x += 1) xs[x] = Math.floor((x * sw) / ow)
  for (let y = 0; y < oh; y += 1) {
    const y0 = Math.floor((y * sh) / oh)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / oh))
    for (let x = 0; x < ow; x += 1) {
      const x0 = xs[x]
      const x1 = Math.max(x0 + 1, xs[x + 1])
      let sum = 0
      for (let j = y0; j < y1; j += 1) {
        let i = (j * sw + x0) * 4
        for (let k = x0; k < x1; k += 1, i += 4) {
          sum += (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) >> 8
        }
      }
      data[y * ow + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)))
    }
  }
  return { width: ow, height: oh, data }
}
