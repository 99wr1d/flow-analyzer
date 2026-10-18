import { describe, expect, it } from 'vitest'
import {
  autoBinSeconds,
  computeStats,
  filterByTags,
  resolveBinSeconds,
  unionLength,
  type StatsEpisode
} from './stats'

const ep = (
  tagId: string,
  start: number,
  end: number,
  name = tagId,
  color = '#2bd67b'
): StatsEpisode => ({
  tagId,
  tagName: name,
  tagColor: color,
  start,
  end
})

describe('computeStats: по тегам', () => {
  it('считает число, время, среднее, доли и первое/последнее появление', () => {
    const s = computeStats(
      [ep('a', 10, 20, 'Атака'), ep('a', 100, 130, 'Атака'), ep('b', 50, 60, 'Гол')],
      600
    )
    expect(s.tags.map((t) => t.tagId)).toEqual(['a', 'b'])
    const a = s.tags[0]
    expect(a.count).toBe(2)
    expect(a.total).toBe(40)
    expect(a.avg).toBe(20)
    expect(a.shareCount).toBeCloseTo(66.667, 2)
    expect(a.shareTime).toBeCloseTo(80, 6)
    expect(a.first).toBe(10)
    expect(a.last).toBe(100)
    expect(s.tags[1].shareTime).toBeCloseTo(20, 6)
    expect(s.tags.reduce((x, t) => x + t.shareCount, 0)).toBeCloseTo(100, 6)
    expect(s.tags.reduce((x, t) => x + t.shareTime, 0)).toBeCloseTo(100, 6)
  })

  it('при равном числе эпизодов сортирует по имени', () => {
    const s = computeStats([ep('z', 0, 1, 'Яблоко'), ep('y', 0, 1, 'Арбуз')], 100)
    expect(s.tags.map((t) => t.name)).toEqual(['Арбуз', 'Яблоко'])
  })

  it('имя тега: берёт актуальное из настроек, иначе самый свежий снимок', () => {
    const items = [ep('a', 0, 1, 'Старое', '#111111'), ep('a', 5, 6, 'Новее', '#222222')]
    const noSettings = computeStats(items, 100)
    expect(noSettings.tags).toHaveLength(1)
    expect(noSettings.tags[0].name).toBe('Новее')
    expect(noSettings.tags[0].color).toBe('#222222')
    const withSettings = computeStats(items, 100, {
      knownTags: [{ id: 'a', name: 'Из настроек', color: '#abcdef' }]
    })
    expect(withSettings.tags[0].name).toBe('Из настроек')
    expect(withSettings.tags[0].color).toBe('#abcdef')
    // Тег, которого уже нет в настройках, остаётся со снимком.
    const other = computeStats(items, 100, {
      knownTags: [{ id: 'q', name: 'Q', color: '#000000' }]
    })
    expect(other.tags[0].name).toBe('Новее')
  })
})

describe('computeStats: итоги', () => {
  it('пересечения считаются один раз для процента видео', () => {
    const s = computeStats([ep('a', 0, 10), ep('b', 5, 15), ep('a', 100, 110)], 200)
    expect(s.overall.episodes).toBe(3)
    expect(s.overall.sumTime).toBe(30)
    expect(s.overall.taggedTime).toBe(25)
    expect(s.overall.taggedPercent).toBeCloseTo(12.5, 6)
    expect(s.overall.tags).toBe(2)
    expect(s.overall.avg).toBe(10)
  })

  it('пустой список', () => {
    const s = computeStats([], 120)
    expect(s.tags).toEqual([])
    expect(s.overall).toMatchObject({
      episodes: 0,
      taggedTime: 0,
      taggedPercent: 0,
      avg: 0,
      tags: 0
    })
    expect(s.distribution.max).toBe(0)
    expect(s.distribution.bins.length).toBeGreaterThan(0)
  })

  it('один эпизод', () => {
    const s = computeStats([ep('a', 2, 4)], 10)
    expect(s.tags[0].shareCount).toBe(100)
    expect(s.tags[0].shareTime).toBe(100)
    expect(s.tags[0].first).toBe(2)
    expect(s.tags[0].last).toBe(2)
    expect(s.overall.taggedPercent).toBeCloseTo(20, 6)
  })

  it('обрезает эпизоды по границам видео', () => {
    const s = computeStats([ep('a', -5, 3), ep('a', 8, 20), ep('a', 30, 40)], 10)
    expect(s.tags[0].total).toBe(3 + 2 + 0)
    expect(s.overall.taggedTime).toBe(5)
    expect(s.tags[0].last).toBe(10)
  })

  it('нулевая длина и неизвестная длительность не дают деления на ноль', () => {
    const zero = computeStats([ep('a', 5, 5)], 10)
    expect(zero.tags[0].total).toBe(0)
    expect(zero.tags[0].shareTime).toBe(0)
    expect(Number.isFinite(zero.tags[0].avg)).toBe(true)
    const noDuration = computeStats([ep('a', 5, 9)], 0)
    expect(noDuration.overall.taggedPercent).toBe(0)
    expect(noDuration.overall.videoDuration).toBe(0)
    expect(noDuration.tags[0].total).toBe(4)
    expect(computeStats([ep('a', 5, 9)], Number.NaN).overall.taggedPercent).toBe(0)
  })
})

describe('unionLength', () => {
  it('объединяет вложенные, смежные и разрозненные отрезки', () => {
    expect(unionLength([])).toBe(0)
    expect(
      unionLength([
        { start: 0, end: 10 },
        { start: 2, end: 4 }
      ])
    ).toBe(10)
    expect(
      unionLength([
        { start: 0, end: 5 },
        { start: 5, end: 8 }
      ])
    ).toBe(8)
    expect(
      unionLength([
        { start: 10, end: 12 },
        { start: 0, end: 1 }
      ])
    ).toBe(3)
  })
})

describe('отрезки времени', () => {
  it('эпизод относится к отрезку, где лежит его начало', () => {
    const s = computeStats([ep('a', 290, 400), ep('a', 300, 310), ep('b', 0, 5)], 900, { bin: 300 })
    const { bins, size } = s.distribution
    expect(size).toBe(300)
    expect(bins).toHaveLength(3)
    expect(bins[0].counts).toEqual({ a: 1, b: 1 })
    expect(bins[1].counts).toEqual({ a: 1 })
    expect(bins[2].total).toBe(0)
    expect(s.distribution.max).toBe(2)
  })

  it('граница: начало ровно на границе отрезка идёт в следующий, начало в конце видео — в последний', () => {
    const s = computeStats([ep('a', 300, 301), ep('a', 900, 905)], 900, { bin: 300 })
    expect(s.distribution.bins.map((b) => b.total)).toEqual([0, 1, 1])
  })

  it('последний отрезок неполный', () => {
    const s = computeStats([], 700, { bin: 300 })
    expect(s.distribution.bins.map((b) => [b.start, b.end])).toEqual([
      [0, 300],
      [300, 600],
      [600, 700]
    ])
  })

  it('автоподбор размера', () => {
    expect(autoBinSeconds(5400)).toBe(300)
    expect(autoBinSeconds(1200)).toBe(300)
    expect(autoBinSeconds(600)).toBe(120)
    expect(autoBinSeconds(240)).toBe(60)
    expect(autoBinSeconds(4)).toBe(1)
    expect(autoBinSeconds(0.5)).toBe(1)
    expect(autoBinSeconds(0)).toBe(300)
    for (const d of [4, 10, 45, 100, 600, 1500, 5400]) {
      const size = autoBinSeconds(d)
      const bins = computeStats([], d).distribution.bins.length
      expect(size).toBeGreaterThanOrEqual(1)
      if (d >= 4) expect(bins).toBeGreaterThanOrEqual(4)
      if (d >= 4 && d <= 3000) expect(bins).toBeLessThanOrEqual(12)
    }
  })

  it('явный выбор размера уважается, auto зависит от длительности', () => {
    expect(resolveBinSeconds(600, 4)).toBe(600)
    expect(resolveBinSeconds('auto', 4)).toBe(1)
    expect(computeStats([], 4, { bin: 'auto' }).distribution.bins).toHaveLength(4)
    expect(computeStats([], 4, { bin: 900 }).distribution.bins).toHaveLength(1)
  })
})

describe('производительность и фильтр', () => {
  it('10 000 эпизодов считаются быстро', () => {
    const items: StatsEpisode[] = Array.from({ length: 10_000 }, (_, i) =>
      ep(`t${i % 20}`, (i * 0.5) % 5400, ((i * 0.5) % 5400) + 5)
    )
    const t0 = performance.now()
    const s = computeStats(items, 5400, { bin: 60 })
    const ms = performance.now() - t0
    expect(s.overall.episodes).toBe(10_000)
    expect(s.tags).toHaveLength(20)
    expect(ms).toBeLessThan(50)
  })

  it('filterByTags', () => {
    const items = [ep('a', 0, 1), ep('b', 0, 1)]
    expect(filterByTags(items, [])).toHaveLength(2)
    expect(filterByTags(items, ['b']).map((e) => e.tagId)).toEqual(['b'])
  })
})
