// Состязательные сценарии многоцелевого слежения: шум рамок, пропуски, слияния, три игрока одной формы.
// Детерминировано (сид). Инвариант: ни одной молчаливой подмены (уверенная рамка чужого игрока при расстоянии между
// игроками больше SEP), и в каждом вопросе среди кандидатов есть настоящий игрок цели. Вопросы и безопасные остановки допустимы.
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
  drop?: { len: number; who: number }
  merge?: { len: number }
  pair?: [number, number]
}
interface Res {
  swapFrames: number
  firstSwap: number
  asks: number
  lost: string | null
  userNull: number
  mergedConf: number
  endWrong: boolean
}

function run(players: Player[], o: Opts): Res {
  const R = rng(o.seed)
  const U = (a: number) => (R() * 2 - 1) * a
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
  // closest approach of pair
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
  const m = new MultiTracker(
    tIdx.map((i) => ({ det: mk(players[i].x(0), players[i].y(0), [i], false) })),
    FPS,
    FRAME
  )
  const res: Res = {
    swapFrames: 0,
    firstSwap: -1,
    asks: 0,
    lost: null,
    userNull: 0,
    mergedConf: 0,
    endWrong: false
  }
  let lastOwn: boolean[] = tIdx.map(() => true)
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
    // shuffle detection order (detector order is arbitrary)
    dets = dets
      .map((d) => [R(), d] as const)
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1])
    let r: MultiStep = m.step({ index: f, t: (f + 0.5) / FPS, detections: dets, frameHist: WF })
    let guard = 0
    while (r.kind === 'ask' && guard++ < 20) {
      res.asks++
      const own = tIdx[r.target]
      const exact = r.candidates.find((c) => {
        const s = src.get(c)
        return s && s.length === 1 && s[0] === own
      })
      const merged = r.candidates.find((c) => {
        const s = src.get(c)
        return s && s.includes(own)
      })
      const pick = exact ?? merged
      if (DEBUG)
        console.log(
          `  ask f${f} target${r.target} cands=${r.candidates.map((c) => src.get(c)!.join('+')).join(',')}`
        )
      if (!pick) {
        res.userNull++
        res.lost = `user-null@${f}`
        break
      }
      try {
        r = m.resolve(r.target, pick)
      } catch (e) {
        res.lost = `resolve-throw@${f}:${(e as Error).message}`
        break
      }
    }
    if (res.lost) break
    if (r.kind === 'lost') {
      res.lost = `lost t${r.target} ${r.reason}@${f}`
      break
    }
    if (r.kind !== 'track') break
    const rr = r
    if (DEBUG && f >= 34 && f <= 52)
      console.log(
        `  f${f} truth=${players.map((p) => `(${p.x(f).toFixed(0)},${p.y(f).toFixed(0)})`).join(' ')} dets=${dets.map((d) => `${src.get(d)!.join('+')}@${(d.box.x + d.box.w / 2).toFixed(0)}`).join(' ')} out=${rr.boxes.map((b, k) => `${(b.x + b.w / 2).toFixed(0)}${rr.coasting[k] ? 'c' : ''}`).join(' ')}`
      )
    lastOwn = tIdx.map((own, k) => {
      if (rr.coasting[k]) return lastOwn[k]
      const d = dets.find(
        (x) =>
          x.box.x === rr.boxes[k].x &&
          x.box.y === rr.boxes[k].y &&
          x.box.w === rr.boxes[k].w &&
          x.box.h === rr.boxes[k].h
      )
      if (!d) return true // user-confirmed copy
      const s = src.get(d)!
      if (s.length > 1) {
        res.mergedConf++
        return s.includes(own)
      }
      if (s[0] !== own) {
        const sep = Math.hypot(
          players[own].x(f) - players[s[0]].x(f),
          players[own].y(f) - players[s[0]].y(f)
        )
        if (sep > SEP) {
          res.swapFrames++
          if (res.firstSwap < 0) res.firstSwap = f
        }
        if (DEBUG)
          console.log(`  wrong f${f} target${k} own=${own} took=${s[0]} sep=${sep.toFixed(1)}`)
        return false
      }
      return true
    })
  }
  res.endWrong = lastOwn.some((x) => !x)
  return res
}

const M = 40
const SEP = Number(process.env.SEP ?? 20)
const DEBUG = false
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
// diagonal: A moves (+v, +0.5v), B moves (-0.4v, -v); both at (200+vM + 0, 270+...) at f=M
const diag = (v: number, dy: number, rev: boolean): Player[] => {
  const g = (f: number) => (rev ? Math.min(f, M) - Math.max(0, f - M) : f) - M
  return [
    { x: (f) => 400 + v * g(f), y: (f) => 270 + 0.5 * v * g(f), target: true },
    { x: (f) => 400 - 0.4 * v * g(f), y: (f) => 270 + dy - v * g(f), target: true }
  ]
}
// A walks to the meeting point and stops there forever; B passes through
const stopPass = (v: number, dy: number): Player[] => [
  { x: (f) => 200 + v * Math.min(f, M), y: () => 270, target: true },
  { x: (f) => 200 + 2 * v * M - v * f, y: () => 270 + dy, target: true }
]
// A stands still, B walks up, stands next to A for 15 frames, walks back
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
// three: A from left, B from right, C from top-left diagonal, all meet near (400,270)
const three = (
  v: number,
  dys: [number, number, number],
  rev: boolean,
  cTarget = true
): Player[] => {
  const g = (f: number) => (rev ? Math.min(f, M) - Math.max(0, f - M) : f) - M
  return [
    { x: (f) => 400 + v * g(f), y: () => 270 + dys[0], target: true },
    { x: (f) => 400 - v * g(f), y: () => 270 + dys[1], target: true },
    { x: (f) => 400 + 0.3 * v * g(f), y: (f) => 270 + dys[2] + 0.8 * v * g(f), target: cTarget }
  ]
}

interface Tally {
  swapRuns: number
  unanswerable: number
  asks: number
  stops: number
  runs: number
  detail: string[]
}
const TOTAL: Record<string, Tally> = {}

/** Прогон семейства сценариев по нескольким сидам; итоги копятся в TOTAL (для отчёта). */
function family(
  group: string,
  name: string,
  mkP: () => Player[],
  base: Omit<Opts, 'seed'>,
  seeds: number,
  pair?: [number, number]
): void {
  const t = (TOTAL[group] ??= {
    swapRuns: 0,
    unanswerable: 0,
    asks: 0,
    stops: 0,
    runs: 0,
    detail: []
  })
  for (let s = 1; s <= seeds; s += 1) {
    const r = run(mkP(), { ...base, seed: s * 7919, pair })
    t.runs += 1
    t.asks += r.asks
    t.unanswerable += r.userNull
    if (r.lost) t.stops += 1
    if (r.swapFrames > 0) {
      t.swapRuns += 1
      t.detail.push(`${name} s${s}:f${r.firstSwap}x${r.swapFrames}`)
    }
    if (r.userNull > 0) t.detail.push(`${name} s${s}: вопрос без настоящего игрока (${r.lost})`)
  }
}

function check(group: string): void {
  const t = TOTAL[group]
  if (process.env.ADV_REPORT) {
    process.stderr.write(
      `ADV ${group}: runs ${t.runs} swapRuns ${t.swapRuns} unanswerable ${t.unanswerable} asks ${t.asks} stops ${t.stops}\n`
    )
  }
  expect(t.detail).toEqual([])
}

const jit = (J: number): Pick<Opts, 'J' | 'hj'> => ({ J, hj: J ? 0.05 : 0 })

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
        ] as Array<[number, number, number]>)
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
})
