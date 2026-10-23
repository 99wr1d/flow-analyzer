// Состязательные сценарии многоцелевого слежения: шум рамок, пропуски (окном и случайные), слияния, три игрока одной
// формы, две пары одновременно, линия обороны из четырёх, ошибочный ответ пользователя.
// Детерминировано (сиды). Инвариант: ни одной молчаливой подмены (уверенная рамка чужого игрока при расстоянии между
// игроками больше SEP), в каждом вопросе есть настоящий игрок цели (иначе — стоп, а не вопрос), ответ из списка вопроса
// всегда принимается (исключение при resolve — провал). Вопросы и безопасные остановки допустимы.
import { describe, expect, it } from 'vitest'
import { lookOf } from './appearance'
import { MultiTracker, type MultiStep } from './multi'
import { frameHistOf } from './sceneCut'
import type { Detection } from './types'

const FPS = 25,
  FRAME = { w: 960, h: 540 },
  BW = 40,
  BH = 90
function look(top: number[], bottom: number[]): Float32Array {
  const px = new Uint8Array(BW * BH * 4)
  for (let y = 0; y < BH; y++) {
    const c = y < BH / 2 ? top : bottom
    for (let x = 0; x < BW; x++) px.set([c[0], c[1], c[2], 255], (y * BW + x) * 4)
  }
  return lookOf(px, BW, BH, { x: 0, y: 0, w: BW, h: BH })
}
const RED = look([220, 30, 30], [255, 255, 255])
const WF = frameHistOf(new Uint8Array(64 * 64 * 4).fill(235), 64, 64)

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Fn = (f: number) => number
interface Player {
  x: Fn
  y: Fn
  target: boolean
}
interface Opts {
  J: number
  hj: number
  seed: number
  frames?: number
  /** Окно пропуска рамки одного игрока пары вокруг сближения. */
  drop?: { len: number; who: number }
  /** Окно слияния пары в одну рамку вокруг сближения. */
  merge?: { len: number }
  pair?: [number, number]
  /** Случайный пропуск каждой рамки с этой вероятностью. */
  dropP?: number
  /** 'wrong': один раз за прогон пользователь ошибается (выбирает игрока другой цели) и дальше считает так. */
  policy?: 'correct' | 'wrong'
}
interface Res {
  swaps: number
  firstSwap: number
  asks: number
  stop: string | null
  /** Вопрос без настоящего игрока среди вариантов (правильного ответа нет). */
  noTruth: number
  /** Ответ из списка вопроса отвергнут (исключение). */
  throws: number
  /** Самый долгий step() за прогон, мс. */
  maxStepMs: number
  detail: string[]
}

const SEP = 20

function run(players: Player[], o: Opts): Res {
  const R = rng(o.seed)
  const U = (a: number): number => (R() * 2 - 1) * a
  const src = new Map<Detection, number[]>()
  const mk = (cx: number, cy: number, s: number[], noisy = true): Detection => {
    const h = BH * (1 + (noisy ? U(o.hj) : 0)),
      w = (BW * h) / BH
    const x = cx + (noisy ? U(o.J) : 0),
      y = cy + (noisy ? U(o.J) : 0)
    const d: Detection = { box: { x: x - w / 2, y: y - h / 2, w, h }, score: 0.9, look: RED }
    src.set(d, s)
    return d
  }
  const frames = o.frames ?? 110
  const pair = o.pair ?? [0, 1]
  // кадр наибольшего сближения пары (окна пропуска и слияния — вокруг него)
  let cf = 0,
    best = Infinity
  for (let f = 0; f < frames; f++) {
    const d = Math.hypot(
      players[pair[0]].x(f) - players[pair[1]].x(f),
      players[pair[0]].y(f) - players[pair[1]].y(f)
    )
    if (d < best) {
      best = d
      cf = f
    }
  }
  const tIdx = players.map((p, i) => (p.target ? i : -1)).filter((i) => i >= 0)
  // Кто чей игрок, по мнению пользователя (меняется только при ошибочном ответе).
  const own = [...tIdx]
  const m = new MultiTracker(
    tIdx.map((i) => ({ det: mk(players[i].x(0), players[i].y(0), [i], false) })),
    FPS,
    FRAME
  )
  const res: Res = {
    swaps: 0,
    firstSwap: -1,
    asks: 0,
    stop: null,
    noTruth: 0,
    throws: 0,
    maxStepMs: 0,
    detail: []
  }
  let wrongDone = false
  for (let f = 1; f < frames; f++) {
    let dets: Detection[] = []
    const inMerge =
      o.merge &&
      f >= cf - Math.floor(o.merge.len / 2) &&
      f < cf - Math.floor(o.merge.len / 2) + o.merge.len
    const inDrop =
      o.drop &&
      f >= cf - Math.floor(o.drop.len / 2) &&
      f < cf - Math.floor(o.drop.len / 2) + o.drop.len
    players.forEach((p, i) => {
      if (inMerge && pair.includes(i)) return
      if (inDrop && i === pair[o.drop!.who]) return
      if (o.dropP && R() < o.dropP) return
      dets.push(mk(p.x(f), p.y(f), [i]))
    })
    if (inMerge) {
      const a = players[pair[0]],
        b = players[pair[1]]
      const x0 = Math.min(a.x(f), b.x(f)) - BW / 2,
        x1 = Math.max(a.x(f), b.x(f)) + BW / 2
      const y0 = Math.min(a.y(f), b.y(f)) - BH / 2,
        y1 = Math.max(a.y(f), b.y(f)) + BH / 2
      const d: Detection = {
        box: { x: x0 + U(o.J), y: y0 + U(o.J), w: x1 - x0, h: y1 - y0 },
        score: 0.9,
        look: RED
      }
      src.set(d, [...pair])
      dets.push(d)
    }
    // порядок детекций произвольный
    dets = dets
      .map((d) => [R(), d] as const)
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1])
    const t0 = performance.now()
    let r: MultiStep = m.step({ index: f, t: (f + 0.5) / FPS, detections: dets, frameHist: WF })
    res.maxStepMs = Math.max(res.maxStepMs, performance.now() - t0)
    let guard = 0
    while (r.kind === 'ask') {
      res.asks++
      if (++guard > 20) {
        res.stop = `ask-loop@${f}`
        res.throws++
        res.detail.push(res.stop)
        break
      }
      const k = r.target
      const ownK = own[k]
      const exact = r.candidates.find((c) => {
        const s = src.get(c)
        return s && s.length === 1 && s[0] === ownK
      })
      const merged = r.candidates.find((c) => src.get(c)?.includes(ownK))
      if (!exact && !merged) {
        res.noTruth++
        res.detail.push(
          `f${f} t${k}: вопрос без настоящего игрока (варианты ${r.candidates.map((c) => src.get(c)?.join('+')).join(',')})`
        )
      }
      let pick = exact ?? merged
      if (o.policy === 'wrong' && !wrongDone) {
        // Пользователь ошибся: назвал игрока другой цели. Дальше он считает, что эти двое поменялись.
        const wrong = r.candidates.find((c) => {
          const s = src.get(c)
          return s && s.length === 1 && s[0] !== ownK && tIdx.includes(s[0])
        })
        if (wrong) {
          wrongDone = true
          const p = src.get(wrong)![0]
          const other = own.indexOf(p)
          if (other >= 0) own[other] = ownK
          own[k] = p
          pick = wrong
        }
      }
      if (!pick) {
        res.stop = `user-null@${f}`
        break
      }
      try {
        r = m.resolve(k, pick)
      } catch (e) {
        res.throws++
        res.stop = `resolve-throw@${f}`
        res.detail.push(`f${f} t${k}: ответ из списка отвергнут (${(e as Error).message})`)
        break
      }
    }
    if (res.stop) break
    if (r.kind === 'lost') {
      res.stop = `lost t${r.target} ${r.reason}@${f}`
      break
    }
    if (r.kind !== 'track') break
    const rr = r
    tIdx.forEach((_, k) => {
      if (rr.coasting[k]) return
      const b = rr.boxes[k]
      const d = dets.find(
        (x) => x.box.x === b.x && x.box.y === b.y && x.box.w === b.w && x.box.h === b.h
      )
      if (!d) return // копия рамки, подтверждённой пользователем
      const s = src.get(d)!
      if (s.includes(own[k])) return
      const sep = Math.min(
        ...s.map((p) =>
          Math.hypot(players[own[k]].x(f) - players[p].x(f), players[own[k]].y(f) - players[p].y(f))
        )
      )
      if (sep > SEP) {
        res.swaps++
        if (res.firstSwap < 0) res.firstSwap = f
      }
    })
  }
  return res
}

const M = 40
const pass = (v: number, dy: number, vb = v): Player[] => [
  { x: (f) => 200 + v * f, y: () => 270, target: true },
  { x: (f) => 200 + v * M + vb * M - vb * f, y: () => 270 + dy, target: true }
]
const bounce = (v: number, dy: number): Player[] => [
  { x: (f) => 200 + v * Math.min(f, M) - v * Math.max(0, f - M), y: () => 270, target: true },
  {
    x: (f) => 200 + 2 * v * M - v * Math.min(f, M) + v * Math.max(0, f - M),
    y: () => 270 + dy,
    target: true
  }
]
// диагональ: A идёт (+v, +0.5v), B (-0.4v, -v); встреча на кадре M
const diag = (v: number, dy: number, rev: boolean): Player[] => {
  const g = (f: number): number => (rev ? Math.min(f, M) - Math.max(0, f - M) : f) - M
  return [
    { x: (f) => 400 + v * g(f), y: (f) => 270 + 0.5 * v * g(f), target: true },
    { x: (f) => 400 - 0.4 * v * g(f), y: (f) => 270 + dy - v * g(f), target: true }
  ]
}
// A доходит до точки встречи и стоит; B проходит насквозь
const stopPass = (v: number, dy: number): Player[] => [
  { x: (f) => 200 + v * Math.min(f, M), y: () => 270, target: true },
  { x: (f) => 200 + 2 * v * M - v * f, y: () => 270 + dy, target: true }
]
// A стоит; B подходит, стоит рядом 15 кадров и уходит обратно
const standBounce = (v: number, dy: number): Player[] => [
  { x: () => 400, y: () => 270, target: true },
  {
    x: (f) => {
      const s = 400 + v * M
      if (f < M) return s - v * f
      if (f < M + 15) return 400
      return 400 + v * (f - M - 15)
    },
    y: () => 270 + dy,
    target: true
  }
]
// три игрока: A слева, B справа, C по диагонали сверху-слева; встреча около (400,270)
const three = (v: number, dys: number[], rev: boolean, cTarget = true): Player[] => {
  const g = (f: number): number => (rev ? Math.min(f, M) - Math.max(0, f - M) : f) - M
  return [
    { x: (f) => 400 + v * g(f), y: () => 270 + dys[0], target: true },
    { x: (f) => 400 - v * g(f), y: () => 270 + dys[1], target: true },
    { x: (f) => 400 + 0.3 * v * g(f), y: (f) => 270 + dys[2] + 0.8 * v * g(f), target: cTarget }
  ]
}
// две пары с отскоком одновременно (вопросы по нескольким целям в одном кадре)
const twoPairs = (v: number, dy: number): Player[] => [
  ...bounce(v, dy),
  ...bounce(v, dy).map((p) => ({ ...p, y: (f: number) => p.y(f) + 150 }))
]
// линия обороны: 4 игрока одной формы с шагом sp, общее движение и покачивание;
// swap12 — 1 и 2 меняются местами (f30..60), bounce12 — сходятся и расходятся, all — ещё и 0 пробегает вдоль линии.
const line = (
  sp: number,
  vx: number,
  shuffle: 'none' | 'swap12' | 'bounce12' | 'all',
  wob: number
): Player[] => {
  const base = (i: number) => (f: number) => 200 + sp * i + vx * f + wob * Math.sin(f / 7 + i * 1.3)
  const P: Player[] = [0, 1, 2, 3].map((i) => ({
    x: base(i),
    y: (f: number) => 270 + 0.5 * vx * Math.sin(f / 15) * 10 + (wob ? 3 * Math.sin(f / 5 + i) : 0),
    target: true
  }))
  const tt = (f: number): number => Math.min(1, Math.max(0, (f - 30) / 30))
  const bb = (f: number): number =>
    (f < 30 ? 0 : f < 45 ? (f - 30) / 15 : f < 60 ? (60 - f) / 15 : 0) * 0.8
  if (shuffle === 'swap12' || shuffle === 'all') {
    const b1 = base(1),
      b2 = base(2)
    P[1] = { ...P[1], x: (f) => b1(f) + sp * tt(f) }
    P[2] = {
      ...P[2],
      x: (f) => b2(f) - sp * tt(f),
      y: (f) => P[1].y(f) + 15 * Math.sin(Math.PI * tt(f))
    }
  }
  if (shuffle === 'bounce12') {
    const b1 = base(1),
      b2 = base(2)
    P[1] = { ...P[1], x: (f) => b1(f) + sp * bb(f) * 0.5 }
    P[2] = { ...P[2], x: (f) => b2(f) - sp * bb(f) * 0.5 }
  }
  if (shuffle === 'all') {
    const b0 = base(0),
      b3 = base(3)
    const t2 = (f: number): number => Math.min(1, Math.max(0, (f - 70) / 25))
    P[0] = {
      ...P[0],
      x: (f) => b0(f) + 3 * sp * t2(f),
      y: (f) => 270 + 25 * Math.sin(Math.PI * t2(f))
    }
    P[3] = { ...P[3], x: (f) => b3(f) - sp * t2(f) }
  }
  return P
}

interface Tally {
  runs: number
  swapRuns: number
  noTruth: number
  throws: number
  asks: number
  stops: number
  stopList: string[]
  detail: string[]
}
const TOTAL: Record<string, Tally> = {}

/** Прогон семейства по сидам seed = s·base (s = 1..seeds); итоги копятся в TOTAL. */
function family(
  group: string,
  name: string,
  mkP: () => Player[],
  base: Omit<Opts, 'seed'>,
  seeds: number,
  seedBase = 7919
): void {
  const t = (TOTAL[group] ??= {
    runs: 0,
    swapRuns: 0,
    noTruth: 0,
    throws: 0,
    asks: 0,
    stops: 0,
    stopList: [],
    detail: []
  })
  for (let s = 1; s <= seeds; s += 1) {
    const r = run(mkP(), { ...base, seed: s * seedBase })
    t.runs += 1
    t.asks += r.asks
    t.noTruth += r.noTruth
    t.throws += r.throws
    if (r.stop) {
      t.stops += 1
      t.stopList.push(`${name} s${s}: ${r.stop}`)
    }
    if (r.swaps > 0) {
      t.swapRuns += 1
      t.detail.push(`${name} s${s}: подмена с кадра ${r.firstSwap} (${r.swaps} кадров)`)
    }
    for (const d of r.detail) t.detail.push(`${name} s${s}: ${d}`)
  }
}

function check(group: string): void {
  const t = TOTAL[group]
  if (process.env.ADV_REPORT) {
    process.stderr.write(
      `ADV ${group}: runs ${t.runs} swapRuns ${t.swapRuns} noTruth ${t.noTruth} throws ${t.throws} asks ${t.asks} stops ${t.stops}\n`
    )
    if (process.env.ADV_REPORT === 'stops') {
      for (const x of t.stopList) process.stderr.write(`  stop ${x}\n`)
    }
  }
  expect(t.detail).toEqual([])
}

const jit = (J: number): Pick<Opts, 'J' | 'hj'> => ({ J, hj: J ? 0.05 : 0 })
/** Сиды семейств второго зонда ревью (s·104729): среди них — найденные провалы (s=1, 2, 3). */
const S2 = 104729

// плотный блок 2×4 (и больше): первые nT — цели, остальные — игроки той же формы; все покачиваются и смещаются
const block = (nT: number, nD: number, sp: number, amp: number): Player[] =>
  Array.from({ length: nT + nD }, (_, i) => {
    const r = Math.floor(i / 4)
    const c = i % 4
    return {
      x: (f: number): number => 330 + sp * c + amp * Math.sin(f / 9 + i * 1.9) + 1.5 * f,
      y: (f: number): number => 230 + 40 * r + amp * 0.6 * Math.cos(f / 11 + i),
      target: i < nT
    }
  })

describe('многоцелевое слежение: время шага', () => {
  it('8 целей + 4 игрока той же формы в блоке (шаг 22 и 30), пропуски 10 %: step() < 50 мс', () => {
    let worst = 0
    let total = 0
    for (const [sp, amp] of [
      [22, 15],
      [30, 10]
    ]) {
      const t0 = performance.now()
      const r = run(block(8, 4, sp, amp), { J: 4, hj: 0.05, dropP: 0.1, frames: 250, seed: 104729 })
      total += performance.now() - t0
      worst = Math.max(worst, r.maxStepMs)
      expect(r.swaps).toBe(0)
      expect(r.throws).toBe(0)
    }
    if (process.env.ADV_REPORT) {
      process.stderr
        .write(`TIMING block 8+4: max step ${worst.toFixed(1)} ms, total 2×250 frames ${total.toFixed(0)} ms
`)
    }
    expect(worst).toBeLessThan(50)
  }, 600000)
})

describe('состязательные сценарии: нет молчаливых подмен', () => {
  it('отскок с шумом рамок v=4/6/8, dy=0/10, J=2/4', () => {
    for (const v of [4, 6, 8])
      for (const dy of [0, 10])
        for (const J of [2, 4])
          family('bounce-jitter', `bounce v=${v} dy=${dy} J=${J}`, () => bounce(v, dy), jit(J), 4)
    check('bounce-jitter')
  })

  it('отскок и проход с пропуском рамки 1-3 кадра и слиянием 2-5 кадров', () => {
    for (const kind of ['pass', 'bounce'] as const)
      for (const v of [3, 6])
        for (const dy of [0, 10, 30]) {
          const mkP = (): Player[] => (kind === 'pass' ? pass(v, dy) : bounce(v, dy))
          for (const len of [1, 2, 3])
            for (const who of [0, 1])
              family(
                `${kind}-drop`,
                `${kind} v=${v} dy=${dy} drop${len} who${who}`,
                mkP,
                { ...jit(2), drop: { len, who } },
                2
              )
          for (const len of [2, 3, 5])
            family(
              `${kind}-merge`,
              `${kind} v=${v} dy=${dy} merge${len}`,
              mkP,
              { ...jit(2), merge: { len } },
              2
            )
        }
    for (const g of ['pass-drop', 'pass-merge', 'bounce-drop', 'bounce-merge']) check(g)
  })

  it('три игрока одной формы, отскок и проход', () => {
    for (const rev of [false, true])
      for (const v of [3, 6])
        for (const dys of [
          [0, 10, 20],
          [0, 30, -30]
        ])
          for (const J of [0, 3]) {
            const g = rev ? 'three-bounce' : 'three-pass'
            family(g, `three v=${v} dys=${dys} J=${J}`, () => three(v, dys, rev), jit(J), J ? 6 : 1)
            family(
              `${g}-decoy`,
              `decoy v=${v} dys=${dys} J=${J}`,
              () => three(v, dys, rev, false),
              jit(J),
              J ? 6 : 1
            )
          }
    for (const g of ['three-pass', 'three-pass-decoy', 'three-bounce', 'three-bounce-decoy'])
      check(g)
  })

  it('проход, диагональ, разные скорости, остановка: без подмен', () => {
    for (const v of [2, 4, 6])
      for (const dy of [0, 10, 30])
        for (const J of [0, 3])
          family('pass', `pass v=${v} dy=${dy} J=${J}`, () => pass(v, dy), jit(J), J ? 4 : 1)
    for (const rev of [false, true])
      for (const v of [2, 4, 6])
        for (const dy of [0, 10])
          for (const J of [0, 3])
            family(
              'diag',
              `diag${rev} v=${v} dy=${dy} J=${J}`,
              () => diag(v, dy, rev),
              jit(J),
              J ? 4 : 1
            )
    for (const [va, vb] of [
      [2, 7],
      [7, 2],
      [1, 5]
    ])
      for (const dy of [0, 10, 30])
        for (const J of [0, 3])
          family(
            'speeds',
            `vA=${va} vB=${vb} dy=${dy} J=${J}`,
            () => pass(va, dy, vb),
            jit(J),
            J ? 4 : 1
          )
    for (const v of [3, 6])
      for (const dy of [0, 10, 30])
        for (const J of [0, 3]) {
          family(
            'stops',
            `A stops v=${v} dy=${dy} J=${J}`,
            () => stopPass(v, dy),
            jit(J),
            J ? 4 : 1
          )
          family(
            'stops',
            `A still v=${v} dy=${dy} J=${J}`,
            () => standBounce(v, dy),
            jit(J),
            J ? 4 : 1
          )
        }
    for (const g of ['pass', 'diag', 'speeds', 'stops']) check(g)
  })

  it('сильный шум рамок J=6: проход и отскок двух, три игрока', () => {
    const J6 = { J: 6, hj: 0.08 }
    for (const kind of ['pass', 'bounce'] as const)
      for (const v of [2, 4, 6, 8])
        for (const dy of [0, 10, 30])
          family(
            'jitter6',
            `${kind} v=${v} dy=${dy} J=6`,
            () => (kind === 'pass' ? pass(v, dy) : bounce(v, dy)),
            J6,
            6,
            S2
          )
    for (const rev of [false, true])
      for (const v of [3, 6])
        family(
          'jitter6',
          `three rev=${rev} v=${v} J=6`,
          () => three(v, [0, 10, 20], rev),
          J6,
          6,
          S2
        )
    check('jitter6')
  })

  it('случайные пропуски 10 % рамок (детектор не видит своего игрока, сосед рядом)', () => {
    const o = { J: 4, hj: 0.05, dropP: 0.1 }
    for (const kind of ['pass', 'bounce'] as const)
      for (const v of [3, 6])
        for (const dy of [0, 10])
          family(
            'random-drop',
            `${kind} v=${v} dy=${dy} J=4 drop10%`,
            () => (kind === 'pass' ? pass(v, dy) : bounce(v, dy)),
            o,
            6,
            S2
          )
    for (const rev of [false, true])
      family(
        'random-drop',
        `three rev=${rev} v=4 J=4 drop10%`,
        () => three(4, [0, 10, 20], rev),
        o,
        6,
        S2
      )
    check('random-drop')
  })

  it('две пары с отскоком одновременно', () => {
    for (const v of [3, 6])
      for (const dy of [0, 10])
        for (const J of [0, 3])
          family(
            'two-pairs',
            `twoPairs v=${v} dy=${dy} J=${J}`,
            () => twoPairs(v, dy),
            jit(J),
            J ? 6 : 1,
            S2
          )
    check('two-pairs')
  })

  it('линия обороны из четырёх одной формы: шаг 25/35/50, перестроения, J=0/3/6', () => {
    for (const sp of [25, 35, 50])
      for (const sh of ['none', 'swap12', 'bounce12', 'all'] as const)
        for (const J of [0, 3, 6])
          family(
            'line',
            `line sp=${sp} ${sh} J=${J}`,
            () => line(sp, 2, sh, J ? 4 : 0),
            { J, hj: J ? 0.05 : 0, frames: 110 },
            J ? 6 : 1,
            S2
          )
    check('line')
  })

  it('пользователь один раз ошибся: дальше без подмен относительно его ответа и без вопросов без правильного варианта', () => {
    const o = { J: 3, hj: 0.05, policy: 'wrong' as const }
    for (const kind of ['pass', 'bounce'] as const)
      for (const v of [3, 6])
        for (const dy of [0, 10])
          family(
            'wrong-answer',
            `${kind} v=${v} dy=${dy} J=3 WRONG`,
            () => (kind === 'pass' ? pass(v, dy) : bounce(v, dy)),
            o,
            6,
            S2
          )
    for (const rev of [false, true])
      family(
        'wrong-answer',
        `three rev=${rev} v=4 J=3 WRONG`,
        () => three(4, [0, 10, 20], rev),
        o,
        6,
        S2
      )
    for (const sp of [25, 35])
      family(
        'wrong-answer',
        `line sp=${sp} swap12 J=3 WRONG`,
        () => line(sp, 2, 'swap12', 4),
        o,
        6,
        S2
      )
    check('wrong-answer')
  })
})
