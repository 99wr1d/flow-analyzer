/** Типы IPC досок: список, сохранение, открытие, картинка. */
import { z } from 'zod'
import { LEAD_IN, HOLD_END } from './resolve'
import { BoardSchema, MAX_FRAMES, MAX_TRANSITION, type Board } from './schema'

export const MAX_BOARD_PNG_BYTES = 20 * 1024 * 1024

export interface BoardCard {
  path: string
  title: string
  updatedAt: string | null
  frames: number
  thumb: string | null
  status: 'ok' | 'error'
  error?: string
}

export const BoardSaveRequestSchema = z.object({
  path: z.string().min(1).max(1024).nullable(),
  board: BoardSchema
})
export type BoardSaveRequest = z.infer<typeof BoardSaveRequestSchema>

export interface BoardSaveResult {
  path: string
}

export type BoardOpenResult =
  { ok: true; path: string; board: Board } | { ok: false; message: string }

export const SaveImageRequestSchema = z.object({
  suggestedName: z.string().max(200),
  png: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_BOARD_PNG_BYTES, {
    message: 'Картинка слишком большая'
  })
})
export type SaveImageRequest = z.infer<typeof SaveImageRequestSchema>

/** Частота кадров видео доски (одна, как в рендерере). */
export const BOARD_VIDEO_FPS = 30
/** Самое длинное видео: 50 кадров по 5 с плюс вход (0.5 с) и пауза в конце (1 с). */
export const MAX_BOARD_VIDEO_FRAMES = Math.ceil(
  ((MAX_FRAMES - 1) * MAX_TRANSITION + LEAD_IN + HOLD_END) * BOARD_VIDEO_FPS
)
/** Кадров в одной пачке stageBoardFrames. */
export const MAX_STAGE_BATCH = 30

export const ExportVideoRequestSchema = z.object({
  suggestedName: z.string().max(200),
  frameCount: z.number().int().min(1).max(MAX_BOARD_VIDEO_FRAMES),
  fps: z.literal(BOARD_VIDEO_FPS)
})
export type ExportVideoRequest = z.infer<typeof ExportVideoRequestSchema>

export const StageFramesRequestSchema = z.object({
  token: z.string().min(1).max(100),
  start: z.number().int().min(0).max(MAX_BOARD_VIDEO_FRAMES),
  pngs: z.array(z.instanceof(Uint8Array)).min(1).max(MAX_STAGE_BATCH)
})
export type StageFramesRequest = z.infer<typeof StageFramesRequestSchema>

export interface BoardVideoProgress {
  token: string
  done: number
  total: number
}
