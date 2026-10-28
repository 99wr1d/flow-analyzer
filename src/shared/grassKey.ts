// Ключ «газон» (этап 16a): рисунки на траве показываются только там, где в кадре газон, а игроки их закрывают.
// ОДНО определение ключа для экрана (WebGL-шейдер, см. renderer/features/under) и экспорта (фильтр chromakey ffmpeg).
//
// Математика — точная копия libavfilter/vf_chromakey.c (ffmpeg 6.x):
//   для каждого пикселя берётся окно 3×3 в плоскостях U и V (точки за краем кадра — читаются из памяти за плоскостью: у ffmpeg результат на крайнем ряду пикселей
//   не определён; мы считаем такие точки цветом ключа, то есть газоном);
//   diff = среднее по девяти точкам от sqrt((du² + dv²) / (255² · 2)), du и dv — разность с U и V цвета ключа;
//   alpha = blend > 0.0001 ? clip((diff − similarity) / blend, 0, 1) · 255 (с отбрасыванием дробной части)
//                          : (diff > similarity ? 255 : 0).
// alpha 0 — «цвет ключа» (газон), 255 — всё остальное. Нам нужна маска наоборот: grass = 255 − alpha.
// U и V считаются из RGB по формулам JPEG (полный диапазон), теми же, которыми ffmpeg переводит цвет ключа.
// Так цвет, выбранный пипеткой на экране, и цвет, который получает ffmpeg, — одно и то же число.
import { z } from 'zod'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const MIN_GRASS_SIMILARITY = 0.01
export const MAX_GRASS_SIMILARITY = 0.5
export const DEFAULT_GRASS_SIMILARITY = 0.07
export const MIN_GRASS_BLEND = 0
export const MAX_GRASS_BLEND = 0.3
export const DEFAULT_GRASS_BLEND = 0.05
/** Цвет, пока газон не определён (типичный зелёный). */
export const DEFAULT_GRASS_COLOR = '#2f8a3f'

/** Значения ключа, которые нужны для расчёта (в запрос экспорта уходят именно они). */
export const GrassKeyValuesSchema = z.object({
  color: hex,
  similarity: z.number().min(MIN_GRASS_SIMILARITY).max(MAX_GRASS_SIMILARITY),
  blend: z.number().min(MIN_GRASS_BLEND).max(MAX_GRASS_BLEND)
})
export type GrassKeyValues = z.infer<typeof GrassKeyValuesSchema>

/**
 * Настройки ключа в проекте. auto — цвет определяется по кадру автоматически; false — цвет выбран пипеткой или взят
 * с кадра кнопкой. from — время кадра (секунды), с которого взят цвет; в старых проектах его нет.
 */
export const GrassKeySchema = GrassKeyValuesSchema.extend({
  auto: z.boolean(),
  from: z.number().min(0).max(1e6).optional()
})
export type GrassKey = z.infer<typeof GrassKeySchema>

export const DEFAULT_GRASS_KEY: GrassKey = {
  color: DEFAULT_GRASS_COLOR,
  similarity: DEFAULT_GRASS_SIMILARITY,
  blend: DEFAULT_GRASS_BLEND,
  auto: true
}

export function parseHex(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Цвет в виде, который понимает фильтр chromakey: «0xRRGGBB». */
export const ffmpegColor = (color: string): string => `0x${color.slice(1).toLowerCase()}`

// Целочисленные формулы libavutil (RGB → U, V; полный диапазон, 10 бит дробной части).
const ONE_HALF = 1 << 9
export const rgbToU = (r: number, g: number, b: number): number =>
  ((-173 * r - 339 * g + 512 * b + ONE_HALF - 1) >> 10) + 128
export const rgbToV = (r: number, g: number, b: number): number =>
  ((512 * r - 429 * g - 83 * b + ONE_HALF - 1) >> 10) + 128
/** Яркость Y (полный диапазон), как её даёт ffmpeg при переводе кадра в YUV полного диапазона (scale=out_range=pc). */
export const rgbToY = (r: number, g: number, b: number): number =>
  (306 * r + 601 * g + 117 * b + ONE_HALF) >> 10

/** U и V цвета ключа — так их считает ffmpeg. */
export function keyUV(color: string): { u: number; v: number } {
  const [r, g, b] = parseHex(color)
  return { u: rgbToU(r, g, b), v: rgbToV(r, g, b) }
}

/**
 * Какую долю расстояния от цвета газона до нейтрального серого (белая форма, гетры, бутсы, кожа в тени, чёрное) может занять
 * допуск ключа (similarity + blend). Газон телетрансляции бледный: до серого от него ~0.06–0.10, и прежние 0.07 + 0.05
 * считали газоном белых игроков и ноги — рисунки «под игроками» ложились поверх них.
 */
export const NEUTRAL_SHARE = 0.55

/**
 * Чувствительность и мягкость края по умолчанию для цвета газона: прежние 0.07 / 0.05, но не шире NEUTRAL_SHARE расстояния
 * до серого (отношение мягкости к чувствительности то же). Ручные значения пользователя этим не заменяются.
 */
export function autoGrassTuning(color: string): { similarity: number; blend: number } {
  const k = keyUV(color)
  const toNeutral = Math.sqrt(((k.u - 128) ** 2 + (k.v - 128) ** 2) / (255 * 255 * 2))
  const full = DEFAULT_GRASS_SIMILARITY + DEFAULT_GRASS_BLEND
  const total = Math.min(full, NEUTRAL_SHARE * toNeutral)
  const share = DEFAULT_GRASS_SIMILARITY / full
  const similarity = Math.max(MIN_GRASS_SIMILARITY, total * share)
  const blend = (similarity * DEFAULT_GRASS_BLEND) / DEFAULT_GRASS_SIMILARITY
  return { similarity, blend }
}

/**
 * Яркость: пиксель светлее цвета газона на LUMA_GAP (по Y полного диапазона) и больше — не газон, полностью — ещё через
 * LUMA_RAMP. Ключ по цветности не отличает от бледного газона лаймовые гетры, кремовую и светло-жёлтую форму: по цветности они
 * газон, по яркости — нет. Полосы стрижки и солнце светлее газона меньше, чем на LUMA_GAP (проверено на 28 кадрах трансляции:
 * теряется 0.5 % газона — края белых линий).
 */
export const LUMA_GAP = 45
export const LUMA_RAMP = 20

/** Порог яркости для цвета ключа: lut ffmpeg и шейдер берут его отсюда. */
export const lumaThreshold = (color: string): number => {
  const [r, g, b] = parseHex(color)
  return rgbToY(r, g, b) + LUMA_GAP
}

/** Прозрачность по яркости y (0..255, как lut ffmpeg: дробная часть отбрасывается). */
export function lumaAlpha(y: number, threshold: number): number {
  return Math.trunc(Math.min(255, Math.max(0, ((y - threshold) * 255) / LUMA_RAMP)))
}

/** Прозрачность по среднему расстоянию diff: то, что возвращает ffmpeg (0..255, дробная часть отбрасывается). */
export function alphaFromDiff(diff: number, similarity: number, blend: number): number {
  if (blend > 0.0001) {
    const t = Math.min(1, Math.max(0, (diff - similarity) / blend))
    return Math.floor(t * 255)
  }
  return diff > similarity ? 255 : 0
}

/**
 * Прозрачность ffmpeg-фильтра chromakey по плоскостям U и V размером w×h (по одному байту на пиксель).
 * 0 — цвет ключа (газон), 255 — не газон.
 */
export function chromakeyAlpha(
  u: ArrayLike<number>,
  v: ArrayLike<number>,
  w: number,
  h: number,
  key: GrassKeyValues
): Uint8Array {
  const k = keyUV(key.color)
  const dist = (du: number, dv: number): number => Math.sqrt((du * du + dv * dv) / (255 * 255 * 2))
  // Расстояние точки до цвета ключа считаем один раз на пиксель; за краем кадра расстояние нулевое.
  const d = new Float64Array(w * h)
  for (let i = 0; i < w * h; i += 1) d[i] = dist(u[i] - k.u, v[i] - k.v)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0
      for (let j = -1; j <= 1; j += 1) {
        const yy = y + j
        for (let i = -1; i <= 1; i += 1) {
          const xx = x + i
          if (xx >= 0 && xx < w && yy >= 0 && yy < h) sum += d[yy * w + xx]
        }
      }
      out[y * w + x] = alphaFromDiff(sum / 9, key.similarity, key.blend)
    }
  }
  return out
}

/** U и V по пикселям RGBA (как их видит ключ). */
export function uvPlanes(
  rgba: ArrayLike<number>,
  w: number,
  h: number
): { u: Uint8Array; v: Uint8Array } {
  const u = new Uint8Array(w * h)
  const v = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i += 1) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    u[i] = Math.min(255, Math.max(0, rgbToU(r, g, b)))
    v[i] = Math.min(255, Math.max(0, rgbToV(r, g, b)))
  }
  return { u, v }
}

/** Маска «газон» по картинке RGBA: 255 — газон (рисунок виден), 0 — игроки, линии и всё остальное. */
export function grassMask(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  key: GrassKeyValues
): Uint8Array {
  const { u, v } = uvPlanes(rgba, w, h)
  const alpha = chromakeyAlpha(u, v, w, h, key)
  // Светлее газона на LUMA_GAP — не газон (blend lighten в ffmpeg — наибольшая из двух прозрачностей).
  const t = lumaThreshold(key.color)
  for (let i = 0; i < w * h; i += 1) {
    const l = lumaAlpha(rgbToY(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]), t)
    if (l > alpha[i]) alpha[i] = l
  }
  return alpha.map((a) => 255 - a)
}

// --- Автоматическое определение цвета газона ---

/** Доля кадра сверху, которая не смотрится: газон ищем в нижних 60 %. */
export const GRASS_SEARCH_FROM = 0.4
/** Пикселей на сторону при выборке (выборка редкая — хватает для медианы). */
const SAMPLE_STEP = 4
/** Мало «зелёных» пикселей — это не футбольное поле. */
const MIN_GREEN_SHARE = 0.01

/** Зелёный по оттенку: G заметно больше R и B, и цвет не слишком тёмный и не серый. */
export function isGreenish(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max < 35 || max - min < 22) return false
  return g >= max && g > r * 1.12 && g > b * 1.2
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Обратное преобразование Y, U, V (полный диапазон) в RGB. */
function yuvToRgb(y: number, u: number, v: number): [number, number, number] {
  return [
    y + 1.402 * (v - 128),
    y - 0.344136 * (u - 128) - 0.714136 * (v - 128),
    y + 1.772 * (u - 128)
  ]
}

/**
 * Цвет газона по кадру: медиана цветности (U, V) и яркости «зелёных» пикселей нижних 60 % картинки.
 * Линии, игроки и тени в медиану не попадают (они не зелёные или их мало). null — газон не найден.
 */
export function estimateGrassColor(rgba: ArrayLike<number>, w: number, h: number): string | null {
  const ys: number[] = []
  const us: number[] = []
  const vs: number[] = []
  let total = 0
  for (let y = Math.floor(h * GRASS_SEARCH_FROM); y < h; y += SAMPLE_STEP) {
    for (let x = 0; x < w; x += SAMPLE_STEP) {
      total += 1
      const i = (y * w + x) * 4
      const r = rgba[i]
      const g = rgba[i + 1]
      const b = rgba[i + 2]
      if (!isGreenish(r, g, b)) continue
      ys.push(0.299 * r + 0.587 * g + 0.114 * b)
      us.push(rgbToU(r, g, b))
      vs.push(rgbToV(r, g, b))
    }
  }
  if (total === 0 || ys.length < Math.max(8, total * MIN_GREEN_SHARE)) return null
  const [r, g, b] = yuvToRgb(median(ys), median(us), median(vs))
  return toHex(r, g, b)
}
