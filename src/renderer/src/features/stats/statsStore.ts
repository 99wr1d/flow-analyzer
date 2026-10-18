// Состояние окна «Статистика»: открыто ли, размер отрезков, сортировка таблицы, итог выгрузки CSV.
import { create } from 'zustand'
import type { BinChoice } from '../../../../shared/stats'
import type { SortKey, SortState } from './tableSort'

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; fileName: string }
  | { kind: 'error'; message: string }

export interface StatsState {
  open: boolean
  bin: BinChoice
  /** Считать только эпизоды тегов, выбранных в фильтре списка эпизодов. */
  respectFilter: boolean
  sort: SortState
  save: SaveState
}

export const DEFAULT_SORT: SortState = { key: 'count', dir: 'desc' }

export const useStatsStore = create<StatsState>()(() => ({
  open: false,
  bin: 'auto',
  respectFilter: false,
  sort: DEFAULT_SORT,
  save: { kind: 'idle' }
}))

export type { SortKey }
