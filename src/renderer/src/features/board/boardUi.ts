// Состояние экрана доски, которое не входит в документ: кисти разделов, приближение, сообщения, ход сохранения видео.
import { create } from 'zustand'
import type { BoardSection } from './boardStore'

/** Палитра кисти: 10 насыщенных цветов, читаемых на проекторе. */
export const PALETTE = [
  '#ffffff',
  '#1a1a1a',
  '#e53935',
  '#ff7a00',
  '#ffd400',
  '#43a047',
  '#00bcd4',
  '#1e66f5',
  '#8e24aa',
  '#ec407a'
] as const

/** Цвет новых элементов раздела по умолчанию; null — у каждого предмета свой (инвентарь). */
export const DEFAULT_BRUSH: Record<BoardSection, string | null> = {
  equipment: null,
  gk: null,
  player: null,
  coach: null,
  tokens: '#e53935',
  arrows: '#ffffff',
  pencil: '#ffffff',
  text: '#ffffff',
  numbers: '#1a1a1a',
  zones: '#ffd400'
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export interface BoardNotice {
  kind: 'info' | 'error'
  text: string
}

export interface BoardJob {
  /** render — рисуются кадры, encode — ffmpeg собирает MP4. */
  phase: 'render' | 'encode'
  done: number
  total: number
}

interface BoardUiState {
  /** Выбранный цвет кисти раздела (нет записи — цвет по умолчанию). */
  brush: Partial<Record<BoardSection, string>>
  zoom: number
  pan: { x: number; y: number }
  /** Инструмент «Рука»: перетаскивание двигает поле. */
  hand: boolean
  notice: BoardNotice | null
  job: BoardJob | null
  /** Время проигрывания, с; null — не проигрывается. */
  playTime: number | null
  /** Идёт протяжка мышью на поле (проигрывание в это время не запускается). */
  dragging: boolean
  setDragging: (dragging: boolean) => void
  setBrush: (section: BoardSection, color: string) => void
  setView: (zoom: number, pan: { x: number; y: number }) => void
  resetView: () => void
  setHand: (hand: boolean) => void
  notify: (kind: BoardNotice['kind'], text: string) => void
  clearNotice: () => void
  setJob: (job: BoardJob | null) => void
  setPlayTime: (t: number | null) => void
  reset: () => void
}

const initial = {
  brush: {},
  zoom: 1,
  pan: { x: 0, y: 0 },
  hand: false,
  notice: null,
  job: null,
  playTime: null,
  dragging: false
}

export const useBoardUi = create<BoardUiState>()((set) => ({
  ...initial,
  setBrush: (section, color) => set((s) => ({ brush: { ...s.brush, [section]: color } })),
  setView: (zoom, pan) =>
    set({
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
      pan: zoom <= 1 ? { x: 0, y: 0 } : pan
    }),
  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
  setHand: (hand) => set({ hand }),
  notify: (kind, text) => set({ notice: { kind, text } }),
  clearNotice: () => set({ notice: null }),
  setJob: (job) => set({ job }),
  setPlayTime: (playTime) => set({ playTime }),
  // Ход сохранения видео живёт до конца задания (его снимает само задание), поэтому сброс его не трогает.
  reset: () => set((s) => ({ ...initial, brush: {}, job: s.job, dragging: false })),
  setDragging: (dragging) => set({ dragging })
}))

/** Цвет кисти раздела (выбранный или по умолчанию). */
export function brushColor(section: BoardSection): string | null {
  return useBoardUi.getState().brush[section] ?? DEFAULT_BRUSH[section]
}
