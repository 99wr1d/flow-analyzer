// Разметки поля (калибровки) с историей отмены. Рисунки на поле ссылаются на них по id.
import { create } from 'zustand'
import type { Calibration } from '../../../../shared/pitch/calibration'
import { commit, createHistory, redo, undo, type HistoryState } from '../annotations/history'

export interface CalibrationsState extends HistoryState<Calibration> {
  /** Выбранная в списке разметка (подсветка). */
  selectedId: string | null
}

export interface CalibrationsActions {
  add: (calibration: Calibration) => void
  /** Заменяет разметку с тем же id (правка точек). */
  replace: (calibration: Calibration) => void
  remove: (id: string) => void
  select: (id: string | null) => void
  undo: () => void
  redo: () => void
  reset: () => void
  load: (items: Calibration[]) => void
}

const initial = (): CalibrationsState => ({ ...createHistory<Calibration>(), selectedId: null })

function keepSelection(
  s: CalibrationsState,
  h: HistoryState<Calibration>
): Partial<CalibrationsState> {
  const exists = s.selectedId !== null && h.items.some((c) => c.id === s.selectedId)
  return { ...h, selectedId: exists ? s.selectedId : null }
}

export const useCalibrationsStore = create<CalibrationsState & CalibrationsActions>()((set) => ({
  ...initial(),
  add: (calibration) =>
    set((s) => ({ ...commit(s, [...s.items, calibration]), selectedId: calibration.id })),
  replace: (calibration) =>
    set((s) => {
      if (!s.items.some((c) => c.id === calibration.id)) return {}
      return {
        ...commit(
          s,
          s.items.map((c) => (c.id === calibration.id ? calibration : c))
        ),
        selectedId: calibration.id
      }
    }),
  remove: (id) =>
    set((s) => {
      if (!s.items.some((c) => c.id === id)) return {}
      return keepSelection(
        s,
        commit(
          s,
          s.items.filter((c) => c.id !== id)
        )
      )
    }),
  select: (selectedId) => set({ selectedId }),
  undo: () => set((s) => keepSelection(s, undo(s))),
  redo: () => set((s) => keepSelection(s, redo(s))),
  reset: () => set(initial()),
  load: (items) => set({ ...initial(), ...createHistory(items) })
}))
