// Модель рисунков поверх видео. Общая для интерфейса, сохранения проекта (этап 8) и экспорта.
// Все координаты НОРМАЛИЗОВАНЫ по кадру видео (0..1 по ширине/высоте самой картинки, без чёрных полей),
// поэтому рисунки «приклеены» к картинке при любом размере окна. Размеры линий и текста — доли высоты видео.
import { z } from 'zod'

export const MIN_DURATION = 0.2
export const MAX_DURATION = 60
export const DEFAULT_DURATION = 3
export const MAX_TEXT_LENGTH = 200
/** Стоп-кадр при экспорте для рисунка «только кадр»: сколько секунд кадр стоит в готовом видео. */
export const MIN_FREEZE = 0.5
export const MAX_FREEZE = 30
export const DEFAULT_FREEZE = 3

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
  z.object({
    mode: z.literal('frame'),
    start: z.number().min(0),
    /** Старые проекты поля не имеют — для них берётся значение по умолчанию (формат файла не меняется). */
    freezeSeconds: z.number().min(MIN_FREEZE).max(MAX_FREEZE).default(DEFAULT_FREEZE)
  })
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
/** Где живёт рисунок: на экране (координаты кадра) или на поле (метры; нужна разметка поля). Старые файлы — «screen». */
const screenSpace = z.literal('screen').default('screen')

export const ArrowSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('arrow'),
  ...twoPoints,
  style: ShapeStyleSchema,
  timing: TimingSchema
})
export const LineSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('line'),
  ...twoPoints,
  style: ShapeStyleSchema,
  timing: TimingSchema
})
/** Эллипс, вписанный в прямоугольник с противоположными углами p1 и p2. */
export const CircleSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('circle'),
  ...twoPoints,
  style: ShapeStyleSchema,
  timing: TimingSchema
})
/** pos — левый верхний угол подписи. */
export const TextSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('text'),
  pos: PointSchema,
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  style: TextStyleSchema,
  timing: TimingSchema
})

// --- Рисунки на поле: координаты в метрах, привязаны к разметке поля (calibrationId) ---

/** Точка на поле, метры (начало координат — угол поля). */
export const WorldPointSchema = z.object({
  x: z.number().min(-80).max(200),
  y: z.number().min(-80).max(160)
})
export const MIN_RING_RADIUS = 0.15
export const MAX_RING_RADIUS = 30
export const DEFAULT_RING_RADIUS = 1

const onPitch = { id, space: z.literal('pitch'), calibrationId: id }
const groundTwo = { p1: WorldPointSchema, p2: WorldPointSchema }

/** Кольцо на траве: окружность радиуса radius метров вокруг center. */
export const RingSchema = z.object({
  ...onPitch,
  type: z.literal('ring'),
  center: WorldPointSchema,
  radius: z.number().min(MIN_RING_RADIUS).max(MAX_RING_RADIUS),
  style: ShapeStyleSchema,
  timing: TimingSchema
})
/** Стрелка на траве: многоугольник на плоскости поля постоянной ширины в метрах. */
export const GroundArrowSchema = z.object({
  ...onPitch,
  type: z.literal('parrow'),
  ...groundTwo,
  style: ShapeStyleSchema,
  timing: TimingSchema
})
export const GroundLineSchema = z.object({
  ...onPitch,
  type: z.literal('pline'),
  ...groundTwo,
  style: ShapeStyleSchema,
  timing: TimingSchema
})
/** Подпись, стоящая вертикально над точкой земли pos. */
export const GroundTextSchema = z.object({
  ...onPitch,
  type: z.literal('ptext'),
  pos: WorldPointSchema,
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  style: TextStyleSchema,
  timing: TimingSchema
})
/** Линейка: линия по земле с засечками и подписью «23.4 м». */
export const RulerSchema = z.object({
  ...onPitch,
  type: z.literal('ruler'),
  ...groundTwo,
  style: ShapeStyleSchema,
  timing: TimingSchema
})

export const AnnotationSchema = z.discriminatedUnion('type', [
  ArrowSchema,
  LineSchema,
  CircleSchema,
  TextSchema,
  RingSchema,
  GroundArrowSchema,
  GroundLineSchema,
  GroundTextSchema,
  RulerSchema
])
export const AnnotationListSchema = z.array(AnnotationSchema)

export type Point = z.infer<typeof PointSchema>
export type WorldPoint = z.infer<typeof WorldPointSchema>
export type Timing = z.infer<typeof TimingSchema>
export type ShapeStyle = z.infer<typeof ShapeStyleSchema>
export type TextStyle = z.infer<typeof TextStyleSchema>
export type Arrow = z.infer<typeof ArrowSchema>
export type Line = z.infer<typeof LineSchema>
export type Circle = z.infer<typeof CircleSchema>
export type TextAnnotation = z.infer<typeof TextSchema>
export type Ring = z.infer<typeof RingSchema>
export type GroundArrow = z.infer<typeof GroundArrowSchema>
export type GroundLine = z.infer<typeof GroundLineSchema>
export type GroundText = z.infer<typeof GroundTextSchema>
export type Ruler = z.infer<typeof RulerSchema>
export type Annotation = z.infer<typeof AnnotationSchema>
export type AnnotationType = Annotation['type']
export type ScreenAnnotation = Arrow | Line | Circle | TextAnnotation
export type PitchAnnotation = Ring | GroundArrow | GroundLine | GroundText | Ruler
export type TwoPointAnnotation = Arrow | Line | Circle

/** Рисунок живёт на поле (координаты в метрах). */
export const isPitchAnnotation = (a: Annotation): a is PitchAnnotation => a.space === 'pitch'
export const isScreenAnnotation = (a: Annotation): a is ScreenAnnotation => a.space !== 'pitch'

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

export type FreezeParse =
  { ok: true; value: number } | { ok: false; error: 'empty' | 'nan' | 'range' }

/** Разбор введённой длины стоп-кадра (секунды; допустима запятая). Не бросает исключений. */
export function parseFreeze(input: string): FreezeParse {
  const text = input.trim().replace(',', '.')
  if (text === '') return { ok: false, error: 'empty' }
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: 'nan' }
  const value = Number(text)
  if (!Number.isFinite(value) || value < MIN_FREEZE || value > MAX_FREEZE) {
    return { ok: false, error: 'range' }
  }
  return { ok: true, value }
}
