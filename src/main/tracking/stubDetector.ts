// Детектор-заглушка для автотестов (FLOW_DETECTOR_STUB=1, только с FLOW_USER_DATA) и модульных тестов: вместо модели рамки берутся
// из простого детерминированного «сценария». Настоящее окно-детектор не создаётся, картинка кадра не читается.
//
// Сценарий (StubPattern) — игроки, движущиеся по прямой. Рамки заданы в долях кадра, скорость — в долях кадра за секунду, время —
// секунды видео (середина кадра, DetectorFrame.t). Файл сценария: FLOW_DETECTOR_STUB_PATTERN=<абсолютный путь к .json>.
// Без файла работает DEFAULT_STUB_PATTERN: один игрок, идущий вправо.
//   players[].start    — рамка в момент 0 (x, y, w, h — верхний левый угол и размер);
//   players[].velocity — сдвиг рамки {x, y} в долях кадра за секунду;
//   players[].look     — номер приметы (по умолчанию номер игрока в списке): у игроков с одинаковым look примета одна и та же,
//                        и трекер не может различить их по виду (сценарий «Кто из них ваш?»);
//   players[].from/until — игрок виден только в этом интервале времени (по умолчанию всегда);
//   cuts               — моменты «смены плана»: на каждом гистограмма кадра меняется скачком.
// Игроки различаются «приметой» (цветом): номер игрока = его место в списке.
// Сценарии для слежения за несколькими игроками (Связка): tests/fixtures/stub-three.json (три разных игрока),
// stub-three-lost.json (средний пропадает на 1,0 с), stub-same-cross.json (два игрока с одной приметой идут навстречу).
import { z } from 'zod'
import type { Box, Detection } from '../../shared/tracking/types'
import type { DetectOutput, Detector, DetectorFrame } from './detectorWindow'

const fractionBox = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive()
})

export const StubPatternSchema = z.object({
  players: z
    .array(
      z.object({
        start: fractionBox,
        look: z.number().int().min(0).max(1000).optional(),
        velocity: z
          .object({ x: z.number().finite(), y: z.number().finite() })
          .default({ x: 0, y: 0 }),
        from: z.number().finite().optional(),
        until: z.number().finite().optional()
      })
    )
    .max(20),
  cuts: z.array(z.number().finite()).max(100).default([])
})

export type StubPattern = z.infer<typeof StubPatternSchema>

export const DEFAULT_STUB_PATTERN: StubPattern = {
  players: [{ start: { x: 0.3, y: 0.35, w: 0.06, h: 0.3 }, velocity: { x: 0.05, y: 0 } }],
  cuts: []
}

const BINS = 16
/** Размер окна, которое видит детектор при распознавании «в окрестности» (как у настоящего: 640×384). */
const CROP_W = 640
const CROP_H = 384

function oneHot(bin: number): number[] {
  const v = new Array<number>(BINS).fill(0)
  v[((bin % BINS) + BINS) % BINS] = 1
  return v
}

/** Примета игрока №id: у разных игроков разные корзины (расстояние между приметами = 1). */
export function stubLook(id: number): Float32Array {
  const out: number[] = []
  for (let part = 0; part < 2; part += 1)
    for (let channel = 0; channel < 3; channel += 1) out.push(...oneHot(id * 3 + part + channel))
  return Float32Array.from(out)
}

function stubFrameHist(cutsBefore: number): Float32Array {
  const bin = cutsBefore % 2 === 0 ? 4 : 12
  return Float32Array.from([...oneHot(bin), ...oneHot(bin), ...oneHot(bin)])
}

export function loadStubPattern(json: string): StubPattern {
  return StubPatternSchema.parse(JSON.parse(json))
}

export interface StubOptions {
  pattern?: StubPattern
  /**
   * Пауза на запрос (мс) для выреза 640×384; на другой размер пропорциональна площади входа сети (стороны кратны 32, как в
   * prepareInput): целый кадр 960×540 стоит ×2,1 выреза. Так тесты видят цену целого кадра против выреза.
   */
  delayMs?: number
}

export function createStubDetector(options: StubOptions = {}): Detector {
  const pattern = options.pattern ?? DEFAULT_STUB_PATTERN
  const delayMs = options.delayMs ?? 0
  let closed = false

  const detect = async (frame: DetectorFrame, roi?: Box): Promise<DetectOutput> => {
    if (closed) throw new Error('Детектор закрыт')
    const { width: W, height: H } = frame
    if (delayMs > 0) {
      const inW = Math.ceil((roi ? Math.min(CROP_W, W) : W) / 32) * 32
      const inH = Math.ceil((roi ? Math.min(CROP_H, H) : H) / 32) * 32
      await new Promise((resolve) => setTimeout(resolve, (delayMs * inW * inH) / (CROP_W * CROP_H)))
    }
    if (closed) throw new Error('Детектор закрыт')
    const t = frame.t ?? 0
    const crop = roi
      ? (() => {
          const cx = roi.x + roi.w / 2
          const cy = roi.y + roi.h / 2
          const x = Math.min(Math.max(0, cx - CROP_W / 2), Math.max(0, W - CROP_W))
          const y = Math.min(Math.max(0, cy - CROP_H / 2), Math.max(0, H - CROP_H))
          return { x, y, w: CROP_W, h: CROP_H }
        })()
      : null
    const detections: Detection[] = []
    pattern.players.forEach((p, id) => {
      if ((p.from !== undefined && t < p.from) || (p.until !== undefined && t >= p.until)) return
      const box: Box = {
        x: (p.start.x + p.velocity.x * t) * W,
        y: (p.start.y + p.velocity.y * t) * H,
        w: p.start.w * W,
        h: p.start.h * H
      }
      if (crop) {
        const cx = box.x + box.w / 2
        const cy = box.y + box.h / 2
        if (cx < crop.x || cx > crop.x + crop.w || cy < crop.y || cy > crop.y + crop.h) return
      }
      detections.push({ box, score: 0.9, look: stubLook(p.look ?? id) })
    })
    const cutsBefore = pattern.cuts.filter((c) => c <= t).length
    return { detections, frameHist: stubFrameHist(cutsBefore) }
  }

  return {
    backend: 'wasm',
    detect,
    close() {
      closed = true
    }
  }
}
