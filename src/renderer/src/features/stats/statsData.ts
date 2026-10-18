// Данные окна: какие эпизоды учитываются, сама статистика и запрос на выгрузку CSV.
import { filterEpisodes, type Episode, type RatingFilter } from '../../../../shared/episodes'
import { computeStats, type BinChoice, type Stats } from '../../../../shared/stats'
import type { TagDef } from '../../../../shared/settings'
import type { StatsExport } from '../../../../shared/statsExport'

export interface StatsInput {
  items: readonly Episode[]
  filter: readonly string[]
  ratingFilter?: readonly RatingFilter[]
  respectFilter: boolean
  duration: number
  tags: readonly TagDef[]
  bin: BinChoice
}

/** Эпизоды, по которым считается статистика, по порядку начала. */
export function episodesForStats(
  input: Pick<StatsInput, 'items' | 'filter' | 'ratingFilter' | 'respectFilter'>
): Episode[] {
  const picked = input.respectFilter
    ? filterEpisodes(input.items, input.filter, input.ratingFilter ?? [])
    : [...input.items]
  return picked.sort((a, b) => a.start - b.start || a.end - b.end)
}

export function deriveStats(input: StatsInput): { episodes: Episode[]; stats: Stats } {
  const episodes = episodesForStats(input)
  // Для имён тегов нужен порядок создания (последний снимок — самый свежий), он сохранён в items.
  const ordered = input.respectFilter
    ? filterEpisodes(input.items, input.filter, input.ratingFilter ?? [])
    : input.items
  const stats = computeStats(ordered, input.duration, {
    knownTags: input.tags,
    bin: input.bin
  })
  return { episodes, stats }
}

const clamp = (v: number, hi: number): number => Math.min(hi, Math.max(0, v))

/** Структурированные данные для main (CSV собирает он). Времена обрезаны по видео так же, как в статистике. */
export function buildExportPayload(
  stats: Stats,
  episodes: readonly Episode[],
  ctx: { fileStem: string | null; videoId: string | null; duration: number }
): StatsExport {
  const hi = ctx.duration > 0 ? ctx.duration : Number.MAX_SAFE_INTEGER
  const names = new Map(stats.tags.map((t) => [t.tagId, t.name]))
  return {
    fileStem: ctx.fileStem,
    videoId: ctx.videoId,
    videoDuration: ctx.duration > 0 ? ctx.duration : 0,
    tags: stats.tags.map((t) => ({
      name: t.name,
      count: t.count,
      total: t.total,
      avg: t.avg,
      shareCount: Math.min(100, t.shareCount),
      shareTime: Math.min(100, t.shareTime),
      first: t.first,
      last: t.last,
      good: t.good,
      bad: t.bad,
      review: t.review
    })),
    episodes: episodes.map((e) => {
      const start = clamp(e.start, hi)
      return {
        tag: names.get(e.tagId) ?? e.tagName,
        start,
        end: Math.max(start, clamp(e.end, hi)),
        rating: e.rating,
        review: e.review,
        ...(e.note ? { note: e.note } : {})
      }
    })
  }
}
