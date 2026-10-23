// Тестовая поломка отрисовки: см. src/renderer/src/testHooks.ts. Без флага FLOW_TEST_CRASH не включается никогда.
import { create } from 'zustand'

export type CrashAreaName = 'app' | 'episodes' | 'timeline' | 'video' | 'tools' | 'start' | 'board'

interface CrashState {
  armed: CrashAreaName | null
  arm: (area: CrashAreaName) => void
  reset: () => void
}

export const useCrashStore = create<CrashState>()((set) => ({
  armed: null,
  arm: (armed) => set({ armed }),
  reset: () => set({ armed: null })
}))
