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
const BLUE = look([30, 60, 220], [20, 20, 20])
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
  /** Виден ли игрок детектору на кадре (нет — ещё скрыт, «выходит из-за спины»). */
  vis?: (f: number) => boolean
  /** Окно кадров [от, до), где детектор этого игрока не видит. */
  dropWin?: [number, number]
  /** Примета (по умолчанию — красная форма, как у целей). */
  look?: Float32Array
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
  lastSwap: number
  asks: number
  stop: string | null
  /** Вопрос без настоящего игрока среди вариантов (правильного ответа нет). */
  noTruth: number
  /** Ответ из списка вопроса отвергнут (исключение). */
  throws: number
  /** Самый долгий step() за прогон, мс. */
  maxStepMs: number
  /** Время каждого step(), мс. */
  stepMs: number[]
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
    const d: Detection = {
      box: { x: x - w / 2, y: y - h / 2, w, h },
      score: 0.9,
      look: (s.length === 1 ? players[s[0]].look : undefined) ?? RED
    }
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
  // Как задача слежения: старт по детекциям кадра 0, и этот же кадр — первый шаг трекера (видны все игроки).
  const start = players.map((p, i) => mk(p.x(0), p.y(0), [i], false))
  const m = new MultiTracker(
    tIdx.map((i) => ({ det: start[i] })),
    FPS,
    FRAME
  )
  m.step({
    index: 0,
    t: 0.5 / FPS,
    detections: start.filter((_, i) => !players[i].vis || players[i].vis(0)),
    frameHist: WF
  })
  const res: Res = {
    swaps: 0,
    firstSwap: -1,
    lastSwap: -1,
    asks: 0,
    stop: null,
    noTruth: 0,
    throws: 0,
    maxStepMs: 0,
    stepMs: [],
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
      if (p.vis && !p.vis(f)) return
      if (p.dropWin && f >= p.dropWin[0] && f < p.dropWin[1]) return
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
    const ms = performance.now() - t0
    res.stepMs.push(ms)
    res.maxStepMs = Math.max(res.maxStepMs, ms)
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
        // Виден ли игрок детектору на этом кадре: «не виден» — отдельная пометка (исключение truthMayBeMissing).
        const seen = dets.some((d) => src.get(d)?.includes(ownK))
        res.detail.push(
          `f${f} t${k}: вопрос без настоящего игрока${seen ? '' : ' (не виден)'} (варианты ${r.candidates.map((c) => src.get(c)?.join('+')).join(',')})`
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
        res.lastSwap = f
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
  seedBase = 7919,
  /**
   * Предел различимости: до этого кадра у цели нет свидетельства, отличающего её игрока от новичка (новичок стоит в
   * пределах разброса прогноза, а свой не виден). Подмена и вопрос без настоящего игрока до него — известный предел;
   * с этого кадра (свой снова виден) — провал.
   */
  evidenceFrom?: number,
  /**
   * Свой игрок цели может так и не появиться у неё на глазах (вокруг только новички): вопрос без него, когда детектор его
   * на этом кадре не видит, считается в отчёте (noTruth), но не проваливает тест. Вопрос без него, когда он виден, и
   * подмена — провал. Известный предел, см. отчёт Fix round 5.
   */
  truthMayBeMissing = false
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
    const limit = evidenceFrom ?? 0
    if (r.swaps > 0) {
      t.swapRuns += 1
      if (r.lastSwap >= limit) {
        t.detail.push(`${name} s${s}: подмена с кадра ${r.firstSwap} (${r.swaps} кадров)`)
      }
    }
    for (const d of r.detail) {
      const at = Number(/^f(\d+)/.exec(d)?.[1] ?? Infinity)
      if (truthMayBeMissing && d.includes('(не виден)')) continue
      if (at >= limit) t.detail.push(`${name} s${s}: ${d}`)
    }
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
  it('8 целей + 4 игрока той же формы в блоке (шаг 22 и 30), пропуски 10 %: p95 step() < 20 мс, max < 250 мс', () => {
    // Порог по p95 (и щедрый по максимуму): одиночные выбросы бывают от загрузки машины (параллельные тесты, другие
    // проекты), а перебор назначений (раунд 4) давал секунды на каждом спорном кадре — это p95 поймает.
    let worst = 0
    let total = 0
    const all: number[] = []
    for (const [sp, amp] of [
      [22, 15],
      [30, 10]
    ]) {
      const t0 = performance.now()
      const r = run(block(8, 4, sp, amp), { J: 4, hj: 0.05, dropP: 0.1, frames: 250, seed: 104729 })
      total += performance.now() - t0
      worst = Math.max(worst, r.maxStepMs)
      all.push(...r.stepMs)
      expect(r.swaps).toBe(0)
      expect(r.throws).toBe(0)
    }
    const sorted = [...all].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))]
    if (process.env.ADV_REPORT) {
      process.stderr
        .write(`TIMING block 8+4: p95 ${p95.toFixed(1)} ms, max step ${worst.toFixed(1)} ms, total 2×250 frames ${total.toFixed(0)} ms
`)
    }
    expect(p95).toBeLessThan(20)
    expect(worst).toBeLessThan(250)
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

// n игроков на эллипсе проходят через центр (или разворачиваются в нём); первые nT — цели, остальные — та же форма
const crowd = (nT: number, nD: number, v: number, rev: boolean, spread = 6): Player[] => {
  const n = nT + nD
  const g = (f: number): number => (rev ? Math.min(f, M) - Math.max(0, f - M) : f) - M
  return Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * 2 * i) / n + 0.3
    const ox = spread * Math.cos(i * 2.1)
    const oy = spread * Math.sin(i * 1.7)
    return {
      x: (f: number): number => 450 + ox + v * Math.cos(a) * g(f),
      y: (f: number): number => 270 + oy + 0.45 * v * Math.sin(a) * g(f),
      target: i < nT
    }
  })
}
// A стоит; B (цель или нет) подходит, стоит вплотную (dx, dy) H кадров и уходит; третья цель далеко
const linger = (H: number, dx: number, dy: number, bTarget: boolean): Player[] => [
  { x: () => 400, y: () => 270, target: true },
  {
    x: (f) =>
      f < 30 ? 400 + dx + 4 * (30 - f) : f < 30 + H ? 400 + dx : 400 + dx + 4 * (f - 30 - H),
    y: () => 270 + dy,
    target: bTarget
  },
  { x: (f) => 250 + f, y: () => 120, target: true }
]
// одна цель и игрок той же формы, который не цель (одиночное кольцо рядом с партнёром)
const passDecoy = (v: number, dy: number): Player[] =>
  pass(v, dy).map((p, i) => ({ ...p, target: i === 0 }))
const bounceDecoy = (v: number, dy: number): Player[] =>
  bounce(v, dy).map((p, i) => ({ ...p, target: i === 0 }))

describe('игрок той же формы, который не цель (в том числе одиночное кольцо)', () => {
  it('пропуски 20/30 %: чужой игрок не подменяет пропавшего (1 цель + 1, толпа T1+D5, T2+D4, T4+D2)', () => {
    const o = { J: 4, hj: 0.05 }
    for (const dropP of [0.2, 0.3]) {
      family(
        'decoy-drop',
        `pass+decoy v=4 dy=10 drop${dropP}`,
        () => passDecoy(4, 10),
        { ...o, dropP },
        12,
        S2
      )
      family(
        'decoy-drop',
        `bounce+decoy v=4 dy=10 drop${dropP}`,
        () => bounceDecoy(4, 10),
        { ...o, dropP },
        12,
        S2
      )
      for (const [nT, nD] of [
        [1, 5],
        [2, 4],
        [4, 2]
      ])
        family(
          'decoy-drop',
          `crowd T${nT}+D${nD} bounce v=4 drop${dropP}`,
          () => crowd(nT, nD, 4, true),
          { ...o, dropP },
          12,
          S2
        )
    }
    check('decoy-drop')
  })

  it('без пропусков: проход и отскок мимо чужого, стоит рядом — без подмен (число вопросов в отчёте)', () => {
    for (const v of [3, 4, 6])
      for (const dy of [0, 10, 30])
        for (const J of [0, 3]) {
          family(
            'decoy-clean',
            `pass+decoy v=${v} dy=${dy} J=${J}`,
            () => passDecoy(v, dy),
            jit(J),
            J ? 6 : 1,
            S2
          )
          family(
            'decoy-clean',
            `bounce+decoy v=${v} dy=${dy} J=${J}`,
            () => bounceDecoy(v, dy),
            jit(J),
            J ? 6 : 1,
            S2
          )
        }
    for (const H of [10, 20, 30])
      for (const [dx, dy] of [
        [8, 5],
        [25, 5],
        [40, 0]
      ])
        family(
          'decoy-clean',
          `linger H=${H} dx=${dx} decoy`,
          () => linger(H, dx, dy, false),
          jit(3),
          6,
          S2
        )
    for (const [nT, nD] of [
      [1, 5],
      [2, 4],
      [4, 2]
    ])
      for (const rev of [false, true])
        family(
          'decoy-clean',
          `crowd T${nT}+D${nD} rev=${rev} v=4`,
          () => crowd(nT, nD, 4, rev),
          jit(4),
          6,
          S2
        )
    check('decoy-clean')
  })
})

const T = (x: Fn, y: Fn, extra: Partial<Player> = {}): Player => ({ x, y, target: true, ...extra })
const D = (x: Fn, y: Fn, extra: Partial<Player> = {}): Player => ({ x, y, target: false, ...extra })
const at =
  (v: number): Fn =>
  () =>
    v

describe('игрок той же формы появляется рядом с потерянной целью', () => {
  it('выходит из-за спины, пока детектор не видит цель; приходит из-за края; стоят рядом; меняются сторонами', () => {
    const J3 = { J: 3, hj: 0.05 }
    for (const [dx, dy] of [
      [0, 10],
      [20, 0],
      [35, 0]
    ])
      for (const N of [1, 2]) {
        const tx = (f: number): number => 80 + 2 * f
        const far = N === 2 ? [T((f) => 500 + f, at(150))] : []
        family(
          'newcomer',
          `offscreen entry dx=${dx} dy=${dy} N=${N}`,
          () => [
            T(tx, at(270), { dropWin: [20, 30] }),
            D((f) => tx(25) + dx - 8 * (25 - f), at(270 + dy)),
            ...far
          ],
          J3,
          6,
          S2
        )
        family(
          'newcomer',
          `emerges next to dropped target dx=${dx} dy=${dy} N=${N}`,
          () => [
            T(tx, at(270), { dropWin: [20, 28] }),
            D((f) => tx(f) + dx, at(270 + dy), { vis: (f) => f >= 22 }),
            ...far
          ],
          J3,
          6,
          S2
        )
        // Новичок в пределах разброса прогноза (dx 0 и 20 при пропуске в 2 кадра) неотличим от своего игрока, пока
        // свой не появится снова (кадр 32): до него — известный предел, с него — вопрос обязателен.
        family(
          'newcomer',
          `emerges & continues, target stops dx=${dx} dy=${dy} N=${N}`,
          () => [
            T((f) => 300 + 2 * Math.min(f, 22), at(270), { dropWin: [20, 32] }),
            D((f) => 300 + 2 * f + dx, at(270 + dy), { vis: (f) => f >= 22 }),
            ...far
          ],
          J3,
          6,
          S2,
          dx < 35 ? 32 : undefined
        )
      }
    for (const gap of [30, 45, 60])
      for (const win of [
        [30, 36],
        [30, 45]
      ] as Array<[number, number]>) {
        family(
          'newcomer',
          `side by side gap=${gap}, decoy stops, target dropped ${win}`,
          () => [
            T((f) => 200 + 3 * f, at(270), { dropWin: win }),
            D((f) => 200 + gap + 3 * Math.min(f, 32), at(272))
          ],
          J3,
          6,
          S2
        )
        family(
          'newcomer',
          `side by side gap=${gap}, target stops dropped ${win}`,
          () => [
            T((f) => 200 + 3 * Math.min(f, 32), at(270), { dropWin: win }),
            D((f) => 200 + gap + 3 * f, at(272))
          ],
          J3,
          6,
          S2
        )
      }
    for (const dropP of [0, 0.2])
      for (const sp of [30, 45]) {
        const sw = (f: number): number => Math.min(1, Math.max(0, (f - 40) / 20))
        family(
          'newcomer',
          `together, swap sides sp=${sp} drop${dropP}`,
          () => [
            T(
              (f) => 200 + 2 * f + sp * sw(f),
              (f) => 270 + 12 * Math.sin(Math.PI * sw(f))
            ),
            D((f) => 200 + 2 * f + sp - sp * sw(f), at(270))
          ],
          { ...J3, dropP },
          6,
          S2
        )
      }
    check('newcomer')
  })
})

describe('длинная сцена на весь кадр', () => {
  it('22 игрока (11 одной формы с целями, 11 другой), 8 целей, пропуски 5 %: без подмен', () => {
    const wander = (i: number): Player => {
      const ax = 80 + ((i * 83) % 800)
      const ay = 80 + ((i * 47) % 380)
      return {
        x: (f) => ax + 60 * Math.sin(f / (40 + i * 3) + i) + 30 * Math.sin(f / 13 + i * 2),
        y: (f) => ay + 40 * Math.cos(f / (55 + i * 2) + i) + 15 * Math.sin(f / 17 + i),
        target: i < 8,
        look: i < 11 ? RED : BLUE
      }
    }
    for (const seed of [4242, 99, 7])
      family(
        'long-scene',
        `22 players seed ${seed}`,
        () => Array.from({ length: 22 }, (_, i) => wander(i)),
        { J: 3, hj: 0.05, dropP: 0.05, frames: 600 },
        1,
        seed,
        undefined,
        // В толпе той же формы с пропусками вопрос на сроке трекера, когда свой как раз не виден, — известный предел
        // (считается в отчёте); подмен быть не должно.
        true
      )
    check('long-scene')
  }, 120000)
})

describe('вопрос только когда игрок цели может быть на кадре', () => {
  it('цель пропала, рядом вышли двое той же формы (никто их не ведёт): без подмены, вопросы — со своим игроком', () => {
    for (const off of [25, 35, 45, 55])
      for (const N of [1, 2])
        for (const win of [
          [20, 34],
          [20, 46]
        ] as Array<[number, number]>)
          for (const dropP of [0, 0.1])
            family(
              'present-only',
              `two strangers ±${off} N=${N} drop ${win} p=${dropP}`,
              () => [
                T((f) => 200 + 2 * f, at(270), { dropWin: win }),
                D((f) => 200 + 2 * f - off, at(272), { vis: (f) => f >= 22 }),
                D((f) => 200 + 2 * f + off, at(268), { vis: (f) => f >= 22 }),
                ...(N === 2 ? [T((f) => 600 + f, at(120))] : [])
              ],
              { J: 3, hj: 0.05, dropP },
              6,
              S2,
              // Одиночный новичок в пределах разброса прогноза (±25 px) неотличим от своего, пока свой не появится (известный
              // предел, как drift); с кадра возвращения своего подмена — провал.
              off <= 25 ? win[1] : undefined,
              // Цель пережидает среди новичков до срока трекера; на сроке он спрашивает сам, и если её игрок как раз не
              // виден, вопрос без него возможен (известный предел, считается в отчёте); подмен быть не должно.
              true
            )
    check('present-only')
  })
})

describe('после ответа соседи-новички не забываются', () => {
  it('ответ, затем свой пропал: новичок рядом (бывший подозреваемый) не подменяет цель (регрессия: ±55, N=2, сиды ×31337)', () => {
    for (const s of [1, 2, 3, 4, 5, 6])
      family(
        'after-answer',
        `two strangers ±55 N=2 drop 20,34 p=0.1 seed ${s}×31337`,
        () => [
          T((f) => 200 + 2 * f, at(270), { dropWin: [20, 34] }),
          D((f) => 200 + 2 * f - 55, at(272), { vis: (f) => f >= 22 }),
          D((f) => 200 + 2 * f + 55, at(268), { vis: (f) => f >= 22 }),
          T((f) => 600 + f, at(120))
        ],
        { J: 3, hj: 0.05, dropP: 0.1 },
        1,
        s * 31337,
        undefined,
        true
      )
    check('after-answer')
  })
})

describe('вернувшийся игрок после сомнительной подмены', () => {
  it('цель встала и пропала, на её месте вышел чужой и ушёл; свой вернулся на 55/70/90 кадре — вопрос, без бесконечной подмены', () => {
    for (const dx of [0, 15, 20])
      for (const back of [55, 70, 90])
        family(
          'drift-return',
          `drift dx=${dx} back=f${back}`,
          () => [
            T((f) => 300 + 2 * Math.min(f, 20), at(270), { dropWin: [20, back] }),
            D((f) => 300 + 2 * f + dx, at(272), { vis: (f) => f >= 22 })
          ],
          { J: 3, hj: 0.05, frames: 140 },
          6,
          S2,
          // До возвращения своего новичок неотличим (известный предел); с кадра возвращения — вопрос обязателен.
          back
        )
    check('drift-return')
  })
})

/**
 * Длинная сцена (6 минут): 22 игрока, 11 одной формы с целями, пропуски 5 %. Ответы всегда верные; вопрос без своего
 * игрока или потеря — перезапуск слежения (как сделал бы пользователь). Возвращает подмены: серии подряд идущих кадров,
 * где уверенная рамка цели на чужом игроке дальше 20 px.
 */
function longScene(
  pos: (i: number, f: number) => [number, number],
  nT: number,
  seed: number,
  frames = 9000
): {
  runs: Array<{ target: number; from: number; len: number; maxSep: number }>
  asks: number
  minutes: number
  stops: number
  /** Остановки, после которых в обрезанном до надёжного кадра выводе остался бы кадр на чужом игроке. */
  keptWrong: string[]
} {
  const R = rng(seed)
  const U = (a: number): number => (R() * 2 - 1) * a
  const src = new Map<Detection, number>()
  const detsAt = (f: number, noisy: boolean): Detection[] => {
    const out: Detection[] = []
    for (let i = 0; i < 22; i++) {
      if (noisy && R() < 0.05) continue
      const [x, y] = pos(i, f)
      const h = BH * (1 + (noisy ? U(0.05) : 0))
      const w = (BW * h) / BH
      const d: Detection = {
        box: { x: x + (noisy ? U(3) : 0) - w / 2, y: y + (noisy ? U(3) : 0) - h / 2, w, h },
        score: 0.9,
        look: i < 11 ? RED : BLUE
      }
      src.set(d, i)
      out.push(d)
    }
    return out
  }
  let m: MultiTracker | null = null
  let asks = 0
  let live = 0
  let stops = 0
  const keptWrong: string[] = []
  // Кадры текущего слежения, где уверенная рамка цели была на чужом игроке (по целям).
  let wrong: number[][] = []
  const open: Array<{ from: number; len: number; maxSep: number } | null> = Array.from(
    { length: nT },
    () => null
  )
  const runs: Array<{ target: number; from: number; len: number; maxSep: number }> = []
  const close = (k: number): void => {
    const o = open[k]
    if (o) runs.push({ target: k, ...o })
    open[k] = null
  }
  for (let f = 0; f < frames; f++) {
    const dets = detsAt(f, m !== null)
    if (!m) {
      const s = Array.from({ length: nT }, (_, i) => dets.find((d) => src.get(d) === i))
      if (s.some((x) => !x)) continue
      m = new MultiTracker(
        s.map((det) => ({ det: det as Detection })),
        FPS,
        FRAME
      )
      wrong = Array.from({ length: nT }, () => [])
    }
    let r: MultiStep = m.step({ index: f, t: (f + 0.5) / FPS, detections: dets, frameHist: WF })
    // Вопрос без своего: пользователь ответил бы «моего тут нет» (обрезка нестрогая); иначе — потеря (строгая).
    let lostStop = true
    while (r.kind === 'ask') {
      asks++
      const target = r.target
      const p = r.candidates.find((c) => src.get(c) === target)
      if (!p) {
        lostStop = false
        r = { kind: 'lost', target, reason: 'occluded' }
        break
      }
      r = m.resolve(target, p)
    }
    if (r.kind === 'lost') {
      // Остановка (потеря или вопрос без своего — пользователь ответил бы «моего тут нет»): вывод обрезается у всех
      // целей до общего надёжного кадра. В оставшемся не должно быть ни одного кадра на чужом игроке.
      stops++
      const tm = m
      const bound = Math.min(
        ...Array.from({ length: nT }, (_, k) => tm.provenUntil(k, lostStop) ?? -1)
      )
      for (let k = 0; k < nT; k++) {
        const bad = wrong[k].filter((x) => x <= bound)
        if (bad.length > 0)
          keptWrong.push(`t${k} f${bad[0]}…f${bad[bad.length - 1]} (до f${bound})`)
      }
      m = null
      for (let k = 0; k < nT; k++) close(k)
      continue
    }
    live++
    const rr = r
    for (let k = 0; k < nT; k++) {
      const b = rr.boxes[k]
      const d = rr.coasting[k] ? undefined : dets.find((x) => x.box.x === b.x && x.box.y === b.y)
      const on = d ? src.get(d) : undefined
      if (on === undefined || on === k) {
        if (!rr.coasting[k]) close(k)
        continue
      }
      const [ox, oy] = pos(k, f)
      const [sx, sy] = pos(on, f)
      const sep = Math.hypot(ox - sx, oy - sy)
      if (sep <= 20) continue
      wrong[k].push(f)
      const o = (open[k] ??= { from: f, len: 0, maxSep: 0 })
      o.len++
      o.maxSep = Math.max(o.maxSep, sep)
    }
  }
  for (let k = 0; k < nT; k++) close(k)
  return { runs, asks, minutes: live / FPS / 60, stops, keptWrong }
}

const wanderLong = (i: number, f: number): [number, number] => {
  const ax = 80 + ((i * 83) % 800)
  const ay = 80 + ((i * 47) % 380)
  return [
    ax + 60 * Math.sin(f / (40 + i * 3) + i) + 30 * Math.sin(f / 13 + i * 2),
    ay + 40 * Math.cos(f / (55 + i * 2) + i) + 15 * Math.sin(f / 17 + i)
  ]
}
const roamLong = (i: number, f: number): [number, number] => {
  const ax = 480 + 380 * Math.sin(f / (300 + 37 * i) + i * 2.3)
  const ay = 270 + 200 * Math.cos(f / (410 + 29 * i) + i * 1.7)
  return [ax + 20 * Math.sin(f / 11 + i), ay + 12 * Math.cos(f / 13 + i)]
}

describe('длинные сцены (6 минут, 22 игрока, 11 одной формы, пропуски 5 %)', () => {
  it('без подмен длиннее 3 кадров и дальше 30 px, без чужих кадров в обрезанном выводе: wander/roam, 1/4/8 целей', () => {
    const bad: string[] = []
    for (const [name, pos, nT, seed] of [
      ['wander', wanderLong, 1, 2],
      ['wander', wanderLong, 1, 1],
      ['roam', roamLong, 1, 2],
      ['roam', roamLong, 4, 1],
      ['roam', roamLong, 4, 2],
      ['wander', wanderLong, 8, 5],
      ['roam', roamLong, 8, 3]
    ] as Array<[string, typeof wanderLong, number, number]>) {
      const r = longScene(pos, nT, seed)
      if (process.env.ADV_REPORT) {
        process.stderr.write(
          `LONG ${name} ${nT}T s${seed}: ${r.minutes.toFixed(1)} min, asks ${r.asks} (${(r.asks / r.minutes).toFixed(1)}/min), stops ${r.stops}, swap runs ${r.runs.length}\n`
        )
      }
      for (const w of r.keptWrong)
        bad.push(`${name} ${nT}T s${seed}: в выводе после остановки ${w}`)
      for (const s of r.runs) {
        if (s.len > 3 || s.maxSep > 30) {
          bad.push(
            `${name} ${nT}T s${seed} t${s.target}: f${s.from} ×${s.len}, до ${s.maxSep.toFixed(0)} px`
          )
        }
      }
    }
    expect(bad).toEqual([])
  }, 240000)
})

describe('товарищ возвращается в ворота, когда цель пропала', () => {
  it('скрывался 1–2 с и вышел в 40–90 px от цели в кадр её пропуска: молча не берётся', () => {
    const J3 = { J: 3, hj: 0.05 }
    for (const hide of [25, 40, 50])
      for (const off of [40, 55, 90])
        for (const tdrop of [0, 1, 2])
          for (const ang of [0, 1]) {
            const back = 30 + hide
            const tx = (f: number): number => 200 + 2 * f
            family(
              'reappear',
              `hide ${hide} off=${off} ${ang ? 'below' : 'ahead'} targetDrop=${tdrop}`,
              () => [
                T(tx, at(270), tdrop ? { dropWin: [back, back + tdrop] } : {}),
                D(
                  (f) => (f < back ? tx(f) : tx(f) + (ang ? 0 : off)),
                  (f) => (f < back ? 340 : 270 + (ang ? off : 6)),
                  { vis: (f) => f < 30 || f >= back }
                )
              ],
              J3,
              6,
              S2
            )
          }
    check('reappear')
  })
})
