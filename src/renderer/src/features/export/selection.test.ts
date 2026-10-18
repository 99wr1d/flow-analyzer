import { describe, expect, it } from 'vitest'
import type { Episode } from '../../../../shared/episodes'
import {
  PADDING_ERROR,
  chooseEpisodes,
  estimateRemainingMs,
  formatClock,
  formatRemaining,
  parsePadding,
  episodesGenitive,
  pluralFiles,
  summarize,
  visibleEpisodes
} from './selection'

const ep = (id: string, tagId: string, start: number, end: number): Episode => ({
  id,
  tagId,
  tagName: tagId,
  tagColor: '#2bd67b',
  start,
  end
})
const sorted = [ep('a', 'goal', 1, 3), ep('b', 'attack', 10, 14), ep('c', 'goal', 20, 22)]

describe('выбор эпизодов', () => {
  it('видимые по фильтру, все и отмеченные вручную', () => {
    expect(visibleEpisodes(sorted, []).map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(chooseEpisodes('visible', sorted, ['goal'], new Set()).map((e) => e.id)).toEqual([
      'a',
      'c'
    ])
    expect(chooseEpisodes('all', sorted, ['goal'], new Set()).map((e) => e.id)).toEqual([
      'a',
      'b',
      'c'
    ])
    expect(chooseEpisodes('pick', sorted, [], new Set(['b', 'c'])).map((e) => e.id)).toEqual([
      'b',
      'c'
    ])
    expect(chooseEpisodes('pick', sorted, [], new Set())).toEqual([])
  })
})

describe('parsePadding', () => {
  it('число с точкой или запятой в пределах 0–10', () => {
    expect(parsePadding('0')).toEqual({ ok: true, value: 0 })
    expect(parsePadding(' 1,5 ')).toEqual({ ok: true, value: 1.5 })
    expect(parsePadding('10')).toEqual({ ok: true, value: 10 })
  })
  it('остальное — понятная ошибка', () => {
    for (const bad of ['', 'abc', '-1', '10.5', '1e3', '1.2.3', '1 2']) {
      expect(parsePadding(bad)).toEqual({ ok: false, error: PADDING_ERROR })
    }
  })
})

describe('summarize', () => {
  it('сумма длительностей с запасом и обрезкой по видео', () => {
    expect(summarize(sorted, 0, 100)).toEqual({ count: 3, seconds: 8 })
    // запас 2: [0,5] (1-2 → обрезано до 0), [8,16], [18,24] = 5 + 8 + 6
    expect(summarize(sorted, 2, 100).seconds).toBe(19)
    expect(summarize([], 0, 100)).toEqual({ count: 0, seconds: 0 })
  })
})

describe('время и склонения', () => {
  it('formatClock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(45.4)).toBe('0:45')
    expect(formatClock(723)).toBe('12:03')
    expect(formatClock(3723)).toBe('1:02:03')
  })
  it('оценка оставшегося времени', () => {
    expect(estimateRemainingMs(500, 0.5)).toBeNull()
    expect(estimateRemainingMs(5000, 0.01)).toBeNull()
    expect(estimateRemainingMs(10_000, 0.5)).toBe(10_000)
    expect(estimateRemainingMs(10_000, 1)).toBeNull()
    expect(formatRemaining(20_000)).toBe('меньше минуты')
    expect(formatRemaining(150_000)).toBe('около 3 мин')
    expect(formatRemaining(3_900_000)).toBe('около 1 ч 05 мин')
  })
  it('склонения', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map(pluralFiles)).toEqual([
      '1 файл',
      '2 файла',
      '5 файлов',
      '11 файлов',
      '21 файл',
      '22 файла',
      '25 файлов'
    ])
    expect([1, 2, 11, 21, 104].map(episodesGenitive)).toEqual([
      '1 эпизода',
      '2 эпизодов',
      '11 эпизодов',
      '21 эпизода',
      '104 эпизодов'
    ])
  })
})

describe('«Всё видео» и стоп-кадры в сводке', () => {
  it('chooseEpisodes для «whole» не выбирает эпизодов (экспортируется всё видео)', () => {
    expect(chooseEpisodes('whole', sorted, [], new Set(['a']))).toEqual([])
  })
  it('summarize прибавляет стоп-кадры', () => {
    expect(summarize(sorted, 0, 100, 4.5).seconds).toBe(12.5)
  })
})
