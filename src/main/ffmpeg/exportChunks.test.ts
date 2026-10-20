import { describe, expect, it } from 'vitest'
import type { Timing } from '../../shared/annotations'
import { planExport, type OverlayPlan, type RangePlan } from '../../shared/exportOverlays'
import { splitRange } from './drawGraph'
import {
  boundaryBefore,
  decodedSecondsOf,
  firstFrameAtOrAfter,
  normalizeRanges,
  planChunks,
  wholeRanges,
  type PlannedChunk
} from './exportChunks'

const FPS = 25
const range = (start: number, duration: number): Timing => ({ mode: 'range', start, duration })
const freeze = (start: number, seconds: number): Timing => ({
  mode: 'frame',
  start,
  freezeSeconds: seconds
})

/** Номера кадров исходника по порядку вывода: обычные кадры и стоп-кадры (кадр повторяется 1 + seconds·fps раз). */
function framesOf(ranges: readonly RangePlan[]): number[] {
  const out: number[] = []
  for (const r of ranges) {
    for (const piece of splitRange(r, FPS)) {
      if (piece.kind === 'cut') {
        for (
          let k = firstFrameAtOrAfter(piece.start, FPS);
          k < firstFrameAtOrAfter(piece.end, FPS);
          k += 1
        ) {
          out.push(k)
        }
      } else {
        const n = Math.round(piece.freeze.seconds * FPS) + 1
        for (let i = 0; i < n; i += 1) out.push(piece.freeze.frame)
      }
    }
  }
  return out
}

/**
 * Одиночные кадры в склейке: обычный кусок из одного кадра, за которым идёт ещё что-то. Фильтр concat даёт такому куску
 * нулевую длительность и следующий кусок наезжает на него (кадр пропадает). Сам по себе такой кусок есть и без деления
 * (стоп-кадры через кадр), но деление не должно добавлять новых: если кусок один и последний — это безвредно.
 */
function singleFrameHazards(groups: readonly (readonly RangePlan[])[]): number {
  let n = 0
  for (const ranges of groups) {
    const pieces = ranges.flatMap((r) => splitRange(r, FPS))
    pieces.forEach((p, i) => {
      if (
        p.kind === 'cut' &&
        i < pieces.length - 1 &&
        firstFrameAtOrAfter(p.end, FPS) - firstFrameAtOrAfter(p.start, FPS) === 1
      ) {
        n += 1
      }
    })
  }
  return n
}

const chunkFrames = (chunks: readonly PlannedChunk[]): number[] =>
  chunks.flatMap((c) => framesOf(c.ranges))

/** Простой детерминированный генератор. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('приведение отрезков к целым кадрам', () => {
  it('границы стоят на серединах кадров, число кадров то же, что у правила planAnimation', () => {
    const [plan] = planExport([{ start: 12.345, end: 22.345 }], 'files', [], FPS)
    const [r] = normalizeRanges(plan, FPS)
    expect(r.k0).toBe(309) // кадр с началом 12.36 — первый, начало которого не раньше 12.345
    expect(r.k1).toBe(559)
    const [w] = wholeRanges(plan, FPS)
    expect(w.start).toBeCloseTo(boundaryBefore(309, FPS), 9)
    expect(w.end).toBeCloseTo(boundaryBefore(559, FPS), 9)
    expect(Math.round((w.end - w.start) * FPS)).toBe(250)
  })
  it('граница точно на кадре: кадр входит в отрезок (с допуском в миллисекунду)', () => {
    expect(firstFrameAtOrAfter(1, FPS)).toBe(25)
    expect(firstFrameAtOrAfter(1.04, FPS)).toBe(26)
    expect(firstFrameAtOrAfter(0, FPS)).toBe(0)
  })
})

describe('куски: всё видео без рисунков', () => {
  const [plan] = planExport([{ start: 0, end: 100 }], 'files', [], FPS)

  it('куски идут подряд без пропусков и повторов, их длина не больше цели', () => {
    const cp = planChunks({ plan, fps: FPS, targetSeconds: 10 })
    expect(cp.chunks.length).toBe(10)
    expect(chunkFrames(cp.chunks)).toEqual(framesOf(wholeRanges(plan, FPS)))
    for (const c of cp.chunks) {
      expect(c.sourceFrames).toBeLessThanOrEqual(10 * FPS)
      expect(c.drawn).toBe(false)
      expect(c.segments).toEqual([])
    }
    expect(cp.outputSeconds).toBeCloseTo(100, 6)
  })
  it('границы между кусками — полкадра до начала кадра', () => {
    const cp = planChunks({ plan, fps: FPS, targetSeconds: 7 })
    for (let i = 0; i + 1 < cp.chunks.length; i += 1) {
      const end = cp.chunks[i].ranges[cp.chunks[i].ranges.length - 1].end
      const start = cp.chunks[i + 1].ranges[0].start
      expect(end).toBeCloseTo(start, 9)
      const k = Math.round(end * FPS + 0.5)
      expect(end).toBeCloseTo((k - 0.5) / FPS, 9)
    }
  })
  it('цель длиннее всего отрезка — один кусок', () => {
    const cp = planChunks({ plan, fps: FPS, targetSeconds: 1000 })
    expect(cp.chunks).toHaveLength(1)
  })
  it('отрезок без кадров не даёт кусков', () => {
    const [none] = planExport([{ start: 5.01, end: 5.02 }], 'files', [], FPS)
    expect(planChunks({ plan: none, fps: FPS, targetSeconds: 10 }).chunks).toEqual([])
  })
})

describe('куски: рисунки', () => {
  // Три рисунка-отрезка по 3 секунды, стоп-кадр и движущийся рисунок среди 10 минут.
  const timings: Timing[] = [
    range(60, 3),
    range(200, 3),
    freeze(300.02, 2),
    range(400, 3),
    range(500, 3)
  ]
  const [plan] = planExport([{ start: 0, end: 600 }], 'files', timings, FPS, new Set([4]))

  it('кадры и стоп-кадры те же, что без деления; каждый стоп-кадр ровно в одном куске', () => {
    const cp = planChunks({ plan, fps: FPS, targetSeconds: 20 })
    expect(chunkFrames(cp.chunks)).toEqual(framesOf(wholeRanges(plan, FPS)))
    const freezeFrames = cp.chunks.flatMap((c) =>
      c.ranges.flatMap((r) => r.freezes.map((f) => f.frame))
    )
    expect(freezeFrames).toEqual([7500])
  })
  it('рисунки только там, где они нужны: куски без рисунков не содержат сегментов, а с рисунками — только свои', () => {
    const cp = planChunks({ plan, fps: FPS, targetSeconds: 20 })
    const drawn = cp.chunks.filter((c) => c.drawn)
    expect(drawn.length).toBeGreaterThanOrEqual(4)
    expect(drawn.length).toBeLessThanOrEqual(10)
    for (const c of cp.chunks) {
      if (!c.drawn) {
        expect(c.segments).toHaveLength(0)
        expect(c.runs).toHaveLength(0)
      }
      // Каждый сегмент куска пересекает его время.
      for (const s of c.segments) {
        expect(c.ranges.some((r) => s.start < r.end + 0.1 && s.end > r.start - 0.1)).toBe(true)
      }
    }
    // Тяжёлых кусков мало: большая часть времени — обычные кадры.
    const plainSeconds = cp.chunks.filter((c) => !c.drawn).reduce((n, c) => n + c.outputSeconds, 0)
    expect(plainSeconds).toBeGreaterThan(540)
  })
  it('ряды кадров анимации обрезаны по куску и вместе дают те же кадры, что в плане', () => {
    const cp = planChunks({ plan, fps: FPS, targetSeconds: 1 })
    const frames = new Set<number>()
    for (const c of cp.chunks) {
      for (const run of c.runs) {
        // Ряд не выходит за кадры куска.
        const lo = Math.round(c.ranges[0].start * FPS + 0.5)
        const hi = Math.round(c.ranges[c.ranges.length - 1].end * FPS + 0.5)
        expect(run.first).toBeGreaterThanOrEqual(lo)
        expect(run.last).toBeLessThan(hi)
        for (let k = run.first; k <= run.last; k += 1) frames.add(k)
      }
    }
    const planned = new Set<number>()
    for (const run of plan.animation.runs)
      for (let k = run.first; k <= run.last; k += 1) planned.add(k)
    expect(frames).toEqual(planned)
  })
  it('стоп-кадр окружён обычными кадрами: одиночных кадров рядом с границей куска нет', () => {
    const cp = planChunks({ plan, fps: FPS, targetSeconds: 3 })
    expect(singleFrameHazards(cp.chunks.map((c) => c.ranges))).toBe(
      singleFrameHazards([wholeRanges(plan, FPS)])
    )
  })
  it('край сегмента, совпавший с краем отрезка экспорта, переносится на край приведённого отрезка', () => {
    const [p] = planExport([{ start: 10.001, end: 20.013 }], 'files', [range(15, 100)], FPS)
    const cp = planChunks({ plan: p, fps: FPS, targetSeconds: 1000 })
    const seg = cp.chunks.flatMap((c) => c.segments)[0]
    const whole = cp.ranges[0]
    expect(seg.end).toBeCloseTo(whole.end, 9)
  })
})

describe('куски: подборка не декодирует лишнего', () => {
  // 20 эпизодов по 10 секунд, разнесённых по 90 минутам, и рисунки в них.
  const clips = Array.from({ length: 20 }, (_, i) => ({ start: 120 + i * 255, end: 130 + i * 255 }))
  const timings = clips.map((c) => range(c.start + 2, 3))
  const plan = planExport(clips, 'compilation', timings, FPS)[0]

  it('каждый кусок читает только свои секунды: всего столько же, сколько эпизодов', () => {
    const cp = planChunks({ plan, fps: FPS, targetSeconds: 30 })
    expect(chunkFrames(cp.chunks)).toEqual(framesOf(wholeRanges(plan, FPS)))
    // Эпизоды далеки друг от друга (255 с), поэтому в кусок попадает по одному.
    expect(cp.chunks.every((c) => c.ranges.length === 1)).toBe(true)
    expect(decodedSecondsOf(cp.chunks)).toBeCloseTo(200, 0)
  })
  it('близкие эпизоды читаются одним куском, если вместе не длиннее цели', () => {
    const near = planExport(
      [
        { start: 100, end: 105 },
        { start: 108, end: 113 },
        { start: 5000, end: 5005 }
      ],
      'compilation',
      [],
      FPS
    )[0]
    const cp = planChunks({ plan: near, fps: FPS, targetSeconds: 60 })
    expect(cp.chunks).toHaveLength(2)
    expect(cp.chunks[0].ranges).toHaveLength(2)
    expect(decodedSecondsOf(cp.chunks)).toBeLessThan(10 + 3 + 6)
  })
  it('перекрывающиеся отрезки (запас по краям) не ломают порядок кадров', () => {
    const overlap = planExport(
      [
        { start: 10, end: 14 },
        { start: 12, end: 16 }
      ],
      'compilation',
      [range(11, 4)],
      FPS
    )[0]
    const cp = planChunks({ plan: overlap, fps: FPS, targetSeconds: 2 })
    expect(chunkFrames(cp.chunks)).toEqual(framesOf(wholeRanges(overlap, FPS)))
  })
})

describe('куски: случайные планы', () => {
  it('на 300 случайных планах кадры и стоп-кадры совпадают с делением на части, одиночных кадров не прибавляется', () => {
    const r = rng(42)
    for (let n = 0; n < 300; n += 1) {
      const clipCount = 1 + Math.floor(r() * 4)
      const clips = Array.from({ length: clipCount }, () => {
        const start = Math.round(r() * 200 * 1000) / 1000
        return { start, end: start + 0.5 + Math.round(r() * 60 * 1000) / 1000 }
      })
      clips.sort((a, b) => a.start - b.start)
      const timings: Timing[] = []
      const count = Math.floor(r() * 12)
      for (let i = 0; i < count; i += 1) {
        const at = clips[Math.floor(r() * clips.length)]
        const t = at.start + r() * (at.end - at.start)
        timings.push(r() < 0.3 ? freeze(t, 0.5 + Math.floor(r() * 3)) : range(t, 0.2 + r() * 5))
      }
      const mode = r() < 0.5 ? 'compilation' : 'files'
      const plans = planExport(clips, mode, timings, FPS, new Set(r() < 0.3 ? [0] : []))
      for (const plan of plans) {
        const cp = planChunks({ plan, fps: FPS, targetSeconds: 0.5 + r() * 40 })
        const whole = wholeRanges(plan, FPS)
        expect(chunkFrames(cp.chunks), `план ${n}`).toEqual(framesOf(whole))
        expect(
          singleFrameHazards(cp.chunks.map((c) => c.ranges)),
          `одиночные кадры, план ${n}`
        ).toBeLessThanOrEqual(singleFrameHazards([whole]))
        // Куски не пустые и идут по порядку номеров.
        cp.chunks.forEach((c, i) => {
          expect(c.index).toBe(i)
          expect(c.sourceFrames).toBeGreaterThan(0)
        })
      }
    }
  })
})

describe('пустой план', () => {
  it('без отрезков кусков нет', () => {
    const plan: OverlayPlan = {
      segments: [],
      ranges: [],
      keys: [],
      freezeSeconds: 0,
      animation: { frames: [], runs: [] }
    }
    expect(planChunks({ plan, fps: FPS, targetSeconds: 10 }).chunks).toEqual([])
  })
})
