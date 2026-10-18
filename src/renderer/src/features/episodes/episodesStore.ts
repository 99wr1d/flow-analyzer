import { create } from 'zustand'
import {
  toggledRating,
  type Episode,
  type Range,
  type Rating,
  type RatingFilter
} from '../../../../shared/episodes'
import { commit, createHistory, redo, undo, type HistoryState } from '../annotations/history'

export interface EpisodesState extends HistoryState<Episode> {
  selectedId: string | null
  /** Показывать только эпизоды этих тегов (id). Пусто — все. */
  filter: string[]
  /** Показывать только эпизоды с такими оценками (или «без оценки»). Пусто — все. Группа сочетается с тегами через «и». */
  ratingFilter: RatingFilter[]
  /** Метки «Начало» / «Конец» для точной разметки (секунды). */
  inPoint: number | null
  outPoint: number | null
}

export interface EpisodesActions {
  /** Добавляет эпизод. Выбор не меняется: быстрая разметка «на ходу» не должна подставлять эпизод под Delete. */
  add: (episode: Episode) => void
  remove: (id: string) => void
  setRange: (id: string, range: Range) => void
  setNote: (id: string, note: string) => void
  /** Нажатие «хорошо» / «плохо»: повторное нажатие на активную оценку снимает её, другая оценка заменяет. */
  toggleRating: (id: string, kind: Rating) => void
  /** Флаг «разобрать» — независим от оценки. */
  toggleReview: (id: string) => void
  select: (id: string | null) => void
  toggleFilter: (tagId: string) => void
  clearFilter: () => void
  toggleRatingFilter: (kind: RatingFilter) => void
  /** Сбрасывает и фильтр по тегам, и фильтр по оценкам. */
  clearFilters: () => void
  /** Заменяет фильтр целиком (например, из окна статистики). */
  setFilter: (tagIds: string[], ratings?: RatingFilter[]) => void
  setIn: (time: number) => void
  setOut: (time: number) => void
  clearMarks: () => void
  undo: () => void
  redo: () => void
  /** Новое видео: эпизоды, метки, фильтр и история очищаются. */
  reset: () => void
  /** Загрузка проекта: эпизоды заменяются, остальное сбрасывается. */
  load: (items: Episode[]) => void
}

function withSelection(s: EpisodesState, h: HistoryState<Episode>): Partial<EpisodesState> {
  const exists = s.selectedId !== null && h.items.some((e) => e.id === s.selectedId)
  return { ...h, selectedId: exists ? s.selectedId : null }
}

const initial = (): EpisodesState => ({
  ...createHistory<Episode>(),
  selectedId: null,
  filter: [],
  ratingFilter: [],
  inPoint: null,
  outPoint: null
})

export const useEpisodesStore = create<EpisodesState & EpisodesActions>()((set) => ({
  ...initial(),

  add: (episode) => set((s) => ({ ...commit(s, [...s.items, episode]) })),

  remove: (id) =>
    set((s) => {
      if (!s.items.some((e) => e.id === id)) return {}
      return withSelection(
        s,
        commit(
          s,
          s.items.filter((e) => e.id !== id)
        )
      )
    }),

  setRange: (id, range) =>
    set((s) => ({
      ...commit(
        s,
        s.items.map((e) => (e.id === id ? { ...e, ...range } : e))
      )
    })),

  setNote: (id, note) =>
    set((s) => {
      const items = s.items.map((e) => {
        if (e.id !== id) return e
        if (note !== '') return { ...e, note }
        const copy = { ...e }
        delete copy.note
        return copy
      })
      return { ...commit(s, items, { key: `note:${id}` }) }
    }),

  toggleRating: (id, kind) =>
    set((s) => {
      if (!s.items.some((e) => e.id === id)) return {}
      return {
        ...commit(
          s,
          s.items.map((e) => (e.id === id ? { ...e, rating: toggledRating(e.rating, kind) } : e))
        )
      }
    }),

  toggleReview: (id) =>
    set((s) => {
      if (!s.items.some((e) => e.id === id)) return {}
      return {
        ...commit(
          s,
          s.items.map((e) => (e.id === id ? { ...e, review: !e.review } : e))
        )
      }
    }),

  select: (selectedId) => set({ selectedId }),

  toggleFilter: (tagId) =>
    set((s) => ({
      filter: s.filter.includes(tagId) ? s.filter.filter((t) => t !== tagId) : [...s.filter, tagId]
    })),
  clearFilter: () => set({ filter: [] }),
  toggleRatingFilter: (kind) =>
    set((s) => ({
      ratingFilter: s.ratingFilter.includes(kind)
        ? s.ratingFilter.filter((r) => r !== kind)
        : [...s.ratingFilter, kind]
    })),
  clearFilters: () => set({ filter: [], ratingFilter: [] }),
  setFilter: (filter, ratings = []) => set({ filter: [...filter], ratingFilter: [...ratings] }),

  setIn: (inPoint) => set({ inPoint }),
  setOut: (outPoint) => set({ outPoint }),
  clearMarks: () => set({ inPoint: null, outPoint: null }),

  undo: () => set((s) => withSelection(s, undo(s))),
  redo: () => set((s) => withSelection(s, redo(s))),
  reset: () => set(initial()),
  load: (items) => set({ ...initial(), ...createHistory<Episode>(items) })
}))

/** Эпизоды по порядку начала (при равенстве — по концу). */
export function sortEpisodes(items: readonly Episode[]): Episode[] {
  return [...items].sort((a, b) => a.start - b.start || a.end - b.end)
}

export const selectedEpisode = (s: EpisodesState): Episode | null =>
  s.items.find((e) => e.id === s.selectedId) ?? null
