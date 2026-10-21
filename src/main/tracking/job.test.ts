// Задача слежения на синтетических рамках: детектор — заглушка, кадры — пустые, настоящих моделей и ffmpeg нет.
import { describe, expect, it } from 'vitest'
import type { Box, Detection } from '../../shared/tracking/types'
import { estimateSeconds } from '../../shared/tracking/trackingIpc'
import { boxToSample, runTrackingJob, type RunTrackingOptions } from './job'
import type { DecodedFrame } from './frames'
import type { DetectOutput, Detector, DetectorFrame } from './detectorWindow'
import {
  createStubDetector,
  DEFAULT_STUB_PATTERN,
  StubPatternSchema,
  stubLook,
  type StubPattern
} from './stubDetector'

const FPS = 25
const W = 960
const H = 540

function frames(
  count: number,
  onReturn?: () => void,
  fps: number = FPS
): AsyncGenerator<DecodedFrame> {
  return (async function* () {
    try {
      for (let i = 0; i < count; i += 1) {
        await Promise.resolve()
        yield { index: i, t: (i + 0.5) / fps, fps, rgba: new Uint8Array(0), width: W, height: H }
      }
    } finally {
      onReturn?.()
    }
  })()
}

interface Call {
  index: number
  roi?: Box
}

/** Детектор, у которого список людей на кадре задаёт функция (пиксели кадра 960×540). */
function scripted(
  gen: (f: number) => Detection[],
  calls: Call[] = []
): Detector & { closed: boolean } {
  const hist = Float32Array.from([
    ...stubLook(0).slice(0, 16),
    ...stubLook(0).slice(0, 16),
    ...stubLook(0).slice(0, 16)
  ])
  const det = {
    backend: 'wasm' as const,
    closed: false,
    detect(frame: DetectorFrame, roi?: Box): Promise<DetectOutput> {
      calls.push({ index: frame.index ?? -1, roi })
      return Promise.resolve({ detections: gen(frame.index ?? 0), frameHist: hist })
    },
    close() {
      det.closed = true
    }
  }
  return det
}

const person = (cx: number, cy: number, id = 0, w = 40, h = 90): Detection => ({
  box: { x: cx - w / 2, y: cy - h / 2, w, h },
  score: 0.9,
  look: stubLook(id)
})

function options(over: Partial<RunTrackingOptions>): RunTrackingOptions {
  return {
    from: 0,
    to: 4,
    anchor: { x: 0.2, y: 0.5 },
    signal: new AbortController().signal,
    frames: frames(100),
    createDetector: () => Promise.resolve(scripted(() => [])),
    onAsk: () => Promise.resolve(null),
    ...over
  }
}

describe('runTrackingJob', () => {
  it('бегущая рамка: отсчёт на каждый кадр, ноги и высота — доли кадра', async () => {
    const det = scripted((f) => [person(200 + 3 * f, 270)])
    const progress: Array<[number, number]> = []
    const out = await runTrackingJob(
      options({
        frames: frames(60),
        createDetector: () => Promise.resolve(det),
        onProgress: (d, t) => progress.push([d, t]),
        anchor: { x: 200 / W, y: 270 / H }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toBeNull()
    expect(out.samples).toHaveLength(60)
    out.samples.forEach((s, i) => {
      expect(s.t).toBeCloseTo((i + 0.5) / FPS, 9)
      expect(s.foot.x).toBeCloseTo((200 + 3 * i) / W, 6)
      expect(s.foot.y).toBeCloseTo((270 + 45) / H, 6)
      expect(s.height).toBeCloseTo(90 / H, 6)
    })
    expect(progress.at(-1)).toEqual([60, 100])
    expect(det.closed).toBe(true)
  })

  it('boxToSample: ноги — середина нижней кромки', () => {
    expect(boxToSample({ x: 100, y: 200, w: 40, h: 90 }, 1, W, H)).toEqual({
      t: 1,
      foot: { x: 120 / W, y: 290 / H },
      height: 90 / H
    })
  })

  it('детекция: целый кадр на старте и раз в секунду, между ними вырез вокруг игрока', async () => {
    const calls: Call[] = []
    const det = scripted((f) => [person(200 + 2 * f, 270)], calls)
    await runTrackingJob(
      options({
        frames: frames(60),
        createDetector: () => Promise.resolve(det),
        anchor: { x: 200 / W, y: 270 / H }
      })
    )
    expect(calls).toHaveLength(60)
    calls.forEach((c, i) => {
      if (i % FPS === 0) expect(c.roi).toBeUndefined()
      else {
        expect(c.roi).toBeDefined()
        // вырез строится вокруг прогноза трекера на этот кадр: ближе к настоящему положению, чем рамка прошлого кадра
        const centre = c.roi!.x + c.roi!.w / 2
        const actual = 200 + 2 * i
        if (i > 5)
          expect(Math.abs(centre - actual)).toBeLessThan(Math.abs(actual - 2 - actual) - 0.5)
      }
    })
  })

  it('нет игрока под рисунком: no-player, детектор закрыт', async () => {
    const det = scripted(() => [person(700, 270)])
    const out = await runTrackingJob(
      options({ createDetector: () => Promise.resolve(det), anchor: { x: 0.1, y: 0.9 } })
    )
    expect(out).toEqual({ kind: 'failed', error: 'no-player' })
    expect(det.closed).toBe(true)
  })

  it('старт между двумя игроками: ambiguous-start с рамками-кандидатами в долях кадра', async () => {
    const det = scripted(() => [person(300, 270), person(330, 270, 1)])
    const out = await runTrackingJob(
      options({ createDetector: () => Promise.resolve(det), anchor: { x: 315 / W, y: 270 / H } })
    )
    expect(out.kind).toBe('failed')
    if (out.kind !== 'failed') return
    expect(out.error).toBe('ambiguous-start')
    expect(out.candidates).toHaveLength(2)
    for (const c of out.candidates ?? []) {
      expect(c.w).toBeCloseTo(40 / W, 6)
      expect(c.h).toBeCloseTo(90 / H, 6)
    }
  })

  it('старт между двумя игроками с выбором рамки (pick): слежение идёт за выбранным', async () => {
    const det = scripted((f) => [person(300 + 3 * f, 270), person(330 + 3 * f, 270, 1)])
    const out = await runTrackingJob(
      options({
        frames: frames(10),
        createDetector: () => Promise.resolve(det),
        anchor: { x: 315 / W, y: 270 / H },
        // Правый игрок: центр (330, 270), рамка 40x90.
        pick: { x: 310 / W, y: 225 / H, w: 40 / W, h: 90 / H }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.samples).toHaveLength(10)
    expect(out.samples[0].foot.x).toBeCloseTo(330 / W, 2)
  })

  it('pick не совпадает ни с одной рамкой — остаётся ambiguous-start', async () => {
    const det = scripted(() => [person(300, 270), person(330, 270, 1)])
    const out = await runTrackingJob(
      options({
        createDetector: () => Promise.resolve(det),
        anchor: { x: 315 / W, y: 270 / H },
        pick: { x: 0.9, y: 0.1, w: 0.05, h: 0.1 }
      })
    )
    expect(out.kind === 'failed' && out.error).toBe('ambiguous-start')
  })

  it('ask → resolve: слежение продолжается с выбранного, следующий кадр — целый', async () => {
    const calls: Call[] = []
    const mine = (f: number): Detection => person(100 + 3 * f, 320)
    const other = (f: number): Detection => person(100 + 3 * f, 220)
    const a = (f: number): Detection => person(100 + 3 * f, 270)
    const det = scripted((f) => {
      if (f < 30) return [a(f)]
      if (f < 42) return [a(f), a(f)]
      return [mine(f), other(f)]
    }, calls)
    const asks: Array<{ t: number; n: number }> = []
    const out = await runTrackingJob(
      options({
        frames: frames(100),
        createDetector: () => Promise.resolve(det),
        anchor: { x: 100 / W, y: 270 / H },
        onAsk: (t, candidates) => {
          asks.push({ t, n: candidates.length })
          // «мой» — тот, что ниже (больше y)
          const idx = candidates.findIndex((c) => c.y > 250 / H)
          return Promise.resolve(idx)
        }
      })
    )
    expect(asks).toHaveLength(1)
    expect(asks[0].n).toBe(2)
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.samples).toHaveLength(100)
    const askFrame = Math.round(asks[0].t * FPS - 0.5)
    // после ответа рамка идёт по выбранному игроку
    const after = out.samples[askFrame + 5]
    expect(after.foot.y).toBeCloseTo((320 + 45) / H, 2)
    // кадр после вопроса распознаётся целиком (если он не очередной по счёту секунды — вырез был бы)
    expect(calls[askFrame + 1].roi).toBeUndefined()
  })

  it('игрок потерян: done со stop и отсчётами до потери', async () => {
    const det = scripted((f) => (f < 20 ? [person(200 + 2 * f, 270)] : []))
    const out = await runTrackingJob(
      options({
        frames: frames(100),
        createDetector: () => Promise.resolve(det),
        anchor: { x: 200 / W, y: 270 / H }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop?.reason).toBe('occluded')
    // последний уверенный кадр — 19-й: отсчёты «пережидания» после него и время остановки отбрасываются
    expect(out.samples).toHaveLength(20)
    expect(out.stop?.t).toBeCloseTo((19 + 0.5) / FPS, 9)
    expect(out.samples.at(-1)?.t).toBeCloseTo((19 + 0.5) / FPS, 9)
    expect(det.closed).toBe(true)
  })

  it('частота кадров берётся с кадров декодера: ход работы и расписание считаются по ней', async () => {
    const calls: Call[] = []
    const det = scripted((f) => [person(200 + f, 270)], calls)
    const progress: Array<[number, number]> = []
    await runTrackingJob(
      options({
        frames: frames(120, undefined, 50),
        createDetector: () => Promise.resolve(det),
        anchor: { x: 200 / W, y: 270 / H },
        onProgress: (d, t) => progress.push([d, t])
      })
    )
    // 4 секунды по 50 к/с, а не по запасным 25
    expect(progress.at(-1)).toEqual([120, 200])
    // целый кадр раз в секунду = каждые 50 кадров
    expect(calls.map((c, i) => (c.roi === undefined ? i : -1)).filter((i) => i >= 0)).toEqual([
      0, 50, 100
    ])
  })

  it('отмена посреди расчёта: cancelled, кадры остановлены, детектор закрыт', async () => {
    const controller = new AbortController()
    let returned = false
    const det = scripted((f) => [person(200 + 2 * f, 270)])
    const out = await runTrackingJob(
      options({
        frames: frames(100, () => {
          returned = true
        }),
        signal: controller.signal,
        createDetector: () => Promise.resolve(det),
        anchor: { x: 200 / W, y: 270 / H },
        onProgress: (done) => {
          if (done === 10) controller.abort()
        }
      })
    )
    expect(out).toEqual({ kind: 'cancelled' })
    expect(returned).toBe(true)
    expect(det.closed).toBe(true)
  })

  it('отмена во время создания детектора: создание получает сигнал и прерывается быстро', async () => {
    const controller = new AbortController()
    let closedByAbort = false
    const started = Date.now()
    const run = runTrackingJob(
      options({
        signal: controller.signal,
        createDetector: (signal) =>
          new Promise<Detector>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              closedByAbort = true
              reject(new Error('Детектор закрыт'))
            })
          })
      })
    )
    setTimeout(() => controller.abort(), 30)
    expect(await run).toEqual({ kind: 'cancelled' })
    expect(closedByAbort).toBe(true)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('пустой ответ на вопрос без отмены — сбой, а не вечное ожидание', async () => {
    const a = (f: number): Detection => person(100 + 3 * f, 270)
    const det = scripted((f) =>
      f < 30 ? [a(f)] : f < 42 ? [a(f), a(f)] : [person(100 + 3 * f, 320), person(100 + 3 * f, 220)]
    )
    await expect(
      runTrackingJob(
        options({
          frames: frames(100),
          createDetector: () => Promise.resolve(det),
          anchor: { x: 100 / W, y: 270 / H },
          onAsk: () => Promise.resolve(null)
        })
      )
    ).rejects.toThrow(/выбранного игрока/)
    expect(det.closed).toBe(true)
  })

  it('отмена до начала: детектор не создаётся', async () => {
    const controller = new AbortController()
    controller.abort()
    let created = false
    const out = await runTrackingJob(
      options({
        signal: controller.signal,
        createDetector: () => {
          created = true
          return Promise.resolve(scripted(() => []))
        }
      })
    )
    expect(out).toEqual({ kind: 'cancelled' })
    expect(created).toBe(false)
  })

  it('ошибка детектора не маскируется: исключение, детектор закрыт', async () => {
    const det = scripted(() => [])
    det.detect = () => Promise.reject(new Error('сбой'))
    await expect(
      runTrackingJob(options({ createDetector: () => Promise.resolve(det) }))
    ).rejects.toThrow('сбой')
    expect(det.closed).toBe(true)
  })
})

describe('заглушка детектора', () => {
  it('стандартный сценарий: один игрок идёт вправо, вырез его не теряет', async () => {
    const stub = createStubDetector()
    const f = { rgba: new Uint8Array(0), width: W, height: H }
    const full = await stub.detect({ ...f, t: 1 })
    expect(full.detections).toHaveLength(1)
    const p = DEFAULT_STUB_PATTERN.players[0]
    expect(full.detections[0].box.x).toBeCloseTo((p.start.x + p.velocity.x) * W, 6)
    const part = await stub.detect({ ...f, t: 1 }, full.detections[0].box)
    expect(part.detections).toHaveLength(1)
    // вырез у левого края не достаёт игрока у правого
    const farStub = createStubDetector({
      pattern: StubPatternSchema.parse({
        players: [{ start: { x: 0.9, y: 0.3, w: 0.05, h: 0.2 } }]
      })
    })
    const far = await farStub.detect({ ...f, t: 1 }, { x: 0, y: 100, w: 10, h: 10 })
    expect(far.detections).toHaveLength(0)
    expect(full.frameHist).toHaveLength(48)
    stub.close()
    await expect(stub.detect({ ...f, t: 1 })).rejects.toThrow()
  })

  it('сценарий: окно видимости и смена плана', async () => {
    const pattern: StubPattern = StubPatternSchema.parse({
      players: [{ start: { x: 0.1, y: 0.2, w: 0.05, h: 0.2 }, from: 1, until: 2 }],
      cuts: [3]
    })
    const stub = createStubDetector({ pattern })
    const f = { rgba: new Uint8Array(0), width: W, height: H }
    expect((await stub.detect({ ...f, t: 0.5 })).detections).toHaveLength(0)
    expect((await stub.detect({ ...f, t: 1.5 })).detections).toHaveLength(1)
    expect((await stub.detect({ ...f, t: 2.5 })).detections).toHaveLength(0)
    const before = (await stub.detect({ ...f, t: 2.9 })).frameHist
    const after = (await stub.detect({ ...f, t: 3.1 })).frameHist
    expect(Array.from(before)).not.toEqual(Array.from(after))
  })

  it('слежение по стандартному сценарию заглушки доходит до конца', async () => {
    const out = await runTrackingJob(
      options({
        frames: frames(75),
        createDetector: () => Promise.resolve(createStubDetector()),
        anchor: { x: 0.33, y: 0.5 }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.samples).toHaveLength(75)
  })
})

describe('estimateSeconds', () => {
  it('видеокарта 0,05 с на кадр, процессор 0,25 с', () => {
    expect(estimateSeconds(10, 'webgpu', 25)).toBeCloseTo(12.5, 9)
    expect(estimateSeconds(10, 'wasm', 25)).toBeCloseTo(62.5, 9)
    expect(estimateSeconds(-1, 'wasm')).toBe(0)
  })
})
