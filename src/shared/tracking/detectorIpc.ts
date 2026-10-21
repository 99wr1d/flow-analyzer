// Слежение за игроком: обмен между main и скрытым окном-детектором (каналы и типы; без zod — это нужно preload в песочнице).
import type { Box } from './types'

export const DETECTOR_CHANNELS = {
  /** окно → main: страница загружена, можно присылать модель. */
  hello: 'detector:hello',
  /** main → окно: модель (байты) и настройки. */
  init: 'detector:init',
  /** окно → main: сессия создана (или ошибка) и на каком бэкенде. */
  ready: 'detector:ready',
  /** main → окно: кадр на распознавание. */
  detect: 'detector:detect',
  /** окно → main: результат (или ошибка) по номеру запроса. */
  result: 'detector:result'
} as const

export type DetectorBackend = 'webgpu' | 'wasm'

export interface DetectorInit {
  model: Uint8Array
  /** wasm — принудительно процессор (тестовый флаг FLOW_DETECTOR_BACKEND=wasm). */
  backend: DetectorBackend | null
}

export interface DetectRequest {
  id: number
  rgba: Uint8Array
  width: number
  height: number
  roi: Box | null
}

/** Что preload окна-детектора отдаёт странице. */
export interface DetectorBridge {
  hello(): void
  onInit(cb: (init: DetectorInit) => void): void
  onDetect(cb: (req: DetectRequest) => void): void
  ready(payload: unknown): void
  result(payload: unknown): void
}
