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
/** Управляющая точка кривой может лежать за кадром (кривая при этом остаётся в кадре). */
const ControlPointSchema = z.object({ x: z.number().min(-1).max(2), y: z.number().min(-1).max(2) })
const id = z.uuid()
/** Рисунок лежит «под игроками» (ключ по газону). Нет поля — значение по умолчанию для вида рисунка (isUnderPlayers). */
const underPlayers = z.boolean().optional()
/**
 * Заливка круга и кольца, доля прозрачности. Нет поля — как было до 0.16.4 (круг 0.16, кольцо 0.18);
 * новые рисунки получают лёгкую заливку (DEFAULT_RING_FILL), чтобы игрок под кольцом оставался виден.
 */
export const MAX_RING_FILL = 0.4
export const DEFAULT_RING_FILL = 0.06
export const LEGACY_CIRCLE_FILL = 0.16
export const LEGACY_RING_FILL = 0.18
const ringFill = z.number().min(0).max(MAX_RING_FILL).optional()

// --- Этап 16б: ключевые кадры (анимация рисунка) ---

/** Максимум ключей у одного рисунка. */
// Ключи слежения за игроком идут почти на каждом кадре отрезка, поэтому предел высокий (старые версии программы
// проект с более чем 200 ключами не откроют).
export const MAX_KEYFRAMES = 3000
/** Ключи ближе друг к другу, секунд, считаются одним моментом. */
export const KEY_EPS = 1e-6
export const EASES = ['linear', 'ease'] as const
export type Ease = (typeof EASES)[number]
export const DEFAULT_EASE: Ease = 'ease'

/**
 * Ключи рисунка: геометрия (поля, которые задают положение и форму вида рисунка) в моменты времени t.
 * Стиль и свойства не анимируются. Время строго возрастает; массивы точек во всех ключах одной длины.
 * ease ключа — переход от него к следующему ключу (нет поля — «ease» = плавно).
 */
// Тип результата длинный и выводится из схемы: явный возвращаемый тип здесь не нужен.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function kf<S extends z.ZodRawShape>(shape: S) {
  const geom = z.object(shape)
  return z
    .array(
      z.object({
        t: z.number().min(0).max(1_000_000),
        ease: z.enum(EASES).optional(),
        /** Ключ поставлен слежением за игроком (пересчитывается при новом слежении). Нет поля — ключ ручной. */
        auto: z.literal(true).optional(),
        geom
      })
    )
    .min(1)
    .max(MAX_KEYFRAMES)
    .superRefine((keys, ctx) => {
      if (keys.length === 0) return
      for (let i = 1; i < keys.length; i += 1) {
        if (!(keys[i].t - keys[i - 1].t > KEY_EPS)) {
          ctx.addIssue({ code: 'custom', message: 'Ключи должны идти по возрастанию времени' })
          return
        }
      }
      const first = keys[0].geom as Record<string, unknown>
      for (const k of keys) {
        const g = k.geom as Record<string, unknown>
        for (const name of Object.keys(first)) {
          const a = first[name]
          const b = g[name]
          if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) {
            ctx.addIssue({ code: 'custom', message: 'У всех ключей одинаковое число вершин' })
            return
          }
        }
      }
    })
    .optional()
}

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
  underPlayers,
  keyframes: kf(twoPoints),
  timing: TimingSchema
})
export const LineSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('line'),
  ...twoPoints,
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf(twoPoints),
  timing: TimingSchema
})
/** Эллипс, вписанный в прямоугольник с противоположными углами p1 и p2. */
export const CircleSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('circle'),
  ...twoPoints,
  style: ShapeStyleSchema,
  fillOpacity: ringFill,
  underPlayers,
  keyframes: kf(twoPoints),
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
  keyframes: kf({ pos: PointSchema }),
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
const ringRadius = z.number().min(MIN_RING_RADIUS).max(MAX_RING_RADIUS)

const onPitch = { id, space: z.literal('pitch'), calibrationId: id }
const groundTwo = { p1: WorldPointSchema, p2: WorldPointSchema }

/** Кольцо на траве: окружность радиуса radius метров вокруг center. */
export const RingSchema = z.object({
  ...onPitch,
  type: z.literal('ring'),
  center: WorldPointSchema,
  radius: z.number().min(MIN_RING_RADIUS).max(MAX_RING_RADIUS),
  style: ShapeStyleSchema,
  fillOpacity: ringFill,
  underPlayers,
  keyframes: kf({ center: WorldPointSchema, radius: ringRadius }),
  timing: TimingSchema
})
/** Стрелка на траве: многоугольник на плоскости поля постоянной ширины в метрах. */
export const GroundArrowSchema = z.object({
  ...onPitch,
  type: z.literal('parrow'),
  ...groundTwo,
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf(groundTwo),
  timing: TimingSchema
})
export const GroundLineSchema = z.object({
  ...onPitch,
  type: z.literal('pline'),
  ...groundTwo,
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf(groundTwo),
  timing: TimingSchema
})
/** Подпись, стоящая вертикально над точкой земли pos. */
export const GroundTextSchema = z.object({
  ...onPitch,
  type: z.literal('ptext'),
  pos: WorldPointSchema,
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  style: TextStyleSchema,
  keyframes: kf({ pos: WorldPointSchema }),
  timing: TimingSchema
})
/** Линейка: линия по земле с засечками и подписью «23.4 м». */
export const RulerSchema = z.object({
  ...onPitch,
  type: z.literal('ruler'),
  ...groundTwo,
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf(groundTwo),
  timing: TimingSchema
})

// --- Этап 15: прожектор, изогнутая стрелка, перо, зона, лупа, связи игроков ---

export const MIN_DIM = 0.2
export const MAX_DIM = 0.8
export const DEFAULT_DIM = 0.55
export const MIN_ZONE_OPACITY = 0.1
export const MAX_ZONE_OPACITY = 0.6
export const DEFAULT_ZONE_OPACITY = 0.3
export const MAX_PEN_POINTS = 400
export const MAX_ZONE_VERTICES = 60
export const MAX_CHAIN_NODES = 30
export const MIN_LOUPE_RADIUS = 0.04
export const MAX_LOUPE_RADIUS = 0.3
export const DEFAULT_LOUPE_RADIUS = 0.12
export const LOUPE_ZOOMS = [1.5, 2, 3] as const
export const DEFAULT_LOUPE_ZOOM = 2
export const MIN_SPOT_RADIUS = 0.5
export const MAX_SPOT_RADIUS = 15
export const DEFAULT_SPOT_RADIUS = 2.2
const spotRadius = z.number().min(MIN_SPOT_RADIUS).max(MAX_SPOT_RADIUS)
const penPoints = z.array(PointSchema).min(2).max(MAX_PEN_POINTS)
const zonePoints = z.array(PointSchema).min(3).max(MAX_ZONE_VERTICES)
const chainPoints = z.array(PointSchema).min(2).max(MAX_CHAIN_NODES)
const groundPenPoints = z.array(WorldPointSchema).min(2).max(MAX_PEN_POINTS)
const groundZonePoints = z.array(WorldPointSchema).min(3).max(MAX_ZONE_VERTICES)
const groundChainPoints = z.array(WorldPointSchema).min(2).max(MAX_CHAIN_NODES)

const dim = z.number().min(MIN_DIM).max(MAX_DIM).default(DEFAULT_DIM)
const zoneOpacity = z
  .number()
  .min(MIN_ZONE_OPACITY)
  .max(MAX_ZONE_OPACITY)
  .default(DEFAULT_ZONE_OPACITY)
const zoom = z
  .number()
  .refine((v) => (LOUPE_ZOOMS as readonly number[]).includes(v), 'Увеличение: 1.5, 2 или 3')
  .default(DEFAULT_LOUPE_ZOOM)

/** Прожектор: затемняет всё, кроме эллипса, вписанного в прямоугольник p1–p2. */
export const SpotlightSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('spot'),
  ...twoPoints,
  dim,
  /** Вертикальный «луч» (как у прожектора на траве); появляется при переводе прожектора с поля для слежения. */
  beam: z.boolean().optional(),
  style: ShapeStyleSchema,
  keyframes: kf(twoPoints),
  timing: TimingSchema
})
/** Изогнутая стрелка: квадратичная кривая Безье p1 → p2 с управляющей точкой c. */
export const CurveSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('curve'),
  ...twoPoints,
  c: ControlPointSchema,
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ ...twoPoints, c: ControlPointSchema }),
  timing: TimingSchema
})
/** Перо: нарисованная от руки линия (точки уже упрощены). */
export const PenSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('pen'),
  points: z.array(PointSchema).min(2).max(MAX_PEN_POINTS),
  arrow: z.boolean().default(false),
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ points: penPoints }),
  timing: TimingSchema
})
/** Зона: многоугольник с полупрозрачной заливкой. */
export const ZoneSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('zone'),
  points: z.array(PointSchema).min(3).max(MAX_ZONE_VERTICES),
  opacity: zoneOpacity,
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ points: zonePoints }),
  timing: TimingSchema
})
/** Лупа: круг с центром pos показывает увеличенный участок кадра вокруг точки src. radius — доля высоты кадра. */
export const LoupeSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('loupe'),
  pos: PointSchema,
  src: PointSchema,
  radius: z.number().min(MIN_LOUPE_RADIUS).max(MAX_LOUPE_RADIUS),
  zoom,
  style: ShapeStyleSchema,
  keyframes: kf({ pos: PointSchema, src: PointSchema }),
  timing: TimingSchema
})
/** Связи игроков / линия обороны: ломаная по точкам (ноги игроков) с узлами. */
export const ChainSchema = z.object({
  id,
  space: screenSpace,
  type: z.literal('chain'),
  points: z.array(PointSchema).min(2).max(MAX_CHAIN_NODES),
  fill: z.boolean().default(false),
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ points: chainPoints }),
  timing: TimingSchema
})

/** Прожектор на траве: эллипс на земле радиусом radius метров и (по желанию) вертикальный «луч». */
export const GroundSpotlightSchema = z.object({
  ...onPitch,
  type: z.literal('pspot'),
  center: WorldPointSchema,
  radius: z.number().min(MIN_SPOT_RADIUS).max(MAX_SPOT_RADIUS),
  dim,
  beam: z.boolean().default(true),
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ center: WorldPointSchema, radius: spotRadius }),
  timing: TimingSchema
})
/** Изогнутая стрелка на траве: кривая задана в метрах. */
export const GroundCurveSchema = z.object({
  ...onPitch,
  type: z.literal('pcurve'),
  ...groundTwo,
  c: WorldPointSchema,
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ ...groundTwo, c: WorldPointSchema }),
  timing: TimingSchema
})
/** Перо на траве: точки в метрах. */
export const GroundPenSchema = z.object({
  ...onPitch,
  type: z.literal('ppen'),
  points: z.array(WorldPointSchema).min(2).max(MAX_PEN_POINTS),
  arrow: z.boolean().default(false),
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ points: groundPenPoints }),
  timing: TimingSchema
})
/** Зона на траве; showArea — подпись площади в м². */
export const GroundZoneSchema = z.object({
  ...onPitch,
  type: z.literal('pzone'),
  points: z.array(WorldPointSchema).min(3).max(MAX_ZONE_VERTICES),
  opacity: zoneOpacity,
  showArea: z.boolean().default(true),
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ points: groundZonePoints }),
  timing: TimingSchema
})
/** Связи игроков на траве; labels — подписи длин звеньев и «Ширина линии». */
export const GroundChainSchema = z.object({
  ...onPitch,
  type: z.literal('pchain'),
  points: z.array(WorldPointSchema).min(2).max(MAX_CHAIN_NODES),
  fill: z.boolean().default(false),
  labels: z.boolean().default(true),
  style: ShapeStyleSchema,
  underPlayers,
  keyframes: kf({ points: groundChainPoints }),
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
  RulerSchema,
  SpotlightSchema,
  CurveSchema,
  PenSchema,
  ZoneSchema,
  LoupeSchema,
  ChainSchema,
  GroundSpotlightSchema,
  GroundCurveSchema,
  GroundPenSchema,
  GroundZoneSchema,
  GroundChainSchema
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
export type Spotlight = z.infer<typeof SpotlightSchema>
export type Curve = z.infer<typeof CurveSchema>
export type Pen = z.infer<typeof PenSchema>
export type Zone = z.infer<typeof ZoneSchema>
export type Loupe = z.infer<typeof LoupeSchema>
export type Chain = z.infer<typeof ChainSchema>
export type GroundSpotlight = z.infer<typeof GroundSpotlightSchema>
export type GroundCurve = z.infer<typeof GroundCurveSchema>
export type GroundPen = z.infer<typeof GroundPenSchema>
export type GroundZone = z.infer<typeof GroundZoneSchema>
export type GroundChain = z.infer<typeof GroundChainSchema>
export type Annotation = z.infer<typeof AnnotationSchema>
export type AnnotationType = Annotation['type']
export type ScreenAnnotation =
  Arrow | Line | Circle | TextAnnotation | Spotlight | Curve | Pen | Zone | Loupe | Chain
export type PitchAnnotation =
  | Ring
  | GroundArrow
  | GroundLine
  | GroundText
  | Ruler
  | GroundSpotlight
  | GroundCurve
  | GroundPen
  | GroundZone
  | GroundChain
export type TwoPointAnnotation = Arrow | Line | Circle
/** Рисунки на экране, лежащие в рамке p1–p2 (как круг). */
export type BoxAnnotation = Circle | Spotlight
/** Рисунки, состоящие из списка точек (экран или поле). */
export type PointsAnnotation = Pen | Zone | Chain | GroundPen | GroundZone | GroundChain

/** Рисунок — прожектор (экран или поле): затемняет всё вокруг. */
export const isSpotlight = (a: Annotation): a is Spotlight | GroundSpotlight =>
  a.type === 'spot' || a.type === 'pspot'

/** Виды рисунков, которые по умолчанию лежат на траве под игроками: всё, что нарисовано на земле. */
const UNDER_BY_DEFAULT: ReadonlySet<string> = new Set([
  'ring',
  'parrow',
  'pline',
  'pcurve',
  'ppen',
  'pzone',
  'pchain',
  'pspot',
  'ruler'
])
/** Виды, которым «под игроками» не имеет смысла: подписи, лупа и затемнение прожектора (оно всегда поверх кадра). */
const NEVER_UNDER: ReadonlySet<string> = new Set(['text', 'ptext', 'loupe', 'spot'])

/** Значение «под игроками» по умолчанию для вида рисунка. Старые проекты поля не имеют — берётся оно. */
export const defaultUnderPlayers = (type: string): boolean => UNDER_BY_DEFAULT.has(type)
/** Подсветки на экране, которые с 0.16.4 новыми кладутся под игроков (старые рисунки хранят своё значение). */
const UNDER_WHEN_NEW_ON_SCREEN: ReadonlySet<string> = new Set(['circle', 'zone'])
/**
 * «Под игроками» для НОВОГО рисунка, пока пользователь не выбрал сам: всё на поле, а на экране
 * круг/эллипс и зона (подсветка выделяет игрока, а не закрывает его). Стрелки и линии на экране — поверх.
 */
export const newUnderDefault = (type: string, space: 'pitch' | 'screen'): boolean =>
  canBeUnder(type) && (space === 'pitch' || UNDER_WHEN_NEW_ON_SCREEN.has(type))
/** Можно ли положить рисунок под игроков (подписи и лупа всегда поверх). */
export const canBeUnder = (type: string): boolean => !NEVER_UNDER.has(type)
/** Лежит ли рисунок под игроками: явное значение или умолчание по виду. Подписи — никогда. */
export const isUnderPlayers = (a: { type: string; underPlayers?: boolean }): boolean =>
  canBeUnder(a.type) && (a.underPlayers ?? defaultUnderPlayers(a.type))

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
