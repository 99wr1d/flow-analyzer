// Окно-детектор: подготовка кадра для D-FINE и разбор ответа модели. Чистый TS, без ONNX и DOM.
import type { Box } from '../../../shared/tracking/types'

/** Класс «person» в COCO (80 классов, номера с нуля). */
export const PERSON_CLASS = 0
/** Порог уверенности модели для «человека». */
export const PERSON_THRESHOLD = 0.4
/** Размер выреза вокруг игрока. */
export const ROI_WIDTH = 640
export const ROI_HEIGHT = 384
/** Вход сети кратен 32; добавка заполняется серым. */
const MULTIPLE = 32
const PAD_VALUE = 114 / 255
/** Рамки меньше этого (пикселей) — шум. */
const MIN_SIDE = 2

const roundUp = (v: number): number => Math.ceil(v / MULTIPLE) * MULTIPLE

/** Вырез ROI_WIDTH×ROI_HEIGHT с центром в центре roi, целиком внутри кадра (кадр меньше выреза — берётся весь). */
export function roiCrop(roi: Box, frameW: number, frameH: number): Box {
  const w = Math.min(ROI_WIDTH, frameW)
  const h = Math.min(ROI_HEIGHT, frameH)
  const x = Math.round(Math.min(Math.max(0, roi.x + roi.w / 2 - w / 2), frameW - w))
  const y = Math.round(Math.min(Math.max(0, roi.y + roi.h / 2 - h / 2), frameH - h))
  return { x, y, w, h }
}

export interface ModelInput {
  /** CHW, RGB, 0..1. */
  data: Float32Array
  inputW: number
  inputH: number
}

/** Вырез кадра (RGBA) → тензор CHW; размер дополняется справа и снизу до кратного 32 серым цветом. Без масштабирования. */
export function prepareInput(
  rgba: Uint8Array | Uint8ClampedArray,
  frameW: number,
  crop: Box
): ModelInput {
  const inputW = roundUp(crop.w)
  const inputH = roundUp(crop.h)
  const plane = inputW * inputH
  const data = new Float32Array(3 * plane)
  if (crop.w < inputW || crop.h < inputH) data.fill(PAD_VALUE)
  for (let y = 0; y < crop.h; y += 1) {
    let src = ((crop.y + y) * frameW + crop.x) * 4
    let dst = y * inputW
    for (let x = 0; x < crop.w; x += 1) {
      data[dst] = rgba[src] / 255
      data[plane + dst] = rgba[src + 1] / 255
      data[2 * plane + dst] = rgba[src + 2] / 255
      src += 4
      dst += 1
    }
  }
  return { data, inputW, inputH }
}

export interface DecodeSpec {
  numQueries: number
  numClasses: number
  inputW: number
  inputH: number
  /** Вырез кадра, который подавался в сеть (координаты результата — в системе целого кадра). */
  crop: Box
  threshold?: number
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))

/**
 * logits [numQueries × numClasses] и boxes [numQueries × 4] (центр, размер; доли входа сети) → рамки людей в пикселях кадра,
 * по убыванию уверенности. Рамка обрезается по вырезу (заполнение серым не считается).
 */
export function decodePersons(
  logits: ArrayLike<number>,
  boxes: ArrayLike<number>,
  spec: DecodeSpec
): { box: Box; score: number }[] {
  const { numQueries, numClasses, inputW, inputH, crop } = spec
  const threshold = spec.threshold ?? PERSON_THRESHOLD
  const out: { box: Box; score: number }[] = []
  for (let q = 0; q < numQueries; q += 1) {
    const score = sigmoid(logits[q * numClasses + PERSON_CLASS])
    if (!(score >= threshold)) continue
    const cx = boxes[q * 4] * inputW
    const cy = boxes[q * 4 + 1] * inputH
    const w = boxes[q * 4 + 2] * inputW
    const h = boxes[q * 4 + 3] * inputH
    const x0 = Math.max(0, cx - w / 2)
    const y0 = Math.max(0, cy - h / 2)
    const x1 = Math.min(crop.w, cx + w / 2)
    const y1 = Math.min(crop.h, cy + h / 2)
    if (x1 - x0 < MIN_SIDE || y1 - y0 < MIN_SIDE) continue
    out.push({ box: { x: crop.x + x0, y: crop.y + y0, w: x1 - x0, h: y1 - y0 }, score })
  }
  return out.sort((a, b) => b.score - a.score)
}
