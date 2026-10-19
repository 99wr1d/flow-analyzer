// Ключ «газон» в графе ffmpeg: маска «где виден газон» из кадра и слияние «основа / кадр с рисунками» по этой маске.
// Математика ключа — shared/grassKey.ts (та же, что в предпросмотре). Чистые функции: ffmpeg не запускают.
import { ffmpegColor, type GrassKeyValues } from '../../shared/grassKey'

const num = (v: number): string => (Math.round(v * 1e4) / 1e4).toString()

/**
 * Цепочка фильтров «кадр → маска газона»: 255 — газон (рисунок виден), 0 — всё остальное.
 * Кадр сначала переводится в RGB (как его видит экран), затем в YUV с полным диапазоном — теми же формулами,
 * которыми ffmpeg переводит цвет ключа; chromakey даёт прозрачность 0 на газоне, negate переворачивает её в маску.
 */
export function grassMaskFilter(key: GrassKeyValues): string {
  return [
    'format=rgb24',
    'scale=out_range=pc',
    'format=yuva444p',
    `chromakey=color=${ffmpegColor(key.color)}:similarity=${num(key.similarity)}:blend=${num(key.blend)}`,
    'alphaextract',
    'negate'
  ].join(',')
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
    `${o.input}${grassMaskFilter(o.key)},format=gray,split=3[${id}m0][${id}m1][${id}m2]`,
    `[${id}m0][${id}m1][${id}m2]mergeplanes=0x001020:yuv444p,format=yuv420p${o.output}`
  ]
}
