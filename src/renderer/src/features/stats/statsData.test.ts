import { describe, expect, it } from 'vitest'
import { StatsExportSchema } from '../../../../shared/statsExport'
import type { Episode } from '../../../../shared/episodes'
import { buildExportPayload, deriveStats } from './statsData'

const ep = (id: number, tagId: string, start: number, end: number, note?: string): Episode => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  tagId,
  tagName: tagId.toUpperCase(),
  tagColor: '#2bd67b',
  start,
  end,
  rating: null,
  review: false,
  ...(note ? { note } : {})
})
const base = { duration: 100, tags: [], bin: 'auto' as const }

describe('данные окна статистики', () => {
  const items = [ep(1, 'b', 50, 60), ep(2, 'a', 10, 20, '=1+1'), ep(3, 'a', 90, 130)]

  it('фильтр учитывается только по запросу', () => {
    const all = deriveStats({ ...base, items, filter: ['a'], respectFilter: false })
    expect(all.stats.overall.episodes).toBe(3)
    const filtered = deriveStats({ ...base, items, filter: ['a'], respectFilter: true })
    expect(filtered.stats.overall.episodes).toBe(2)
    expect(filtered.episodes.map((e) => e.start)).toEqual([10, 90])
  })

  it('запрос на выгрузку проходит схему, времена обрезаны', () => {
    const { stats, episodes } = deriveStats({ ...base, items, filter: [], respectFilter: false })
    const payload = buildExportPayload(stats, episodes, {
      fileStem: 'Матч',
      videoId: null,
      duration: 100
    })
    expect(StatsExportSchema.safeParse(payload).success).toBe(true)
    expect(payload.episodes.map((e) => [e.start, e.end])).toEqual([
      [10, 20],
      [50, 60],
      [90, 100]
    ])
    expect(payload.episodes[0].note).toBe('=1+1')
    expect(payload.episodes[1].note).toBeUndefined()
    expect(payload.tags).toHaveLength(2)
  })

  it('пустая статистика тоже допустима', () => {
    const { stats, episodes } = deriveStats({
      ...base,
      items: [],
      filter: [],
      respectFilter: false
    })
    const payload = buildExportPayload(stats, episodes, {
      fileStem: null,
      videoId: null,
      duration: 0
    })
    expect(StatsExportSchema.safeParse(payload).success).toBe(true)
  })
})
