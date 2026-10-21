// Ограничение битрейта экспорта относительно исходника и оценка размера файла (одни и те же числа для кодера и сводки).
import type { ExportQuality } from './export'

/** Во сколько раз битрейт видео в файле может превысить битрейт видео исходника. «Меньше размер» ограничен жёстче. */
export const BITRATE_CAP_FACTOR: Record<ExportQuality, number> = { normal: 2, small: 1.2 }
/** Нижняя граница ограничения, кбит/с: у совсем лёгких исходников потолок не должен душить картинку. */
export const MIN_MAXRATE_KBPS = 1200
/** Битрейт звука в экспорте, бит/с (как AUDIO_BITRATE в args.ts). */
export const EXPORT_AUDIO_BPS = 160_000
/** Сколько в общем битрейте файла примерно занимает звук (когда видео-битрейт отдельно неизвестен). */
const SOURCE_AUDIO_GUESS_BPS = 128_000

/** Потолок битрейта видео (-maxrate), кбит/с, для исходника с видео-битрейтом sourceBps (бит/с). */
export function maxrateKbps(sourceBps: number, quality: ExportQuality): number {
  const cap = (sourceBps / 1000) * BITRATE_CAP_FACTOR[quality]
  return Math.max(MIN_MAXRATE_KBPS, Math.round(cap))
}

/** Битрейт видео исходника по общему (файл целиком, бит/с): вычитаем звук, но не больше пятой части. */
export function videoBpsOfTotal(totalBps: number): number {
  return Math.max(totalBps * 0.8, totalBps - SOURCE_AUDIO_GUESS_BPS)
}

/**
 * Не больше скольких байт получится файл: потолок битрейта видео плюс звук. fast — «Быстро» (без перекодирования):
 * размер пропорционален исходнику.
 */
export function estimateMaxBytes(opts: {
  seconds: number
  sourceTotalBps: number
  quality: ExportQuality
  fast: boolean
}): number {
  const { seconds, sourceTotalBps, quality, fast } = opts
  if (!(seconds > 0) || !(sourceTotalBps > 0)) return 0
  if (fast) return (seconds * sourceTotalBps) / 8
  const videoKbps = maxrateKbps(videoBpsOfTotal(sourceTotalBps), quality)
  return (seconds * (videoKbps * 1000 + EXPORT_AUDIO_BPS)) / 8
}
