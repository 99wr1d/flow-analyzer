import { describe, expect, it } from 'vitest'
import { lookOf } from './appearance'
import { MultiTracker, type MultiStep } from './multi'
import { CHAIN_NEIGHBOUR_DIST } from './tuning'
import { SingleTracker } from './tracker'
import { frameHistOf } from './sceneCut'
import type { Box, Detection, FrameInput, StepResult } from './types'

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

const lookMix = (a: Float32Array, b: Float32Array, k: number): Float32Array =>
  a.map((v, i) => v * (1 - k) + b[i] * k) as Float32Array

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
    // Прямой проход насквозь: уверенно ведёт каждая своего, вопросов нет.
    expect(asks).toBe(0)
  })

  it('две цели одной формы на одной рамке: рамку не получает ни одна (обе ждут), потом решает цепочка/вопрос', () => {
    // Два одинаковых игрока рядом; затем виден один человек посередине, у обоих в воротах. Кто из них — неизвестно.
    const m = new MultiTracker(
      [{ det: det(200, 270, RED) }, { det: det(250, 270, RED) }],
      FPS,
      FRAME
    )
    const mid = det(225, 270, RED)
    const r = m.step(frame(1, [mid, det(330, 270, RED)]))
    expect(r.kind).toBe('track')
    if (r.kind !== 'track') return
    expect(r.coasting).toEqual([true, true])
  })

  it('разные майки на одной рамке: цель, которой рамка ближе, держит её, вторая ждёт', () => {
    const m = new MultiTracker(
      [{ det: det(200, 270, RED) }, { det: det(250, 270, BLUE) }],
      FPS,
      FRAME
    )
    const r = m.step(frame(1, [det(205, 270, RED)]))
    expect(r.kind).toBe('track')
    if (r.kind !== 'track') return
    expect(r.coasting[0]).toBe(false)
  })

  it('две цели на одной рамке надолго: ждущая цель теряется (стоп всех с её номером), рамка остаётся первой', () => {
    const m = new MultiTracker(
      [{ det: det(200, 270, RED) }, { det: det(250, 270, RED) }],
      FPS,
      FRAME
    )
    const mid = det(225, 270, RED)
    let last: MultiStep | null = null
    for (let f = 1; f < 60; f += 1) {
      last = m.step(frame(f, [mid]))
      if (last.kind === 'lost') break
      expect(last.kind).toBe('track')
    }
    expect(last).toEqual({ kind: 'lost', target: 1, reason: 'occluded' })
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

/** Результат прогона двух целей: вопросы, подмены (уверенная рамка ближе к чужому игроку), остановка. */
interface TwoRun {
  asks: number
  swaps: number
  coastFrames: number
  lost: MultiStep | null
}

function runTwo(
  xs: [(f: number) => number, (f: number) => number],
  ys: [number, number],
  looks: [Float32Array, Float32Array],
  opts: { merge?: boolean; frames?: number } = {}
): TwoRun {
  const mk = (f: number): Detection[] => [
    det(xs[0](f), ys[0], looks[0]),
    det(xs[1](f), ys[1], looks[1])
  ]
  const m = new MultiTracker(
    mk(0).map((d) => ({ det: d })),
    FPS,
    FRAME
  )
  const out: TwoRun = { asks: 0, swaps: 0, coastFrames: 0, lost: null }
  for (let f = 1; f < (opts.frames ?? 120); f += 1) {
    const px = [xs[0](f), xs[1](f)]
    let dets = mk(f)
    // детектор отдаёт одну общую рамку, когда игроки почти совпали
    if (opts.merge && Math.abs(px[0] - px[1]) < 20) {
      dets = [det((px[0] + px[1]) / 2, (ys[0] + ys[1]) / 2, looks[0])]
    }
    let r: MultiStep = m.step(frame(f, dets))
    while (r.kind === 'ask') {
      out.asks += 1
      const want = px[r.target]
      // Отвечаем верно: рамка, ближайшая к настоящему положению цели.
      const pick = r.candidates.reduce((a, b) =>
        Math.abs(cx(a.box) - want) < Math.abs(cx(b.box) - want) ? a : b
      )
      r = m.resolve(r.target, pick)
    }
    if (r.kind === 'lost') {
      out.lost = r
      break
    }
    const res = r
    res.boxes.forEach((b, i) => {
      if (res.coasting[i]) {
        out.coastFrames += 1
        return
      }
      const own = Math.abs(cx(b) - px[i])
      const other = Math.abs(cx(b) - px[1 - i])
      if (other + 1 < own) out.swaps += 1
    })
  }
  return out
}

describe('MultiTracker: отскок, близкий проход, скорость (правки ревью)', () => {
  const M = 40
  const bounce = (v: number): [(f: number) => number, (f: number) => number] => [
    (f) => 200 + v * Math.min(f, M) - v * Math.max(0, f - M),
    (f) => 200 + 2 * v * M - v * Math.min(f, M) + v * Math.max(0, f - M)
  ]
  const pass = (v: number): [(f: number) => number, (f: number) => number] => [
    (f) => 200 + v * f,
    (f) => 200 + 2 * v * M - v * f
  ]

  for (const merge of [false, true]) {
    for (const v of [3, 5, 8]) {
      for (const dy of [0, 10, 30]) {
        it(`одинаковые майки, отскок v=${v} dy=${dy} merge=${merge}: молчаливого обмена нет`, () => {
          const r = runTwo(bounce(v), [270, 270 + dy], [RED, RED], { merge })
          expect(r.swaps).toBe(0)
          // при совпадении боксов (dy=0) дольше секунды допустима остановка, но не обмен
          if (dy > 0) expect(r.lost).toBeNull()
        })
      }
    }
  }

  it('одна цель остановилась и вернулась, вторая прошла насквозь: обмена нет', () => {
    for (const v of [3, 5]) {
      for (const dy of [0, 10]) {
        const a = (f: number): number => 200 + v * Math.min(f, M) - v * Math.max(0, f - M - 5)
        const b = (f: number): number => 200 + 2 * v * M - v * f
        const r = runTwo([a, b], [270, 270 + dy], [RED, RED])
        expect(r.swaps).toBe(0)
        // неоднозначность не скрывается: либо вопрос, либо безопасная остановка (перекрытие дольше секунды)
        expect(r.asks + (r.lost ? 1 : 0)).toBeGreaterThan(0)
      }
    }
  })

  for (const v of [2, 5]) {
    for (const dy of [10, 30, 45]) {
      it(`одинаковые майки, проход насквозь v=${v} dy=${dy}: без остановки и обмена, вопросов не больше двух (dy=45: ни одного)`, () => {
        const r = runTwo(pass(v), [270, 270 + dy], [RED, RED])
        expect(r.asks).toBeLessThanOrEqual(dy >= 45 ? 0 : 2)
        expect(r.lost).toBeNull()
        expect(r.swaps).toBe(0)
      })
    }
  }

  for (const lk of ['RED', 'BLUE']) {
    for (const v of [2, 5]) {
      it(`близкий проход (dx около 20, dy=10) ${lk} v=${v}: без остановки; разные майки без вопросов`, () => {
        const r = runTwo(pass(v), [270, 280], [RED, lk === 'RED' ? RED : BLUE])
        expect(r.asks).toBeLessThanOrEqual(lk === 'RED' ? 2 : 0)
        expect(r.lost).toBeNull()
        expect(r.swaps).toBe(0)
      })
    }
  }

  it('разные рамки с IoU 0,29 (dx=20, dy=10) не считаются одним человеком', () => {
    const m = new MultiTracker(
      [{ det: det(200, 270, RED) }, { det: det(260, 280, BLUE) }],
      FPS,
      FRAME
    )
    const r = m.step(frame(1, [det(210, 270, RED), det(230, 280, BLUE)]))
    expect(r.kind).toBe('track')
  })

  it('товарищ полностью закрыл цель одной общей рамкой: цель ждёт, а не останавливает связку', () => {
    // Цель 1 (синяя) на 3 кадра скрыта за целью 0 (красной): детектор видит одну рамку.
    const a = det(200, 270, RED)
    const m = new MultiTracker([{ det: a }, { det: det(235, 270, BLUE) }], FPS, FRAME)
    let sawCoast = false
    for (let f = 1; f < 40; f += 1) {
      const hidden = f >= 10 && f < 13
      const dets = hidden ? [det(200, 270, RED)] : [det(200, 270, RED), det(235, 270, BLUE)]
      const r = m.step(frame(f, dets))
      expect(r.kind).toBe('track')
      if (r.kind !== 'track') return
      if (r.coasting[1]) sawCoast = true
      if (f >= 20) expect(r.coasting).toEqual([false, false])
    }
    expect(sawCoast).toBe(true)
  })

  it('спорная рамка не портит примету: после «ждёт» примета цели прежняя', () => {
    const near = lookMix(RED, BLUE, 0.15)
    const m = new MultiTracker(
      [{ det: det(200, 270, RED) }, { det: det(250, 270, RED) }],
      FPS,
      FRAME
    )
    const before = Float32Array.from(m.lookOf(1))
    // только общая рамка с чуть иной приметой: вторая цель её не берёт
    const r = m.step(frame(1, [det(225, 270, near)]))
    expect(r.kind).toBe('track')
    expect(Array.from(m.lookOf(1))).toEqual(Array.from(before))
  })
})

/** Ход одиночного трекера и MultiTracker с одной целью в одной строке (для сравнения). */
function stepKey(r: StepResult | MultiStep): string {
  const box = (b: Box): string => `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.w.toFixed(2)}`
  if (r.kind === 'lost') return `lost:${r.reason}`
  if (r.kind === 'ask') return `ask:${r.candidates.map((c) => box(c.box)).join('|')}`
  if ('boxes' in r) return `track:${r.coasting[0] ? 'c' : ''}${box(r.boxes[0])}`
  return `track:${r.coasting ? 'c' : ''}${box(r.box)}`
}

/**
 * Одна цель: MultiTracker ведёт себя ровно как SingleTracker (решения, вопросы с теми же вариантами, рамки), пока рядом
 * (не дальше CHAIN_NEIGHBOUR_DIST высот) нет другого игрока той же формы. С таким соседом слой нескольких целей
 * намеренно строже (чужой игрок той же формы не подменяет пропавшего) — сравнение заканчивается.
 */
function parity(
  start: Detection,
  detsAt: (f: number) => Detection[],
  frames: number
): { asks: number; steps: number } {
  let last = start.box
  const kinNear = (dets: Detection[]): boolean =>
    dets.filter(
      (d) =>
        d.look === start.look &&
        Math.hypot(cx(d.box) - cx(last), cy(d.box) - cy(last)) <= CHAIN_NEIGHBOUR_DIST * BH
    ).length > 1
  const s = new SingleTracker(start, FPS, { frame: FRAME })
  const m = new MultiTracker([{ det: start }], FPS, FRAME)
  let asks = 0
  let steps = 0
  for (let f = 1; f < frames; f += 1) {
    const fi = frame(f, detsAt(f))
    if (kinNear(fi.detections)) break
    const a = s.step(fi)
    const b = m.step(fi)
    steps += 1
    expect(stepKey(b), `кадр ${f}`).toBe(stepKey(a))
    if (a.kind === 'ask') {
      asks += 1
      s.resolve(a.candidates[0])
      expect(stepKey(m.resolve(0, (b as { candidates: Detection[] }).candidates[0]))).toMatch(
        /^track:/
      )
    }
    if (a.kind === 'lost') break
    if (a.kind === 'track') last = a.box
  }
  return { asks, steps }
}

// «Сомнительная» примета: не та же форма (дальше CHAIN_SIMILAR_LOOK), но и не явно чужая — трекер из-за неё спрашивает.
const NEAR_RED = lookMix(RED, BLUE, 0.95)

describe('MultiTracker с одной целью = SingleTracker (без соседей той же формы)', () => {
  it('скрылся и вернулся (иногда далеко от прогноза) среди игроков другой и почти такой же формы (40 вариантов)', () => {
    let asks = 0
    for (let sc = 0; sc < 40; sc += 1) {
      const r = parity(
        det(200, 270, RED),
        (f) => {
          const x = 200 + 3 * f
          if (f < 20) return [det(x, 270, RED), det(x + 150, 270, BLUE)]
          if (f < 20 + (sc % 30)) return [det(x + 150, 270, BLUE), det(x - 40 - sc, 300, BLUE)]
          return [
            det(x + (sc % 2) * 100, 270, RED),
            det(x + 40, 280, NEAR_RED),
            det(x - 60, 270, BLUE),
            det(x + 200, 260, BLUE),
            det(x - 400, 270, RED)
          ]
        },
        80
      )
      asks += r.asks
    }
    // сценарий действительно доходит до вопросов
    expect(asks).toBeGreaterThan(0)
  })

  it('проход мимо игрока такой же формы (до сближения), сосед другой формы вплотную, пропуски рамок', () => {
    const rnd = ((): (() => number) => {
      let a = 12345
      return () => {
        a = (a * 1103515245 + 12345) & 0x7fffffff
        return a / 0x7fffffff
      }
    })()
    const drops = Array.from({ length: 120 }, () => rnd() < 0.15)
    parity(
      det(200, 270, RED),
      (f) => {
        const out = [det(440 - 3 * f, 280, RED), det(200 + 3 * f + 25, 265, BLUE)]
        if (!drops[f]) out.push(det(200 + 3 * f, 270, RED))
        return out
      },
      120
    )
    parity(
      det(200, 270, RED),
      (f) => [det(200 + 3 * f, 270, RED), det(200 + 3 * Math.min(f, 40) + 30, 275, BLUE)],
      90
    )
  })
})

describe('MultiTracker: варианты вопроса', () => {
  it('в эпизоде одинаковой формы игроки другой формы в вопрос не добавляются; вариантов не больше пяти', () => {
    const M = 40
    const xa = (f: number): number => 300 + 3 * Math.min(f, M) - 3 * Math.max(0, f - M)
    const xb = (f: number): number => 540 - 3 * Math.min(f, M) + 3 * Math.max(0, f - M)
    const m = new MultiTracker(
      [{ det: det(xa(0), 270, RED) }, { det: det(xb(0), 280, RED) }],
      FPS,
      FRAME
    )
    let asks = 0
    for (let f = 1; f < 100; f += 1) {
      const dets = [
        det(xa(f), 270, RED),
        det(xb(f), 280, RED),
        det(420, 200, BLUE),
        det(380, 350, BLUE),
        det(460, 350, BLUE)
      ]
      let r = m.step(frame(f, dets))
      while (r.kind === 'ask') {
        asks += 1
        expect(r.candidates.length).toBeLessThanOrEqual(5)
        expect(r.candidates.every((c) => c.look === RED)).toBe(true)
        const want = r.target === 0 ? xa(f) : xb(f)
        r = m.resolve(
          r.target,
          r.candidates.reduce((a, b) =>
            Math.abs(cx(a.box) - want) < Math.abs(cx(b.box) - want) ? a : b
          )
        )
      }
      expect(r.kind).toBe('track')
    }
    expect(asks).toBeGreaterThan(0)
  })
})

describe('одна цель и чужой игрок той же формы (одиночное кольцо)', () => {
  it('детектор теряет свою рамку у прохода рядом с чужим: кольцо не переходит на чужого, вопросы — с настоящим игроком', () => {
    // Цель идёт вправо, чужой той же формы — навстречу (dy=10); у сближения своя рамка пропадает через кадр.
    const own = (f: number): number => 200 + 4 * f
    const other = (f: number): number => 520 - 4 * f
    for (const lost of [
      [34, 36, 38, 40, 42, 44],
      [37, 38, 41, 43, 44, 47],
      [30, 31, 32, 45, 46, 48]
    ]) {
      const m = new MultiTracker([{ det: det(own(0), 270, RED) }], FPS, FRAME)
      for (let f = 1; f < 90; f += 1) {
        const mine = det(own(f), 270, RED)
        const dets = [det(other(f), 280, RED), ...(lost.includes(f) ? [] : [mine])]
        let r = m.step(frame(f, dets))
        while (r.kind === 'ask') {
          const pick = r.candidates.find((c) => c === mine)
          expect(pick, `кадр ${f}: в вопросе есть настоящий игрок`).toBeDefined()
          r = m.resolve(0, pick as Detection)
        }
        if (r.kind === 'lost') break
        if (r.coasting[0]) continue
        const x = cx(r.boxes[0])
        // уверенная рамка — у своего игрока, а не у чужого (если они не вплотную)
        if (Math.abs(own(f) - other(f)) > 20) {
          expect(Math.abs(x - own(f)), `кадр ${f}`).toBeLessThan(Math.abs(x - other(f)))
        }
      }
    }
  })
})
