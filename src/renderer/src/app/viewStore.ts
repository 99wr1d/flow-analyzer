// Какой экран показан: стартовый (библиотека проектов) или рабочая область с видео.
import { create } from 'zustand'

export type AppView = 'start' | 'workspace'

interface ViewState {
  view: AppView
  /** Пока приложение выясняет, не передан ли проект при запуске, ни один экран не показывается (чтобы не мигать). */
  booting: boolean
  setView: (view: AppView) => void
  setBooting: (booting: boolean) => void
}

export const useViewStore = create<ViewState>()((set) => ({
  view: 'start',
  booting: true,
  setView: (view) => set({ view }),
  setBooting: (booting) => set({ booting })
}))
