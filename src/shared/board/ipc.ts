/** Типы IPC досок: список, сохранение, открытие, картинка. */
import { z } from 'zod'
import { BoardSchema, type Board } from './schema'

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
