// Экспорт клипов: запрос, прогресс и результат. Общее для main, preload и интерфейса.
// Пути к файлам в этом контракте не передаются: видео задаётся идентификатором, папку выбирает пользователь в диалоге main.
import { z } from 'zod'

export const MAX_EXPORT_CLIPS = 500
export const MAX_PADDING = 10
/** Насколько конец клипа может выходить за длительность видео (секунд): длительность в метаданных бывает округлена. */
export const DURATION_TOLERANCE = 0.5
/** Короче этого клип не вырезается. */
export const MIN_CLIP_SECONDS = 0.1

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

export const ExportRequestSchema = z.object({
  videoId: z.string().min(1).max(100),
  clips: z.array(ExportClipSchema).min(1).max(MAX_EXPORT_CLIPS),
  mode: z.enum(EXPORT_MODES),
  precision: z.enum(EXPORT_PRECISIONS),
  /** Запас по краям, секунд. */
  padding: z.number().finite().min(0).max(MAX_PADDING),
  /** Имя проекта для имени подборки; null — взять имя видеофайла. */
  projectName: z.string().max(300).nullable()
})

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
