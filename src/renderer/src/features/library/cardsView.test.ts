import { describe, expect, it } from 'vitest'
import type { LibraryCard } from '../../../../shared/library'
import {
  agoText,
  countByTab,
  dateText,
  drawingsText,
  durationText,
  episodesText,
  filterCards,
  matchesQuery,
  sortCards,
  todayIso,
  visibleCards
} from './cardsView'

const card = (over: Partial<LibraryCard>): LibraryCard => ({
  path: `/p/${over.title ?? 'x'}.flowproj`,
  status: 'ok',
  title: 'Проект',
  type: 'other',
  hasMeta: true,
  videoFileName: 'video.mp4',
  episodes: 0,
  drawings: 0,
  updatedAt: '2026-05-01T10:00:00.000Z',
  addedAt: '2026-04-01T10:00:00.000Z',
  lastOpenedAt: null,
  inDefaultFolder: false,
  thumb: null,
  ...over
})

const cards = [
  card({
    title: 'Динамо — Спартак',
    type: 'match',
    date: '2026-05-10',
    videoFileName: 'final.mp4'
  }),
  card({
    title: 'Тренировка среда',
    type: 'training',
    updatedAt: '2026-05-03T10:00:00.000Z',
    videoFileName: 'train.mp4'
  }),
  card({
    title: 'Ёлкин, скаутинг',
    type: 'scouting',
    updatedAt: '2026-04-20T10:00:00.000Z',
    date: '2026-04-19'
  }),
  card({
    title: 'Зенит',
    type: 'match',
    date: '2026-05-12',
    updatedAt: '2026-05-02T10:00:00.000Z'
  }),
  card({
    title: 'Пропал',
    status: 'missing',
    updatedAt: null,
    lastOpenedAt: '2026-05-04T10:00:00.000Z'
  })
]

describe('вкладки и поиск', () => {
  it('счётчики по типам, «Все» — всего', () => {
    expect(countByTab(cards)).toEqual({ all: 5, match: 2, training: 1, scouting: 1, other: 1 })
  })

  it('вкладка фильтрует по типу', () => {
    expect(filterCards(cards, 'match', '').map((c) => c.title)).toEqual([
      'Динамо — Спартак',
      'Зенит'
    ])
    expect(filterCards(cards, 'all', '')).toHaveLength(5)
  })

  it('поиск по названию и по имени видео, без учёта регистра и ё/е', () => {
    expect(matchesQuery(cards[0], 'динамо')).toBe(true)
    expect(matchesQuery(cards[0], 'FINAL')).toBe(true)
    expect(matchesQuery(cards[2], 'елкин')).toBe(true)
    expect(matchesQuery(cards[0], 'зенит')).toBe(false)
    expect(matchesQuery(cards[0], '   ')).toBe(true)
    expect(filterCards(cards, 'training', 'train')).toHaveLength(1)
    expect(filterCards(cards, 'match', 'train')).toHaveLength(0)
  })
})

describe('сортировка', () => {
  it('«Изменены»: новые выше; пропавший — по последнему открытию', () => {
    expect(sortCards(cards, 'modified').map((c) => c.title)).toEqual([
      'Пропал',
      'Тренировка среда',
      'Зенит',
      'Динамо — Спартак',
      'Ёлкин, скаутинг'
    ])
  })

  it('«Название»: по алфавиту', () => {
    expect(sortCards(cards, 'title').map((c) => c.title)).toEqual([
      'Динамо — Спартак',
      'Ёлкин, скаутинг',
      'Зенит',
      'Пропал',
      'Тренировка среда'
    ])
  })

  it('«Дата матча»: новые даты выше, без даты — в конце по названию', () => {
    expect(sortCards(cards, 'date').map((c) => c.title)).toEqual([
      'Зенит',
      'Динамо — Спартак',
      'Ёлкин, скаутинг',
      'Пропал',
      'Тренировка среда'
    ])
  })

  it('visibleCards объединяет вкладку, поиск и сортировку, исходный список не меняет', () => {
    const copy = [...cards]
    expect(visibleCards(cards, 'match', '', 'date').map((c) => c.title)).toEqual([
      'Зенит',
      'Динамо — Спартак'
    ])
    expect(cards).toEqual(copy)
  })
})

describe('подписи', () => {
  it('склонения', () => {
    expect(episodesText(1)).toBe('1 эпизод')
    expect(episodesText(2)).toBe('2 эпизода')
    expect(episodesText(5)).toBe('5 эпизодов')
    expect(episodesText(11)).toBe('11 эпизодов')
    expect(episodesText(21)).toBe('21 эпизод')
    expect(drawingsText(0)).toBe('0 рисунков')
    expect(drawingsText(3)).toBe('3 рисунка')
    expect(drawingsText(1)).toBe('1 рисунок')
  })

  it('«N назад»', () => {
    const now = Date.parse('2026-05-10T12:00:00.000Z')
    expect(agoText('2026-05-10T11:59:40.000Z', now)).toBe('только что')
    expect(agoText('2026-05-10T11:15:00.000Z', now)).toBe('45 мин назад')
    expect(agoText('2026-05-10T10:00:00.000Z', now)).toBe('2 ч назад')
    expect(agoText('2026-05-08T12:00:00.000Z', now)).toBe('2 дн. назад')
    expect(agoText(null, now)).toBe('')
    expect(agoText('мусор', now)).toBe('')
    expect(agoText('2026-03-01T12:00:00.000Z', now)).toMatch(/1 марта/)
  })

  it('дата, длительность, сегодня', () => {
    expect(dateText('2026-05-17')).toBe('17 мая 2026')
    expect(dateText('2026-01-05')).toBe('5 января 2026')
    expect(dateText(undefined)).toBe('')
    expect(durationText(5530)).toBe('1:32:10')
    expect(durationText(2703)).toBe('45:03')
    expect(durationText(undefined)).toBe('')
    expect(todayIso(new Date(2026, 4, 7))).toBe('2026-05-07')
  })
})
