// Привязка к линиям на текущем кадре: берём окно пикселей вокруг точки из видеоэлемента и ищем линии в нём.
import { snapToLines } from '../../../../shared/pitch/snap'
import { getVideoElement } from '../player/videoElement'

/** Сторона окна в пикселях анализа; кадр приводится к ширине ~960, чтобы линии везде были одной толщины. */
const WINDOW = 64
const RADIUS = 14
const BASE_WIDTH = 960

let canvas: HTMLCanvasElement | null = null

/** Точка кадра (доли ширины/высоты), к которой привязался клик, или null (нет уверенной линии / кадр недоступен). */
export function snapImagePoint(image: { x: number; y: number }): { x: number; y: number } | null {
  const video = getVideoElement()
  if (!video || video.videoWidth <= 0) return null
  const scale = Math.max(1, video.videoWidth / BASE_WIDTH)
  const side = WINDOW * scale
  const cx = image.x * video.videoWidth
  const cy = image.y * video.videoHeight
  canvas ??= document.createElement('canvas')
  canvas.width = WINDOW
  canvas.height = WINDOW
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  let pixels: ImageData
  try {
    ctx.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, WINDOW, WINDOW)
    pixels = ctx.getImageData(0, 0, WINDOW, WINDOW)
  } catch {
    return null
  }
  const r = snapToLines(pixels, WINDOW / 2, WINDOW / 2, RADIUS)
  if (!r) return null
  return {
    x: (cx + (r.x - WINDOW / 2) * scale) / video.videoWidth,
    y: (cy + (r.y - WINDOW / 2) * scale) / video.videoHeight
  }
}
