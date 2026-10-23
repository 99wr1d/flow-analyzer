// Задача слежения на синтетических рамках: детектор — заглушка, кадры — пустые, настоящих моделей и ffmpeg нет.
import { describe, expect, it } from 'vitest'
import type { Box, Detection } from '../../shared/tracking/types'
import type { TrackSample } from '../../shared/tracking/keys'
import { estimateSeconds } from '../../shared/tracking/trackingIpc'
import { boxToSample, reconcileAnswer, runTrackingJob, type RunTrackingOptions } from './job'
import type { DecodedFrame } from './frames'
import type { DetectOutput, Detector, DetectorFrame } from './detectorWindow'
import {
  createStubDetector,
  DEFAULT_STUB_PATTERN,
  loadStubPattern,
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
    const asks: Array<{
      t: number
      n: number
      cur: { x: number; y: number; w: number; h: number }
    }> = []
    const out = await runTrackingJob(
      options({
        frames: frames(100),
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: 100 / W, y: 270 / H }],
        onAsk: (t, candidates, _target, cur) => {
          asks.push({ t, n: candidates.length, cur })
          // «мой» — тот, что ниже (больше y)
          const idx = candidates.findIndex((c) => c.y > 250 / H)
          return Promise.resolve(idx)
        }
      })
    )
    expect(asks).toHaveLength(1)
    expect(asks[0].n).toBe(2)
    // Вопрос несёт текущую рамку цели: она ушла от старта (x 100 → ~190) и стоит там, где игрок на кадре вопроса.
    const f0 = Math.round(asks[0].t * FPS - 0.5)
    expect(asks[0].cur.x + asks[0].cur.w / 2).toBeCloseTo((100 + 3 * f0) / W, 1)
    expect(asks[0].cur.y + asks[0].cur.h).toBeCloseTo((270 + 45) / H, 1)
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

  it('метка в вопросе: рамка цели — по прогнозу до кадра, а не по спорной рамке, которую фильтр уже принял', async () => {
    // Две цели одной формы идут рядом (40 px); на 10-м кадре на три кадра остаётся одна рамка между ними, сдвинутая к цели 1 (спор за неё), затем обе
    // возвращаются. К вопросу фильтр цели 0 уже принял спорную рамку (от пути цели — десятки px), а метка обязана стоять
    // на пути самой цели.
    const gap = 40
    const det = scripted((f) => {
      const ax = 100 + 3 * f
      if (f < 10 || f >= 13) return [person(ax, 200, 0), person(ax + gap, 200, 0)]
      return [person(ax + gap / 2 + 15, 200, 0)]
    })
    const asks: Array<{
      f: number
      target: number
      cur: { x: number; y: number; w: number; h: number }
    }> = []
    const out = await runTrackingJob(
      options({
        createDetector: () => Promise.resolve(det),
        anchors: [
          { x: 100 / W, y: 200 / H },
          { x: (100 + gap) / W, y: 200 / H }
        ],
        onAsk: (t, _c, target, cur) => {
          asks.push({ f: Math.round(t * FPS - 0.5), target, cur })
          return Promise.resolve(0)
        }
      })
    )
    expect(out.kind).toBe('done')
    const own0 = asks.filter((a) => a.target === 0)
    expect(own0.length).toBeGreaterThan(0)
    for (const { f, cur } of own0) {
      // рамка цели 0 — у её собственного пути (прогноз до кадра), не у спорной рамки и не у соседа
      expect(Math.abs(cur.x + cur.w / 2 - (100 + 3 * f) / W) * W, 'кадр ' + f).toBeLessThan(8)
      expect(Math.abs(cur.y + cur.h - (200 + 45) / H) * H, 'кадр ' + f).toBeLessThan(8)
    }
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
    expect(out).toMatchObject({
      kind: 'failed',
      error: 'ambiguous-start',
      target: 1,
      cause: 'same-player',
      other: 0
    })
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

describe('ответ противоречит недоказанному возвращению', () => {
  const at = (
    t: number,
    x: number
  ): { t: number; foot: { x: number; y: number }; height: number } => ({
    t,
    foot: { x, y: 0.5 },
    height: 0.17
  })

  it('reconcileAnswer: ответ далеко от последнего отсчёта — отсчёты после надёжного кадра заменяются прямой', () => {
    const samples = [at(0, 0.3), at(1, 0.31), at(2, 0.4), at(3, 0.45)]
    const n = reconcileAnswer(samples, [0, 1, 2, 3], 1, at(4, 0.32))
    expect(n).toBe(2)
    expect(samples[0].foot.x).toBe(0.3)
    expect(samples[1].foot.x).toBe(0.31)
    // прямая от (t=1, 0.31) к (t=4, 0.32)
    expect(samples[2].foot.x).toBeCloseTo(0.31 + (0.01 * 1) / 3, 9)
    expect(samples[3].foot.x).toBeCloseTo(0.31 + (0.01 * 2) / 3, 9)
  })

  it('reconcileAnswer: ответ согласен со следом (рядом с последним отсчётом) — ничего не трогается', () => {
    const samples = [at(0, 0.3), at(1, 0.31), at(2, 0.32), at(3, 0.33)]
    const copy = samples.map((s) => ({ ...s, foot: { ...s.foot } }))
    expect(reconcileAnswer(samples, [0, 1, 2, 3], 1, at(4, 0.34))).toBe(0)
    expect(samples).toEqual(copy)
  })

  it('кольцо ушло за неотличимым новичком, свой вернулся и ответ верный: в результате нет кадров на чужом', async () => {
    // Своя рамка встаёт на кадре 22 и пропадает на кадрах 20–31; на кадре 22 рядом (dx=20) выходит игрок той же формы и
    // идёт дальше. На кадре 32 свой виден снова — вопрос, ответ — свой.
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
        frames: frames(50),
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: 300 / W, y: 300 / H }],
        onAsk: (t, candidates) => {
          asked.push(Math.round(t * FPS - 0.5))
          // свой — левее (ближе к 344 px)
          let best = 0
          candidates.forEach((c, k) => {
            const cx = (c.x + c.w / 2) * W
            const bx = (candidates[best].x + candidates[best].w / 2) * W
            if (Math.abs(cx - own(32)) < Math.abs(bx - own(32))) best = k
          })
          return Promise.resolve(best)
        }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(asked.length).toBeGreaterThan(0)
    expect(out.samples[0]).toHaveLength(50)
    for (const [k, s] of out.samples[0].entries()) {
      // ни одного кадра у чужого (тот правее своего не меньше чем на 20 px)
      expect(Math.abs(s.foot.x * W - own(k)), `кадр ${k}`).toBeLessThan(12)
    }
  })
})

describe('обрезка результата по последнему сомнению: чистое кольцо не теряет след', () => {
  // Одно кольцо без соседей той же формы (рядом — игрок другой формы), детектор случайно пропускает кадры. Конец сцены —
  // смена плана, уход за край или пропажа навсегда. Результат должен сохранить почти весь след (до последнего уверенного
  // кадра без малого запаса), а не обрезаться к давнему безобидному пропуску.
  const MARGIN = 5
  const hist = (bin: number): Float32Array => {
    const out = new Float32Array(48)
    for (let c = 0; c < 3; c += 1) out[c * 16 + bin] = 1
    return out
  }
  const rand = (seed: number): (() => number) => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const ring = (
    x: (f: number) => number,
    y: (f: number) => number,
    o: { seed: number; drop: number; cutAt?: number; goneAt?: number }
  ): Detector => {
    const R = rand(o.seed)
    const misses = new Map<number, boolean>()
    return {
      backend: 'wasm',
      detect(frame: DetectorFrame): Promise<DetectOutput> {
        const f = frame.index ?? 0
        if (!misses.has(f)) misses.set(f, f > 0 && R() < o.drop)
        const out: Detection[] = [person(200 + 100 * Math.sin(f / 90), 450, 1)]
        const seen = x(f) > -20 && x(f) < W + 20 && (o.goneAt === undefined || f < o.goneAt)
        if (seen && !misses.get(f)) out.push(person(x(f), y(f), 0))
        const cut = o.cutAt !== undefined && f >= o.cutAt
        return Promise.resolve({ detections: out, frameHist: hist(cut ? 12 : 4) })
      },
      close() {
        // нечего освобождать
      }
    }
  }
  const run = async (
    det: Detector,
    count: number,
    x: (f: number) => number,
    y: (f: number) => number
  ): Promise<{ stop: string | undefined; kept: number; offTruth: number }> => {
    const out = await runTrackingJob(
      options({
        to: count / FPS,
        frames: frames(count),
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: x(0) / W, y: y(0) / H }]
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return { stop: undefined, kept: 0, offTruth: 0 }
    let off = 0
    out.samples[0].forEach((s, k) => {
      if (Math.hypot(s.foot.x * W - x(k), s.foot.y * H - (y(k) + 45)) > 27) off += 1
    })
    return { stop: out.stop?.reason, kept: out.samples[0].length, offTruth: off }
  }
  const cx = (f: number): number => 480 + 300 * Math.sin(f / 200)
  const cy = (f: number): number => 270 + 100 * Math.cos(f / 260)

  for (const drop of [0.02, 0.05])
    for (const seed of [1, 2]) {
      it(`смена плана (пропуски ${drop}, seed ${seed}): след до кадра смены`, async () => {
        const r = await run(ring(cx, cy, { seed, drop, cutAt: 600 }), 700, cx, cy)
        expect(r.stop).toBe('cut')
        expect(r.kept).toBeGreaterThanOrEqual(600 - MARGIN)
        expect(r.offTruth).toBe(0)
      })

      it(`пропажа навсегда (пропуски ${drop}, seed ${seed}): след до последнего уверенного кадра`, async () => {
        const r = await run(ring(cx, cy, { seed, drop, goneAt: 600 }), 700, cx, cy)
        expect(r.stop).toBe('occluded')
        expect(r.kept).toBeGreaterThanOrEqual(600 - MARGIN)
        expect(r.offTruth).toBe(0)
      })

      it(`уход за край (пропуски ${drop}, seed ${seed}): след до края`, async () => {
        const ox = (f: number): number => 100 + 1.5 * f
        const oy = (): number => 270
        // правый край рамки доходит до края кадра на кадре 560
        const r = await run(ring(ox, oy, { seed, drop }), 700, ox, oy)
        expect(r.stop).toBe('out')
        expect(r.kept).toBeGreaterThanOrEqual(560 - MARGIN)
        expect(r.offTruth).toBe(0)
      })
    }

  it('бегун пережидает за игроком другой формы, затем смена плана: след обрезается до пережидания', async () => {
    // Сценарий e2e (stub-runner.json): бегун на 1.2–1.75 с перекрывает игрока другой формы — кольцо пережидает. Возвращение
    // меньше чем за секунду до смены плана (2.4 с) не доказано: под прикрытием мог встать чужой той же формы, поэтому
    // обрезка — до последнего уверенного кадра перед пережиданием (33-й, 1.3 с). Правила «пропуск под прикрытием не
    // сомнителен» нет (раунд 13: оно пропускало чужого, вставшего под прикрытием в пределах 0,1 высоты).
    const pattern = loadStubPattern(
      JSON.stringify({
        players: [
          { start: { x: 0.05, y: 0.4, w: 0.06, h: 0.34 }, velocity: { x: 0.25, y: 0 }, look: 0 },
          { start: { x: 0.42, y: 0.36, w: 0.06, h: 0.34 }, velocity: { x: 0, y: 0 }, look: 1 },
          { start: { x: 0.8, y: 0.45, w: 0.06, h: 0.34 }, velocity: { x: 0, y: 0 }, look: 2 }
        ],
        cuts: [2.4]
      })
    )
    const out = await runTrackingJob(
      options({
        frames: frames(75),
        createDetector: () => Promise.resolve(createStubDetector({ pattern })),
        anchors: [{ x: 0.08, y: 0.74 }]
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop?.reason).toBe('cut')
    expect(out.samples[0]).toHaveLength(34)
  })

  // Ближе (dx ≤ 10) рамка новичка неотличима от шага самой цели: пропуска нет вовсе — это предел детектора, не обрезки.
  for (const dx of [15, 20, 25])
    it(`игрок той же формы встаёт на место пропавшего кольца (dx=${dx}), затем смена плана: его кадров в следе нет`, async () => {
      const own = (f: number): number => 300 + 2 * f
      const det: Detector = {
        backend: 'wasm',
        detect(frame: DetectorFrame): Promise<DetectOutput> {
          const f = frame.index ?? 0
          const out: Detection[] = []
          if (f < 20) out.push(person(own(f), 270, 0))
          else out.push(person(own(f) + dx, 272, 0))
          return Promise.resolve({ detections: out, frameHist: hist(f >= 30 ? 12 : 4) })
        },
        close() {
          // нечего освобождать
        }
      }
      const out = await runTrackingJob(
        options({
          frames: frames(60),
          createDetector: () => Promise.resolve(det),
          anchors: [{ x: own(0) / W, y: 315 / H }]
        })
      )
      expect(out.kind).toBe('done')
      if (out.kind !== 'done') return
      for (const [k, s] of out.samples[0].entries()) {
        if (k >= 20)
          expect(Math.abs(s.foot.x * W - own(k) - dx), `кадр ${k} на чужом`).toBeGreaterThan(3)
      }
    })

  it('ответ на давнее сомнение не переписывает след до последнего возвращения', async () => {
    // Кольцо по кругу; на кадре 300 короткий пропуск, с 303-го рядом идёт игрок той же формы (вопрос), ответ верный.
    // До этого — случайные пропуски без соседей. Отсчёты до пропуска на 300-м остаются на своём игроке (сверка ответа их не трогает).
    const tx = (f: number): number => 480 + 150 * Math.cos(f / 60)
    const ty = (f: number): number => 270 + 120 * Math.sin(f / 60)
    const R = rand(5)
    const misses = new Map<number, boolean>()
    const det: Detector = {
      backend: 'wasm',
      detect(frame: DetectorFrame): Promise<DetectOutput> {
        const f = frame.index ?? 0
        if (!misses.has(f)) misses.set(f, f > 0 && f < 290 && R() < 0.03)
        const out: Detection[] = []
        if (!misses.get(f) && (f < 300 || f >= 312)) out.push(person(tx(f), ty(f), 0))
        if (f >= 303 && f < 400) out.push(person(tx(f) + 30, ty(f) + 5, 0))
        return Promise.resolve({ detections: out, frameHist: hist(4) })
      },
      close() {
        // нечего освобождать
      }
    }
    let asked = 0
    const out = await runTrackingJob(
      options({
        to: 360 / FPS,
        frames: frames(360),
        createDetector: () => Promise.resolve(det),
        anchors: [{ x: tx(0) / W, y: ty(0) / H }],
        onAsk: (t, cands) => {
          asked += 1
          // верный ответ: вариант, ближайший к своему игроку на этом кадре
          const f = Math.round(t * FPS - 0.5)
          const err = (c: { x: number; y: number; w: number; h: number }): number =>
            Math.hypot((c.x + c.w / 2) * W - tx(f), (c.y + c.h / 2) * H - ty(f))
          let best = 0
          cands.forEach((c, k) => {
            if (err(c) < err(cands[best])) best = k
          })
          expect(err(cands[best])).toBeLessThan(15)
          return Promise.resolve(best)
        }
      })
    )
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(asked).toBeGreaterThan(0)
    expect(out.samples[0].length).toBeGreaterThanOrEqual(300 - MARGIN)
    for (let k = 0; k < 299; k += 1) {
      const s = out.samples[0][k]
      expect(
        Math.hypot(s.foot.x * W - tx(k), s.foot.y * H - (ty(k) + 45)),
        `кадр ${k}`
      ).toBeLessThan(10)
    }
  })
})

describe('ответ после долгой подмены и прикрытие соперником', () => {
  const cutHist = (bin: number): Float32Array => {
    const out = new Float32Array(48)
    for (let c = 0; c < 3; c += 1) out[c * 16 + bin] = 1
    return out
  }
  const at = (t: number, x: number): TrackSample => ({ t, foot: { x, y: 0.5 }, height: 0.17 })

  it('reconcileAnswer: из нескольких границ берётся самая поздняя достижимая', () => {
    // отсчёты на кадрах 0..9 (25 к/с); границы 2 и 6; ответ на кадре 10 у x=0.30
    const make = (): TrackSample[] =>
      Array.from({ length: 10 }, (_, f) => at((f + 0.5) / FPS, f <= 6 ? 0.3 : 0.6))
    const frames10 = Array.from({ length: 10 }, (_, f) => f)
    const late = make()
    // отсчёт на 6-м (0.30) достижим — заменяются только 7..9
    expect(reconcileAnswer(late, frames10, [2, 6], at(10.5 / FPS, 0.3), 1, FPS)).toBe(3)
    expect(late[6].foot.x).toBe(0.3)
    // поздняя граница недостижима (её отсчёт далеко от ответа, а времени мало) — берётся ранняя
    const far = make().map((s, f) => (f >= 3 ? { ...s, foot: { x: 0.9, y: 0.5 } } : s))
    expect(reconcileAnswer(far, frames10, [2, 6], at(10.5 / FPS, 0.3), 1, FPS)).toBe(7)
    expect(far[2].foot.x).toBe(0.3)
  })

  for (const dx of [0, 15])
    for (const back of [55, 90])
      it(`свой стоит невидимым, чужой той же формы ушёл один дольше секунды (dx=${dx}), свой вернулся на ${back}-м и ответ верный: чужих отсчётов нет`, async () => {
        const own = (f: number): number => 300 + 2 * Math.min(f, 20)
        const other = (f: number): number => 300 + 2 * f + dx
        const det = scripted((f) => {
          const out: Detection[] = []
          if (f < 20 || f >= back) out.push(person(own(f), 270))
          if (f >= 22) out.push(person(other(f), 272))
          return out
        })
        let asked = 0
        const out = await runTrackingJob(
          options({
            frames: frames(back + 20),
            createDetector: () => Promise.resolve(det),
            anchors: [{ x: 300 / W, y: 315 / H }],
            onAsk: (t, candidates) => {
              asked += 1
              const f = Math.round(t * FPS - 0.5)
              let best = 0
              const err = (k: number): number =>
                Math.abs((candidates[k].x + candidates[k].w / 2) * W - own(f))
              candidates.forEach((_, k) => {
                if (err(k) < err(best)) best = k
              })
              expect(err(best)).toBeLessThan(10)
              return Promise.resolve(best)
            }
          })
        )
        expect(out.kind).toBe('done')
        if (out.kind !== 'done') return
        expect(asked).toBeGreaterThan(0)
        for (const [k, s] of out.samples[0].entries()) {
          expect(Math.abs(s.foot.x * W - own(k)), `кадр ${k}`).toBeLessThan(27)
        }
      })

  for (const dx of [0, 5, 10, 15, 20, 25])
    it(`чужой той же формы встаёт под прикрытием игрока другой формы (dx=${dx}), затем смена плана: его кадров нет`, async () => {
      // Свой останавливается и пропадает с 20-го; игрок другой формы закрывает место прогноза на 17–35-м; под ним на
      // месте прогноза (+dx) встаёт чужой той же формы и продолжает движение своего. Смена плана на 44-м.
      const own = (f: number): number => 300 + 2 * Math.min(f, 20)
      const det: Detector = {
        backend: 'wasm',
        detect(frame: DetectorFrame): Promise<DetectOutput> {
          const f = frame.index ?? 0
          const out: Detection[] = []
          if (f < 20) out.push(person(own(f), 270, 0))
          if (f >= 20) out.push(person(300 + 2 * f + dx, 272, 0))
          if (f >= 17 && f < 36) out.push(person(300 + 2 * f + 3, 268, 1))
          return Promise.resolve({ detections: out, frameHist: cutHist(f >= 44 ? 12 : 4) })
        },
        close() {
          // нечего освобождать
        }
      }
      const out = await runTrackingJob(
        options({
          frames: frames(60),
          createDetector: () => Promise.resolve(det),
          anchors: [{ x: 300 / W, y: 315 / H }]
        })
      )
      expect(out.kind).toBe('done')
      if (out.kind !== 'done') return
      for (const [k, s] of out.samples[0].entries()) {
        expect(Math.abs(s.foot.x * W - own(k)), `кадр ${k} на чужом`).toBeLessThan(27)
      }
    })
})

describe('сверка ответа: от последнего доказанного места', () => {
  const at = (t: number, x: number): TrackSample => ({ t, foot: { x, y: 0.5 }, height: 0.17 })
  const fr = (n: number): number[] => Array.from({ length: n }, (_, f) => f)

  it('reconcileAnswer: ответ у доказанного места заменяет след после него, даже если согласен с последним отсчётом', () => {
    // отсчёты 0..4 у 0.30, 5..9 уходят к 0.60 и возвращаются к 0.31; ответ у 0.30 согласен с последним
    const xs = [0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.5, 0.6, 0.45, 0.31]
    const samples = xs.map((x, f) => at((f + 0.5) / FPS, x))
    expect(reconcileAnswer(samples, fr(10), [4], at(10.5 / FPS, 0.3), 1, FPS)).toBe(0)
    expect(reconcileAnswer(samples, fr(10), [4], at(10.5 / FPS, 0.3), 1, FPS, 4)).toBe(5)
    for (let f = 5; f < 10; f += 1) expect(Math.abs(samples[f].foot.x - 0.3)).toBeLessThan(0.001)
  })

  it('reconcileAnswer: ни одна граница не достижима — замена от самой поздней, а не от ранней', () => {
    // быстрый бег: отсчёты 0..9 верные (по 0.1 высоты кадра за кадр), граница 2 и 8; ответ далеко впереди
    const samples = fr(10).map((f) => at((f + 0.5) / FPS, 0.05 * f))
    const n = reconcileAnswer(samples, fr(10), [2, 8], at(10.5 / FPS, 2.5), 1, FPS)
    expect(n).toBe(1)
    for (let f = 0; f < 9; f += 1) expect(samples[f].foot.x).toBeCloseTo(0.05 * f, 9)
  })

  it('reconcileAnswer: верный след на беге (0,25 высоты за кадр) с границами каждые 40 кадров не портится', () => {
    // A1: 300 отсчётов по дуге, последние 8 — прямой прогноз пережидания; ответ — на настоящем месте
    const hpx = 90
    const truth = (f: number): [number, number] => {
      const a = (f * 0.25 * hpx) / 150
      return [480 + 150 * Math.cos(a), 270 + 150 * Math.sin(a)]
    }
    const samples: TrackSample[] = []
    for (let f = 0; f < 300; f += 1) {
      let [x, y] = truth(f)
      if (f >= 292) {
        const [x0, y0] = truth(291)
        const [x1, y1] = truth(290)
        x = x0 + (x0 - x1) * (f - 291)
        y = y0 + (y0 - y1) * (f - 291)
      }
      samples.push({ t: (f + 0.5) / FPS, foot: { x: x / W, y: (y + 45) / H }, height: hpx / H })
    }
    const [ax, ay] = truth(300)
    const answer = { t: 300.5 / FPS, foot: { x: ax / W, y: (ay + 45) / H }, height: hpx / H }
    reconcileAnswer(samples, fr(300), [40, 80, 120, 160, 200, 240, 280, 291], answer, W / H, FPS)
    for (let f = 0; f < 292; f += 1) {
      const [tx, ty] = truth(f)
      const s = samples[f]
      expect(Math.hypot(s.foot.x * W - tx, s.foot.y * H - ty - 45), `кадр ${f}`).toBeLessThan(1)
    }
  })

  for (const k of [1, 3])
    it(`чужой после подмены сам пропал на ${k} кадр(а) (граница на чужом), свой вернулся, ответ верный: чужих отсчётов нет`, async () => {
      // A2: свой стоит невидимым с 20-го до 55-го; чужой той же формы с 22-го идёт рядом и уходит, на 40-м пропадает на k
      // кадров — граница возвращения ложится на чужого. Ответ у доказанного места своего — сверка от него.
      const own = (f: number): number => 300 + 2 * Math.min(f, 20)
      const det = scripted((f) => {
        const out: Detection[] = []
        if (f < 20 || f >= 55) out.push(person(own(f), 270))
        if (f >= 22 && !(f >= 40 && f < 40 + k)) out.push(person(300 + 2 * f, 272))
        return out
      })
      let asked = 0
      const out = await runTrackingJob(
        options({
          frames: frames(75),
          createDetector: () => Promise.resolve(det),
          anchors: [{ x: 300 / W, y: 315 / H }],
          onAsk: (t, candidates) => {
            asked += 1
            const f = Math.round(t * FPS - 0.5)
            let best = 0
            const err = (j: number): number =>
              Math.abs((candidates[j].x + candidates[j].w / 2) * W - own(f))
            candidates.forEach((_, j) => {
              if (err(j) < err(best)) best = j
            })
            expect(err(best)).toBeLessThan(10)
            return Promise.resolve(best)
          }
        })
      )
      expect(out.kind).toBe('done')
      if (out.kind !== 'done') return
      expect(asked).toBeGreaterThan(0)
      for (const [f, s] of out.samples[0].entries()) {
        expect(Math.abs(s.foot.x * W - own(f)), `кадр ${f}`).toBeLessThan(27)
      }
    })
})

describe('сверка ответа: свой ушёл, пока его не было видно; чужой вернулся вплотную к своему', () => {
  /** Ответ — вариант, ближайший к своему игроку (x = own(f)); проверяет, что свой среди вариантов. */
  const answerOwn =
    (own: (f: number) => number, asked: number[]) =>
    (t: number, candidates: Array<{ x: number; w: number }>): Promise<number> => {
      const f = Math.round(t * FPS - 0.5)
      asked.push(f)
      let best = 0
      const err = (j: number): number =>
        Math.abs((candidates[j].x + candidates[j].w / 2) * W - own(f))
      candidates.forEach((_, j) => {
        if (err(j) < err(best)) best = j
      })
      expect(err(best), `вопрос на кадре ${f} без своего`).toBeLessThan(10)
      return Promise.resolve(best)
    }

  for (const moved of [110, 220])
    it(`свой ушёл на ${moved} px за 40 кадров невидимым, чужой взял кольцо и сам пропадал: ответ верный — чужих отсчётов нет`, async () => {
      const own = (f: number): number => 340 - moved * Math.min(1, Math.max(0, (f - 20) / 40))
      const det = scripted((f) => {
        const out: Detection[] = []
        if (f < 20 || f >= 60) out.push(person(own(f), 270))
        if (f >= 22 && !(f >= 40 && f < 42)) out.push(person(300 + 2 * f + 15, 272))
        return out
      })
      const asked: number[] = []
      const out = await runTrackingJob(
        options({
          frames: frames(90),
          createDetector: () => Promise.resolve(det),
          anchors: [{ x: 340 / W, y: 315 / H }],
          onAsk: answerOwn(own, asked)
        })
      )
      expect(out.kind).toBe('done')
      if (out.kind !== 'done') return
      expect(asked.length).toBeGreaterThan(0)
      for (const [f, s] of out.samples[0].entries()) {
        expect(Math.abs(s.foot.x * W - own(f)), `кадр ${f}`).toBeLessThan(27)
      }
    })

  for (const after of ['stay', 'leave'] as const)
    it(`чужой вернулся вплотную к своему на 55-м (${after === 'stay' ? 'и стоит' : 'и уходит'}): вопрос со своим, чужих отсчётов нет`, async () => {
      // Свой стоит невидимым с 20-го по 54-й; чужой той же формы с 22-го уходит на 60 px и возвращается к своему (12 px)
      // ровно когда тот появляется.
      const back = 55
      const own = (f: number): number => 300 + 2 * Math.min(f, 20)
      const sx = (f: number): number =>
        f <= back
          ? 340 + 60 * Math.sin(Math.PI * Math.min(1, (f - 22) / (back - 22)))
          : after === 'stay'
            ? 340
            : 340 + 3 * (f - back)
      const det = scripted((f) => {
        const out: Detection[] = []
        if (f < 20 || f >= back) out.push(person(own(f), 270))
        if (f >= 22) out.push(person(sx(f) + 12, 272))
        return out
      })
      const asked: number[] = []
      const out = await runTrackingJob(
        options({
          frames: frames(back + 40),
          createDetector: () => Promise.resolve(det),
          anchors: [{ x: 300 / W, y: 315 / H }],
          onAsk: answerOwn(own, asked)
        })
      )
      expect(out.kind).toBe('done')
      if (out.kind !== 'done') return
      expect(asked.length).toBeGreaterThan(0)
      for (const [f, s] of out.samples[0].entries()) {
        expect(Math.abs(s.foot.x * W - own(f)), `кадр ${f}`).toBeLessThan(27)
      }
    })
})
