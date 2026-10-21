// Слежение за игроком: проверка ответов окна-детектора в главном процессе.
import { z } from 'zod'
import { LOOK_LENGTH } from './appearance'
import { FRAME_HIST_LENGTH } from './sceneCut'

const finite = z.number().finite()
const boxSchema = z.object({ x: finite, y: finite, w: finite, h: finite })

export const readySchema = z.union([
  z.object({ ok: z.literal(true), backend: z.enum(['webgpu', 'wasm']) }),
  z.object({ ok: z.literal(false), error: z.string().max(2000) })
])

export const resultSchema = z.union([
  z.object({
    id: z.number().int(),
    ok: z.literal(true),
    detections: z
      .array(
        z.object({
          box: boxSchema,
          score: finite,
          look: z.instanceof(Float32Array).refine((a) => a.length === LOOK_LENGTH)
        })
      )
      .max(1000),
    frameHist: z.instanceof(Float32Array).refine((a) => a.length === FRAME_HIST_LENGTH)
  }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string().max(2000) })
])
