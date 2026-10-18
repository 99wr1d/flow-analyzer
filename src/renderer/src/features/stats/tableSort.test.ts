import { describe, expect, it } from 'vitest'
import type { TagStat } from '../../../../shared/stats'
import { nextSort, sortTags } from './tableSort'

const t = (name: string, count: number, total: number): TagStat => ({
  tagId: name,
  name,
  color: '#ffffff',
  count,
  total,
  avg: total / count,
  shareCount: 0,
  shareTime: 0,
  first: 0,
  last: 0
})
const tags = [t('Б', 2, 30), t('А', 5, 10), t('В', 2, 20)]

describe('сортировка таблицы', () => {
  it('по числу эпизодов по убыванию, при равенстве по имени', () => {
    expect(sortTags(tags, { key: 'count', dir: 'desc' }).map((x) => x.name)).toEqual([
      'А',
      'Б',
      'В'
    ])
    expect(sortTags(tags, { key: 'count', dir: 'asc' }).map((x) => x.name)).toEqual(['Б', 'В', 'А'])
  })
  it('по имени и по времени', () => {
    expect(sortTags(tags, { key: 'name', dir: 'asc' }).map((x) => x.name)).toEqual(['А', 'Б', 'В'])
    expect(sortTags(tags, { key: 'total', dir: 'desc' }).map((x) => x.name)).toEqual([
      'Б',
      'В',
      'А'
    ])
  })
  it('клик по заголовку', () => {
    expect(nextSort({ key: 'count', dir: 'desc' }, 'count')).toEqual({ key: 'count', dir: 'asc' })
    expect(nextSort({ key: 'count', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'name', dir: 'asc' }, 'total')).toEqual({ key: 'total', dir: 'desc' })
  })
  it('не меняет исходный массив', () => {
    const copy = [...tags]
    sortTags(tags, { key: 'name', dir: 'asc' })
    expect(tags).toEqual(copy)
  })
})
