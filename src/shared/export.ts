// Экспорт клипов: запрос, прогресс и результат. Общее для main, preload и интерфейса.
// Пути к файлам в этом контракте не передаются: видео задаётся идентификатором, папку выбирает пользователь в диалоге main.
import { z } from 'zod'
import { GrassKeyValuesSchema } from './grassKey'
import {
  EASES,
  LOUPE_ZOOMS,
  MAX_KEYFRAMES,
  MAX_LOUPE_RADIUS,
  MIN_LOUPE_RADIUS,
  TimingSchema
} from './annotations'

export const MAX_EXPORT_CLIPS = 500
export const MAX_PADDING = 10
/** Насколько конец клипа может выходить за длительность видео (секунд): длительность в метаданных бывает округлена. */
export const DURATION_TOLERANCE = 0.5
/** Короче этого клип не вырезается. */
export const MIN_CLIP_SECONDS = 0.1

/** Кодирование: «auto» — видеокарта, если она есть и работает; «cpu» — процессор (x264). */
export const EXPORT_ENCODERS = ['auto', 'cpu'] as const
export type ExportEncoderChoice = (typeof EXPORT_ENCODERS)[number]

export const EXPORT_MODES = ['files', 'compilation'] as const
export const EXPORT_PRECISIONS = ['precise', 'fast'] as const
export type ExportMode = (typeof EXPORT_MODES)[number]
export type ExportPrecision = (typeof EXPORT_PRECISIONS)[number]

export const ExportClipSchema = z.object({
  start: z.number().finite().min(0).max(1_000_000),
  end: z.number().finite().min(0).max(1_000_000),
  /** Название тега: попадает в имя файла (очищается в main). */
  label: z.string().max(200)
})

/** Рисунки в экспорте: время показа каждого (по порядку наложения) и билет на загруженные картинки. */
export const MAX_EXPORT_DRAWINGS = 10_000
export const MAX_EXPORT_LOUPES = 200
const unit = z.number().min(0).max(1)

/** Лупа в экспорте: содержимое линзы делает ffmpeg (см. main/ffmpeg/loupe.ts). Координаты — доли кадра. */
const LoupeKeySchema = z.object({
  t: z.number().min(0).max(1_000_000),
  ease: z.enum(EASES).optional(),
  pos: z.object({ x: unit, y: unit }),
  src: z.object({ x: unit, y: unit })
})
export const ExportLoupeSchema = z.object({
  /** Номер рисунка (по порядку наложения, как в timings). */
  index: z.number().int().min(0).max(MAX_EXPORT_DRAWINGS),
  pos: z.object({ x: unit, y: unit }),
  src: z.object({ x: unit, y: unit }),
  radius: z.number().min(MIN_LOUPE_RADIUS).max(MAX_LOUPE_RADIUS),
  zoom: z.number().refine((v) => (LOUPE_ZOOMS as readonly number[]).includes(v)),
  /** Ключи движущейся лупы (положение линзы и источника во времени). Нет поля — лупа стоит на месте. */
  keys: z.array(LoupeKeySchema).min(2).max(MAX_KEYFRAMES).optional()
})
export const ExportDrawingsSchema = z.object({
  /** Билет, который main выдал при загрузке картинок (stageExportOverlays). */
  token: z.uuid(),
  /** Частота кадров, по которой интерфейс считал стоп-кадры. */
  fps: z.number().finite().gt(0).max(1000),
  timings: z.array(TimingSchema).max(MAX_EXPORT_DRAWINGS),
  /** Лупы среди рисунков. Старые запросы поля не имеют. */
  loupes: z.array(ExportLoupeSchema).max(MAX_EXPORT_LOUPES).default([]),
  /**
   * Номера движущихся (анимированных) рисунков: для них вместо одной картинки на отрезок идёт ряд картинок по кадрам
   * (stageExportFrames). Старые запросы поля не имеют.
   */
  animated: z
    .array(z.number().int().min(0).max(MAX_EXPORT_DRAWINGS))
    .max(MAX_EXPORT_DRAWINGS)
    .optional(),
  /** Какие слои есть у кадров анимации (кадры слоя записаны для всех кадров плана). */
  animLayers: z.object({ over: z.boolean(), under: z.boolean() }).optional(),
  /** Ключ «газон» для рисунков «под игроками» (цвет уже определён интерфейсом). Нужен, если среди картинок есть слой «under». */
  grass: GrassKeyValuesSchema.optional()
})

/** Ограничения на картинки с рисунками (проверяет main). */
export const OVERLAY_LIMITS = {
  /** Картинок всего: на каждый набор рисунков до двух (поверх кадра и под игроками). */
  maxImages: 600,
  /** Различных наборов рисунков. */
  maxKeys: 300,
  maxImageBytes: 8 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
  /** Кадров анимации на весь экспорт (на каждый кадр до двух картинок: «поверх» и «под игроками»). */
  maxAnimFrames: 3000,
  /** Все картинки анимации вместе. */
  maxAnimBytes: 1536 * 1024 * 1024,
  /** Картинок кадров в одном обращении к main. */
  maxFramesPerCall: 100,
  minSide: 16,
  maxSide: 8192,
  maxKeyLength: 100_000
} as const

export const OVERLAY_LAYERS = ['over', 'under'] as const
export type OverlayLayer = (typeof OVERLAY_LAYERS)[number]

export const OverlayImageSchema = z.object({
  /** Набор рисунков на картинке: номера через дефис («3-7-12»), см. exportOverlays.ts. */
  key: z
    .string()
    .max(OVERLAY_LIMITS.maxKeyLength)
    .regex(/^\d+(-\d+)*$/),
  data: z.instanceof(Uint8Array),
  /** Слой: «over» — поверх всего, «under» — под игроками (ключ по газону). Старые запросы — «over». */
  layer: z.enum(OVERLAY_LAYERS).default('over')
})
export const StageOverlaysSchema = z.object({
  width: z.number().int().min(OVERLAY_LIMITS.minSide).max(OVERLAY_LIMITS.maxSide),
  height: z.number().int().min(OVERLAY_LIMITS.minSide).max(OVERLAY_LIMITS.maxSide),
  /** Может быть пустым: если на видео только движущиеся рисунки, картинки приходят потом, кадрами. */
  images: z.array(OverlayImageSchema).max(OVERLAY_LIMITS.maxImages)
})
export type StageOverlays = z.infer<typeof StageOverlaysSchema>

/** Часть кадров анимации: PNG на каждый кадр исходного видео, слой «over» или «under». */
export const StageFramesSchema = z.object({
  token: z.uuid(),
  layer: z.enum(OVERLAY_LAYERS),
  frames: z
    .array(
      z.object({ frame: z.number().int().min(0).max(10_000_000), data: z.instanceof(Uint8Array) })
    )
    .min(1)
    .max(OVERLAY_LIMITS.maxFramesPerCall)
})
export type StageFrames = z.infer<typeof StageFramesSchema>

export const ExportRequestSchema = z.object({
  videoId: z.string().min(1).max(100),
  clips: z.array(ExportClipSchema).min(1).max(MAX_EXPORT_CLIPS),
  mode: z.enum(EXPORT_MODES),
  precision: z.enum(EXPORT_PRECISIONS),
  /** Запас по краям, секунд. */
  padding: z.number().finite().min(0).max(MAX_PADDING),
  /** Имя проекта для имени подборки; null — взять имя видеофайла. */
  projectName: z.string().max(300).nullable(),
  /** Нанести рисунки на видео (только с перекодированием). */
  drawings: ExportDrawingsSchema.optional(),
  /** Чем кодировать видео. Старые запросы поля не имеют — это «auto». */
  encoder: z.enum(EXPORT_ENCODERS).optional()
})

export type ExportDrawings = z.infer<typeof ExportDrawingsSchema>
export type ExportClip = z.infer<typeof ExportClipSchema>
export type ExportRequest = z.infer<typeof ExportRequestSchema>

/** Ход экспорта: приходит событием примерно дважды в секунду. */
export interface ExportProgress {
  /** Номер текущего клипа (с 0) и всего клипов; у подборки один «клип». */
  index: number
  count: number
  /** Имя файла, который сейчас создаётся. */
  name: string
  /** Доли 0..1. */
  clipFraction: number
  overallFraction: number
  elapsedMs: number
}

export interface ExportFailure {
  /** Подпись клипа (номер и тег). */
  label: string
  message: string
  details?: string
}

export type ExportStatus = 'done' | 'cancelled' | 'failed' | 'dialog-cancelled'

export interface ExportResult {
  status: ExportStatus
  mode: ExportMode
  /** Сколько клипов должно было получиться. */
  total: number
  /** Имена созданных файлов (без пути). */
  files: string[]
  /** Папка (режим «Отдельные файлы») или файл подборки — для показа. */
  target: string | null
  failures: ExportFailure[]
  elapsedMs: number
}

/** Сведения о кодировании для окна экспорта: найдена ли видеокарта, годная для кодирования. */
export interface ExportEncoderInfo {
  /** Название найденного кодера видеокарты; null — не найден (остаётся процессор). */
  gpuLabel: string | null
}
