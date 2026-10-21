// Ключ «газон» в интерфейсе: настройки проекта (сохраняются), найденный автоматически цвет и временные режимы
// (пипетка, показ маски, окно настроек). Математика ключа — shared/grassKey.ts.
import { create } from 'zustand'
import {
  DEFAULT_GRASS_BLEND,
  DEFAULT_GRASS_COLOR,
  DEFAULT_GRASS_SIMILARITY,
  MAX_GRASS_BLEND,
  MAX_GRASS_SIMILARITY,
  MIN_GRASS_BLEND,
  MIN_GRASS_SIMILARITY,
  estimateGrassColor,
  type GrassKey,
  type GrassKeyValues
} from '../../../../shared/grassKey'
import { usePlayerStore } from '../../store/playerStore'
import { getVideoElement } from '../player/videoElement'
import { grabFrame } from './sampleVideo'

export interface GrassState {
  /** Что задал пользователь (это и сохраняется в проекте); null — всё по умолчанию. */
  userKey: GrassKey | null
  /** Цвет газона, найденный по кадру текущего видео. found — на кадре нашёлся газон. */
  estimate: { videoId: string; color: string; found: boolean; time?: number } | null
  /** Показывать маску ключа поверх видео (для настройки). */
  maskView: boolean
  /** Ждём щелчок по газону на картинке. */
  eyedropper: boolean
  /** Окно настроек «Газон» открыто. */
  popover: boolean
  /** WebGL2 не заработал: рисунки «под игроками» рисуются поверх видео (одно уведомление). */
  webgl: 'ok' | 'failed'
}

export interface GrassActions {
  /** Меняет чувствительность и мягкость края (цвет и режим «авто» сохраняются). */
  setTuning: (patch: Partial<Pick<GrassKey, 'similarity' | 'blend'>>) => void
  /** Цвет выбран вручную (пипеткой): режим «авто» выключается. */
  pickColor: (color: string, time?: number) => void
  /** Всё по умолчанию, цвет снова определяется по кадру. */
  resetAuto: () => void
  setEstimate: (estimate: GrassState['estimate']) => void
  setMaskView: (on: boolean) => void
  setEyedropper: (on: boolean) => void
  setPopover: (open: boolean) => void
  setWebgl: (state: GrassState['webgl']) => void
  /** Загрузка проекта: настройки из файла (null — по умолчанию). */
  load: (key: GrassKey | null) => void
  /** Новое видео: настройки и временные режимы сбрасываются. */
  reset: () => void
}

const initial = (): GrassState => ({
  userKey: null,
  estimate: null,
  maskView: false,
  eyedropper: false,
  popover: false,
  webgl: 'ok'
})

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Настройки с учётом найденного цвета: то, что реально применяется (и на экране, и в экспорте). */
export function effectiveKey(
  s: Pick<GrassState, 'userKey' | 'estimate'>,
  videoId: string | undefined
): GrassKey {
  const u = s.userKey
  const auto = u ? u.auto : true
  const found = s.estimate && s.estimate.videoId === videoId ? s.estimate : null
  const estimated = found ? found.color : null
  const from = auto ? found?.time : u?.from
  return {
    color: auto
      ? (estimated ?? u?.color ?? DEFAULT_GRASS_COLOR)
      : (u?.color ?? DEFAULT_GRASS_COLOR),
    similarity: u?.similarity ?? DEFAULT_GRASS_SIMILARITY,
    blend: u?.blend ?? DEFAULT_GRASS_BLEND,
    auto,
    ...(from !== undefined ? { from } : {})
  }
}

export const useGrassStore = create<GrassState & GrassActions>()((set, get) => ({
  ...initial(),
  setTuning: (patch) =>
    set((s) => {
      const base = s.userKey ?? effectiveKey(s, usePlayerStore.getState().source?.id)
      return {
        userKey: {
          color: base.color,
          auto: base.auto,
          similarity: clamp(
            patch.similarity ?? base.similarity,
            MIN_GRASS_SIMILARITY,
            MAX_GRASS_SIMILARITY
          ),
          blend: clamp(patch.blend ?? base.blend, MIN_GRASS_BLEND, MAX_GRASS_BLEND),
          ...(base.from !== undefined ? { from: base.from } : {})
        }
      }
    }),
  pickColor: (color, time) =>
    set((s) => {
      const base = s.userKey ?? effectiveKey(s, usePlayerStore.getState().source?.id)
      return {
        userKey: {
          color,
          similarity: base.similarity,
          blend: base.blend,
          auto: false,
          ...(time !== undefined ? { from: time } : {})
        },
        eyedropper: false
      }
    }),
  resetAuto: () => {
    set({ userKey: null, estimate: null })
    ensureGrassEstimate()
  },
  setEstimate: (estimate) => set({ estimate }),
  setMaskView: (maskView) => set({ maskView }),
  setEyedropper: (eyedropper) => set({ eyedropper }),
  setPopover: (popover) => set(popover ? { popover } : { popover, eyedropper: false }),
  setWebgl: (webgl) => {
    if (get().webgl !== webgl) set({ webgl })
  },
  load: (key) => set({ ...initial(), userKey: key }),
  reset: () => set(initial())
}))

/** Настройки ключа для текущего видео (хук для компонентов). */
export function useGrassKey(): GrassKey {
  const userKey = useGrassStore((s) => s.userKey)
  const estimate = useGrassStore((s) => s.estimate)
  const videoId = usePlayerStore((s) => s.source?.id)
  return effectiveKey({ userKey, estimate }, videoId)
}

/** Сохраняемые настройки: только то, что пользователь менял. */
export const savedGrassKey = (): GrassKey | undefined =>
  useGrassStore.getState().userKey ?? undefined

/** Значения для расчёта ключа (без признака «авто»). */
export const grassValues = (key: GrassKey): GrassKeyValues => ({
  color: key.color,
  similarity: key.similarity,
  blend: key.blend
})

/**
 * Определяет цвет газона по текущему кадру, если он нужен (режим «авто») и ещё не определён для этого видео.
 * true — цвет известен (найден раньше или сейчас); false — кадр ещё не готов, можно попробовать позже.
 */
export function ensureGrassEstimate(): boolean {
  const state = useGrassStore.getState()
  const videoId = usePlayerStore.getState().source?.id
  if (!videoId) return false
  if (state.userKey && !state.userKey.auto) return true
  if (state.estimate && state.estimate.videoId === videoId) return true
  const video = getVideoElement()
  if (!video || video.readyState < 2 || !(video.videoWidth > 0)) return false
  const frame = grabFrame(video, 320)
  if (!frame) return false
  const color = estimateGrassColor(frame.data, frame.w, frame.h)
  state.setEstimate({
    videoId,
    color: color ?? DEFAULT_GRASS_COLOR,
    found: color !== null,
    time: video.currentTime
  })
  return true
}

/**
 * «Взять цвет газона с этого кадра»: цвет определяется заново по текущему кадру и запоминается в проекте (режим
 * «вручную», с временем кадра). 'no-frame' — кадр ещё не готов; 'not-found' — газон на кадре не нашёлся (настройки
 * не меняются).
 */
export function takeColorFromFrame(): 'ok' | 'no-frame' | 'not-found' {
  const video = getVideoElement()
  if (!video || video.readyState < 2 || !(video.videoWidth > 0)) return 'no-frame'
  const frame = grabFrame(video, 320)
  if (!frame) return 'no-frame'
  const color = estimateGrassColor(frame.data, frame.w, frame.h)
  if (color === null) return 'not-found'
  useGrassStore.getState().pickColor(color, video.currentTime)
  return 'ok'
}
