// Ключ «газон» в графе ffmpeg: маска «где виден газон» из кадра и слияние «основа / кадр с рисунками» по этой маске.
// Математика ключа — shared/grassKey.ts (та же, что в предпросмотре). Чистые функции: ffmpeg не запускают.
import { ffmpegColor, lumaThreshold, LUMA_RAMP, type GrassKeyValues } from '../../shared/grassKey'

const num = (v: number): string => (Math.round(v * 1e4) / 1e4).toString()

/**
 * Граф «кадр → маска газона»: 255 — газон (рисунок виден), 0 — всё остальное. Кадр переводится в RGB (как его видит экран),
 * затем в YUV полного диапазона — теми же формулами, которыми ffmpeg переводит цвет ключа. Две прозрачности: chromakey по
 * цветности и lut по яркости (светлее газона на LUMA_GAP — не газон, см. lumaAlpha); берётся наибольшая (blend lighten),
 * negate переворачивает её в маску. id — приставка внутренних меток (в одном графе масок может быть несколько).
 */
export function grassMaskFilter(key: GrassKeyValues, id = 'k'): string {
  const t = num(lumaThreshold(key.color))
  return [
    `format=rgb24,scale=out_range=pc,format=yuva444p,split[${id}a][${id}b]`,
    `[${id}a]chromakey=color=${ffmpegColor(key.color)}:similarity=${num(key.similarity)}:blend=${num(key.blend)},alphaextract[${id}c]`,
    `[${id}b]extractplanes=y,lut=c0='clip((val-${t})*255/${LUMA_RAMP},0,255)'[${id}l]`,
    `[${id}c][${id}l]blend=all_mode=lighten,negate`
  ].join(';')
}

/**
 * Строки графа: из потока input получается маска yuv420p (все три плоскости — маска), готовая для maskedmerge.
 * maskedmerge берёт вес для каждой плоскости из той же плоскости маски, поэтому цветностные плоскости маски нужны тоже.
 */
export function grassMaskLines(o: {
  id: string
  input: string
  output: string
  key: GrassKeyValues
}): string[] {
  const { id } = o
  return [
    `${o.input}${grassMaskFilter(o.key, `${id}k`)},format=gray,split=3[${id}m0][${id}m1][${id}m2]`,
    `[${id}m0][${id}m1][${id}m2]mergeplanes=0x001020:yuv444p,format=yuv420p${o.output}`
  ]
}
