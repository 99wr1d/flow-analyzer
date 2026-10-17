import { create } from 'zustand'

interface KeymapState {
  /** Идёт запись нового сочетания в поле «горячая клавиша»: глобальные команды молчат. */
  capturing: boolean
  setCapturing: (capturing: boolean) => void
}

export const useKeymapStore = create<KeymapState>()((set) => ({
  capturing: false,
  setCapturing: (capturing) => set({ capturing })
}))
