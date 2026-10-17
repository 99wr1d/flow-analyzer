import { create } from 'zustand'
import type { VideoSource } from '../../../shared/ipc-contract'
import { DEFAULT_FPS, type FpsSource } from '../features/player/frames'

export type PlayerStatus = 'empty' | 'loading' | 'ready' | 'error'

export interface PlayerState {
  source: VideoSource | null
  status: PlayerStatus
  playing: boolean
  currentTime: number
  duration: number
  playbackRate: number
  volume: number
  muted: boolean
  /** Частота кадров и откуда она известна. */
  fps: number
  fpsSource: FpsSource
  /** Частота переменная: fps — среднее значение. */
  fpsVariable: boolean
  /** Формат времени: «ММ:СС.д» или таймкод «ЧЧ:ММ:СС:КК». Сохраняется между файлами. */
  timeMode: 'time' | 'timecode'
  /** Ошибка воспроизведения текущего файла. */
  playbackError: string | null
  /** Ошибка импорта (файл не принят); текущее видео при этом не трогаем. */
  importError: string | null
  /** Над окном сейчас тащат файл. */
  dragActive: boolean
}

export interface PlayerActions {
  /** Загружает новый файл и полностью сбрасывает состояние воспроизведения. */
  loadSource: (source: VideoSource) => void
  setMetadata: (duration: number) => void
  setPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setPlaybackRate: (rate: number) => void
  setFps: (fps: number, source: FpsSource, variable?: boolean) => void
  toggleTimeMode: () => void
  setVolumeState: (volume: number, muted: boolean) => void
  setPlaybackError: (message: string) => void
  setImportError: (message: string | null) => void
  setDragActive: (active: boolean) => void
}

const resetPlayback = {
  playing: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  fps: DEFAULT_FPS,
  fpsSource: 'default',
  fpsVariable: false,
  playbackError: null,
  importError: null
} as const

export const usePlayerStore = create<PlayerState & PlayerActions>()((set) => ({
  source: null,
  status: 'empty',
  volume: 1,
  muted: false,
  dragActive: false,
  importError: null,
  playbackError: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  fps: DEFAULT_FPS,
  fpsSource: 'default',
  fpsVariable: false,
  timeMode: 'time',

  loadSource: (source) => set({ ...resetPlayback, source, status: 'loading' }),
  setMetadata: (duration) =>
    set((s) =>
      s.status === 'loading'
        ? { duration: Number.isFinite(duration) ? duration : 0, status: 'ready' }
        : {}
    ),
  setPlaying: (playing) => set({ playing }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setFps: (fps, fpsSource, fpsVariable = false) => set({ fps, fpsSource, fpsVariable }),
  toggleTimeMode: () => set((s) => ({ timeMode: s.timeMode === 'time' ? 'timecode' : 'time' })),
  setVolumeState: (volume, muted) => set({ volume, muted }),
  setPlaybackError: (message) => set({ status: 'error', playing: false, playbackError: message }),
  setImportError: (importError) => set({ importError }),
  setDragActive: (dragActive) => set({ dragActive })
}))
