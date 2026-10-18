// Запрос на выгрузку статистики в CSV: структурированные данные (не готовый CSV). Файл собирает и записывает main.
import { z } from 'zod'
import { MAX_NOTE, RATINGS } from './episodes'

export const STATS_EXPORT_LIMITS = {
  maxEpisodes: 10_000,
  maxTags: 200,
  maxName: 100,
  maxNote: MAX_NOTE,
  maxSeconds: 1e7
} as const

const L = STATS_EXPORT_LIMITS
const seconds = z.number().min(0).max(L.maxSeconds)
const percent = z.number().min(0).max(100)
const name = z.string().min(1).max(L.maxName)

const TagRowSchema = z.strictObject({
  name,
  count: z.number().int().min(0).max(L.maxEpisodes),
  total: seconds,
  avg: seconds,
  shareCount: percent,
  shareTime: percent,
  first: seconds,
  last: seconds,
  good: z.number().int().min(0).max(L.maxEpisodes).default(0),
  bad: z.number().int().min(0).max(L.maxEpisodes).default(0),
  review: z.number().int().min(0).max(L.maxEpisodes).default(0)
})

const EpisodeRowSchema = z
  .strictObject({
    tag: name,
    start: seconds,
    end: seconds,
    note: z.string().max(L.maxNote).optional(),
    rating: z.enum(RATINGS).nullable().default(null),
    review: z.boolean().default(false)
  })
  .refine((e) => e.end >= e.start, { message: 'Конец раньше начала', path: ['end'] })

export const StatsExportSchema = z.strictObject({
  /** Для имени файла: сохранённый проект, иначе имя видео. null — безымянный. */
  fileStem: z.string().max(200).nullable(),
  /** Видео, рядом с которым предлагается сохранить файл. */
  videoId: z.string().min(1).max(64).nullable(),
  videoDuration: seconds,
  tags: z.array(TagRowSchema).max(L.maxTags),
  episodes: z.array(EpisodeRowSchema).max(L.maxEpisodes)
})

export type StatsExport = z.infer<typeof StatsExportSchema>
export type StatsExportTagRow = z.infer<typeof TagRowSchema>

/** Результат выгрузки: имя файла (без пути) или отмена в диалоге. */
export type StatsExportResult = { status: 'saved'; fileName: string } | { status: 'cancelled' }
