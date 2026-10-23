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
    anchors: [{ x: 0.2, y: 0.5 }],
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
        anchors: [{ x: 200 / W, y: 270 / H }]
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toBeNull()
    expect(out.samples[0]).toHaveLength(60)
    out.samples[0].forEach((s, i) => {
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
        anchors: [{ x: 200 / W, y: 270 / H }]
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
      options({ createDetector: () => Promise.resolve(det), anchors: [{ x: 0.1, y: 0.9 }] })
    )
    expect(out).toEqual({ kind: 'failed', error: 'no-player', target: 0 })
    expect(det.closed).toBe(true)
  })

  it('старт между двумя игроками: ambiguous-start с рамками-кандидатами в долях кадра', async () => {
    const det = scripted(() => [person(300, 270), person(330, 270, 1)])
    const out = await runTrackingJob(
      options({ createDetector: () => Promise.resolve(det), anchors: [{ x: 315 / W, y: 270 / H }] })
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
        anchors: [{ x: 315 / W, y: 270 / H }],
        // Правый игрок: центр (330, 270), рамка 40x90.
        picks: [{ x: 310 / W, y: 225 / H, w: 40 / W, h: 90 / H }]
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.samples[0]).toHaveLength(10)
    expect(out.samples[0][0].foot.x).toBeCloseTo(330 / W, 2)
  })

  it('pick не совпадает ни с одной рамкой — остаётся ambiguous-start', async () => {
    const det = scripted(() => [person(300, 270), person(330, 270, 1)])
    const out = await runTrackingJob(
      options({
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: 315 / W, y: 270 / H }],
        picks: [{ x: 0.9, y: 0.1, w: 0.05, h: 0.1 }]
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
        anchors: [{ x: 100 / W, y: 270 / H }],
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
    expect(out.samples[0]).toHaveLength(100)
    const askFrame = Math.round(asks[0].t * FPS - 0.5)
    // после ответа рамка идёт по выбранному игроку
    const after = out.samples[0][askFrame + 5]
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
        anchors: [{ x: 200 / W, y: 270 / H }]
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toMatchObject({ reason: 'occluded', target: 0 })
    // последний уверенный кадр — 19-й: отсчёты «пережидания» после него и время остановки отбрасываются
    expect(out.samples[0]).toHaveLength(20)
    expect(out.stop?.t).toBeCloseTo((19 + 0.5) / FPS, 9)
    expect(out.samples[0].at(-1)?.t).toBeCloseTo((19 + 0.5) / FPS, 9)
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
        anchors: [{ x: 200 / W, y: 270 / H }],
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
        anchors: [{ x: 200 / W, y: 270 / H }],
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
          anchors: [{ x: 100 / W, y: 270 / H }],
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

describe('runTrackingJob: несколько целей', () => {
  const three = (f: number): Detection[] => [
    person(100 + 3 * f, 100, 0),
    person(100 + 4 * f, 270, 1),
    person(100 + 2 * f, 440, 2)
  ]
  const threeAnchors = [
    { x: 100 / W, y: 100 / H },
    { x: 100 / W, y: 270 / H },
    { x: 100 / W, y: 440 / H }
  ]

  it('три цели ведутся одним проходом детектора: один вызов на кадр, отсчёты по целям', async () => {
    const calls: Call[] = []
    const det = scripted(three, calls)
    const out = await runTrackingJob(
      options({
        frames: frames(60),
        createDetector: () => Promise.resolve(det),
        anchors: threeAnchors
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toBeNull()
    expect(calls).toHaveLength(60)
    expect(out.samples).toHaveLength(3)
    out.samples.forEach((track, k) => {
      expect(track).toHaveLength(60)
      const v = [3, 4, 2][k]
      expect(track[59].foot.x).toBeCloseTo((100 + v * 59) / W, 2)
      expect(track[59].foot.y).toBeCloseTo(([100, 270, 440][k] + 45) / H, 2)
    })
  })

  it('близкие цели делят вырез детектора между целыми кадрами', async () => {
    const calls: Call[] = []
    const det = scripted((f) => [person(200 + 2 * f, 220, 0), person(200 + 2 * f, 330, 1)], calls)
    await runTrackingJob(
      options({
        frames: frames(60),
        createDetector: () => Promise.resolve(det),
        anchors: [
          { x: 200 / W, y: 220 / H },
          { x: 200 / W, y: 330 / H }
        ]
      })
    )
    expect(calls).toHaveLength(60)
    calls.forEach((c, i) => {
      if (i % FPS === 0) expect(c.roi).toBeUndefined()
      else expect(c.roi).toBeDefined()
    })
  })

  it('две цели одной формы пересекаются: без обмена, отсчёты у своих игроков', async () => {
    const pattern = StubPatternSchema.parse({
      players: [
        { start: { x: 0.2, y: 0.3, w: 0.06, h: 0.3 }, velocity: { x: 0.1, y: 0 }, look: 0 },
        { start: { x: 0.5, y: 0.4, w: 0.06, h: 0.3 }, velocity: { x: -0.1, y: 0 }, look: 0 }
      ]
    })
    const asks: number[] = []
    const out = await runTrackingJob(
      options({
        frames: frames(75),
        createDetector: () => Promise.resolve(createStubDetector({ pattern })),
        anchors: [
          { x: 0.23, y: 0.45 },
          { x: 0.53, y: 0.55 }
        ],
        // Верхний игрок (ноги на 0,6) — цель 0, нижний (0,7) — цель 1.
        onAsk: (_t, candidates, target) => {
          asks.push(target)
          const ys = candidates.map((c) => c.y + c.h)
          const want = target === 0 ? Math.min(...ys) : Math.max(...ys)
          return Promise.resolve(ys.indexOf(want))
        }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toBeNull()
    out.samples[0].forEach((s) => expect(s.foot.y).toBeCloseTo(0.6, 1))
    out.samples[1].forEach((s) => expect(s.foot.y).toBeCloseTo(0.7, 1))
    // к концу цель 0 справа, цель 1 слева
    expect(out.samples[0][74].foot.x).toBeGreaterThan(out.samples[1][74].foot.x)
  })

  it('потеря одной цели: стоп всех на последнем кадре, уверенном у всех, с номером цели', async () => {
    const det = scripted((f) => (f < 20 ? three(f) : three(f).filter((_, i) => i !== 1)))
    const out = await runTrackingJob(
      options({
        frames: frames(100),
        createDetector: () => Promise.resolve(det),
        anchors: threeAnchors
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toMatchObject({ reason: 'occluded', target: 1 })
    expect(out.stop?.t).toBeCloseTo((19 + 0.5) / FPS, 9)
    expect(out.samples).toHaveLength(3)
    out.samples.forEach((s) => expect(s).toHaveLength(20))
  })

  it('вопрос по цели ставит на паузу всех; ответ по цели, остальные ведутся дальше', async () => {
    const calls: Call[] = []
    const a = (f: number): Detection => person(100 + 3 * f, 270)
    const calm = (f: number): Detection => person(100 + 3 * f, 450, 1)
    const det = scripted((f) => {
      if (f < 30) return [a(f), calm(f)]
      if (f < 42) return [a(f), a(f), calm(f)]
      return [person(100 + 3 * f, 320), person(100 + 3 * f, 220), calm(f)]
    }, calls)
    const asks: Array<{ target: number; n: number }> = []
    const out = await runTrackingJob(
      options({
        frames: frames(100),
        createDetector: () => Promise.resolve(det),
        anchors: [
          { x: 100 / W, y: 270 / H },
          { x: 100 / W, y: 450 / H }
        ],
        onAsk: async (_t, candidates, target) => {
          asks.push({ target, n: candidates.length })
          const before = calls.length
          await new Promise((r) => setTimeout(r, 30))
          // пока вопрос не решён, новых кадров нет ни у кого
          expect(calls.length).toBe(before)
          return candidates.findIndex((c) => c.y > 250 / H)
        }
      })
    )
    expect(asks).toEqual([{ target: 0, n: 2 }])
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toBeNull()
    expect(out.samples[0]).toHaveLength(100)
    expect(out.samples[1]).toHaveLength(100)
    expect(out.samples[0][80].foot.y).toBeCloseTo((320 + 45) / H, 2)
    expect(out.samples[1][80].foot.y).toBeCloseTo((450 + 45) / H, 2)
  })

  it('две цели на одной рамке: общую рамку не делят ни на одном кадре', async () => {
    // С 10-го кадра виден один человек посередине (у обоих в воротах) и ещё один справа.
    const det = scripted((f) =>
      f < 10 ? [person(200, 270), person(250, 270)] : [person(225, 270), person(330, 270)]
    )
    const out = await runTrackingJob(
      options({
        frames: frames(30),
        createDetector: () => Promise.resolve(det),
        anchors: [
          { x: 200 / W, y: 270 / H },
          { x: 250 / W, y: 270 / H }
        ],
        // Если спросят — отвечаем рамкой, ближайшей к 330 для цели 1 и к 225 для цели 0.
        onAsk: (_t, candidates, target) => {
          const want = (target === 1 ? 330 : 225) / W
          const dist = candidates.map((c) => Math.abs(c.x + c.w / 2 - want))
          return Promise.resolve(dist.indexOf(Math.min(...dist)))
        }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    for (let i = 0; i < out.samples[0].length; i += 1) {
      const gap = Math.abs(out.samples[0][i].foot.x - out.samples[1][i].foot.x)
      expect(gap).toBeGreaterThan(10 / W)
    }
  })

  it('две цели на одном игроке при старте: ambiguous-start по второй цели', async () => {
    const det = scripted(() => [person(300, 270)])
    const out = await runTrackingJob(
      options({
        createDetector: () => Promise.resolve(det),
        anchors: [
          { x: 300 / W, y: 270 / H },
          { x: 305 / W, y: 270 / H }
        ]
      })
    )
    expect(out).toMatchObject({ kind: 'failed', error: 'ambiguous-start', target: 1 })
  })

  it('нет игрока под вторым рисунком: no-player с номером цели', async () => {
    const det = scripted(() => [person(300, 270)])
    const out = await runTrackingJob(
      options({
        createDetector: () => Promise.resolve(det),
        anchors: [
          { x: 300 / W, y: 270 / H },
          { x: 0.9, y: 0.9 }
        ]
      })
    )
    expect(out).toEqual({ kind: 'failed', error: 'no-player', target: 1 })
    expect(det.closed).toBe(true)
  })

  it('отмена посреди вопроса: cancelled, кадры остановлены, детектор закрыт', async () => {
    const controller = new AbortController()
    let returned = false
    const a = (f: number): Detection => person(100 + 3 * f, 270)
    const det = scripted((f) =>
      f < 30 ? [a(f)] : f < 42 ? [a(f), a(f)] : [person(100 + 3 * f, 320), person(100 + 3 * f, 220)]
    )
    const out = await runTrackingJob(
      options({
        frames: frames(100, () => {
          returned = true
        }),
        signal: controller.signal,
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: 100 / W, y: 270 / H }],
        onAsk: () => {
          controller.abort()
          return Promise.resolve(null)
        }
      })
    )
    expect(out).toEqual({ kind: 'cancelled' })
    expect(returned).toBe(true)
    expect(det.closed).toBe(true)
  })

  /** Прогон 40 кадров на заглушке с задержкой: время, число вызовов детектора и сколько из них — целые кадры. */
  async function timedRun(
    pattern: StubPattern,
    anchors: Array<{ x: number; y: number }>
  ): Promise<{ ms: number; calls: number; fullFrames: number }> {
    const stub = createStubDetector({ pattern, delayMs: 10 })
    let calls = 0
    let fullFrames = 0
    const counted: Detector = {
      backend: stub.backend,
      detect: (frame, roi) => {
        calls += 1
        if (!roi) fullFrames += 1
        return stub.detect(frame, roi)
      },
      close: () => stub.close()
    }
    const t0 = Date.now()
    const out = await runTrackingJob(
      options({ frames: frames(40), createDetector: () => Promise.resolve(counted), anchors })
    )
    const ms = Date.now() - t0
    expect(out.kind === 'done' && out.stop).toBeNull()
    if (out.kind === 'done') expect(out.samples).toHaveLength(anchors.length)
    return { ms, calls, fullFrames }
  }

  const rowPattern = (
    gap: number
  ): { pattern: StubPattern; anchors: Array<{ x: number; y: number }> } => {
    const players = [0, 1, 2, 3, 4].map((i) => ({
      start: { x: 0.1, y: 0.02 + gap * i, w: 0.04, h: 0.08 },
      velocity: { x: 0.03 + 0.01 * i, y: 0 },
      look: i
    }))
    return {
      pattern: StubPatternSchema.parse({ players }),
      anchors: players.map((p) => ({ x: p.start.x + 0.02, y: p.start.y + 0.04 }))
    }
  }

  it('время: 5 близких целей (общий вырез) не дольше ×1,5 от одной цели', async () => {
    const near = rowPattern(0.1)
    await timedRun(near.pattern, near.anchors.slice(0, 1))
    const one = await timedRun(near.pattern, near.anchors.slice(0, 1))
    const five = await timedRun(near.pattern, near.anchors)
    expect(five.calls).toBe(40)
    expect(five.fullFrames).toBe(one.fullFrames)
    expect(five.ms).toBeLessThanOrEqual(one.ms * 1.5)
  })

  it('время: 5 разбросанных целей не помещаются в вырез — целый кадр, но детектор вызывается раз на кадр', async () => {
    const spread = rowPattern(0.19)
    const one = await timedRun(spread.pattern, spread.anchors.slice(0, 1))
    const five = await timedRun(spread.pattern, spread.anchors)
    expect(five.ms).toBeGreaterThan(0)
    // Целый кадр на заглушке стоит ×2,1 выреза: отношение записано в отчёте, порога на заглушке нет (оно присуще).
    expect(five.calls).toBe(40)
    expect(five.fullFrames).toBe(40)
    expect(one.calls).toBe(40)
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
        anchors: [{ x: 0.33, y: 0.5 }]
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.samples[0]).toHaveLength(75)
  })
})

describe('estimateSeconds', () => {
  it('видеокарта 0,05 с на кадр, процессор 0,25 с', () => {
    expect(estimateSeconds(10, 'webgpu', 25)).toBeCloseTo(12.5, 9)
    expect(estimateSeconds(10, 'wasm', 25)).toBeCloseTo(62.5, 9)
    expect(estimateSeconds(-1, 'wasm')).toBe(0)
  })
})

describe('runTrackingJob: ответ «моего игрока тут нет»', () => {
  it('стоп not-here: все цели обрезаны до последнего надёжного кадра, длины равны', async () => {
    const a = (f: number): Detection => person(100 + 3 * f, 270)
    const calm = (f: number): Detection => person(100 + 3 * f, 450, 1)
    const det = scripted((f) => {
      if (f < 30) return [a(f), calm(f)]
      if (f < 42) return [a(f), a(f), calm(f)]
      return [person(100 + 3 * f, 320), person(100 + 3 * f, 220), calm(f)]
    })
    const asks: number[] = []
    const out = await runTrackingJob(
      options({
        frames: frames(100),
        createDetector: () => Promise.resolve(det),
        anchors: [
          { x: 100 / W, y: 270 / H },
          { x: 100 / W, y: 450 / H }
        ],
        onAsk: (_t, _c, target) => {
          asks.push(target)
          return Promise.resolve('none')
        }
      })
    )
    expect(asks).toEqual([0])
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toMatchObject({ reason: 'not-here', target: 0 })
    // цель 0 последний раз уверена на кадре 29 (дальше её рамка двоится): всё после — догадки, обрезаются у всех
    expect(out.samples[0]).toHaveLength(30)
    expect(out.samples[1]).toHaveLength(30)
    expect(out.stop?.t).toBeCloseTo((29 + 0.5) / FPS, 9)
  })

  it('короткая подмена перед вопросом отрезается: обрезка до кадра перед недоказанным возвращением', async () => {
    // Цель стоит после кадра 22; её рамка пропадает на кадрах 20–31; на кадре 22 рядом (dx=20) выходит игрок той же
    // формы и идёт дальше — неотличим от своего (в пределах разброса прогноза), кольцо уходит на него. На кадре 32 свой
    // снова виден — вопрос; ответ «моего тут нет»: кадры на чужом (после возвращения) выброшены.
    const own = (f: number): number => 300 + 2 * Math.min(f, 22)
    const other = (f: number): number => 300 + 2 * f + 20
    const det = scripted((f) => {
      const out: Detection[] = []
      if (f < 20 || f >= 32) out.push(person(own(f), 270))
      if (f >= 22) out.push(person(other(f), 270))
      return out
    })
    const asked: number[] = []
    const out = await runTrackingJob(
      options({
        frames: frames(60),
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: 300 / W, y: 300 / H }],
        onAsk: (t) => {
          asked.push(Math.round(t * FPS - 0.5))
          return Promise.resolve('none')
        }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(asked.length).toBe(1)
    expect(out.stop).toMatchObject({ reason: 'not-here', target: 0 })
    // ни одного оставленного кадра на чужом игроке
    for (const [k, s] of out.samples[0].entries()) {
      expect(Math.abs(s.foot.x * W - own(k)), `кадр ${k}`).toBeLessThan(10)
    }
    // последний уверенный кадр до недоказанного возвращения — 19-й (своя рамка пропала с 20-го)
    expect(out.samples[0]).toHaveLength(20)
  })

  // Пропуск на кадрах 10–12, затем двойная рамка 30–41 и вопрос; ответ «моего тут нет».
  const dropThenAsk = (stranger: boolean) => async () => {
    const a = (f: number): Detection => person(100 + 3 * f, 270)
    const det = scripted((f) => {
      const out: Detection[] = []
      if (f < 10 || (f >= 13 && f < 30)) out.push(a(f))
      if (f >= 30 && f < 42) out.push(a(f), a(f))
      if (f >= 42) out.push(person(100 + 3 * f, 320), person(100 + 3 * f, 220))
      // игрок той же формы рядом при возвращении (кадры 13–20)
      if (stranger && f >= 13 && f <= 20) out.push(person(100 + 3 * f + 60, 270))
      return out
    })
    return runTrackingJob(
      options({
        frames: frames(80),
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: 100 / W, y: 270 / H }],
        onAsk: () => Promise.resolve('none')
      })
    )
  }

  it('чистое возвращение (рядом никого): обрезка не уходит к давнему пропуску', async () => {
    const out = await dropThenAsk(false)()
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toMatchObject({ reason: 'not-here' })
    // последний уверенный кадр перед двойной рамкой — 29-й
    expect(out.samples[0]).toHaveLength(30)
  })

  it('возвращение с игроком той же формы рядом: обрезка — до последнего уверенного кадра перед пропуском', async () => {
    const out = await dropThenAsk(true)()
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toMatchObject({ reason: 'not-here' })
    expect(out.samples[0]).toHaveLength(10)
  })
})

describe('runTrackingJob: потеря после недоказанного возвращения', () => {
  it('стоп из-за потери обрезает до последнего надёжного кадра: кадры на неотличимом новичке не остаются', async () => {
    // Своя рамка пропадает с кадра 20 навсегда; на кадре 22 рядом с прогнозом (dx=20) выходит игрок той же формы и через
    // несколько кадров уходит из кадра — кольцо успевает уйти на него (неотличим), затем цель теряется.
    const own = (f: number): number => 300 + 2 * f
    const det = scripted((f) => {
      const out: Detection[] = []
      if (f < 20) out.push(person(own(f), 270))
      if (f >= 22 && f < 40) out.push(person(own(f) + 20, 270))
      return out
    })
    const out = await runTrackingJob(
      options({
        frames: frames(100),
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: 300 / W, y: 300 / H }]
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop?.reason).toBe('occluded')
    // последний надёжный кадр — 19-й (дальше — возвращение на чужого, не доказанное)
    expect(out.samples[0]).toHaveLength(20)
    for (const [k, s] of out.samples[0].entries()) {
      expect(Math.abs(s.foot.x * W - own(k)), `кадр ${k}`).toBeLessThan(10)
    }
  })
})
