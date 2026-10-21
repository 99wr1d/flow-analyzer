import { describe, expect, it } from 'vitest'
import { lookOf } from './appearance'
import { frameHistOf } from './sceneCut'
import { pickStart, SingleTracker } from './tracker'
import type { Box, Detection, FrameInput, StepResult } from './types'

const FPS = 25
const FRAME = { w: 960, h: 540 }
const BW = 40
const BH = 90

/** Примета: однотонная майка сверху и однотонные трусы снизу, посчитанная настоящим lookOf. */
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
const WHITE_FRAME = frameHistOf(new Uint8Array(64 * 64 * 4).fill(235), 64, 64)
const DARK_FRAME = frameHistOf(new Uint8Array(64 * 64 * 4).fill(30), 64, 64)

const det = (cx: number, cy: number, lk: Float32Array, w = BW, h = BH): Detection => ({
  box: { x: cx - w / 2, y: cy - h / 2, w, h },
  score: 0.9,
  look: lk
})

const frame = (index: number, detections: Detection[], hist = WHITE_FRAME): FrameInput => ({
  index,
  t: (index + 0.5) / FPS,
  detections,
  frameHist: hist
})

const cx = (b: Box): number => b.x + b.w / 2
const cy = (b: Box): number => b.y + b.h / 2

/** Прогон: кадры строит gen(f); возвращает результаты по кадрам. */
function run(
  tracker: SingleTracker,
  from: number,
  to: number,
  gen: (f: number) => Detection[],
  hist: (f: number) => Float32Array = () => WHITE_FRAME
): StepResult[] {
  const out: StepResult[] = []
  for (let f = from; f < to; f += 1) out.push(tracker.step(frame(f, gen(f), hist(f))))
  return out
}

describe('SingleTracker', () => {
  it('прямой бег: ведёт все кадры, не уходит на соседа', () => {
    const a = (f: number): Detection => det(200 + f * 5, 270, RED)
    const other = (f: number): Detection => det(200 + f * 5, 400, BLUE)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    const res = run(tr, 1, 60, (f) => [other(f), a(f)])
    for (let i = 0; i < res.length; i += 1) {
      const r = res[i]
      expect(r.kind).toBe('track')
      if (r.kind !== 'track') continue
      expect(r.coasting).toBe(false)
      expect(Math.abs(cy(r.box) - 270)).toBeLessThan(1)
    }
  })

  it('пересечение с игроком другого цвета на 12 кадров: после расхождения ведёт своего', () => {
    // Сходятся 36 кадров, 12 кадров рамки перекрыты, затем расходятся. Скорость ±1.7 пикс/кадр.
    const v = 1.7
    const a = (f: number): Detection => det(100 + v * f, 270, RED)
    const b = (f: number): Detection => det(100 + 2 * v * 36 - v * f, 270, BLUE)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    const res = run(tr, 1, 90, (f) => [a(f), b(f)])
    let sawCoast = false
    res.forEach((r, i) => {
      const f = i + 1
      expect(r.kind).toBe('track')
      if (r.kind !== 'track') return
      if (r.coasting) sawCoast = true
      // ни разу не перескакиваем к синему: центр всегда ближе к своему, чем к чужому
      expect(Math.abs(cx(r.box) - cx(a(f).box))).toBeLessThan(25)
    })
    expect(sawCoast).toBe(true)
    const last = res[res.length - 1]
    if (last.kind === 'track') {
      expect(last.coasting).toBe(false)
      expect(Math.abs(cx(last.box) - cx(a(89).box))).toBeLessThan(2)
    }
  })

  it('пересечение с игроком того же цвета, расходятся в разные стороны: ведёт своего по прогнозу', () => {
    const v = 3
    const a = (f: number): Detection => det(100 + v * f, 270, RED)
    const b = (f: number): Detection => det(100 + 2 * v * 30 - v * f, 270, RED)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    const res = run(tr, 1, 70, (f) => [a(f), b(f)])
    // Одинокого кандидата при грязной примете молча не берём (это мог быть сосед): ждём, затем спрашиваем.
    // Главное — ни одного кадра на чужом игроке.
    res.forEach((r, i) => {
      if (r.kind === 'track') expect(Math.abs(cx(r.box) - cx(a(i + 1).box))).toBeLessThan(26)
      else expect(r.kind).toBe('ask')
    })
    const last = res[res.length - 1]
    if (last.kind === 'track') expect(last.coasting).toBe(false)
  })

  it('тот же цвет, расходятся симметрично от прогноза: ask; resolve продолжает со своего', () => {
    const a0 = (f: number): Detection => det(100 + 3 * f, 270, RED)
    const mine = (f: number): Detection => det(100 + 3 * f, 270 + 50, RED)
    const other = (f: number): Detection => det(100 + 3 * f, 270 - 50, RED)
    const tr = new SingleTracker(a0(0), FPS, { frame: FRAME })
    const gen = (f: number): Detection[] => {
      if (f < 30) return [a0(f)]
      if (f < 42) return [a0(f), a0(f)] // игроки стоят друг на друге
      return [mine(f), other(f)]
    }
    const res = run(tr, 1, 100, gen)
    const askIdx = res.findIndex((r) => r.kind === 'ask')
    expect(askIdx).toBeGreaterThan(40)
    res.slice(0, askIdx).forEach((r) => expect(r.kind).toBe('track'))
    const ask = res[askIdx]
    expect(ask.kind).toBe('ask')
    if (ask.kind !== 'ask') return
    expect(ask.candidates).toHaveLength(2)
    const f = askIdx + 1
    tr.resolve(mine(f))
    const next = tr.step(frame(f + 1, [mine(f + 1), other(f + 1)]))
    expect(next.kind).toBe('track')
    if (next.kind === 'track') expect(Math.abs(cy(next.box) - 320)).toBeLessThan(5)
  })

  it('слияние двух рамок в одну широкую на 4 кадра: без перескока', () => {
    const a = (f: number): Detection => det(300 + 3 * f, 270, RED)
    const b = (f: number): Detection => det(300 + 3 * f + 60, 270, BLUE)
    const merged = (f: number): Detection => det(300 + 3 * f + 30, 270, RED, 100)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    const res = run(tr, 1, 60, (f) => (f >= 30 && f < 34 ? [merged(f)] : [a(f), b(f)]))
    res.forEach((r, i) => {
      expect(r.kind).toBe('track')
      if (r.kind === 'track') expect(Math.abs(cx(r.box) - cx(a(i + 1).box))).toBeLessThan(15)
    })
    expect(res.slice(29, 33).every((r) => r.kind === 'track' && r.coasting)).toBe(true)
  })

  it('смена плана: lost(cut)', () => {
    const a = (f: number): Detection => det(200 + f * 3, 270, RED)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    const res = run(
      tr,
      1,
      30,
      (f) => [a(f)],
      (f) => (f < 20 ? WHITE_FRAME : DARK_FRAME)
    )
    expect(res[18].kind).toBe('track')
    expect(res[19]).toEqual({ kind: 'lost', reason: 'cut' })
    expect(tr.step(frame(30, [a(30)]))).toEqual({ kind: 'lost', reason: 'cut' })
  })

  it('уход за край: lost(out)', () => {
    const a = (f: number): Detection => det(700 + f * 10, 270, RED)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    // рамка видна, пока центр левее 940
    const res = run(tr, 1, 40, (f) => (a(f).box.x + BW / 2 < 940 ? [a(f)] : []))
    const lost = res.find((r) => r.kind === 'lost')
    expect(lost).toEqual({ kind: 'lost', reason: 'out' })
  })

  it('пропадание на 30 кадров посреди поля: lost(occluded) через секунду', () => {
    const a = (f: number): Detection => det(200 + f * 2, 270, RED)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    const res = run(tr, 1, 70, (f) => (f < 20 || f >= 50 ? [a(f)] : []))
    const idx = res.findIndex((r) => r.kind === 'lost')
    expect(res[idx]).toEqual({ kind: 'lost', reason: 'occluded' })
    expect(idx + 1).toBe(19 + FPS) // последний виденный кадр 19, потеряно на 25-м пропущенном
    expect(res.slice(19, idx).every((r) => r.kind === 'track' && r.coasting)).toBe(true)
  })

  it('«грязный» старт: не уводит на чужого, одинокого кандидата не берём молча', () => {
    const v = 1.7
    const a = (f: number): Detection => det(100 + v * f, 270, RED)
    const b = (f: number): Detection => det(100 + 2 * v * 36 - v * f, 270, BLUE)
    // старт взят с примесью синего
    const dirty = { ...a(0), look: BLUE }
    const tr = new SingleTracker(dirty, FPS, { frame: FRAME, dirtyStart: true })
    const res = run(tr, 1, 90, (f) => [a(f), b(f)])
    res.forEach((r, i) => {
      // одинокого кандидата при грязной примете молча не берём (мог быть сосед): ждём, затем вопрос
      if (r.kind === 'track' && !r.coasting)
        expect(Math.abs(cx(r.box) - cx(a(i + 1).box))).toBeLessThan(25)
      else expect(['track', 'ask', 'lost']).toContain(r.kind)
    })
  })
})

describe('pickStart', () => {
  const R = RED
  it('одна рамка под якорем: ok', () => {
    const d = det(300, 270, R)
    const other = det(600, 270, BLUE)
    const r = pickStart([other, d], { x: 302, y: 310 })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.det).toBe(d)
  })

  it('якорь между двумя перекрытыми игроками: ambiguous', () => {
    const a = det(300, 270, R)
    const b = det(320, 270, BLUE)
    const r = pickStart([a, b], { x: 310, y: 300 })
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.candidates).toHaveLength(2)
  })

  it('якорь в своей рамке, но рамка перекрыта соседом: ambiguous', () => {
    const a = det(300, 270, R)
    const b = det(325, 270, BLUE) // IoU > 0.1, якорь только в рамке a
    const r = pickStart([a, b], { x: 290, y: 300 })
    expect(r.kind).toBe('ambiguous')
  })

  it('рядом нет рамок: none', () => {
    const r = pickStart([det(600, 270, R)], { x: 100, y: 100 })
    expect(r).toEqual({ kind: 'none' })
    expect(pickStart([], { x: 1, y: 1 })).toEqual({ kind: 'none' })
  })
})

describe('SingleTracker: защита от молчаливого перескока', () => {
  const lookOfTone = (c: [number, number, number]): Float32Array => look(c, [255, 255, 255])

  it('наш игрок пропал, рядом стоит игрок другой формы (обычная ветка): ждём и lost(occluded), на чужого не уходим', () => {
    const a = (f: number): Detection => det(200 + f * 2, 270, RED)
    const other = (f: number): Detection => det(200 + f * 2, 320, BLUE)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    const res = run(tr, 1, 70, (f) => (f < 20 ? [a(f), other(f)] : [other(f)]))
    res.slice(0, 19).forEach((r) => expect(r.kind === 'track' && !r.coasting).toBe(true))
    const lostIdx = res.findIndex((r) => r.kind === 'lost')
    expect(res[lostIdx]).toEqual({ kind: 'lost', reason: 'occluded' })
    res.slice(19, lostIdx).forEach((r) => expect(r.kind === 'track' && r.coasting).toBe(true))
  })

  it('наш игрок пропал, потом появляется один игрок другой формы (выход из пережидания): не берём', () => {
    const a = (f: number): Detection => det(200 + f * 2, 270, RED)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    const res = run(tr, 1, 70, (f) => {
      if (f < 20) return [a(f)]
      return f >= 25 ? [det(200 + f * 2, 320, BLUE)] : []
    })
    res.forEach((r, i) => {
      if (r.kind === 'track' && i >= 19) expect(r.coasting).toBe(true)
    })
    expect(res.some((r) => r.kind === 'lost' && r.reason === 'occluded')).toBe(true)
  })

  it('два почти равных кандидата одной формы при обычном ведении: не выбираем молча', () => {
    const a = (f: number): Detection => det(200 + f * 2, 270, RED)
    // два одинаковых игрока симметрично по 50 пикселей выше и ниже прогноза: цены равны
    const up = (f: number): Detection => det(200 + f * 2, 270 - 50, RED)
    const down = (f: number): Detection => det(200 + f * 2, 270 + 50, RED)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME })
    run(tr, 1, 20, (f) => [a(f)])
    const res = run(tr, 20, 24, (f) => [up(f), down(f)])
    expect(res.every((r) => r.kind === 'track' && r.coasting)).toBe(true)
  })

  it('грязный старт, сосед остаётся рядом: ask, а не молчаливый захват', () => {
    const a = (f: number): Detection => det(300 + 2 * f, 270, RED)
    const b = (f: number): Detection => det(300 + 2 * f + 30, 270, RED)
    const tr = new SingleTracker(a(0), FPS, { frame: FRAME, dirtyStart: true })
    const res = run(tr, 1, 40, (f) => [a(f), b(f)])
    // пока оба рядом, ни один кадр не принят как уверенный
    expect(res.every((r) => !(r.kind === 'track' && !r.coasting))).toBe(true)
    const ask = res.find((r) => r.kind === 'ask')
    expect(ask).toBeDefined()
  })

  it('resolve: выбранный игрок идёт не туда, куда вёл прогноз, — трекер остаётся с ним', () => {
    const a0 = (f: number): Detection => det(100 + 3 * f, 270, RED)
    const mine = (f: number): Detection => det(100 + 3 * f, 320, RED)
    const other = (f: number): Detection => det(100 + 3 * f, 220, RED)
    const tr = new SingleTracker(a0(0), FPS, { frame: FRAME })
    const gen = (f: number): Detection[] => {
      if (f < 30) return [a0(f)]
      if (f < 42) return [a0(f), a0(f)]
      return [mine(f), other(f)]
    }
    const res = run(tr, 1, 100, gen)
    const idx = res.findIndex((r) => r.kind === 'ask')
    expect(idx).toBeGreaterThan(0)
    let f = idx + 1
    // игрок выбран и резко разворачивается назад и вниз
    let x = mine(f).box.x + BW / 2
    let y = 320
    tr.resolve(det(x, y, RED))
    for (let k = 0; k < 15; k += 1) {
      f += 1
      x -= 3
      y += 2
      const r = tr.step(frame(f, [det(x, y, RED), det(x + 200, 220, RED)]))
      expect(r.kind).toBe('track')
      if (r.kind === 'track') {
        expect(r.coasting).toBe(false)
        expect(Math.abs(cx(r.box) - x)).toBeLessThan(2)
      }
    }
  })

  it('ask показывает не больше трёх кандидатов', () => {
    const a0 = (f: number): Detection => det(100 + 3 * f, 270, RED)
    const tr = new SingleTracker(a0(0), FPS, { frame: FRAME })
    const around = (f: number): Detection[] =>
      [-60, 0, 60, 120].map((dy) => det(100 + 3 * f, 270 + dy + (dy === 0 ? 55 : 0), RED))
    const res = run(tr, 1, 100, (f) => (f < 30 ? [a0(f)] : f < 40 ? [a0(f), a0(f)] : around(f)))
    const ask = res.find((r) => r.kind === 'ask')
    if (ask && ask.kind === 'ask') expect(ask.candidates.length).toBeLessThanOrEqual(3)
    expect(lookOfTone([1, 2, 3])).toHaveLength(96)
  })
})

describe('SingleTracker: выход из пережидания (реальное видео, Task 7)', () => {
  it('наш игрок пропал, одиночный игрок той же формы появился далеко (> 1 роста от прогноза): молча не берём, по истечении срока вопрос', () => {
    const a = (): Detection => det(200, 270, RED)
    const tr = new SingleTracker(a(), FPS, { frame: FRAME })
    // с кадра 10 игрока нет; с кадра 14 в 2 ростах выше стоит такой же красный
    const res = run(tr, 1, 60, (f) =>
      f < 10 ? [a()] : f >= 14 ? [det(200, 270 - 2 * BH, RED)] : []
    )
    const ask = res.findIndex((r) => r.kind === 'ask')
    expect(ask).toBeGreaterThan(0)
    // до вопроса — только пережидание по прогнозу, на далёкого не уходили
    res.slice(9, ask).forEach((r) => {
      expect(r.kind === 'track' && r.coasting).toBe(true)
      if (r.kind === 'track') expect(Math.abs(cy(r.box) - 270)).toBeLessThan(BH)
    })
  })

  it('чистый кандидат хуже, чем перекрытая рамка у прогноза: ждём, пока она освободится, а не берём сидящего рядом', () => {
    const own = (): Detection => det(300, 270, RED)
    const tr = new SingleTracker(own(), FPS, { frame: FRAME })
    // кадры 5–7: наш игрок слит с рамкой чужого соседа (перекрыт), одновременно в 0.6 роста правее стоит одноформенный
    const mate = det(300 + BW * 1.5, 270, RED)
    const res = run(tr, 1, 12, (f) => {
      if (f < 5) return [own()]
      if (f < 8) return [det(300, 270, RED), det(310, 270, BLUE), mate]
      return [own()]
    })
    res.forEach((r) => {
      expect(r.kind).toBe('track')
      if (r.kind === 'track') expect(Math.abs(cx(r.box) - 300)).toBeLessThan(BW)
    })
  })
})

describe('SingleTracker: сомнительная рамка у прогноза (проверка ревью)', () => {
  it('сомнительная рамка у прогноза и ≥3 чистых одноформенных поодаль: пережидание, затем вопрос, сомнительная рамка в списке (первой)', () => {
    // примета чуть хуже порога (0,375): майка другого оттенка и тёмные трусы вместо белых
    const doubtLook = look([220, 120, 30], [20, 20, 20])
    const own = det(300, 270, RED)
    const tr = new SingleTracker(own, FPS, { frame: FRAME })
    const doubtful = det(300, 270, doubtLook)
    const around = [det(375, 270, RED), det(225, 270, RED), det(300, 351, RED), det(300, 189, RED)]
    const res = run(tr, 1, 60, (f) => (f < 5 ? [det(300, 270, RED)] : [doubtful, ...around]))
    const ask = res.findIndex((r) => r.kind === 'ask')
    expect(ask).toBeGreaterThan(5)
    // до вопроса — только пережидание, молча никого из чистых не берём
    res.slice(4, ask).forEach((r) => {
      expect(r.kind === 'track' && r.coasting).toBe(true)
    })
    const r = res[ask]
    if (r.kind !== 'ask') throw new Error('ожидался вопрос')
    expect(r.candidates.length).toBeLessThanOrEqual(3)
    expect(r.candidates).toContain(doubtful)
    expect(r.candidates[0]).toBe(doubtful)
  })
})

describe('SingleTracker: не перепрыгивать на другого (итоговый разбор ветки)', () => {
  const confident = (r: StepResult): boolean => r.kind === 'track' && !r.coasting

  it('грязный старт: наш игрок пропал, рядом один сосед другой формы — молча не берём, затем вопрос', () => {
    const ours = det(300, 270, RED)
    const neighbour = (): Detection => det(330, 270, BLUE)
    const tr = new SingleTracker(ours, FPS, { frame: FRAME, dirtyStart: true })
    const res = run(tr, 1, 30, () => [neighbour()])
    expect(res.some(confident)).toBe(false)
    // пока ждём, рамка стоит на прогнозе нашего игрока, а не на соседе
    const coasting = res.filter((r) => r.kind === 'track')
    expect(coasting.length).toBeGreaterThan(10)
    for (const r of coasting)
      if (r.kind === 'track') expect(Math.abs(cx(r.box) - 300)).toBeLessThan(5)
    // по истечении срока — вопрос, а не молчаливый захват
    expect(res.some((r) => r.kind === 'ask')).toBe(true)
  })

  it('грязный старт: наш игрок вернулся рядом с соседом — не уходит на соседа', () => {
    const tr = new SingleTracker(det(300, 270, RED), FPS, { frame: FRAME, dirtyStart: true })
    const alone = run(tr, 1, 8, () => [det(330, 270, BLUE)])
    const back = run(tr, 8, 20, () => [det(300, 270, RED), det(380, 270, BLUE)])
    for (const r of [...alone, ...back]) {
      if (r.kind === 'track') expect(Math.abs(cx(r.box) - 330)).toBeGreaterThan(20)
    }
  })

  it('resolve по рамке с примесью соседа не снимает «грязность»', () => {
    // примета старта испорчена соседом (синее на красном игроке)
    const a = { ...det(300, 270, RED), look: BLUE }
    const b = det(310, 270, BLUE)
    const tr = new SingleTracker(a, FPS, { frame: FRAME, dirtyStart: true })
    tr.step(frame(1, [a, b]))
    tr.resolve(a) // a перекрыта b: рамка нечистая, примету не берём
    const res = run(tr, 2, 10, () => [det(310, 270, BLUE)])
    expect(res.some(confident)).toBe(false)
  })

  it('своя примета ушла в сомнительную зону, рядом чистый напарник в той же форме — молча не берём', () => {
    const tr = new SingleTracker(det(300, 270, RED), FPS, { frame: FRAME })
    run(tr, 1, 6, () => [det(300, 270, RED), det(500, 270, RED)])
    const shaded = look([150, 40, 40], [180, 180, 180])
    // напарник в 0,45 роста от прогноза
    const res = run(tr, 6, 12, () => [det(300, 270, shaded), det(300 + 0.45 * BH, 270, RED)])
    for (const r of res) {
      if (r.kind === 'track') expect(r.coasting && Math.abs(cx(r.box) - 300) < 6).toBe(true)
    }
    expect(res.some((r) => r.kind === 'track' && !r.coasting)).toBe(false)
  })
})
