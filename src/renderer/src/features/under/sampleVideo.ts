// Пиксели текущего кадра видео: для автоматического определения цвета газона и пипетки.
import { toHex } from '../../../../shared/grassKey'

let scratch: HTMLCanvasElement | null = null

function context(w: number, h: number): CanvasRenderingContext2D | null {
  scratch ??= document.createElement('canvas')
  scratch.width = w
  scratch.height = h
  return scratch.getContext('2d', { willReadFrequently: true })
}

/** Кадр, уменьшенный до ширины maxWidth, как RGBA. null — кадр прочитать не удалось. */
export function grabFrame(
  video: HTMLVideoElement,
  maxWidth: number
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!(vw > 0 && vh > 0)) return null
  const w = Math.min(vw, maxWidth)
  const h = Math.max(1, Math.round((vh * w) / vw))
  const ctx = context(w, h)
  if (!ctx) return null
  try {
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(video, 0, 0, w, h)
    return { data: ctx.getImageData(0, 0, w, h).data, w, h }
  } catch {
    return null
  }
}

/** Цвет в точке картинки (доли кадра): среднее по окну 5×5 исходных пикселей (шум и сжатие сглаживаются). */
export function pickVideoColor(video: HTMLVideoElement, nx: number, ny: number): string | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!(vw > 0 && vh > 0)) return null
  const side = 5
  const sx = Math.min(vw - side, Math.max(0, Math.round(nx * vw) - 2))
  const sy = Math.min(vh - side, Math.max(0, Math.round(ny * vh) - 2))
  const ctx = context(side, side)
  if (!ctx) return null
  try {
    ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side)
    const px = ctx.getImageData(0, 0, side, side).data
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < side * side; i += 1) {
      r += px[i * 4]
      g += px[i * 4 + 1]
      b += px[i * 4 + 2]
    }
    const n = side * side
    return toHex(r / n, g / n, b / n)
  } catch {
    return null
  }
}
