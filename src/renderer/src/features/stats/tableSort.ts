// Сортировка таблицы по тегам.
import type { TagStat } from '../../../../shared/stats'

export type SortKey =
  | 'name'
  | 'count'
  | 'total'
  | 'avg'
  | 'shareCount'
  | 'shareTime'
  | 'good'
  | 'bad'
  | 'review'
  | 'goodPercent'
export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: SortKey
  dir: SortDir
}

/** Новое состояние по клику на заголовок: тот же столбец — меняет направление; другой — текст по возрастанию, числа по убыванию. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'name' ? 'asc' : 'desc' }
}

export function sortTags(tags: readonly TagStat[], sort: SortState): TagStat[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...tags].sort((a, b) => {
    const diff =
      sort.key === 'name'
        ? a.name.localeCompare(b.name, 'ru')
        : sort.key === 'goodPercent'
          ? (a.goodPercent ?? -1) - (b.goodPercent ?? -1)
          : a[sort.key] - b[sort.key]
    // При равенстве порядок один и тот же: по имени.
    return diff !== 0 ? sign * diff : a.name.localeCompare(b.name, 'ru')
  })
}
