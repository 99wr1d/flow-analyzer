import { describe, expect, it } from 'vitest'
import {
  AnnotationSchema,
  MAX_KEYFRAMES,
  type Annotation,
  type Ring,
  type Zone
} from './annotations'
import {
  addKeyHere,
  applyGeomEdit,
  flatten,
  geomAt,
  insertVertexAllKeys,
  isAnimated,
  isMoving,
  keyIndexAt,
  keysOf,
  movingIndices,
  neighbourKey,
  removeKey,
  removeVertexAllKeys,
  resolveAt,
  retimeKey,
  setKeyEase,
  startAnimation,
  upsertKey
} from './animation'
import { fitHomography, type Correspondence } from './pitch/homography'
import { penaltyAreaRect } from './pitch/landmarks'
import { lookAtCamera } from './pitch/pitch.testkit'
import { makeProjector } from './pitch/projector'

const id = '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11'
const style = { color: '#ffd60a', width: 0.008, dash: 'solid' as const }
const FPS = 25

const arrow = (): Annotation => ({
  id,
  space: 'screen',
  type: 'arrow',
  p1: { x: 0.1, y: 0.2 },
  p2: { x: 0.5, y: 0.6 },
  style,
  timing: { mode: 'range', start: 1, duration: 3 }
})
const ring = (): Ring => ({
  id,
  space: 'pitch',
  calibrationId: '4f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c22',
  type: 'ring',
  center: { x: 10, y: 20 },
  radius: 2,
  style,
  timing: { mode: 'frame', start: 1.02, freezeSeconds: 3 }
})
const zone = (): Zone => ({
  id,
  space: 'screen',
  type: 'zone',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.5, y: 0.5 }
  ],
  opacity: 0.3,
  style,
  timing: { mode: 'range', start: 1, duration: 3 }
})

const px = (g: ReturnType<typeof geomAt>, name: string): number => (g[name] as { x: number }).x

/** Стрелка с двумя ключами: t=1.02 → p1.x 0.1, t=2.02 → p1.x 0.5. */
function twoKeys(ease?: 'linear' | 'ease'): Annotation {
  const a = startAnimation(arrow(), 1.0, FPS, 60)
  const moved = { ...a, p1: { x: 0.5, y: 0.2 } } as Annotation
  const b = applyGeomEdit(a, moved, 2.0, FPS)
  return ease ? setKeyEase(b, 0, ease) : b
}

describe('startAnimation и ключи', () => {
  it('первый ключ в середине кадра, геометрия из рисунка, один ключ — ещё не движение', () => {
    const a = startAnimation(arrow(), 1.0, FPS, 60)
    expect(keysOf(a)).toHaveLength(1)
    expect(keysOf(a)[0].t).toBeCloseTo(1.02, 6)
    expect(isAnimated(a)).toBe(true)
    expect(isMoving(a)).toBe(false)
    expect(resolveAt(a, 3)).toBe(a)
  })
  it('рисунок «Кадр» становится отрезком от своего кадра', () => {
    const a = startAnimation(ring(), 1.02, FPS, 60)
    expect(a.timing).toEqual({ mode: 'range', start: 1.02, duration: 3 })
  })
  it('правка в другое время создаёт ключ (автоключ), в том же кадре — обновляет', () => {
    const a = twoKeys()
    expect(keysOf(a)).toHaveLength(2)
    expect(keysOf(a)[1].t).toBeCloseTo(2.02, 6)
    const again = applyGeomEdit(a, { ...a, p1: { x: 0.9, y: 0.2 } } as Annotation, 2.03, FPS)
    expect(keysOf(again)).toHaveLength(2)
    expect(px(keysOf(again)[1].geom, 'p1')).toBe(0.9)
    const third = applyGeomEdit(a, { ...a, p1: { x: 0.3, y: 0.9 } } as Annotation, 1.5, FPS)
    expect(keysOf(third)).toHaveLength(3)
    const times = keysOf(third).map((k) => k.t)
    expect(times).toEqual([...times].sort((x, y) => x - y))
  })
  it('правка без изменений рисунок не меняет', () => {
    const a = twoKeys()
    expect(applyGeomEdit(a, { ...a, ...geomAt(a, 1.5) } as Annotation, 1.5, FPS)).toBe(a)
  })
  it('геометрия рисунка всегда равна геометрии первого ключа', () => {
    const a = twoKeys()
    expect((a as { p1: { x: number } }).p1.x).toBe(0.1)
    const b = upsertKey(a, 0.5, { p1: { x: 0.7, y: 0.7 }, p2: { x: 0.9, y: 0.9 } }, FPS)
    expect((b as { p1: { x: number } }).p1.x).toBe(0.7)
    expect(b.timing).toEqual({ mode: 'range', start: 0.5, duration: 3.5 })
  })
  it('«Ключ здесь» берёт интерполированную геометрию; повторно в том же кадре — без изменений', () => {
    const a = twoKeys('linear')
    const b = addKeyHere(a, 1.52, FPS)
    expect(keysOf(b)).toHaveLength(3)
    expect(px(keysOf(b)[1].geom, 'p1')).toBeCloseTo(0.3, 6)
    expect(addKeyHere(b, 1.53, FPS)).toBe(b)
  })
  it('не больше MAX_KEYFRAMES ключей', () => {
    let a = startAnimation(arrow(), 0, FPS, 60)
    for (let i = 1; i < MAX_KEYFRAMES + 60; i += 1) {
      a = upsertKey(a, (i + 0.5) / FPS, { p1: { x: 0.2, y: 0.2 }, p2: { x: 0.3, y: 0.3 } }, FPS)
    }
    expect(keysOf(a)).toHaveLength(MAX_KEYFRAMES)
  })
})

describe('geomAt: интерполяция', () => {
  it('равномерно: середина — среднее', () => {
    const a = twoKeys('linear')
    expect(px(geomAt(a, 1.52), 'p1')).toBeCloseTo(0.3, 6)
    expect(px(geomAt(a, 1.27), 'p1')).toBeCloseTo(0.2, 6)
  })
  it('плавно (по умолчанию): в середине то же, на четверти — меньше линейного', () => {
    const a = twoKeys()
    expect(px(geomAt(a, 1.52), 'p1')).toBeCloseTo(0.3, 6)
    // четверть пути: smoothstep(0.25) = 0.15625 → 0.1 + 0.4 * 0.15625
    expect(px(geomAt(a, 1.27), 'p1')).toBeCloseTo(0.1625, 6)
  })
  it('до первого и после последнего ключа — стоит на месте', () => {
    const a = twoKeys()
    expect(px(geomAt(a, 0), 'p1')).toBe(0.1)
    expect(px(geomAt(a, 50), 'p1')).toBe(0.5)
  })
  it('один ключ: геометрия не меняется', () => {
    const a = startAnimation(arrow(), 1.0, FPS, 60)
    expect(geomAt(a, 0)).toEqual(geomAt(a, 9))
  })
  it('на ключах — ровно значения ключей', () => {
    const a = twoKeys()
    expect(px(geomAt(a, 1.02), 'p1')).toBe(0.1)
    expect(px(geomAt(a, 2.02), 'p1')).toBe(0.5)
  })
  it('ease задаётся у ключа, с которого начинается переход', () => {
    const a = setKeyEase(twoKeys('linear'), 0, 'ease')
    expect(px(geomAt(a, 1.27), 'p1')).toBeCloseTo(0.1625, 6)
    expect(setKeyEase(a, 0, 'ease')).toBe(a)
  })
  it('стрелка: интерполируется каждое поле геометрии', () => {
    const a0 = startAnimation(arrow(), 1.0, FPS, 60)
    const edited = { ...a0, p2: { x: 0.9, y: 1 } } as Annotation
    const a = setKeyEase(applyGeomEdit(a0, edited, 2.0, FPS), 0, 'linear')
    const g = geomAt(a, 1.52)
    expect(px(g, 'p2')).toBeCloseTo(0.7, 6)
    expect((g.p2 as { y: number }).y).toBeCloseTo(0.8, 6)
  })
  it('кольцо на поле: центр и радиус интерполируются в метрах', () => {
    const a0 = startAnimation(ring(), 1.02, FPS, 60)
    const a = setKeyEase(
      applyGeomEdit(a0, { ...a0, center: { x: 30, y: 40 }, radius: 6 } as Annotation, 3.02, FPS),
      0,
      'linear'
    )
    const g = geomAt(a, 2.02)
    expect(g.center).toEqual({ x: 20, y: 30 })
    expect(g.radius).toBeCloseTo(4, 6)
  })
  it('зона: вершины интерполируются поэлементно', () => {
    const a0 = startAnimation(zone(), 1.0, FPS, 60)
    const moved = {
      ...a0,
      points: a0.points.map((p) => ({ x: p.x + 0.2, y: p.y }))
    } as Annotation
    const a = setKeyEase(applyGeomEdit(a0, moved, 2.0, FPS), 0, 'linear')
    const pts = geomAt(a, 1.52).points as Array<{ x: number; y: number }>
    expect(pts[0].x).toBeCloseTo(0.2, 6)
    expect(pts[2].x).toBeCloseTo(0.6, 6)
  })
  it('resolveAt: рисунок с геометрией на момент, мемоизация по ссылке и времени', () => {
    const a = twoKeys('linear')
    const r = resolveAt(a, 1.52) as unknown as { p1: { x: number } }
    expect(r.p1.x).toBeCloseTo(0.3, 6)
    expect(resolveAt(a, 1.52)).toBe(r)
    expect(resolveAt(a, 1.6)).not.toBe(r)
  })
  it('кольцо уходит вглубь поля: метры интерполируются, а потом проекция — на экране оно уменьшается', () => {
    const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)
    const pairs: Correspondence[] = penaltyAreaRect({ length: 105, width: 68 }, 'left').map(
      (w) => ({ world: w, image: cam.project(w)! })
    )
    const fit = fitHomography(pairs, cam.aspect)
    if (!fit.ok) throw new Error('камера теста не годится')
    const proj = makeProjector(fit.H)!
    const a0 = startAnimation(ring(), 1.02, FPS, 60)
    const near = { ...a0, center: { x: 14, y: 60 }, radius: 3 } as Annotation
    const far = { ...a0, center: { x: 14, y: 10 }, radius: 3 } as Annotation
    const a = setKeyEase(
      applyGeomEdit(applyGeomEdit(a0, near, 1.02, FPS), far, 3.02, FPS),
      0,
      'linear'
    )
    const radiusPx = (t: number): number => {
      const g = geomAt(a, t) as { center: { x: number; y: number }; radius: number }
      const c = proj.toImage(g.center)!
      const e = proj.toImage({ x: g.center.x + g.radius, y: g.center.y })!
      return Math.hypot((e.x - c.x) * cam.aspect, e.y - c.y)
    }
    const mid = geomAt(a, 2.02) as { center: { y: number } }
    expect(mid.center.y).toBeCloseTo(35, 6)
    expect(radiusPx(1.02)).toBeGreaterThan(radiusPx(2.02))
    expect(radiusPx(2.02)).toBeGreaterThan(radiusPx(3.02))
  })
})

describe('ключи: удаление, сдвиг, соседи, плоская копия', () => {
  it('removeKey: остаётся один ключ — всё ещё «анимирован»; последний ключ убирает анимацию', () => {
    const a = twoKeys()
    const one = removeKey(a, 1)
    expect(keysOf(one)).toHaveLength(1)
    expect(isMoving(one)).toBe(false)
    const none = removeKey(one, 0)
    expect(isAnimated(none)).toBe(false)
    expect('keyframes' in none).toBe(false)
  })
  it('removeKey первого ключа переносит геометрию рисунка на новый первый', () => {
    const a = removeKey(twoKeys(), 0)
    expect((a as { p1: { x: number } }).p1.x).toBe(0.5)
  })
  it('retimeKey: кадр середины, не заходит на соседей, не уходит в минус', () => {
    const a = twoKeys()
    const b = retimeKey(a, 1, 3.0, FPS)
    expect(keysOf(b)[1].t).toBeCloseTo(3.02, 6)
    const c = retimeKey(a, 1, 0.5, FPS)
    expect(keysOf(c)[1].t).toBeCloseTo(1.06, 6)
    const d = retimeKey(a, 0, 5, FPS)
    expect(keysOf(d)[0].t).toBeCloseTo(1.98, 6)
    expect(keysOf(retimeKey(a, 0, -4, FPS))[0].t).toBeCloseTo(0.02, 6)
    expect(retimeKey(a, 1, 2.02, FPS)).toBe(a)
  })
  it('сдвиг ключа за конец отрезка растягивает отрезок', () => {
    const a = retimeKey(twoKeys(), 1, 9.0, FPS)
    expect(a.timing.mode).toBe('range')
    if (a.timing.mode === 'range') {
      expect(a.timing.start).toBe(1)
      expect(a.timing.start + a.timing.duration).toBeCloseTo(9.02, 6)
    }
  })
  it('keyIndexAt и neighbourKey', () => {
    const a = twoKeys()
    expect(keyIndexAt(a, 1.03, FPS)).toBe(0)
    expect(keyIndexAt(a, 1.5, FPS)).toBe(-1)
    expect(neighbourKey(a, 1.5, 1, FPS)).toBe(1)
    expect(neighbourKey(a, 1.5, -1, FPS)).toBe(0)
    expect(neighbourKey(a, 1.02, -1, FPS)).toBeNull()
    expect(neighbourKey(a, 2.02, 1, FPS)).toBeNull()
    expect(neighbourKey(a, 1.02, 1, FPS)).toBe(1)
  })
  it('flatten: застывает в геометрии момента, отрезок не меняется', () => {
    const a = twoKeys('linear')
    const f = flatten(a, 1.52) as unknown as { p1: { x: number }; keyframes?: unknown }
    expect(f.p1.x).toBeCloseTo(0.3, 6)
    expect(f.keyframes).toBeUndefined()
    expect(flatten(a, 1.52).timing).toEqual(a.timing)
  })
  it('movingIndices', () => {
    expect(movingIndices([arrow(), twoKeys(), startAnimation(arrow(), 1, FPS, 60)])).toEqual([1])
  })
})

describe('вершины во всех ключах', () => {
  function animatedZone(): Zone {
    const a0 = startAnimation(zone(), 1.0, FPS, 60)
    const moved = { ...a0, points: a0.points.map((p) => ({ x: p.x + 0.3, y: p.y + 0.1 })) }
    return applyGeomEdit(a0, moved as Annotation, 2.0, FPS) as Zone
  }
  it('вставка: новая вершина есть во всех ключах и лежит на звене', () => {
    const z = insertVertexAllKeys(animatedZone(), 1, 0.5)
    expect(z.points).toHaveLength(4)
    for (const k of keysOf(z)) expect((k.geom.points as unknown[]).length).toBe(4)
    const k0 = keysOf(z)[0].geom.points as Array<{ x: number; y: number }>
    expect(k0[1].x).toBeCloseTo(0.3, 6)
    expect(k0[1].y).toBeCloseTo(0.1, 6)
    const k1 = keysOf(z)[1].geom.points as Array<{ x: number; y: number }>
    expect(k1[1].x).toBeCloseTo(0.6, 6)
  })
  it('вставка после последней вершины замкнутой зоны — между последней и первой', () => {
    const z = insertVertexAllKeys(animatedZone(), 3, 0.5)
    const k0 = keysOf(z)[0].geom.points as Array<{ x: number; y: number }>
    expect(k0[3].x).toBeCloseTo(0.3, 6)
    expect(k0[3].y).toBeCloseTo(0.3, 6)
  })
  it('удаление убирает вершину из всех ключей', () => {
    const z = removeVertexAllKeys(insertVertexAllKeys(animatedZone(), 1, 0.5), 1)
    expect(z.points).toHaveLength(3)
    for (const k of keysOf(z)) expect((k.geom.points as unknown[]).length).toBe(3)
  })
  it('без анимации работает как обычная вставка', () => {
    const z = insertVertexAllKeys(zone(), 1, 0.5)
    expect(z.points).toHaveLength(4)
    expect(keysOf(z)).toHaveLength(0)
  })
})

describe('схема: ключи', () => {
  it('рисунок с ключами проходит проверку и не теряет их', () => {
    const a = twoKeys()
    const parsed = AnnotationSchema.parse(JSON.parse(JSON.stringify(a)))
    expect(keysOf(parsed)).toHaveLength(2)
  })
  it('старый рисунок без ключей проходит', () => {
    expect(AnnotationSchema.safeParse(arrow()).success).toBe(true)
  })
  it('время ключей должно строго возрастать', () => {
    const a = twoKeys() as unknown as { keyframes: Array<{ t: number }> }
    const bad = { ...a, keyframes: [a.keyframes[1], a.keyframes[0]] }
    expect(AnnotationSchema.safeParse(bad).success).toBe(false)
    const same = { ...a, keyframes: [a.keyframes[0], { ...a.keyframes[0] }] }
    expect(AnnotationSchema.safeParse(same).success).toBe(false)
  })
  it('не больше MAX_KEYFRAMES ключей, не пустой список', () => {
    const a = twoKeys() as unknown as { keyframes: Array<{ t: number; geom: unknown }> }
    const many = Array.from({ length: MAX_KEYFRAMES + 1 }, (_, i) => ({
      t: i + 1,
      geom: a.keyframes[0].geom
    }))
    expect(AnnotationSchema.safeParse({ ...a, keyframes: many }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...a, keyframes: [] }).success).toBe(false)
  })
  it('геометрия ключа проверяется по виду рисунка', () => {
    const a = twoKeys() as unknown as { keyframes: Array<{ t: number; geom: unknown }> }
    const bad = {
      ...a,
      keyframes: [{ t: 1, geom: { p1: { x: 5, y: 0 }, p2: { x: 0, y: 0 } } }, a.keyframes[1]]
    }
    expect(AnnotationSchema.safeParse(bad).success).toBe(false)
  })
  it('у зоны во всех ключах одинаковое число вершин', () => {
    const a0 = startAnimation(zone(), 1.0, FPS, 60)
    const a = applyGeomEdit(
      a0,
      { ...a0, points: a0.points.map((p) => ({ x: p.x + 0.1, y: p.y })) } as Annotation,
      2.0,
      FPS
    ) as unknown as { keyframes: Array<{ t: number; geom: { points: unknown[] } }> }
    const bad = {
      ...a,
      keyframes: [
        a.keyframes[0],
        { ...a.keyframes[1], geom: { points: a.keyframes[1].geom.points.slice(0, 2) } }
      ]
    }
    expect(AnnotationSchema.safeParse(bad).success).toBe(false)
    expect(AnnotationSchema.safeParse(a).success).toBe(true)
  })
  it('ease: только linear или ease', () => {
    const a = twoKeys() as unknown as { keyframes: Array<Record<string, unknown>> }
    const bad = { ...a, keyframes: [{ ...a.keyframes[0], ease: 'bounce' }, a.keyframes[1]] }
    expect(AnnotationSchema.safeParse(bad).success).toBe(false)
  })
})

describe('ключи слежения: ручная правка снимает auto', () => {
  const tracked = (): Annotation => {
    const base = arrow()
    return {
      ...base,
      p1: { x: 0.1, y: 0.2 },
      keyframes: [
        {
          t: 1.02,
          ease: 'linear',
          auto: true,
          geom: { p1: { x: 0.1, y: 0.2 }, p2: { x: 0.5, y: 0.6 } }
        },
        {
          t: 1.5,
          ease: 'linear',
          auto: true,
          geom: { p1: { x: 0.2, y: 0.2 }, p2: { x: 0.6, y: 0.6 } }
        },
        {
          t: 2.1,
          ease: 'linear',
          auto: true,
          geom: { p1: { x: 0.3, y: 0.2 }, p2: { x: 0.7, y: 0.6 } }
        }
      ]
    } as Annotation
  }

  it('upsertKey в кадре авто-ключа: ключ становится ручным', () => {
    const next = upsertKey(tracked(), 1.5, { p1: { x: 0.25, y: 0.3 }, p2: { x: 0.6, y: 0.6 } }, FPS)
    const keys = keysOf(next)
    expect(keys).toHaveLength(3)
    expect(keys[1].auto).toBeUndefined()
    expect(keys[0].auto).toBe(true)
    expect(keys[2].auto).toBe(true)
  })

  it('applyGeomEdit по авто-ключу: ключ становится ручным', () => {
    const stored = tracked()
    const edited = { ...stored, p1: { x: 0.9, y: 0.9 } } as Annotation
    const next = applyGeomEdit(stored, edited, 2.1, FPS)
    expect(keysOf(next)[2].auto).toBeUndefined()
  })

  it('retimeKey сдвигает авто-ключ: он становится ручным', () => {
    const next = retimeKey(tracked(), 1, 1.7, FPS)
    expect(keysOf(next)[1].auto).toBeUndefined()
    expect(keysOf(next)[1].t).toBeCloseTo(1.7, 6)
  })

  it('retimeKey не трогает остальные авто-ключи', () => {
    const next = retimeKey(tracked(), 1, 1.7, FPS)
    expect(keysOf(next)[0].auto).toBe(true)
    expect(keysOf(next)[2].auto).toBe(true)
  })
})

describe('movingIndices: рисунки, зависящие от времени', () => {
  const pulsing = (over: object = {}): Annotation =>
    ({
      id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4e01',
      space: 'screen',
      type: 'circle',
      p1: { x: 0.4, y: 0.5 },
      p2: { x: 0.5, y: 0.6 },
      style: { color: '#ff5a1f', width: 0.004, dash: 'solid' },
      timing: { mode: 'range', start: 1, duration: 3 },
      ...over
    }) as Annotation
  it('круг/кольцо с пульсом без ключей попадает в покадровые; без пульса — нет', () => {
    expect(movingIndices([pulsing({ pulse: true }), pulsing(), pulsing({ pulse: false })])).toEqual(
      [0]
    )
  })
})
