// Библиотека проектов (стартовый экран): карточки для показа и запросы к main.
// В карточках нет рисунков и эпизодов целиком — только короткая сводка из файла проекта.
import { z } from 'zod'
import { ProjectMetaSchema, type ProjectType } from './project'

/** Ни один эскиз не больше этого размера (байт): большие картинки не отправляются в интерфейс. */
export const MAX_THUMB_BYTES = 60 * 1024
/** Эскизы отправляются не больше чем для стольких карточек за раз. */
export const MAX_THUMBS_PER_LISTING = 200
export const THUMB_WIDTH = 320

export type CardStatus = 'ok' | 'missing' | 'error'

export interface LibraryCard {
  path: string
  status: CardStatus
  /** Причина, если файл проекта не читается. */
  error?: string
  title: string
  type: ProjectType
  /** Дата матча ГГГГ-ММ-ДД. */
  date?: string
  notes?: string
  /** В файле проекта есть своё описание (название, тип…), а не значения по умолчанию. */
  hasMeta: boolean
  videoFileName: string | null
  /** Длительность видео, с, если она была известна при сохранении. */
  videoDuration?: number
  episodes: number
  drawings: number
  /** Когда проект изменён (из файла). null — файл не читается. */
  updatedAt: string | null
  addedAt: string
  lastOpenedAt: string | null
  /** Лежит в папке проектов по умолчанию (или её подпапке): из списка такой проект не убирается. */
  inDefaultFolder: boolean
  /** JPEG-эскиз (до 60 КБ) или null. */
  thumb: Uint8Array | null
}

export interface LibraryListing {
  cards: LibraryCard[]
  /** Папка проектов по умолчанию. */
  folder: string
}

export const CreateProjectRequestSchema = ProjectMetaSchema.extend({
  /** Видео, выданное main через диалог (идентификатор из реестра). */
  videoId: z.uuid()
})
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>

export const UpdateMetaRequestSchema = z.object({
  path: z.string().min(1).max(1024),
  meta: ProjectMetaSchema
})
