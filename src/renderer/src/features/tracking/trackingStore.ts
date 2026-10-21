// Состояние слежения для интерфейса: идёт ли расчёт, ход работы, вопрос «Кто из них ваш?», подтверждение перед стартом.
import { create } from 'zustand'
import type { FractionBox } from '../../../../shared/tracking/trackingIpc'

/**
 * idle — слежения нет; confirm — ждём ответа на вопрос перед стартом («Это займёт около N с», «Заменить N ключей»);
 * running — идёт расчёт; asking — расчёт ждёт щелчка по игроку («Кто из них ваш?»).
 */
export type TrackingPhase = 'idle' | 'confirm' | 'running' | 'asking'

export interface PickState {
  /** Рамки игроков на кадре вопроса, доли кадра. */
  candidates: FractionBox[]
}

export interface TrackingState {
  phase: TrackingPhase
  /** Рисунок, за которым идёт слежение. */
  annotationId: string | null
  done: number
  total: number
  confirmText: string | null
  pick: PickState | null
  /** Отмена уже запрошена: ждём остановки расчёта. */
  cancelling: boolean
  /** Сколько слежений уже закончилось (для тестов: отличить конец нового расчёта от старого). */
  runs: number
}

export interface TrackingActions {
  enter: (annotationId: string) => void
  askConfirm: (text: string) => void
  startRunning: () => void
  setProgress: (done: number, total: number) => void
  setPick: (pick: PickState | null) => void
  setCancelling: () => void
  leave: () => void
}

const initial: Omit<TrackingState, 'runs'> = {
  phase: 'idle',
  annotationId: null,
  done: 0,
  total: 0,
  confirmText: null,
  pick: null,
  cancelling: false
}

export const useTrackingStore = create<TrackingState & TrackingActions>()((set) => ({
  ...initial,
  runs: 0,
  enter: (annotationId) => set({ ...initial, phase: 'confirm', annotationId }),
  askConfirm: (confirmText) => set({ phase: 'confirm', confirmText }),
  startRunning: () => set({ phase: 'running', confirmText: null, pick: null, done: 0, total: 0 }),
  setProgress: (done, total) => set({ done, total }),
  setPick: (pick) => set({ pick, phase: pick ? 'asking' : 'running' }),
  setCancelling: () => set({ cancelling: true }),
  leave: () => set((s) => ({ ...initial, runs: s.runs + 1 }))
}))

/** Слежение занято (идёт, спрашивает или ждёт подтверждения). */
export const trackingBusy = (s: TrackingState): boolean => s.phase !== 'idle'
