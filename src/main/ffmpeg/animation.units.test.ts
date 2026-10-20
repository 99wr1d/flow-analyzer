// Движущиеся рисунки: загрузка кадров (staging), план кадров, структура графа ffmpeg и выражения движущейся лупы.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Timing } from '../../shared/annotations'
import { OVERLAY_LIMITS } from '../../shared/export'
import { frameTime, planAnimation, planExport, type RangePlan } from '../../shared/exportOverlays'
import type { GrassKeyValues } from '../../shared/grassKey'
import type { LoupeGeometry } from '../../shared/tools/loupe'
import { planDrawn } from './drawGraph'
import { makePng } from './ffmpeg.testkit'
import { keyedExpr, loupeGeometryFromKeys, loupeLines } from './loupe'
import {
  STAGING_ERRORS,
  disposeAllSync,
  disposePending,
  disposeStaged,
  holdStaged,
  stageFrames,
  stageOverlays,
  type Staged
} from './staging'

const FPS = 25
const W = 32
const H = 18
let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'flow-anim-units-'))
})
afterAll(() => {
  disposeAllSync()
  rmSync(root, { recursive: true, force: true })
})
afterEach(() => disposeAllSync())

const png = (w = W, h = H): Uint8Array => makePng(w, h)
const range = (start: number, duration: number): Timing => ({ mode: 'range', start, duration })

async function holdEmpty(): Promise<Staged> {
  const res = await stageOverlays({ width: W, height: H, images: [] }, root)
  if (!res.ok) throw new Error(res.error)
  await holdStaged(res.staged)
  return res.staged
}

describe('stageFrames: кадры движущихся рисунков', () => {
  it('загрузка без обычных картинок допустима; кадры пишутся в папку по слоям и номерам', async () => {
    const staged = await holdEmpty()
    const a = await stageFrames({
      token: staged.token,
      layer: 'over',
      frames: [
        { frame: 25, data: png() },
        { frame: 26, data: png() }
      ]
    })
    expect(a).toEqual({ ok: true, count: 2 })
    const b = await stageFrames({
      token: staged.token,
      layer: 'under',
      frames: [{ frame: 25, data: png() }]
    })
    expect(b).toEqual({ ok: true, count: 1 })
    expect(readdirSync(staged.dir).sort()).toEqual([
      'over_0000025.png',
      'over_0000026.png',
      'under_0000025.png'
    ])
    expect(staged.frames.over.get(26)).toBe(join(staged.dir, 'over_0000026.png'))
    await disposeStaged(staged)
    expect(existsSync(staged.dir)).toBe(false)
  })

  it('чужой билет — понятная ошибка, загрузка остаётся', async () => {
    const staged = await holdEmpty()
    const res = await stageFrames({
      token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
      layer: 'over',
      frames: [{ frame: 1, data: png() }]
    })
    expect(res).toEqual({ ok: false, error: STAGING_ERRORS.noSession })
    expect(existsSync(staged.dir)).toBe(true)
  })

  it('повтор кадра, чужой размер и не PNG отклоняются, загрузка при этом удаляется', async () => {
    for (const frames of [
      [
        { frame: 1, data: png() },
        { frame: 1, data: png() }
      ],
      [{ frame: 1, data: png(64, 36) }],
      [{ frame: 1, data: new Uint8Array(200) }]
    ]) {
      const staged = await holdEmpty()
      const res = await stageFrames({ token: staged.token, layer: 'over', frames })
      expect(res.ok).toBe(false)
      expect(existsSync(staged.dir)).toBe(false)
    }
  })

  it('больше 3000 кадров одного слоя — дружелюбная ошибка и чистая папка', async () => {
    const staged = await holdEmpty()
    const one = png()
    let last: Awaited<ReturnType<typeof stageFrames>> = { ok: true, count: 0 }
    for (let start = 0; start < OVERLAY_LIMITS.maxAnimFrames + 100; start += 100) {
      last = await stageFrames({
        token: staged.token,
        layer: 'over',
        frames: Array.from({ length: 100 }, (_, i) => ({ frame: start + i, data: one }))
      })
      if (!last.ok) break
    }
    expect(last).toEqual({ ok: false, error: STAGING_ERRORS.animTooMany })
    expect(STAGING_ERRORS.animTooMany).toMatch(/Выберите отрезки покороче/)
    expect(existsSync(staged.dir)).toBe(false)
  }, 60_000)

  it('общий объём кадров ограничен (1,5 ГБ): сверх лимита — ошибка и уборка', async () => {
    const staged = await holdEmpty()
    staged.frameBytes = OVERLAY_LIMITS.maxAnimBytes - 10
    const res = await stageFrames({
      token: staged.token,
      layer: 'over',
      frames: [{ frame: 1, data: png() }]
    })
    expect(res).toEqual({ ok: false, error: STAGING_ERRORS.animTotal })
    expect(existsSync(staged.dir)).toBe(false)
  })

  it('disposePending убирает ожидающую загрузку вместе с кадрами', async () => {
    const staged = await holdEmpty()
    await stageFrames({ token: staged.token, layer: 'over', frames: [{ frame: 3, data: png() }] })
    await disposePending()
    expect(existsSync(staged.dir)).toBe(false)
  })
})

describe('planAnimation: кадры с движущимися рисунками', () => {
  it('кадры внутри отрезка: по началу кадра, видимость — по середине кадра', () => {
    const plan = planAnimation([{ t: range(1, 1), index: 0 }], [{ start: 0.5, end: 3 }], FPS)
    expect(plan.runs).toEqual([{ first: 25, last: 49 }])
    expect(plan.frames).toHaveLength(25)
    expect(plan.frames[0]).toEqual({ frame: 25, members: [0] })
  })
  it('экспортируемый отрезок обрезает кадры, а соседние кадры собираются в ряд', () => {
    const plan = planAnimation([{ t: range(1, 2), index: 3 }], [{ start: 1.5, end: 2 }], FPS)
    expect(plan.runs).toEqual([{ first: 38, last: 49 }])
    expect(plan.frames.map((f) => f.members)).toEqual(Array(12).fill([3]))
  })
  it('два рисунка с разрывом — два ряда; общие кадры содержат обоих', () => {
    const plan = planAnimation(
      [
        { t: range(1, 0.6), index: 0 },
        { t: range(1.4, 0.4), index: 1 },
        { t: range(3, 0.4), index: 2 }
      ],
      [{ start: 0, end: 5 }],
      FPS
    )
    expect(plan.runs).toEqual([
      { first: 25, last: 44 },
      { first: 75, last: 84 }
    ])
    const at = (f: number): number[] => plan.frames.find((x) => x.frame === f)!.members
    expect(at(25)).toEqual([0])
    expect(at(37)).toEqual([0, 1])
    expect(at(44)).toEqual([1])
  })
  it('пересекающиеся отрезки (запас по краям) не дублируют кадры', () => {
    const plan = planAnimation(
      [{ t: range(1, 1), index: 0 }],
      [
        { start: 0.6, end: 1.6 },
        { start: 1.4, end: 2.4 }
      ],
      FPS
    )
    expect(plan.frames).toHaveLength(25)
    expect(new Set(plan.frames.map((f) => f.frame)).size).toBe(25)
  })
  it('нет движущихся рисунков — нет кадров', () => {
    expect(planAnimation([], [{ start: 0, end: 5 }], FPS)).toEqual({ frames: [], runs: [] })
  })
  it('planExport: движущиеся идут отдельно от обычных ключей, стоп-кадр запоминает движущиеся в кадре', () => {
    const timings: Timing[] = [
      range(1, 2),
      range(0, 10),
      { mode: 'frame', start: frameTime(37, FPS), freezeSeconds: 1 }
    ]
    const [plan] = planExport([{ start: 0, end: 4 }], 'files', timings, FPS, new Set([0]))
    expect(plan.keys.some((k) => k.split('-').includes('0'))).toBe(false)
    expect(plan.ranges[0].freezes[0].key).toBe('1-2')
    expect(plan.ranges[0].freezes[0].animated).toEqual([0])
    expect(plan.animation.frames.length).toBe(50)
  })
})

const GRASS: GrassKeyValues = { color: '#2a7d3e', similarity: 0.07, blend: 0.05 }
const R = (start: number, end: number, freezes: RangePlan['freezes'] = []): RangePlan => ({
  start,
  end,
  freezes
})

describe('planDrawn: ряды кадров анимации', () => {
  it('ряд — отдельный вход со сдвигом setpts на метку времени первого кадра; overlay берёт кадры по времени', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [],
      fps: FPS,
      audio: null,
      animation: { runs: [{ first: 30, last: 54 }], layers: { over: true, under: false } }
    })
    expect(g.inputs).toEqual([{ key: '', layer: 'over', seq: { first: 30, last: 54 } }])
    // 30/25 − 1 = 0.2 с, минус четверть кадра (0.01 с).
    expect(g.script).toContain('[1:v]format=rgba,settb=1/1000000,setpts=PTS+(0.1900)/TB[ps0]')
    expect(g.script).toMatch(/\[src\]\[ps0\]overlay=x=0:y=0:eof_action=pass\[ov0\]/)
    expect(g.script).not.toContain('maskedmerge')
  })
  it('слой «под игроками»: ряд вливается по маске газона', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [],
      fps: FPS,
      audio: null,
      grass: GRASS,
      animation: { runs: [{ first: 25, last: 40 }], layers: { over: true, under: true } }
    })
    expect(g.inputs.map((x) => x.layer)).toEqual(['over', 'under'])
    expect(g.script).toContain('[gd][ps1]overlay=x=0:y=0:eof_action=pass[gq0]')
    expect(g.script).toContain('maskedmerge')
  })
  it('без ключа «газон» слой «под игроками» не строится', () => {
    expect(() =>
      planDrawn({
        ranges: [R(1, 3)],
        segments: [],
        fps: FPS,
        audio: null,
        animation: { runs: [{ first: 25, last: 40 }], layers: { over: false, under: true } }
      })
    ).toThrow()
  })
  it('стоп-кадр: у него своя картинка кадра (still), наложение идёт цепочкой с метками', () => {
    const g = planDrawn({
      ranges: [
        R(1, 3, [{ time: frameTime(37, FPS), frame: 37, seconds: 1, key: '1', animated: [0] }])
      ],
      segments: [],
      fps: FPS,
      audio: null,
      layers: new Map([['1', { over: true, under: false }]]),
      animation: { runs: [{ first: 25, last: 50 }], layers: { over: true, under: false } }
    })
    expect(g.inputs.map((x) => x.still ?? x.seq?.first ?? x.key)).toEqual(['1', 25, 37])
    expect(g.script).toMatch(/\[fz0\]\[pf0_0\]overlay=x=0:y=0:eof_action=repeat\[fzo0_0\]/)
    expect(g.script).toMatch(/\[fzo0_0\]\[pt2\]overlay=x=0:y=0:eof_action=repeat\[fzo0_1\]/)
    expect(g.script).toMatch(/\[fzo0_1\]tpad=/)
  })
  it('без анимации новых входов нет', () => {
    const base = planDrawn({ ranges: [R(1, 3)], segments: [], fps: FPS, audio: null })
    expect(base.inputs).toEqual([])
  })
})

describe('движущаяся лупа: выражения ffmpeg', () => {
  const g = (ox: number, sx = 10): LoupeGeometry => ({ d: 40, ox, oy: 20, sw: 20, sx, sy: 10 })
  const keys = [
    { t: 1, ease: 'linear' as const, geometry: g(100) },
    { t: 2, ease: 'linear' as const, geometry: g(300) },
    { t: 4, geometry: g(300, 50) }
  ]
  it('геометрия по ключам: равномерно, плавно (по умолчанию), до и после — на месте', () => {
    expect(loupeGeometryFromKeys(keys, 0).ox).toBe(100)
    expect(loupeGeometryFromKeys(keys, 1.5).ox).toBe(200)
    expect(loupeGeometryFromKeys(keys, 9).ox).toBe(300)
    const a = [
      { t: 2, geometry: g(300, 10) },
      { t: 4, geometry: g(300, 50) }
    ]
    // четверть пути с плавным переходом: smoothstep(0.25) = 0.15625 от 40 = 6.25
    expect(loupeGeometryFromKeys(a, 2.5).sx).toBe(16)
  })
  it('выражение: вложенные if по времени, значения на краях, без кавычек и обратных косых', () => {
    const e = keyedExpr(keys, (k) => k.ox, 0.52)
    expect(e.startsWith('if(lt((t+0.52),2),if(lt((t+0.52),1),100,')).toBe(true)
    expect(e).not.toMatch(/['\\]/)
    const smooth = [
      { t: 1, geometry: g(100, 10) },
      { t: 2, geometry: g(100, 50) }
    ]
    expect(keyedExpr(smooth, (k) => k.sx, 0.52)).toContain('st(0,')
    expect(keyedExpr(keys, (k) => k.sx, 0.52)).not.toContain('st(0,')
  })
  it('loupeLines: у движущейся лупы crop и overlay получают выражения, у неподвижной — числа', () => {
    const moving = loupeLines({
      id: 'l',
      input: '[a]',
      output: '[b]',
      geometry: g(100),
      anim: { keys, shift: 0.5 }
    }).join('\n')
    expect(moving).toMatch(/crop=w=20:h=20:x='if\(/)
    expect(moving).toMatch(/overlay=x='if\(/)
    const still = loupeLines({ id: 'l', input: '[a]', output: '[b]', geometry: g(100) }).join('\n')
    expect(still).toContain('overlay=x=100:y=20')
    expect(still).toContain('crop=w=20:h=20:x=10:y=10')
  })
})
