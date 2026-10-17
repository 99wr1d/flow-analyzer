import { create } from 'zustand'

export interface Toast {
  text: string
  kind: 'info' | 'warn'
  color?: string
  nonce: number
}

interface FeedbackState {
  toast: Toast | null
  /** Какой тег только что сработал (для вспышки кнопки). nonce меняется при каждом нажатии. */
  flash: { tagId: string; nonce: number } | null
  show: (toast: Omit<Toast, 'nonce'>) => void
  hide: (nonce: number) => void
  flashTag: (tagId: string) => void
}

let counter = 0

export const useFeedbackStore = create<FeedbackState>()((set) => ({
  toast: null,
  flash: null,
  show: (toast) => set({ toast: { ...toast, nonce: ++counter } }),
  hide: (nonce) => set((s) => (s.toast?.nonce === nonce ? { toast: null } : {})),
  flashTag: (tagId) => set({ flash: { tagId, nonce: ++counter } })
}))
