// Модель рисунков поверх видео. Общая для интерфейса, сохранения проекта (этап 8) и экспорта.
// Все координаты НОРМАЛИЗОВАНЫ по кадру видео (0..1 по ширине/высоте самой картинки, без чёрных полей),
// поэтому рисунки «приклеены» к картинке при любом размере окна. Размеры линий и текста — доли высоты видео.
import { z } from 'zod'

export const MIN_DURATION = 0.2
export const MAX_DURATION = 60
export const DEFAULT_DURATION = 3
export const MAX_TEXT_LENGTH = 200

const unit = z.number().min(0).max(1)
const PointSchema = z.object({ x: unit, y: unit })
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const id = z.uuid()

export const TimingSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('range'),
    start: z.number().min(0),
    duration: z.number().min(MIN_DURATION).max(MAX_DURATION)
  }),
  z.object({ mode: z.literal('frame'), start: z.number().min(0) })
])

/** Стиль линии: толщина — доля высоты видео. */
const ShapeStyleSchema = z.object({
  color,
  width: z.number().min(0.001).max(0.05),
  dash: z.enum(['solid', 'dashed'])
})
/** Стиль текста: размер — доля высоты видео. */
const TextStyleSchema = z.object({
  color,
  size: z.number().min(0.01).max(0.3),
  background: z.boolean()
})

const twoPoints = { p1: PointSchema, p2: PointSchema }

export const ArrowSchema = z.object({
  id,
  type: z.literal('arrow'),
  ...twoPoints,
  style: ShapeStyleSchema,
  timing: TimingSchema
})
export const LineSchema = z.object({
  id,
  type: z.literal('line'),
  ...twoPoints,
  style: ShapeStyleSchema,
  timing: TimingSchema
})
/** Эллипс, вписанный в прямоугольник с противоположными углами p1 и p2. */
export const CircleSchema = z.object({
  id,
  type: z.literal('circle'),
  ...twoPoints,
  style: ShapeStyleSchema,
  timing: TimingSchema
})
/** pos — левый верхний угол подписи. */
export const TextSchema = z.object({
  id,
  type: z.literal('text'),
  pos: PointSchema,
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  style: TextStyleSchema,
  timing: TimingSchema
})

export const AnnotationSchema = z.discriminatedUnion('type', [
  ArrowSchema,
  LineSchema,
  CircleSchema,
  TextSchema
])
export const AnnotationListSchema = z.array(AnnotationSchema)

export type Point = z.infer<typeof PointSchema>
export type Timing = z.infer<typeof TimingSchema>
export type ShapeStyle = z.infer<typeof ShapeStyleSchema>
export type TextStyle = z.infer<typeof TextStyleSchema>
export type Arrow = z.infer<typeof ArrowSchema>
export type Line = z.infer<typeof LineSchema>
export type Circle = z.infer<typeof CircleSchema>
export type TextAnnotation = z.infer<typeof TextSchema>
export type Annotation = z.infer<typeof AnnotationSchema>
export type AnnotationType = Annotation['type']
export type TwoPointAnnotation = Arrow | Line | Circle

const EPS = 1e-6

/** Время середины кадра, в котором находится момент time. */
export function frameCenter(time: number, fps: number): number {
  if (!(fps > 0) || !Number.isFinite(time)) return Math.max(0, time || 0)
  return (Math.floor(Math.max(0, time) * fps + EPS) + 0.5) / fps
}

/** Виден ли рисунок в момент time. Режим «кадр»: только в кадре, чья середина — start (±половина кадра). */
export function isVisible(
  annotation: Pick<Annotation, 'timing'>,
  time: number,
  fps: number
): boolean {
  const { timing } = annotation
  if (timing.mode === 'range') {
    return time >= timing.start - EPS && time < timing.start + timing.duration - EPS
  }
  const half = 0.5 / (fps > 0 ? fps : 25)
  return time >= timing.start - half - EPS && time < timing.start + half - EPS
}

/** Длительность нового рисунка: 3 секунды, но не дальше конца видео (и не меньше минимума). */
export function defaultDuration(start: number, videoDuration: number): number {
  const room =
    Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration - start : Infinity
  return Math.max(MIN_DURATION, Math.min(DEFAULT_DURATION, room))
}

export type DurationParse =
  { ok: true; value: number } | { ok: false; error: 'empty' | 'nan' | 'range' }

/** Разбор введённой длительности (секунды; допустима запятая). Не бросает исключений. */
export function parseDuration(input: string): DurationParse {
  const text = input.trim().replace(',', '.')
  if (text === '') return { ok: false, error: 'empty' }
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: 'nan' }
  const value = Number(text)
  if (!Number.isFinite(value) || value < MIN_DURATION || value > MAX_DURATION) {
    return { ok: false, error: 'range' }
  }
  return { ok: true, value }
}
