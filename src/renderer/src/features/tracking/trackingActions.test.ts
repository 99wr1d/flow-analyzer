import { describe, expect, it } from 'vitest'
import { MAX_KEYFRAMES, AnnotationSchema, type Annotation } from '../../../../shared/annotations'
import { ru } from '../../i18n/ru'
import { estimateSeconds } from '../../../../shared/tracking/trackingIpc'
import { geomAt, keysOf, upsertKey } from '../../../../shared/animation'
import { sampleCalibration } from '../../../../shared/pitch/pitch.testkit'
import { FOOT_LIFT, type TrackSample } from '../../../../shared/tracking/keys'
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { autoRuns } from '../annotations/lanes'
import {
  applyTrackResult,
  canTrack,
  continueFrom,
  planTracking,
  planSeconds,
  rememberBackend,
  footMarker,
  staleOtherPoints,
  startAskKind,
  stopMessage,
  type TrackPlan
} from './trackingApply'

const FPS = 25
const box = { x: 0.1, y: 0.1, w: 0.1, h: 0.3 }
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
    expect(p.anchors[0].x).toBeCloseTo(0.33, 6)
    expect(p.anchors[0].y).toBeCloseTo(0.65, 6)
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
    expect(p.anchors[0].x).toBeCloseTo(0.4, 6)
    expect(p.anchors[0].y).toBeGreaterThan(0.3)
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
    const r = applyTrackResult(a, [run(1, 2.5)], plan, { fps: FPS })
    if (!r.ok) throw new Error(r.reason)
    return r.annotation
  }
  it('нет авто-ключей — продолжать нечего', () => {
    expect(continueFrom(circle(), FPS)).toBeNull()
  })
  it('отрезок кончается там же, где ключи — нечего', () => {
    const a = circle()
    const plan = planOf(a)
    const r = applyTrackResult(a, [run(1, 5)], plan, { fps: FPS })
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
    const r = applyTrackResult(a, [samples], plan, { fps: FPS })
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
    expect(applyTrackResult(a, [[]], planOf(a), { fps: FPS })).toEqual({
      ok: false,
      reason: 'empty'
    })
  })

  it('поправили кольцо руками и нажали «Следить» с этого кадра: ручной ключ на месте, до него — прежнее слежение, после — новое', () => {
    const a0 = circle()
    const first = applyTrackResult(a0, [run(1, 4)], planOf(a0), { fps: FPS })
    if (!first.ok) throw new Error(first.reason)
    const dragged = upsertKey(first.annotation, 2.0, geomAt(first.annotation, 2.0), FPS)
    const manualKey = keysOf(dragged).find((k) => !k.auto)!
    expect(manualKey).toBeDefined()
    const plan = planOf(dragged, 2.02)
    expect(plan.mode).toBe('start')
    expect(plan.at).toBeCloseTo(manualKey.t, 6)
    const again = applyTrackResult(dragged, [run(2.0, 4)], plan, { fps: FPS })
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
    const first = applyTrackResult(a0, [run(1, 3)], planOf(a0), { fps: FPS })
    if (!first.ok) throw new Error(first.reason)
    const plan = planOf(first.annotation, 1.5)
    expect(plan.mode).toBe('continue')
    const again = applyTrackResult(first.annotation, [run(plan.at - 0.02, 5)], plan, { fps: FPS })
    if (!again.ok) throw new Error(again.reason)
    expect(keysOf(again.annotation).every((k) => k.auto)).toBe(true)
    expect(keysOf(again.annotation).at(-1)!.t).toBeGreaterThan(4.9)
  })

  it('ручной ключ-опора после места: игрок рядом — слежение идёт через него', () => {
    const a0 = circle()
    const first = applyTrackResult(a0, [run(1, 4)], planOf(a0), { fps: FPS })
    if (!first.ok) throw new Error(first.reason)
    // Ключ на кадре 1.5 (место старта) и ручной ключ-опора на 3.0 ровно там, где игрок.
    let a = upsertKey(first.annotation, 1.5, geomAt(first.annotation, 1.5), FPS)
    a = upsertKey(a, 3.0, geomAt(first.annotation, 3.0), FPS)
    const plan = planOf(a, 1.52)
    const again = applyTrackResult(a, [run(1.5, 4)], plan, { fps: FPS })
    if (!again.ok) throw new Error(again.reason)
    expect(again.diverged).toBeUndefined()
    expect(keysOf(again.annotation).filter((k) => !k.auto)).toHaveLength(2)
  })

  it('слежение расходится с ручным ключом-опорой — останавливается перед ним', () => {
    const a0 = circle()
    const first = applyTrackResult(a0, [run(1, 4)], planOf(a0), { fps: FPS })
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
    const again = applyTrackResult(a, [run(1.5, 4)], plan, { fps: FPS })
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
    const r = applyTrackResult(a, [samples], plan, { fps: HZ })
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
    const r = applyTrackResult(spot, [run(1, 2)], planOf(spot), { fps: FPS, aspect: 16 / 9 })
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
    const r = applyTrackResult(spot, [run(1, 2)], planOf(spot), { fps: FPS, aspect: 16 / 9 })
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
      // Низ — у ног с тем же подъёмом, что у кольца и точек связки (рамка детектора заходит ниже подошв).
      expect(Math.max(g.p1.y, g.p2.y)).toBeCloseTo(sample.foot.y - FOOT_LIFT * sample.height, 6)
    }
  })

  it('столб у ног игрока по ширине фигуры: размер тренера сохраняется, низ встаёт к ногам (как у кольца, с подъёмом FOOT_LIFT)', () => {
    // Ноги на y=0.65, рост 0.3 (aspect 16/9: фигура шириной 0.45·0.3/1.78 ≈ 0.076), столб 1.1·ширина овала ≈ фигуре.
    const spot = {
      id,
      space: 'screen',
      type: 'spot',
      form: 'pillar',
      p1: { x: 0.3, y: 0.62 },
      p2: { x: 0.3 + 0.0687, y: 0.66 },
      dim: 0.5,
      style,
      timing: range
    } as Annotation
    const r = applyTrackResult(spot, [run(1, 2)], planOf(spot), { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const g = geomAt(r.annotation, 1.02) as {
      p1: { x: number; y: number }
      p2: { x: number; y: number }
    }
    // Ноги 0.65 − подъём 0.07 · рост 0.3; середина — x ног (0.33 + 0.1 · 0.02); ширина и высота овала — как нарисовал тренер.
    expect(Math.max(g.p1.y, g.p2.y)).toBeCloseTo(0.65 - FOOT_LIFT * 0.3, 6)
    expect((g.p1.x + g.p2.x) / 2).toBeCloseTo(0.332, 6)
    expect(Math.abs(g.p2.x - g.p1.x)).toBeCloseTo(0.0687, 6)
    expect(Math.abs(g.p2.y - g.p1.y)).toBeCloseTo(0.04, 6)
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
    const r = applyTrackResult(spot, [run(1, 2)], planOf(spot), { fps: FPS, aspect: 16 / 9 })
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
    const r = applyTrackResult(ring, [run(1, 2, 0.05)], plan, { fps: FPS })
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
    const r = applyTrackResult(ring, [run(1, 2, 0.05)], plan, { fps: FPS })
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
    expect(stopMessage({ t: 251.6, reason: 'cut', target: 0 })).toBe(
      'Игрок потерян на 04:11.6 — смена плана. Поставьте рисунок на игрока и нажмите «Следить» ещё раз.'
    )
    expect(stopMessage({ t: 5, reason: 'out', target: 0 })).toContain('вышел из кадра')
    expect(stopMessage({ t: 5, reason: 'occluded', target: 0 })).toContain(
      'закрыт другими игроками'
    )
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
    const r = applyTrackResult(a, [samples], plan, { fps: FPS, aspect: 16 / 9 })
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
    const r = applyTrackResult(ring, [run(1, 3)], plan, { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const g = keysOf(r.annotation)[0].geom as { p1: { x: number }; p2: { x: number } }
    expect(g.p2.x - g.p1.x).toBeCloseTo(conv.p2.x - conv.p1.x, 3)
  })
})

// --- Связка ---

const linkOf = (over: Partial<Annotation> = {}): Annotation =>
  ({
    id,
    space: 'screen',
    type: 'link',
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.5, y: 0.6 },
      { x: 0.8, y: 0.7 }
    ],
    closed: false,
    fillOpacity: 0.12,
    rings: true,
    style,
    underPlayers: true,
    timing: range,
    ...over
  }) as Annotation

/** Три игрока бегут с разной скоростью; ноги на (x0 + v·(t−1), y), рост 0.3. */
function runs3(t0: number, t1: number, speeds = [0.1, 0.05, -0.05]): TrackSample[][] {
  const base = [
    { x: 0.2, y: 0.5 },
    { x: 0.5, y: 0.6 },
    { x: 0.8, y: 0.7 }
  ]
  return base.map((b, k) => {
    const out: TrackSample[] = []
    for (let n = Math.round(t0 * FPS); (n + 0.5) / FPS < t1; n += 1) {
      const t = (n + 0.5) / FPS
      out.push({ t, foot: { x: b.x + speeds[k] * (t - 1), y: b.y }, height: 0.3 })
    }
    return out
  })
}

type Pts = Array<{ x: number; y: number }>

const plinkOf = (calId: string): Annotation =>
  ({
    id,
    space: 'pitch',
    calibrationId: calId,
    type: 'plink',
    points: [
      { x: 12, y: 16 },
      { x: 12, y: 24 },
      { x: 12, y: 33 }
    ],
    closed: false,
    fillOpacity: 0.12,
    rings: true,
    labels: true,
    style,
    underPlayers: true,
    timing: range
  }) as Annotation

describe('связка: кнопка и план', () => {
  it('у связки (экран и поле) с отрезком кнопка есть, у «Только кадр» — нет', () => {
    expect(canTrack(linkOf())).toBe(true)
    expect(canTrack({ ...linkOf(), type: 'plink', space: 'pitch' } as Annotation)).toBe(true)
    expect(canTrack(linkOf({ timing: { mode: 'frame', start: 1, freezeSeconds: 1 } }))).toBe(false)
  })
  it('якоря — все точки связки на текущем кадре, по порядку', () => {
    const p = planOf(linkOf())
    expect(p.anchors).toEqual([
      { x: 0.2, y: 0.5 },
      { x: 0.5, y: 0.6 },
      { x: 0.8, y: 0.7 }
    ])
    expect(p.mode).toBe('start')
    expect(p.convertedFromPitch).toBe(false)
  })
  it('связка на поле: переводится в экранную по разметке, якоря — по виду на кадре', () => {
    const cal = sampleCalibration()
    const plink = plinkOf(cal.id)
    const p = planTracking(plink, { now: 1.02, fps: FPS, videoDuration: 10, calibration: cal })
    if (!p.ok) throw new Error(p.reason)
    expect(p.convertedFromPitch).toBe(true)
    expect(p.base.type).toBe('link')
    expect(p.anchors).toHaveLength(3)
    const pts = (p.base as unknown as { points: Pts }).points
    p.anchors.forEach((a, i) => {
      expect(a.x).toBeCloseTo(pts[i].x, 9)
      expect(a.y).toBeCloseTo(pts[i].y, 9)
    })
    expect(
      planTracking(plink, { now: 1.02, fps: FPS, videoDuration: 10, calibration: null })
    ).toEqual({ ok: false, reason: 'no-calibration' })
  })
})

describe('связка: траектории → ключи points', () => {
  it('ключи auto, точки у ног с подъёмом, один набор моментов у всех точек; схема цела', () => {
    const a = linkOf()
    const tracks = runs3(1, 3)
    const r = applyTrackResult(a, tracks, planOf(a), { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const keys = keysOf(r.annotation)
    expect(keys.length).toBeGreaterThanOrEqual(2)
    expect(keys.length).toBeLessThan(tracks[0].length)
    expect(keys.every((k) => k.auto === true)).toBe(true)
    keys.forEach((k) => expect((k.geom.points as Pts).length).toBe(3))
    const last = tracks.map((t) => t.at(-1)!)
    const end = geomAt(r.annotation, last[0].t) as unknown as { points: Pts }
    end.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(last[i].foot.x, 3)
      expect(p.y).toBeCloseTo(last[i].foot.y - 0.07 * 0.3, 3)
    })
    // Геометрия рисунка — первый ключ (у ног, а не там, где щёлкнул тренер).
    const first = (r.annotation as unknown as { points: Pts }).points
    expect(first[0].y).toBeCloseTo(0.5 - 0.07 * 0.3, 3)
    expect(AnnotationSchema.safeParse(r.annotation).success).toBe(true)
  })

  it('прореживание по всем точкам сразу: излом одной точки оставляет кадр у всех', () => {
    const a = linkOf()
    const tracks = runs3(1, 3)
    // Вторая точка резко уходит вниз со второй секунды.
    tracks[1] = tracks[1].map((s) => ({
      ...s,
      foot: { x: s.foot.x, y: s.t < 2 ? 0.6 : 0.6 + (s.t - 2) * 0.2 }
    }))
    const r = applyTrackResult(a, tracks, planOf(a), { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    const keys = keysOf(r.annotation)
    expect(keys.some((k) => Math.abs(k.t - 2.0) < 0.05)).toBe(true)
    keys.forEach((k) => expect((k.geom.points as Pts).length).toBe(3))
  })

  it('восемь шумных точек на 120 с — не больше MAX_KEYFRAMES ключей', () => {
    const a = linkOf({
      points: Array.from({ length: 8 }, (_, i) => ({ x: 0.1 + i * 0.1, y: 0.5 })),
      timing: { mode: 'range', start: 1, duration: 120 }
    } as Partial<Annotation>)
    let seed = 7
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const frames = 120 * FPS
    const tracks: TrackSample[][] = Array.from({ length: 8 }, (_, k) =>
      Array.from({ length: frames }, (_, n) => ({
        t: 1 + (n + 0.5) / FPS,
        foot: { x: 0.1 + k * 0.1 + (rnd() - 0.5) * 0.04, y: 0.5 + (rnd() - 0.5) * 0.04 },
        height: 0.3
      }))
    )
    const plan = planOf(a, 1.02)
    const r = applyTrackResult(a, tracks, plan, { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    expect(keysOf(r.annotation).length).toBeLessThanOrEqual(MAX_KEYFRAMES)
    expect(keysOf(r.annotation).length).toBeGreaterThan(100)
  })

  it('пустая траектория — ошибка, рисунок не меняется', () => {
    const a = linkOf()
    expect(applyTrackResult(a, [[], [], []], planOf(a), { fps: FPS })).toEqual({
      ok: false,
      reason: 'empty'
    })
  })

  it('ручная правка точки становится опорой; «Продолжить» идёт от последнего ключа и не трогает правку', () => {
    const a0 = linkOf()
    const first = applyTrackResult(a0, runs3(1, 3), planOf(a0), { fps: FPS, aspect: 16 / 9 })
    if (!first.ok) throw new Error(first.reason)
    // Тренер двигает вторую точку на кадре 2.02 (ручной ключ) — опора.
    const at = geomAt(first.annotation, 2.02) as unknown as { points: Pts }
    const moved = { points: at.points.map((p, i) => (i === 1 ? { x: p.x, y: p.y + 0.02 } : p)) }
    const edited = upsertKey(first.annotation, 2.02, moved, FPS)
    const manual = keysOf(edited).filter((k) => !k.auto)
    expect(manual).toHaveLength(1)
    // На ручном ключе слежение стартует отсюда, не «продолжает».
    expect(planOf(edited, 2.02).mode).toBe('start')
    // Не на ключе — «Продолжить» с последнего авто-ключа.
    const cont = planTracking(edited, { now: 1.5, fps: FPS, videoDuration: 10, calibration: null })
    if (!cont.ok) throw new Error(cont.reason)
    expect(cont.mode).toBe('continue')
    expect(cont.at).toBeCloseTo(keysOf(edited).at(-1)!.t, 6)
    const again = applyTrackResult(edited, runs3(cont.at - 0.02, 5), cont, {
      fps: FPS,
      aspect: 16 / 9
    })
    if (!again.ok) throw new Error(again.reason)
    expect(keysOf(again.annotation).filter((k) => !k.auto)).toEqual(manual)
    expect(keysOf(again.annotation).at(-1)!.t).toBeGreaterThan(4.9)
  })

  it('расхождение с ручной опорой по любой точке останавливает слежение перед ней', () => {
    const a0 = linkOf()
    const first = applyTrackResult(a0, runs3(1, 5), planOf(a0), { fps: FPS, aspect: 16 / 9 })
    if (!first.ok) throw new Error(first.reason)
    // Ручной ключ на 3.02 с: вторая точка далеко от игрока.
    const a = upsertKey(
      first.annotation,
      3.02,
      {
        points: [
          { x: 0.4, y: 0.5 },
          { x: 0.9, y: 0.1 },
          { x: 0.7, y: 0.7 }
        ]
      },
      FPS
    )
    const plan = planOf(a, 1.02)
    const r = applyTrackResult(a, runs3(1, 5), plan, { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.diverged?.t).toBeCloseTo(keysOf(a).find((k) => !k.auto && k.t > 2)!.t, 6)
    expect(keysOf(r.annotation).some((k) => !k.auto)).toBe(true)
  })

  it('связка на поле: результат экранный, один ход истории, Ctrl+Z возвращает связку на поле с метрами', () => {
    const cal = sampleCalibration()
    const plink = plinkOf(cal.id)
    const store = useAnnotationsStore
    store.getState().reset()
    store.getState().load([plink])
    const plan = planTracking(plink, { now: 1.02, fps: FPS, videoDuration: 10, calibration: cal })
    if (!plan.ok) throw new Error(plan.reason)
    const r = applyTrackResult(plink, runs3(1, 2), plan, { fps: FPS, aspect: 16 / 9 })
    if (!r.ok) throw new Error(r.reason)
    store.getState().replaceAnnotation(id, r.annotation)
    expect(store.getState().past).toHaveLength(1)
    expect(store.getState().items[0].type).toBe('link')
    expect(store.getState().items[0].space).toBe('screen')
    store.getState().undo()
    const back = store.getState().items[0] as unknown as {
      type: string
      points: Pts
      labels: boolean
    }
    expect(back.type).toBe('plink')
    expect(back).toEqual(plink)
  })
})

describe('связка: сообщения', () => {
  it('потеря: номер точки и причина', () => {
    expect(stopMessage({ t: 5, reason: 'occluded', target: 1 }, true)).toBe(
      'Точка 2: игрок потерян на 00:05.0 — закрыт другими игроками. Вся связка остановлена на последнем надёжном кадре. Перейдите дальше, поставьте точку на игрока и нажмите «Следить за игроками» ещё раз.'
    )
    expect(stopMessage({ t: 5, reason: 'cut', target: 0 }, true)).toContain('Точка 1:')
    expect(stopMessage({ t: 5, reason: 'out', target: 2 }, true)).toContain('вышел из кадра')
  })
  it('«моего игрока тут нет»: игрок не найден — остановлено на последнем надёжном кадре', () => {
    expect(stopMessage({ t: 5, reason: 'not-here', target: 2 }, true)).toBe(
      'Точка 3: игрок не найден — слежение остановлено на последнем надёжном кадре'
    )
    expect(stopMessage({ t: 5, reason: 'not-here', target: 0 })).toBe(
      'Игрок не найден — слежение остановлено на последнем надёжном кадре'
    )
  })
  it('одиночное слежение: текст прежний', () => {
    expect(stopMessage({ t: 251.6, reason: 'cut', target: 0 })).toBe(
      'Игрок потерян на 04:11.6 — смена плана. Поставьте рисунок на игрока и нажмите «Следить» ещё раз.'
    )
  })
})

describe('связка: вопрос на старте', () => {
  it('несколько рамок — выбор; одна рамка — две точки стоят на одном игроке', () => {
    expect(startAskKind({ candidates: [box, box] })).toBe('pick')
    expect(startAskKind({ candidates: [box], cause: 'same-player' })).toBe('same-player')
    expect(startAskKind({ candidates: [box, box], cause: 'same-player' })).toBe('same-player')
    expect(startAskKind({})).toBe('same-player')
  })
  it('тексты: вопрос по точке и «две точки на одном игроке» с номером', () => {
    expect(ru.tracking.pickPoint(2)).toBe('Точка 2: кто из них ваш? Щёлкните по игроку.')
    expect(ru.tracking.samePlayer(3)).toContain('Точка 3')
    expect(ru.tracking.samePlayer(3)).toContain('одном игроке')
    expect(ru.tracking.samePlayerPoints(1, 3)).toContain('Точки 1 и 3 стоят на одном игроке')
  })
  it('метка в вопросе на ходу: у ног цели с подъёмом как у точек, а не у точки до слежения', () => {
    const m = footMarker({ x: 0.4, y: 0.3, w: 0.06, h: 0.28 })
    expect(m.x).toBeCloseTo(0.43, 9)
    expect(m.y).toBeCloseTo(0.58 - 0.07 * 0.28, 9)
  })
})

describe('связка: «Продолжить» после правки одной точки', () => {
  it('правка одной точки в последнем ключе: остальные стоят по старому ключу — нужна проверка', () => {
    const a0 = linkOf()
    const first = applyTrackResult(a0, runs3(1, 3), planOf(a0), { fps: FPS, aspect: 16 / 9 })
    if (!first.ok) throw new Error(first.reason)
    expect(staleOtherPoints(first.annotation, FPS)).toBe(false)
    const at = geomAt(first.annotation, 4.02) as unknown as { points: Pts }
    const moved = { points: at.points.map((p, i) => (i === 1 ? { x: p.x, y: p.y + 0.02 } : p)) }
    expect(staleOtherPoints(upsertKey(first.annotation, 4.02, moved, FPS), FPS)).toBe(true)
    // Правка всех точек сразу или кольцо — подсказки нет.
    const all = { points: at.points.map((p) => ({ x: p.x, y: p.y + 0.02 })) }
    expect(staleOtherPoints(upsertKey(first.annotation, 4.02, all, FPS), FPS)).toBe(false)
    expect(staleOtherPoints(circle(), FPS)).toBe(false)
  })
})
