// Состояние стартового экрана: список карточек, вкладка, поиск, сортировка.
import { create } from 'zustand'
import type { LibraryCard } from '../../../../shared/library'
import type { ProjectType } from '../../../../shared/project'

export type LibraryTab = 'all' | ProjectType
export type LibrarySort = 'modified' | 'title' | 'date'

export interface LibraryState {
  cards: LibraryCard[]
  folder: string
  /** Список хотя бы раз загружен (до этого показывается «Загрузка…»). */
  loaded: boolean
  /** Когда список получен (для подписей «2 ч назад»). */
  loadedAt: number
  loading: boolean
  /** Не удалось получить список. */
  error: string | null
  /** Сообщение о результате действия с карточкой (ошибка «Найти…», «Убрать…»). */
  notice: string | null
  tab: LibraryTab
  query: string
  sort: LibrarySort
}

export const useLibraryStore = create<LibraryState>()(() => ({
  cards: [],
  folder: '',
  loaded: false,
  loadedAt: 0,
  loading: false,
  error: null,
  notice: null,
  tab: 'all',
  query: '',
  sort: 'modified'
}))
