import { describe, expect, it } from 'vitest'
import { MAX_KEYFRAMES, AnnotationSchema, type Annotation } from '../../../../shared/annotations'
import { estimateSeconds } from '../../../../shared/tracking/trackingIpc'
import { geomAt, keysOf, upsertKey } from '../../../../shared/animation'
import { sampleCalibration } from '../../../../shared/pitch/pitch.testkit'
import type { TrackSample } from '../../../../shared/tracking/keys'
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { autoRuns } from '../annotations/lanes'
import {
  applyTrackResult,
  canTrack,
  continueFrom,
  planTracking,
  planSeconds,
  rememberBackend,
  stopMessage,
  type TrackPlan
} from './trackingApply'

const FPS = 25
const id = '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11'
const style = { color: '#ffd60a', width: 0.008, dash: 'solid' as const }
const range = { mode: 'range' as const, start: 1, duration: 4 }

const circle = (over: Partial<Annotation> = {}): Annotation =>
  ({
    id,
    space: 'screen',
    type: 'circle',
    p1: { x: 0.3, y: 0.62 },
    p2: { x: 0.36, y: 0.68 },
    style,
    fillOpacity: 0.18,
    underPlayers: true,
    timing: range,
    ...over
  }) as Annotation

/** Игрок бежит вправо: ноги на (0.33 + 0.1·(t-1), 0.65), рост 0.3. Отсчёты — середины кадров от t0 до t1. */
function run(t0: number, t1: number, dx = 0.1): TrackSample[] {
  const out: TrackSample[] = []
  for (let k = Math.round(t0 * FPS); (k + 0.5) / FPS < t1; k += 1) {
    const t = (k + 0.5) / FPS
    out.push({ t, foot: { x: 0.33 + dx * (t - 1), y: 0.65 }, height: 0.3 })
  }
  return out
}

const planOf = (a: Annotation, now = 1.02): TrackPlan => {
  const p = planTracking(a, { now, fps: FPS, videoDuration: 10, calibration: null })
  if (!p.ok) throw new Error(`план не получился: ${p.reason}`)
  return p
}

describe('canTrack: у каких рисунков есть кнопка', () => {
  it('кольцо, круг, прожектор, подпись, прожектор на поле — с отрезком', () => {
    for (const type of ['circle', 'spot', 'text']) {
      expect(canTrack({ ...circle(), type } as Annotation)).toBe(true)
    }
    expect(canTrack({ ...circle(), type: 'ring', space: 'pitch' } as Annotation)).toBe(true)
    expect(canTrack({ ...circle(), type: 'pspot', space: 'pitch' } as Annotation)).toBe(true)
  })
  it('«Только кадр» — нет', () => {
    expect(canTrack(circle({ timing: { mode: 'frame', start: 1, freezeSeconds: 1 } }))).toBe(false)
  })
  it('стрелка, линия, зона — нет', () => {
    for (const type of ['arrow', 'line', 'zone', 'curve', 'pen', 'loupe', 'chain']) {
      expect(canTrack({ ...circle(), type } as Annotation)).toBe(false)
    }
  })
})

describe('planTracking: откуда и докуда', () => {
  it('от текущего кадра до конца отрезка; якорь — центр рисунка', () => {
    const p = planOf(circle(), 1.02)
    expect(p.mode).toBe('start')
    expect(p.at).toBeCloseTo(1.02, 6)
    expect(p.from).toBeCloseTo(1.0, 6)
    expect(p.to).toBeCloseTo(5, 6)
    expect(p.anchor.x).toBeCloseTo(0.33, 6)
    expect(p.anchor.y).toBeCloseTo(0.65, 6)
    expect(p.replaceCount).toBe(0)
  })
  it('конец отрезка обрезается длиной видео', () => {
    const p = planTracking(circle(), { now: 1.02, fps: FPS, videoDuration: 3, calibration: null })
    expect(p.ok && p.to).toBeCloseTo(3, 6)
  })
  it('текущий кадр вне отрезка — отказ', () => {
    const p = planTracking(circle(), { now: 7, fps: FPS, videoDuration: 10, calibration: null })
    expect(p).toEqual({ ok: false, reason: 'outside' })
  })
  it('на последнем кадре отрезка считать нечего', () => {
    const p = planTracking(circle(), {
      now: 4.98,
      fps: FPS,
      videoDuration: 10,
      calibration: null
    })
    expect(p).toEqual({ ok: false, reason: 'too-short' })
  })
  it('ручные ключи после кадра: считаются для вопроса о замене', () => {
    let a = circle()
    a = upsertKey(a, 1.02, { p1: { x: 0.3, y: 0.62 }, p2: { x: 0.36, y: 0.68 } }, FPS)
    a = upsertKey(a, 2.02, { p1: { x: 0.4, y: 0.62 }, p2: { x: 0.46, y: 0.68 } }, FPS)
    a = upsertKey(a, 3.02, { p1: { x: 0.5, y: 0.62 }, p2: { x: 0.56, y: 0.68 } }, FPS)
    expect(planOf(a, 1.02).replaceCount).toBe(2)
  })
  it('подпись: якорь чуть ниже точки подписи (под ней — игрок)', () => {
    const t = {
      id,
      space: 'screen',
      type: 'text',
      pos: { x: 0.4, y: 0.3 },
      text: '7',
      style: { color: '#fff', size: 0.04, background: true },
      timing: range
    } as Annotation
    const p = planOf(t)
    expect(p.anchor.x).toBeCloseTo(0.4, 6)
    expect(p.anchor.y).toBeGreaterThan(0.3)
  })
  it('кольцо на поле: переводится в экранное, якорь по виду на кадре', () => {
    const cal = sampleCalibration()
    const ring = {
      id,
      space: 'pitch',
      calibrationId: cal.id,
      type: 'ring',
      center: { x: 8, y: 34 },
      radius: 1.2,
      style,
      timing: range
    } as Annotation
    const p = planTracking(ring, { now: 1.02, fps: FPS, videoDuration: 10, calibration: cal })
    if (!p.ok) throw new Error(p.reason)
    expect(p.convertedFromPitch).toBe(true)
    expect(p.base.space).toBe('screen')
    expect(p.base.type).toBe('circle')
    expect(AnnotationSchema.safeParse(p.base).success).toBe(true)
  })
  it('рисунок на поле без разметки — отказ', () => {
    const ring = { ...circle(), space: 'pitch', type: 'ring', calibrationId: id } as Annotation
    const p = planTracking(ring, { now: 1.02, fps: FPS, videoDuration: 10, calibration: null })
    expect(p).toEqual({ ok: false, reason: 'no-calibration' })
  })
})

describe('continueFrom: «Продолжить слежение»', () => {
  const tracked = (): Annotation => {
    const a = circle()
    const plan = planOf(a)
    const r = applyTrackResult(a, run(1, 2.5), plan, { fps: FPS })
    if (!r.ok) throw new Error(r.reason)
    return r.annotation
  }
  it('нет авто-ключей — продолжать нечего', () => {
    expect(continueFrom(circle(), FPS)).toBeNull()
  })
  it('отрезок кончается там же, где ключи — нечего', () => {
    const a = circle()
    const plan = planOf(a)
    const r = applyTrackResult(a, run(1, 5), plan, { fps: FPS })
    if (!r.ok) throw new Error(r.reason)
    expect(continueFrom(r.annotation, FPS)).toBeNull()
  })
  it('отрезок дальше последнего ключа — старт с последнего ключа', () => {
    const a = tracked()
    const last = keysOf(a).at(-1)!
    expect(continueFrom(a, FPS)).toBeCloseTo(last.t, 6)
    const p = planTracking(a, { now: 1.5, fps: FPS, videoDuration: 10, calibration: null })
    if (!p.ok) throw new Error(p.reason)
    expect(p.mode).toBe('continue')
    expect(p.at).toBeCloseTo(last.t, 6)
    expect(p.from).toBeCloseTo(last.t - 0.5 / FPS, 6)
  })
})

describe('applyTrackResult: траектория → ключи рисунка', () => {
  it('ключи auto, прореженные; кольцо у ног на последнем кадре', () => {
    const a = circle()
    const plan = planOf(a)
    const samples = run(1, 3)
    const r = applyTrackResult(a, samples, plan, { fps: FPS })
    if (!r.ok) throw new Error(r.reason)
    const keys = keysOf(r.annotation)
    expect(keys.length).toBeGreaterThanOrEqual(2)
    expect(keys.length).toBeLessThan(samples.length)
    expect(keys.every((k) => k.auto === true)).toBe(true)
    const last = samples.at(-1)!
    const g = geomAt(r.annotation, last.t) as {
      p1: { x: number; y: number }
      p2: { x: number; y: number }
    }
    // Смещение от ног, как нарисовал тренер: центр 0.33 при ногах 0.332 на кадре старта.
    expect((g.p1.x + g.p2.x) / 2).toBeCloseTo(last.foot.x - 0.002, 3)
    expect((g.p1.y + g.p2.y) / 2).toBeCloseTo(0.65, 3)
    expect(AnnotationSchema.safeParse(r.annotation).success).toBe(true)
  })

  it('пустой список отсчётов — ошибка, рисунок не меняется', () => {
    const a = circle()
    expect(applyTrackResult(a, [], planOf(a), { fps: FPS })).toEqual({ ok: false, reason: 'empty' })
  })

  it('поправили кольцо руками и нажали «Следить» с этого кадра: ручной ключ на месте, до него — прежнее слежение, после — новое', () => {
    const a0 = circle()
    const first = applyTrackResult(a0, run(1, 4), planOf(a0), { fps: FPS })
    if (!first.ok) throw new Error(first.reason)
    const dragged = upsertKey(first.annotation, 2.0, geomAt(first.annotation, 2.0), FPS)
    const manualKey = keysOf(dragged).find((k) => !k.auto)!
    expect(manualKey).toBeDefined()
    const plan = planOf(dragged, 2.02)
    expect(plan.mode).toBe('start')
    expect(plan.at).toBeCloseTo(manualKey.t, 6)
    const again = applyTrackResult(dragged, run(2.0, 4), plan, { fps: FPS })
    if (!again.ok) throw new Error(again.reason)
    const keys = keysOf(again.annotation)
    expect(keys.filter((k) => !k.auto)).toHaveLength(1)
    expect(keys.some((k) => !k.auto && Math.abs(k.t - manualKey.t) < 1e-9)).toBe(true)
    // Ручной ключ перед ключами слежения: переход равномерный (не «плавный»), игрок и кольцо не расходятся посередине.
    expect(keys.find((k) => !k.auto)!.ease).toBe('linear')
    const mid = geomAt(again.annotation, 2.5) as { p1: { x: number }; p2: { x: number } }
    const foot = 0.33 + 0.1 * (2.5 - 1) // ноги игрока в момент 2.5, как в run()
    expect((mid.p1.x + mid.p2.x) / 2 - foot).toBeCloseTo(0, 2)
    // До места: ключи прежнего слежения на месте и не тронуты.
    const before = keys.filter((k) => k.t < plan.at - 1e-9)
    const beforeOld = keysOf(dragged).filter((k) => k.t < plan.at - 1e-9)
    expect(before).toEqual(beforeOld)
    // После места: новые авто-ключи (последний — на конце слежения).
    expect(keys.at(-1)!.auto).toBe(true)
    expect(keys.at(-1)!.t).toBeGreaterThan(3.9)
  })

  it('«Следить» не на ручном ключе, а отрезок растянут дальше последнего — продолжение с последнего ключа', () => {
    const a0 = circle()
    const first = applyTrackResult(a0, run(1, 3), planOf(a0), { fps: FPS })
    if (!first.ok) throw new Error(first.reason)
    const plan = planOf(first.annotation, 1.5)
    expect(plan.mode).toBe('continue')
    const again = applyTrackResult(first.annotation, run(plan.at - 0.02, 5), plan, { fps: FPS })
    if (!again.ok) throw new Error(again.reason)
    expect(keysOf(again.annotation).every((k) => k.auto)).toBe(true)
    expect(keysOf(again.annotation).at(-1)!.t).toBeGreaterThan(4.9)
  })

  it('ручной ключ-опора после места: игрок рядом — слежение идёт через него', () => {
    const a0 = circle()
    const first = applyTrackResult(a0, run(1, 4), planOf(a0), { fps: FPS })
    if (!first.ok) throw new Error(first.reason)
    // Ключ на кадре 1.5 (место старта) и ручной ключ-опора на 3.0 ровно там, где игрок.
    let a = upsertKey(first.annotation, 1.5, geomAt(first.annotation, 1.5), FPS)
    a = upsertKey(a, 3.0, geomAt(first.annotation, 3.0), FPS)
    const plan = planOf(a, 1.52)
    const again = applyTrackResult(a, run(1.5, 4), plan, { fps: FPS })
    if (!again.ok) throw new Error(again.reason)
    expect(again.diverged).toBeUndefined()
    expect(keysOf(again.annotation).filter((k) => !k.auto)).toHaveLength(2)
  })

  it('слежение расходится с ручным ключом-опорой — останавливается перед ним', () => {
    const a0 = circle()
    const first = applyTrackResult(a0, run(1, 4), planOf(a0), { fps: FPS })
    if (!first.ok) throw new Error(first.reason)
    // Ключ на кадре 1.5 (место старта) и ручной ключ на 3.0 далеко от игрока (кольцо увели на другого).
    const g = geomAt(first.annotation, 3.0) as {
      p1: { x: number; y: number }
      p2: { x: number; y: number }
    }
    const far = { p1: { x: g.p1.x - 0.3, y: g.p1.y }, p2: { x: g.p2.x - 0.3, y: g.p2.y } }
    let a = upsertKey(first.annotation, 1.5, geomAt(first.annotation, 1.5), FPS)
    a = upsertKey(a, 3.0, far, FPS)
    const far3 = keysOf(a).find((k) => !k.auto && k.t > 2.5)!
    const plan = planOf(a, 1.52)
    const again = applyTrackResult(a, run(1.5, 4), plan, { fps: FPS })
    if (!again.ok) throw new Error(again.reason)
    expect(again.diverged).toBeDefined()
    expect(again.diverged!.t).toBeCloseTo(far3.t, 6)
    const keys = keysOf(again.annotation)
    // Новое слежение кончается до ручного; старые авто-ключи после опоры остаются; ручной на месте.
    const oldAfter = keysOf(a).filter((k) => k.auto && k.t > far3.t + 1e-9)
    expect(oldAfter.length).toBeGreaterThan(0)
    expect(keys.filter((k) => k.auto && k.t > far3.t + 1e-9)).toEqual(oldAfter)
    expect(keys.some((k) => !k.auto && Math.abs(k.t - far3.t) < 1e-9)).toBe(true)
  })

  it('число ключей не больше MAX_KEYFRAMES даже на шумной траектории', () => {
    const a = circle({ timing: { mode: 'range', start: 0, duration: 60 } })
    const HZ = 60
    const plan = planTracking(a, { now: 0.5 / HZ, fps: HZ, videoDuration: 100, calibration: null })
    if (!plan.ok) throw new Error(plan.reason)
    // Минута по 60 кадров (3600 отсчётов), шум 1 % кадра: прореживание сначала оставляет почти всё.
    let seed = 1
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const samples: TrackSample[] = []
    for (let k = 0; k < 3600; k += 1) {
      samples.push({
        t: (k + 0.5) / HZ,
        foot: { x: 0.5 + (rnd() - 0.5) * 0.02, y: 0.65 + (rnd() - 0.5) * 0.02 },
        height: 0.3
      })
    }
    const r = applyTrackResult(a, samples, plan, { fps: HZ })
    if (!r.ok) throw new Error(r.reason)
    expect(keysOf(r.annotation).length).toBeGreaterThan(1000)
    expect(keysOf(r.annotation).length).toBeLessThanOrEqual(MAX_KEYFRAMES)
    expect(AnnotationSchema.safeParse(r.annotation).success).toBe(true)
  })

  it('прожектор: овал накрывает всю фигуру игрока, даже если нарисован только у ног', () => {
    const spot = {
      id,
      space: 'screen',
      type: 'spot',
      p1: { x: 0.31, y: 0.62 },
      p2: { x: 0.35, y: 0.68 },
      dim: 0.5,
      style,
      timing: range
    } as Annotation
    const r = applyTrackResult(spot, run(1, 2), planOf(spot), { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const g = geomAt(r.annotation, 1.02) as {
      p1: { x: number; y: number }
      p2: { x: number; y: number }
    }
    // Фигура: ноги на y=0.65, рост 0.3 → голова на 0.35.
    expect(Math.min(g.p1.y, g.p2.y)).toBeLessThanOrEqual(0.35)
    expect(Math.max(g.p1.y, g.p2.y)).toBeGreaterThanOrEqual(0.65)
  })

  it('столб: овал заменяется следом под ногами игрока, столб идёт за ним (низ овала = ноги на каждом ключе)', () => {
    const spot = {
      id,
      space: 'screen',
      type: 'spot',
      form: 'pillar',
      p1: { x: 0.1, y: 0.1 },
      p2: { x: 0.2, y: 0.2 },
      dim: 0.5,
      style,
      timing: range
    } as Annotation
    const r = applyTrackResult(spot, run(1, 2), planOf(spot), { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.annotation.type === 'spot' && r.annotation.form).toBe('pillar')
    const samples = run(1, 2)
    for (const t of [1.02, 1.5, 1.98]) {
      const g = geomAt(r.annotation, t) as {
        p1: { x: number; y: number }
        p2: { x: number; y: number }
      }
      const sample = samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a))
      // Низ-середина овала — ноги игрока (±0.01 доли кадра), а не центр фигуры.
      expect((g.p1.x + g.p2.x) / 2).toBeCloseTo(sample.foot.x, 1)
      expect(Math.max(g.p1.y, g.p2.y)).toBeCloseTo(sample.foot.y, 1)
    }
  })

  it('столб, уже стоящий у ног игрока по ширине фигуры, не трогаем', () => {
    // Ноги на y=0.65, рост 0.3 (aspect 16/9: фигура шириной 0.45·0.3/1.78 ≈ 0.076), столб 0.6·ширина овала ≈ фигуре.
    const spot = {
      id,
      space: 'screen',
      type: 'spot',
      form: 'pillar',
      p1: { x: 0.3, y: 0.62 },
      p2: { x: 0.3 + 0.126, y: 0.66 },
      dim: 0.5,
      style,
      timing: range
    } as Annotation
    const r = applyTrackResult(spot, run(1, 2), planOf(spot), { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const g = geomAt(r.annotation, 1.02) as {
      p1: { x: number; y: number }
      p2: { x: number; y: number }
    }
    expect(g.p1.y).toBeCloseTo(0.62, 6)
    expect(g.p2.y).toBeCloseTo(0.66, 6)
  })

  it('прожектор, уже накрывающий фигуру, не трогаем', () => {
    const spot = {
      id,
      space: 'screen',
      type: 'spot',
      p1: { x: 0.25, y: 0.2 },
      p2: { x: 0.45, y: 0.75 },
      dim: 0.5,
      style,
      timing: range
    } as Annotation
    const r = applyTrackResult(spot, run(1, 2), planOf(spot), { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const g = geomAt(r.annotation, 1.02) as {
      p1: { x: number; y: number }
      p2: { x: number; y: number }
    }
    expect(g.p1.y).toBeCloseTo(0.2, 6)
    expect(g.p2.y).toBeCloseTo(0.75, 6)
  })

  it('кольцо на поле → экранный круг «под игроками» с ключами', () => {
    const cal = sampleCalibration()
    const ring = {
      id,
      space: 'pitch',
      calibrationId: cal.id,
      type: 'ring',
      center: { x: 8, y: 34 },
      radius: 1.2,
      style,
      timing: range
    } as Annotation
    const plan = planTracking(ring, { now: 1.02, fps: FPS, videoDuration: 10, calibration: cal })
    if (!plan.ok) throw new Error(plan.reason)
    const r = applyTrackResult(ring, run(1, 2, 0.05), plan, { fps: FPS })
    if (!r.ok) throw new Error(r.reason)
    expect(r.annotation.space).toBe('screen')
    expect(r.annotation.type).toBe('circle')
    expect((r.annotation as { underPlayers?: boolean }).underPlayers).toBe(true)
    expect(keysOf(r.annotation).length).toBeGreaterThan(1)
  })
})

describe('одна запись в истории', () => {
  it('replaceAnnotation: слежение с конвертацией отменяется одним Ctrl+Z', () => {
    const cal = sampleCalibration()
    const ring = {
      id,
      space: 'pitch',
      calibrationId: cal.id,
      type: 'ring',
      center: { x: 8, y: 34 },
      radius: 1.2,
      style,
      timing: range
    } as Annotation
    const store = useAnnotationsStore
    store.getState().reset()
    store.getState().load([ring])
    const plan = planTracking(ring, { now: 1.02, fps: FPS, videoDuration: 10, calibration: cal })
    if (!plan.ok) throw new Error(plan.reason)
    const r = applyTrackResult(ring, run(1, 2, 0.05), plan, { fps: FPS })
    if (!r.ok) throw new Error(r.reason)
    store.getState().replaceAnnotation(id, r.annotation)
    expect(store.getState().past).toHaveLength(1)
    expect(store.getState().items[0].type).toBe('circle')
    store.getState().undo()
    expect(store.getState().items[0].type).toBe('ring')
    expect(keysOf(store.getState().items[0])).toHaveLength(0)
    store.getState().redo()
    expect(store.getState().items[0].type).toBe('circle')
  })
})

describe('stopMessage: сообщение об остановке', () => {
  it('три причины', () => {
    expect(stopMessage({ t: 251.6, reason: 'cut' })).toBe(
      'Игрок потерян на 04:11.6 — смена плана. Поставьте рисунок на игрока и нажмите «Следить» ещё раз.'
    )
    expect(stopMessage({ t: 5, reason: 'out' })).toContain('вышел из кадра')
    expect(stopMessage({ t: 5, reason: 'occluded' })).toContain('закрыт другими игроками')
  })
})

describe('autoRuns: полоса «слежение» на дорожке', () => {
  it('серии подряд идущих авто-ключей; ручные ключи серию разрывают', () => {
    const k = (auto: boolean): { auto?: true } => (auto ? { auto: true } : {})
    expect(autoRuns([])).toEqual([])
    expect(autoRuns([k(false), k(false)])).toEqual([])
    expect(autoRuns([k(true), k(true), k(true)])).toEqual([[0, 2]])
    expect(autoRuns([k(false), k(true), k(true), k(false), k(true)])).toEqual([
      [1, 2],
      [4, 4]
    ])
  })
})

describe('planSeconds: оценка времени по бэкенду прошлого запуска', () => {
  const plan = { from: 0, to: 10 } as TrackPlan
  it('до первого запуска — худший случай (WASM), после запуска на WebGPU — оценка для видеокарты, после WASM — снова процессор', () => {
    rememberBackend(null)
    const first = planSeconds(plan, FPS)
    rememberBackend('webgpu')
    const gpu = planSeconds(plan, FPS)
    expect(gpu).toBeLessThan(first)
    expect(gpu).toBe(Math.round(estimateSeconds(10, 'webgpu', FPS)))
    rememberBackend('wasm')
    expect(planSeconds(plan, FPS)).toBe(first)
    rememberBackend(null)
  })
})

type Gm = { p1: { x: number; y: number }; p2: { x: number; y: number } }

describe('слежение: кольцо охватывает ноги игрока', () => {
  const firstGeom = (a: Annotation, samples: TrackSample[]): { g: Gm; plan: TrackPlan } => {
    const plan = planOf(a)
    const r = applyTrackResult(a, samples, plan, { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const k = keysOf(r.annotation)[0]
    return {
      g: k.geom as { p1: { x: number; y: number }; p2: { x: number; y: number } },
      plan
    }
  }
  const centre = (g: Gm): { x: number; y: number } => ({
    x: (g.p1.x + g.p2.x) / 2,
    y: (g.p1.y + g.p2.y) / 2
  })

  it('новое кольцо у ног (glow, не больше 1.5 рамки): центр — ноги с подъёмом, ширина 0.72 рамки, сплющивание сохраняется', () => {
    const a = circle({ glow: true } as Partial<Annotation>)
    const samples = run(1, 3)
    const { g, plan } = firstGeom(a, samples)
    const foot = samples.reduce((b, s) =>
      Math.abs(s.t - plan.at) < Math.abs(b.t - plan.at) ? s : b
    )
    expect(centre(g).x).toBeCloseTo(foot.foot.x, 2)
    expect(centre(g).y).toBeCloseTo(foot.foot.y - 0.07 * 0.3, 2)
    const w = (g.p2.x - g.p1.x) * (16 / 9)
    expect(w).toBeCloseTo(0.72 * 0.3, 2)
    expect((g.p2.y - g.p1.y) / w).toBeCloseTo(0.5625, 2)
  })

  it('старый круг (без glow) остаётся как нарисован: смещение и размер', () => {
    const a = circle()
    const before = a as unknown as { p1: { x: number }; p2: { x: number } }
    const { g } = firstGeom(a, run(1, 3))
    expect(g.p2.x - g.p1.x).toBeCloseTo(before.p2.x - before.p1.x, 3)
    expect(centre(g).y).toBeCloseTo(0.65, 3)
  })

  it('большой круг на группу (шире 1.5 рамки) остаётся как нарисован', () => {
    const a = circle({
      glow: true,
      p1: { x: 0.1, y: 0.4 },
      p2: { x: 0.6, y: 0.9 }
    } as Partial<Annotation>)
    const { g } = firstGeom(a, run(1, 3))
    expect(g.p2.x - g.p1.x).toBeCloseTo(0.5, 3)
    expect(g.p2.y - g.p1.y).toBeCloseTo(0.5, 3)
  })

  it('кольцо с поля сохраняет размер из перевода в экран', () => {
    const cal = sampleCalibration()
    const ring = {
      id,
      space: 'pitch',
      calibrationId: cal.id,
      type: 'ring',
      center: { x: 8, y: 30 },
      radius: 1.5,
      glow: true,
      style,
      fillOpacity: 0.06,
      timing: range
    } as Annotation
    const plan = planTracking(ring, { now: 1.02, fps: FPS, videoDuration: 10, calibration: cal })
    if (!plan.ok) throw new Error(plan.reason)
    const conv = plan.base as unknown as { p1: { x: number }; p2: { x: number } }
    const r = applyTrackResult(ring, run(1, 3), plan, { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const g = keysOf(r.annotation)[0].geom as { p1: { x: number }; p2: { x: number } }
    expect(g.p2.x - g.p1.x).toBeCloseTo(conv.p2.x - conv.p1.x, 3)
  })
})
