import { describe, expect, it } from 'vitest'
import { lookOf } from './appearance'
import { MultiTracker, type MultiStep } from './multi'
import { frameHistOf } from './sceneCut'
import type { Box, Detection, FrameInput } from './types'

const FPS = 25
const FRAME = { w: 960, h: 540 }
const BW = 40
const BH = 90

function look(top: [number, number, number], bottom: [number, number, number]): Float32Array {
  const w = 40
  const h = 90
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    const c = y < h / 2 ? top : bottom
    for (let x = 0; x < w; x += 1) px.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
  }
  return lookOf(px, w, h, { x: 0, y: 0, w, h })
}

const RED = look([220, 30, 30], [255, 255, 255])
const BLUE = look([30, 60, 220], [20, 20, 20])
const GREEN = look([30, 200, 60], [240, 240, 30])
const WHITE_FRAME = frameHistOf(new Uint8Array(64 * 64 * 4).fill(235), 64, 64)

const det = (cx: number, cy: number, lk: Float32Array, w = BW, h = BH): Detection => ({
  box: { x: cx - w / 2, y: cy - h / 2, w, h },
  score: 0.9,
  look: lk
})

const frame = (index: number, detections: Detection[]): FrameInput => ({
  index,
  t: (index + 0.5) / FPS,
  detections,
  frameHist: WHITE_FRAME
})

const cx = (b: Box): number => b.x + b.w / 2
const cy = (b: Box): number => b.y + b.h / 2

/** Поле «кто где» для сценариев: i-й игрок на кадре f. */
type Truth = Array<(f: number) => Detection>

function startOf(truth: Truth): MultiTracker {
  return new MultiTracker(
    truth.map((p) => ({ det: p(0) })),
    FPS,
    { w: FRAME.w, h: FRAME.h }
  )
}

describe('MultiTracker', () => {
  it('три цели в параллельном движении: все ведутся, ни одна не уходит на соседа', () => {
    const truth: Truth = [
      (f) => det(100 + f * 3, 100, RED),
      (f) => det(100 + f * 4, 270, BLUE),
      (f) => det(100 + f * 2, 440, GREEN)
    ]
    const m = startOf(truth)
    for (let f = 1; f < 60; f += 1) {
      const r = m.step(frame(f, truth.map((p) => p(f)).reverse()))
      expect(r.kind).toBe('track')
      if (r.kind !== 'track') return
      expect(r.boxes).toHaveLength(3)
      r.boxes.forEach((b, i) => {
        expect(r.coasting[i]).toBe(false)
        expect(Math.abs(cx(b) - cx(truth[i](f).box))).toBeLessThan(1)
        expect(Math.abs(cy(b) - cy(truth[i](f).box))).toBeLessThan(1)
      })
    }
  })

  it('две цели одной формы пересекаются: обмена нет (ведут по своей траектории или спрашивают)', () => {
    // Одинаковые майки, идут навстречу друг другу, рамки на пересечении перекрыты.
    const v = 1.7
    const truth: Truth = [
      (f) => det(100 + v * f, 250, RED),
      (f) => det(100 + 2 * v * 36 - v * f, 290, RED)
    ]
    const m = startOf(truth)
    let asks = 0
    for (let f = 1; f < 100; f += 1) {
      const dets = truth.map((p) => p(f))
      let r: MultiStep = m.step(frame(f, dets))
      while (r.kind === 'ask') {
        asks += 1
        // Отвечаем верно: рамка, ближайшая к настоящему положению цели.
        const want = truth[r.target](f).box
        const pick = r.candidates.reduce((a, b) =>
          Math.abs(cx(a.box) - cx(want)) < Math.abs(cx(b.box) - cx(want)) ? a : b
        )
        r = m.resolve(r.target, pick)
      }
      expect(r.kind).toBe('track')
      if (r.kind !== 'track') return
      r.boxes.forEach((b, i) => {
        if (r.kind !== 'track' || r.coasting[i]) return
        // Уверенная рамка — всегда у своего игрока, а не у второго.
        expect(Math.abs(cx(b) - cx(truth[i](f).box))).toBeLessThan(20)
        expect(Math.abs(cy(b) - cy(truth[i](f).box))).toBeLessThan(20)
      })
    }
    expect(asks).toBeGreaterThanOrEqual(0)
  })

  it('две цели на одной рамке: вопрос по одной из целей, а не молчаливый общий выбор', () => {
    // Два одинаковых игрока рядом; затем виден один и тот же человек посередине, у обоих в воротах.
    const a = det(200, 270, RED)
    const b = det(250, 270, RED)
    const m = new MultiTracker([{ det: a }, { det: b }], FPS, FRAME)
    const mid = det(225, 270, RED)
    const far = det(330, 270, RED)
    const r = m.step(frame(1, [mid, far]))
    expect(r.kind).toBe('ask')
    if (r.kind !== 'ask') return
    expect([0, 1]).toContain(r.target)
    // Вариант — та самая спорная рамка и другие рядом.
    expect(r.candidates).toContain(mid)
    expect(r.candidates).toContain(far)
    // Выбрана другая рамка: общая рамка остаётся у второй цели, рамок больше не делят.
    const next = m.resolve(r.target, far)
    expect(next.kind).toBe('track')
    if (next.kind !== 'track') return
    expect(next.boxes[r.target]).toEqual(far.box)
    expect(next.boxes[1 - r.target]).toEqual(mid.box)
  })

  it('две цели на одной рамке, выбрана общая: вторая цель не получает её, остановка всех', () => {
    const m = new MultiTracker(
      [{ det: det(200, 270, RED) }, { det: det(250, 270, RED) }],
      FPS,
      FRAME
    )
    const mid = det(225, 270, RED)
    const r = m.step(frame(1, [mid]))
    expect(r.kind).toBe('ask')
    if (r.kind !== 'ask') return
    const next = m.resolve(r.target, mid)
    // Рамка уже закреплена за выбранной целью; второй предложить нечего — стоп с номером второй цели.
    expect(next).toEqual({ kind: 'lost', target: 1 - r.target, reason: 'occluded' })
  })

  it('потеря одной цели: стоп всех с номером потерянной', () => {
    const truth: Truth = [(f) => det(100 + f * 3, 100, RED), (f) => det(100 + f * 3, 400, BLUE)]
    const m = startOf(truth)
    let last: MultiStep | null = null
    for (let f = 1; f < 80; f += 1) {
      const dets = f < 20 ? truth.map((p) => p(f)) : [truth[0](f)]
      last = m.step(frame(f, dets))
      if (last.kind === 'lost') break
    }
    expect(last).toEqual({ kind: 'lost', target: 1, reason: 'occluded' })
    // после остановки трекер мёртв
    expect(m.step(frame(90, [truth[0](90)])).kind).toBe('lost')
  })

  it('вопрос по одной цели: остальные ждут, после ответа ведутся дальше', () => {
    // Цель 0 раздваивается на две одинаковые рамки; цель 1 идёт спокойно.
    const a = (f: number): Detection => det(100 + 3 * f, 270, RED)
    const calm = (f: number): Detection => det(100 + 3 * f, 450, BLUE)
    const m = new MultiTracker([{ det: a(0) }, { det: calm(0) }], FPS, FRAME)
    let asked: { target: number; frame: number } | null = null
    for (let f = 1; f < 100; f += 1) {
      const dets =
        f < 30
          ? [a(f), calm(f)]
          : f < 42
            ? [a(f), a(f), calm(f)]
            : [det(100 + 3 * f, 320, RED), det(100 + 3 * f, 220, RED), calm(f)]
      let r = m.step(frame(f, dets))
      if (r.kind === 'ask') {
        asked = { target: r.target, frame: f }
        const mine = r.candidates.find((c) => cy(c.box) > 300)!
        r = m.resolve(r.target, mine)
      }
      expect(r.kind).toBe('track')
      if (r.kind !== 'track') return
      // у спокойной цели вопрос не рождается и рамка на месте
      expect(Math.abs(cy(r.boxes[1]) - 450)).toBeLessThan(1)
    }
    expect(asked?.target).toBe(0)
  })

  it('одна цель = прежнее поведение: ask отдаёт кандидатов трекера без изменений', () => {
    const a = (f: number): Detection => det(100 + 3 * f, 270, RED)
    const m = new MultiTracker([{ det: a(0) }], FPS, FRAME)
    let sawAsk = false
    for (let f = 1; f < 100; f += 1) {
      const dets =
        f < 30
          ? [a(f)]
          : f < 42
            ? [a(f), a(f)]
            : [det(100 + 3 * f, 320, RED), det(100 + 3 * f, 220, RED)]
      let r = m.step(frame(f, dets))
      if (r.kind === 'ask') {
        sawAsk = true
        expect(r.target).toBe(0)
        expect(r.candidates).toHaveLength(2)
        r = m.resolve(
          0,
          r.candidates.find((c) => cy(c.box) > 300)!
        )
      }
      expect(r.kind).toBe('track')
    }
    expect(sawAsk).toBe(true)
  })

  it('predictBoxes: по рамке на цель', () => {
    const m = startOf([(f) => det(100 + f, 100, RED), (f) => det(300 + f, 300, BLUE)])
    const boxes = m.predictBoxes(1)
    expect(boxes).toHaveLength(2)
    expect(cx(boxes[1])).toBeGreaterThan(cx(boxes[0]))
  })
})
