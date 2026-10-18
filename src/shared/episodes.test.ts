import { describe, expect, it } from 'vitest'
import {
  EpisodeSchema,
  MAX_NOTE,
  MIN_EPISODE,
  editRange,
  filterEpisodes,
  marksRange,
  matchesRatingFilter,
  normalizeRange,
  quickRange,
  toggledRating
} from './episodes'

const base = {
  id: '00000000-0000-4000-8000-000000000001',
  tagId: 'attack',
  tagName: 'Атака',
  tagColor: '#2bd67b',
  start: 1,
  end: 5
}

describe('EpisodeSchema', () => {
  it('принимает корректный эпизод и заметку', () => {
    expect(EpisodeSchema.safeParse(base).success).toBe(true)
    expect(EpisodeSchema.safeParse({ ...base, note: 'x'.repeat(MAX_NOTE) }).success).toBe(true)
  })
  it('отклоняет: короткий, перевёрнутый, длинная заметка, плохой цвет', () => {
    expect(EpisodeSchema.safeParse({ ...base, end: 1.1 }).success).toBe(false)
    expect(EpisodeSchema.safeParse({ ...base, start: 5, end: 1 }).success).toBe(false)
    expect(EpisodeSchema.safeParse({ ...base, start: -1 }).success).toBe(false)
    expect(EpisodeSchema.safeParse({ ...base, note: 'x'.repeat(MAX_NOTE + 1) }).success).toBe(false)
    expect(EpisodeSchema.safeParse({ ...base, tagColor: 'green' }).success).toBe(false)
    expect(EpisodeSchema.safeParse({ ...base, id: 'нет' }).success).toBe(false)
  })
})

describe('быстрый тег: [t − до, t + после] с обрезкой', () => {
  it('в середине видео границы не меняются', () => {
    expect(quickRange(30, 5, 5, 120)).toEqual({ start: 25, end: 35 })
    expect(quickRange(12.3, 2, 1, 60)).toEqual({ start: 10.3, end: 13.3 })
  })
  it('у начала видео начало обрезается до 0', () => {
    expect(quickRange(2, 5, 5, 120)).toEqual({ start: 0, end: 7 })
    expect(quickRange(0, 5, 5, 120)).toEqual({ start: 0, end: 5 })
  })
  it('у конца видео конец обрезается до длительности', () => {
    expect(quickRange(118, 5, 5, 120)).toEqual({ start: 113, end: 120 })
    expect(quickRange(120, 5, 5, 120)).toEqual({ start: 115, end: 120 })
  })
  it('видео короче окна: весь ролик', () => {
    expect(quickRange(2, 5, 5, 4)).toEqual({ start: 0, end: 4 })
  })
  it('нулевые «до» и «после» дают минимальный эпизод', () => {
    const r = quickRange(10, 0, 0, 60)
    expect(r).not.toBeNull()
    expect(r!.end - r!.start).toBeCloseTo(MIN_EPISODE, 6)
    const atEnd = quickRange(60, 0, 0, 60)
    expect(atEnd).toEqual({ start: 59.8, end: 60 })
    const atStart = quickRange(0, 0, 0, 60)
    expect(atStart).toEqual({ start: 0, end: 0.2 })
  })
  it('слишком короткое видео и мусор: null', () => {
    expect(quickRange(0.05, 5, 5, 0.1)).toBeNull()
    expect(quickRange(NaN, 5, 5, 60)).toBeNull()
    expect(quickRange(1, 5, 5, 0)).toBeNull()
  })
  it('результат всегда проходит схему эпизода', () => {
    for (const t of [0, 0.1, 1.99, 2, 3.95, 4]) {
      const r = quickRange(t, 5, 5, 4)!
      expect(EpisodeSchema.safeParse({ ...base, ...r }).success).toBe(true)
    }
  })
})

describe('точный тег: Начало и Конец', () => {
  it('ровно по меткам', () => {
    expect(marksRange(1, 2.5, 4)).toEqual({ ok: true, range: { start: 1, end: 2.5 } })
  })
  it('Конец раньше или равен Началу — ошибка порядка', () => {
    expect(marksRange(3, 1, 4)).toEqual({ ok: false, error: 'order' })
    expect(marksRange(2, 2, 4)).toEqual({ ok: false, error: 'order' })
  })
  it('слишком короткий отрезок', () => {
    expect(marksRange(1, 1.1, 4)).toEqual({ ok: false, error: 'short' })
  })
  it('метки за пределами видео обрезаются', () => {
    expect(marksRange(3, 9, 4)).toEqual({ ok: true, range: { start: 3, end: 4 } })
  })
  it('normalizeRange меняет местами перевёрнутые границы', () => {
    expect(normalizeRange(5, 2, 10)).toEqual({ start: 2, end: 5 })
  })
})

describe('правка эпизода', () => {
  const e = { start: 2, end: 6 }
  it('новое начало и конец', () => {
    expect(editRange(e, { start: 3 }, 10)).toEqual({ ok: true, range: { start: 3, end: 6 } })
    expect(editRange(e, { end: 9 }, 10)).toEqual({ ok: true, range: { start: 2, end: 9 } })
  })
  it('короче минимума или перевёрнуто — ошибка', () => {
    expect(editRange(e, { start: 5.95 }, 10)).toEqual({ ok: false, error: 'short' })
    expect(editRange(e, { end: 1 }, 10)).toEqual({ ok: false, error: 'short' })
  })
  it('обрезка по длительности видео', () => {
    expect(editRange(e, { end: 99 }, 10)).toEqual({ ok: true, range: { start: 2, end: 10 } })
  })
})

describe('оценки эпизодов', () => {
  it('в старых данных нет полей: подставляются null и false', () => {
    const parsed = EpisodeSchema.parse(base)
    expect(parsed.rating).toBeNull()
    expect(parsed.review).toBe(false)
  })

  it('принимает good, bad, null и review; остальное отклоняет', () => {
    for (const rating of ['good', 'bad', null]) {
      expect(EpisodeSchema.safeParse({ ...base, rating }).success).toBe(true)
    }
    expect(EpisodeSchema.parse({ ...base, rating: 'bad', review: true })).toMatchObject({
      rating: 'bad',
      review: true
    })
    expect(EpisodeSchema.safeParse({ ...base, rating: 'meh' }).success).toBe(false)
    expect(EpisodeSchema.safeParse({ ...base, rating: 1 }).success).toBe(false)
    expect(EpisodeSchema.safeParse({ ...base, review: 'yes' }).success).toBe(false)
  })

  it('переключение: повтор снимает, другая оценка заменяет', () => {
    expect(toggledRating(null, 'good')).toBe('good')
    expect(toggledRating('good', 'good')).toBeNull()
    expect(toggledRating('good', 'bad')).toBe('bad')
    expect(toggledRating('bad', 'bad')).toBeNull()
    expect(toggledRating('bad', 'good')).toBe('good')
  })
})

describe('фильтр по тегам и оценкам', () => {
  const ep = (
    id: string,
    tagId: string,
    rating: 'good' | 'bad' | null,
    review = false
  ): { id: string; tagId: string; rating: 'good' | 'bad' | null; review: boolean } => ({
    id,
    tagId,
    rating,
    review
  })
  const items = [
    ep('1', 'attack', 'good'),
    ep('2', 'attack', 'bad', true),
    ep('3', 'goal', 'good', true),
    ep('4', 'goal', null),
    ep('5', 'shot', null, true)
  ]
  const ids = (list: { id: string }[]): string[] => list.map((e) => e.id)

  it('пустые фильтры показывают всё', () => {
    expect(ids(filterEpisodes(items, [], []))).toEqual(['1', '2', '3', '4', '5'])
  })

  it('оценки внутри группы — «или»', () => {
    expect(ids(filterEpisodes(items, [], ['good']))).toEqual(['1', '3'])
    expect(ids(filterEpisodes(items, [], ['good', 'bad']))).toEqual(['1', '2', '3'])
    expect(ids(filterEpisodes(items, [], ['review']))).toEqual(['2', '3', '5'])
    expect(ids(filterEpisodes(items, [], ['none']))).toEqual(['4', '5'])
    expect(ids(filterEpisodes(items, [], ['bad', 'none']))).toEqual(['2', '4', '5'])
  })

  it('теги и оценки сочетаются через «и»; теги внутри группы — «или»', () => {
    expect(ids(filterEpisodes(items, ['attack'], ['good']))).toEqual(['1'])
    expect(ids(filterEpisodes(items, ['attack', 'goal'], ['review']))).toEqual(['2', '3'])
    expect(ids(filterEpisodes(items, ['shot'], ['good']))).toEqual([])
    expect(ids(filterEpisodes(items, ['goal', 'shot'], []))).toEqual(['3', '4', '5'])
  })

  it('matchesRatingFilter: эпизод без полей считается неоценённым', () => {
    expect(matchesRatingFilter({}, ['none'])).toBe(true)
    expect(matchesRatingFilter({}, ['good'])).toBe(false)
  })
})
