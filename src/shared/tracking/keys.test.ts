import { describe, expect, it } from 'vitest'
import { AnnotationSchema, type Annotation, type Circle, type Ring } from '../annotations'
import { keysOf, type Keyframe } from '../animation'
import { groundEllipseRatio } from '../pitch/ground'
import { sampleCalibration } from '../pitch/pitch.testkit'
import {
  FOOT_LIFT,
  linkTrackToKeys,
  mergeTrackedKeys,
  pitchToScreenForTracking,
  smoothTrack,
  thinTrack,
  thinTracks,
  trackToKeys,
  type TrackSample
} from './keys'

const FPS = 25
const style = { color: '#ffd60a', width: 0.008, dash: 'solid' as const }
const id = '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11'

const sample = (i: number, x: number, y: number, height = 0.2): TrackSample => ({
  t: (i + 0.5) / FPS,
  foot: { x, y },
  height
})

/** Дрожание: среднеквадратичная вторая разность положения (0 у прямой с постоянной скоростью). */
const jitterOf = (s: readonly TrackSample[]): number => {
  let sum = 0
  let n = 0
  for (let i = 1; i < s.length - 1; i += 1) {
    const dx = s[i - 1].foot.x - 2 * s[i].foot.x + s[i + 1].foot.x
    const dy = s[i - 1].foot.y - 2 * s[i].foot.y + s[i + 1].foot.y
    sum += dx * dx + dy * dy
    n += 1
  }
  return Math.sqrt(sum / Math.max(1, n))
}

describe('smoothTrack: сглаживание траектории ног', () => {
  it('дрожание рамки падает не меньше чем втрое', () => {
    let seed = 11
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296 - 0.5
    }
    const raw = Array.from({ length: 80 }, (_, i) =>
      sample(i, 0.2 + i * 0.005 + rnd() * 0.004, 0.5 + rnd() * 0.004)
    )
    expect(jitterOf(smoothTrack(raw)) * 3).toBeLessThan(jitterOf(raw))
  })
  it('равномерное движение не меняется (в том числе у краёв)', () => {
    const raw = Array.from({ length: 30 }, (_, i) => sample(i, 0.1 + i * 0.01, 0.4 + i * 0.002))
    smoothTrack(raw).forEach((s, i) => {
      expect(s.foot.x).toBeCloseTo(raw[i].foot.x, 9)
      expect(s.foot.y).toBeCloseTo(raw[i].foot.y, 9)
    })
  })
  it('разворот не размазывается: вдали от излома точно по прямым, в изломе отклонение не больше шага кадра', () => {
    const step = 0.01
    const raw = Array.from({ length: 41 }, (_, i) =>
      sample(i, 0.2 + (i <= 20 ? i : 40 - i) * step, 0.5)
    )
    const out = smoothTrack(raw)
    for (const i of [2, 8, 12, 28, 32, 38]) expect(out[i].foot.x).toBeCloseTo(raw[i].foot.x, 9)
    expect(Math.abs(out[20].foot.x - raw[20].foot.x)).toBeLessThan(step * 1.5)
  })
  it('через разрыв по времени не сглаживает: скачок между кусками остаётся', () => {
    const a = Array.from({ length: 10 }, (_, i) => sample(i, 0.2, 0.5))
    const b = Array.from({ length: 10 }, (_, i) => sample(100 + i, 0.8, 0.5))
    const out = smoothTrack([...a, ...b])
    expect(out[9].foot.x).toBeCloseTo(0.2, 9)
    expect(out[10].foot.x).toBeCloseTo(0.8, 9)
  })
  it('время и высота рамки не трогаются; короткие траектории возвращаются как есть', () => {
    const raw = [sample(0, 0.3, 0.3, 0.21), sample(1, 0.31, 0.3, 0.22)]
    expect(smoothTrack(raw)).toEqual(raw)
    expect(smoothTrack([])).toEqual([])
    const mid = smoothTrack(Array.from({ length: 9 }, (_, i) => sample(i, 0.2 + i * 0.01, 0.5, 0.2 + i)))
    mid.forEach((s, i) => {
      expect(s.t).toBe(sample(i, 0, 0).t)
      expect(s.height).toBe(0.2 + i)
    })
  })
})

describe('thinTrack', () => {
  it('прямая движется равномерно — остаются две точки', () => {
    const s = Array.from({ length: 50 }, (_, i) => sample(i, 0.2 + i * 0.01, 0.5))
    const out = thinTrack(s, 2.5 / 720)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(s[0])
    expect(out[1]).toBe(s[49])
  })
  it('ломаная сохраняет излом, ошибка не больше допуска', () => {
    const tol = 2.5 / 720
    // 25 кадров вправо, потом 25 кадров вниз.
    const s = [
      ...Array.from({ length: 25 }, (_, i) => sample(i, 0.1 + i * 0.01, 0.3)),
      ...Array.from({ length: 25 }, (_, i) => sample(25 + i, 0.34, 0.3 + (i + 1) * 0.01))
    ]
    const out = thinTrack(s, tol)
    expect(out.some((p) => p.t === s[24].t)).toBe(true)
    expect(out.length).toBeLessThan(6)
    // Положение по прореженной траектории (линейно между точками) не уходит от исходной дальше допуска.
    for (const p of s) {
      const j = out.findIndex((q) => q.t >= p.t)
      const b = out[j]
      const a = out[Math.max(0, j - 1)]
      const u = b.t > a.t ? (p.t - a.t) / (b.t - a.t) : 0
      const x = a.foot.x + (b.foot.x - a.foot.x) * u
      const y = a.foot.y + (b.foot.y - a.foot.y) * u
      expect(Math.hypot(x - p.foot.x, y - p.foot.y)).toBeLessThanOrEqual(tol + 1e-9)
    }
  })
  it('короткие списки возвращаются как есть', () => {
    const s = [sample(0, 0.1, 0.1), sample(1, 0.2, 0.2)]
    expect(thinTrack(s, 0.01)).toEqual(s)
    expect(thinTrack([], 0.01)).toEqual([])
  })
  it('рост рамки тоже сохраняется: масштаб меняется — точки остаются', () => {
    const s = Array.from({ length: 30 }, (_, i) =>
      sample(i, 0.5, 0.5, i < 15 ? 0.2 : 0.2 + (i - 14) * 0.01)
    )
    const out = thinTrack(s, 2.5 / 720)
    expect(out.length).toBeGreaterThan(2)
  })
})

const ringAtFeet = (): Annotation => ({
  id,
  space: 'screen',
  type: 'circle',
  p1: { x: 0.45, y: 0.52 },
  p2: { x: 0.55, y: 0.6 },
  style,
  underPlayers: true,
  timing: { mode: 'range', start: 1, duration: 3 }
})

describe('trackToKeys', () => {
  it('ключ на каждом сэмпле; центр = ноги + исходное смещение; все ключи auto и linear', () => {
    const a = ringAtFeet()
    // Ноги на старте в (0.5, 0.5): центр круга (0.5, 0.56) — на 0.06 ниже ног.
    const samples = Array.from({ length: 6 }, (_, i) => sample(i, 0.5 + i * 0.02, 0.5 + i * 0.01))
    const keys = trackToKeys(a, samples, samples[0].t)
    expect(keys).toHaveLength(6)
    keys.forEach((key, i) => {
      expect(key.auto).toBe(true)
      expect(key.ease).toBe('linear')
      expect(key.t).toBe(samples[i].t)
      const g = key.geom as { p1: { x: number; y: number }; p2: { x: number; y: number } }
      expect((g.p1.x + g.p2.x) / 2).toBeCloseTo(samples[i].foot.x, 6)
      expect((g.p1.y + g.p2.y) / 2).toBeCloseTo(samples[i].foot.y + 0.06, 6)
    })
  })
  it('размер следует за ростом рамки: рост в 1,5 раза — размер в 1,5 раза', () => {
    const a = ringAtFeet()
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => sample(i, 0.5, 0.5, 0.2)),
      ...Array.from({ length: 10 }, (_, i) => sample(10 + i, 0.5, 0.5, 0.3))
    ]
    const keys = trackToKeys(a, samples, samples[0].t)
    const width = (key: Keyframe): number => {
      const g = key.geom as { p1: { x: number }; p2: { x: number } }
      return g.p2.x - g.p1.x
    }
    expect(width(keys[0])).toBeCloseTo(0.1, 6)
    // Далеко от перехода скользящее среднее уже вышло на новое значение.
    expect(width(keys[19]) / width(keys[0])).toBeCloseTo(1.5, 6)
    // Сглаживание: на переходе размер растёт постепенно, без скачка.
    expect(Math.abs(width(keys[10]) - width(keys[9]))).toBeLessThan(0.05)
  })
  it('подпись над головой остаётся над головой', () => {
    const t: Annotation = {
      id,
      space: 'screen',
      type: 'text',
      pos: { x: 0.5, y: 0.3 },
      text: 'Игрок',
      style: { color: '#ffffff', size: 0.03, background: true },
      timing: { mode: 'range', start: 1, duration: 3 }
    }
    const samples = [sample(0, 0.5, 0.5, 0.2), sample(1, 0.6, 0.5, 0.2)]
    const keys = trackToKeys(t, samples, samples[0].t)
    const pos = keys[1].geom.pos as { x: number; y: number }
    expect(pos.x).toBeCloseTo(0.6, 6)
    expect(pos.y).toBeCloseTo(0.3, 6)
  })
  it('геометрия не выходит за кадр, результат проходит схему', () => {
    const a = ringAtFeet()
    const samples = [sample(0, 0.5, 0.5, 0.2), sample(1, 0.99, 0.99, 0.2)]
    const keys = trackToKeys(a, samples, samples[0].t)
    const out = { ...a, keyframes: keys } as Annotation
    expect(AnnotationSchema.safeParse(out).success).toBe(true)
  })
  it('точка отсчёта — сэмпл, ближайший к at', () => {
    const a = ringAtFeet()
    // Игрок стоит в (0.7, 0.5) на 2-м кадре, рисунок нарисован относительно него.
    const samples = [sample(0, 0.6, 0.5), sample(1, 0.7, 0.5), sample(2, 0.8, 0.5)]
    const keys = trackToKeys(a, samples, samples[1].t)
    const g = keys[2].geom as { p1: { x: number }; p2: { x: number } }
    // Центр круга (0.5) левее ног (0.7) на 0.2 — на последнем кадре ноги в 0.8, центр в 0.6.
    expect((g.p1.x + g.p2.x) / 2).toBeCloseTo(0.6, 6)
  })
  it('пустой список сэмплов — нет ключей', () => {
    expect(trackToKeys(ringAtFeet(), [], 1)).toEqual([])
  })
})

const k = (t: number, auto?: true): Keyframe => ({
  t,
  ease: 'linear',
  geom: { p1: { x: t / 10, y: 0.1 }, p2: { x: t / 10 + 0.1, y: 0.2 } },
  ...(auto ? { auto } : {})
})

describe('mergeTrackedKeys', () => {
  it('ручные до и после from сохраняются, старые авто после from заменяются', () => {
    const existing = [k(1), k(2), k(3), k(4, true), k(5, true), k(6), k(7)]
    const tracked = [k(3.5, true), k(4.5, true), k(5.5, true)]
    const { keys, replacedManual } = mergeTrackedKeys(existing, tracked, 3.2)
    expect(replacedManual).toBe(0)
    expect(keys.map((x) => x.t)).toEqual([1, 2, 3, 3.5, 4.5, 5.5, 6, 7])
    expect(keys.filter((x) => x.auto).map((x) => x.t)).toEqual([3.5, 4.5, 5.5])
  })
  it('ручной ключ побеждает авто-ключ в том же моменте', () => {
    const existing = [k(1), k(2, true), k(5)]
    const tracked = [k(2.5, true), k(5, true), k(5.5, true)]
    const { keys } = mergeTrackedKeys(existing, tracked, 1.5)
    expect(keys.map((x) => x.t)).toEqual([1, 2.5, 5, 5.5])
    expect(keys.find((x) => x.t === 5)?.auto).toBeUndefined()
  })
  it('первое слежение за рисунком с ручной анимацией: ручные после from заменяются и считаются', () => {
    const existing = [k(1), k(2), k(3), k(4)]
    const tracked = [k(2.5, true), k(3.5, true)]
    const { keys, replacedManual } = mergeTrackedKeys(existing, tracked, 2.2)
    expect(replacedManual).toBe(2)
    expect(keys.map((x) => x.t)).toEqual([1, 2, 2.5, 3.5])
  })
  it('ключи до from не трогаются, даже авто', () => {
    const existing = [k(1, true), k(2, true), k(3, true)]
    const { keys } = mergeTrackedKeys(existing, [k(2.5, true)], 2.2)
    expect(keys.map((x) => x.t)).toEqual([1, 2, 2.5])
  })
})

const ring = (over: Partial<Ring> = {}): Ring => ({
  id,
  space: 'pitch',
  calibrationId: '00000000-0000-4000-8000-0000000000c1',
  type: 'ring',
  center: { x: 8, y: 30 },
  radius: 1.5,
  style,
  fillOpacity: 0.06,
  timing: { mode: 'range', start: 12, duration: 3 },
  ...over
})

describe('pitchToScreenForTracking', () => {
  const cal = sampleCalibration()
  it('кольцо → эллипс на экране «под игроками»', () => {
    const out = pitchToScreenForTracking(ring(), cal, 12) as Circle
    expect(out.type).toBe('circle')
    expect(out.space).toBe('screen')
    expect(out.underPlayers).toBe(true)
    expect(out.id).toBe(id)
    expect(out.fillOpacity).toBe(0.06)
    expect(out.style).toEqual(style)
    expect(out.timing).toEqual({ mode: 'range', start: 12, duration: 3 })
    expect(out.p2.x).toBeGreaterThan(out.p1.x)
    expect(out.p2.y).toBeGreaterThan(out.p1.y)
    expect('calibrationId' in out).toBe(false)
    expect(AnnotationSchema.safeParse(out).success).toBe(true)
  })
  it('свечение, вид и пульс кольца переходят в эллипс; у старого кольца этих полей нет', () => {
    const fx = pitchToScreenForTracking(
      ring({ glow: true, look: 'target', pulse: true }),
      cal,
      12
    ) as Circle
    expect(fx.glow).toBe(true)
    expect(fx.look).toBe('target')
    expect(fx.pulse).toBe(true)
    const old = pitchToScreenForTracking(ring(), cal, 12) as Circle
    expect('glow' in old || 'look' in old || 'pulse' in old).toBe(false)
  })
  it('эллипс лежит на траве: отношение высоты к ширине как у круга на поле в этой точке', () => {
    const out = pitchToScreenForTracking(ring(), cal, 12) as Circle
    const w = (out.p2.x - out.p1.x) * cal.aspect
    const h = out.p2.y - out.p1.y
    const centre = { x: (out.p1.x + out.p2.x) / 2, y: (out.p1.y + out.p2.y) / 2 }
    expect(Math.abs(h / w - groundEllipseRatio(cal, centre)) / (h / w)).toBeLessThan(0.1)
  })
  it('прожектор на поле → экранный прожектор с лучом', () => {
    const pspot: Annotation = {
      id,
      space: 'pitch',
      calibrationId: cal.id,
      type: 'pspot',
      center: { x: 8, y: 30 },
      radius: 2.2,
      dim: 0.55,
      beam: true,
      style,
      timing: { mode: 'range', start: 12, duration: 3 }
    }
    const out = pitchToScreenForTracking(pspot, cal, 12)
    expect(out.type).toBe('spot')
    if (out.type !== 'spot') return
    expect(out.space).toBe('screen')
    expect(out.beam).toBe(true)
    expect(out.dim).toBe(0.55)
    expect(AnnotationSchema.safeParse(out).success).toBe(true)
    // Овал: флага «под игроками» нет (на экране прожектор-овал всегда поверх).
    expect('underPlayers' in out).toBe(false)
    // Столб с поля остаётся под игроками (у прожектора на поле это значение по умолчанию), выключенный — поверх.
    const col = pitchToScreenForTracking({ ...pspot, form: 'pillar' } as Annotation, cal, 12)
    expect((col as { underPlayers?: boolean }).underPlayers).toBe(true)
    const off = pitchToScreenForTracking(
      { ...pspot, form: 'pillar', underPlayers: false } as Annotation,
      cal,
      12
    )
    expect((off as { underPlayers?: boolean }).underPlayers).toBe(false)
  })
  it('у анимированного рисунка берётся геометрия на момент t, ключей в результате нет', () => {
    const base = ring({
      keyframes: [
        { t: 12, geom: { center: { x: 8, y: 30 }, radius: 1.5 } },
        { t: 14, geom: { center: { x: 12, y: 30 }, radius: 1.5 } }
      ]
    })
    const early = pitchToScreenForTracking(base, cal, 12) as Circle
    const late = pitchToScreenForTracking(base, cal, 14) as Circle
    expect(keysOf(early)).toHaveLength(0)
    expect(late.p1.x).not.toBeCloseTo(early.p1.x, 3)
  })
  it('рисунок на экране возвращается как есть', () => {
    const a = ringAtFeet()
    expect(pitchToScreenForTracking(a, cal, 12)).toBe(a)
  })
})

// --- Связка: N траекторий → ключи points ---

const track = (n: number, x0: number, y: number, vx: number, height = 0.2): TrackSample[] =>
  Array.from({ length: n }, (_, i) => sample(i, x0 + vx * i, y, height))

describe('thinTracks: прореживание сразу по всем точкам', () => {
  it('все траектории прореживаются по одним и тем же кадрам', () => {
    const a = track(60, 0.1, 0.3, 0.004)
    // Вторая точка меняет направление на 30-м кадре: этот кадр обязан остаться у всех.
    const b = Array.from({ length: 60 }, (_, i) =>
      sample(i, 0.5, 0.6 + (i < 30 ? i : 60 - i) * 0.005)
    )
    const out = thinTracks([a, b], 2.5 / 720)
    expect(out).toHaveLength(2)
    expect(out[0].map((s) => s.t)).toEqual(out[1].map((s) => s.t))
    expect(out[0].some((s) => s.t === a[30].t)).toBe(true)
    expect(out[0].length).toBeGreaterThan(2)
    expect(out[0].length).toBeLessThan(10)
    // Одна траектория совпадает с thinTrack.
    expect(thinTracks([b], 2.5 / 720)[0]).toEqual(thinTrack(b, 2.5 / 720))
  })
  it('прямые траектории — остаются первый и последний кадры', () => {
    const out = thinTracks([track(40, 0.1, 0.3, 0.004), track(40, 0.6, 0.7, -0.003)])
    expect(out[0]).toHaveLength(2)
    expect(out[1]).toHaveLength(2)
  })
  it('пустой список и пустые траектории', () => {
    expect(thinTracks([])).toEqual([])
    expect(thinTracks([[], []])).toEqual([[], []])
  })
})

describe('linkTrackToKeys: ключи points из N траекторий', () => {
  it('точка у ног с подъёмом, как у кольца: foot.y − 0.07 · (сглаженная высота), без смещения щелчка', () => {
    const a = track(10, 0.1, 0.3, 0.01, 0.3)
    const b = track(10, 0.6, 0.7, -0.01, 0.2)
    const keys = linkTrackToKeys([a, b])
    expect(keys).toHaveLength(10)
    expect(keys.every((k) => k.auto === true && k.ease === 'linear')).toBe(true)
    const p = keys[4].geom.points as Array<{ x: number; y: number }>
    expect(p).toHaveLength(2)
    expect(p[0].x).toBeCloseTo(a[4].foot.x, 9)
    expect(p[0].y).toBeCloseTo(0.3 - FOOT_LIFT * 0.3, 9)
    expect(p[1].x).toBeCloseTo(b[4].foot.x, 9)
    expect(p[1].y).toBeCloseTo(0.7 - FOOT_LIFT * 0.2, 9)
    expect(keys.map((k) => k.t)).toEqual(a.map((s) => s.t))
  })
  it('высота рамки сглаживается окном в 5 кадров (дрожание рамки не дрожит точкой)', () => {
    const a = track(11, 0.3, 0.5, 0, 0.2).map((s, i) => ({ ...s, height: i === 5 ? 0.3 : 0.2 }))
    const keys = linkTrackToKeys([a, a])
    const p = keys[5].geom.points as Array<{ y: number }>
    expect(p[0].y).toBeCloseTo(0.5 - FOOT_LIFT * 0.22, 9)
    // а у края окно уже: на кадре 0 среднее по кадрам 0..2
    expect((keys[0].geom.points as Array<{ y: number }>)[0].y).toBeCloseTo(0.5 - FOOT_LIFT * 0.2, 9)
  })
  it('кольцо и точка связки встают на одно и то же место (подъём одинаков)', () => {
    const s = track(10, 0.3, 0.6, 0.01, 0.25)
    const k = linkTrackToKeys([s, s])[0].geom.points as Array<{ x: number; y: number }>
    expect(k[0].y).toBeCloseTo(s[0].foot.y - 0.07 * s[0].height, 9)
  })
  it('точки не выходят за кадр', () => {
    const s = track(4, 0.5, 0.01, 0, 0.5)
    const k = linkTrackToKeys([s, s])[0].geom.points as Array<{ y: number }>
    expect(k[0].y).toBe(0)
  })
  it('пусто — пусто; ключи не чаще KEY_EPS', () => {
    expect(linkTrackToKeys([])).toEqual([])
    expect(linkTrackToKeys([[]])).toEqual([])
    const dup = [sample(0, 0.1, 0.1), sample(0, 0.2, 0.2)]
    expect(linkTrackToKeys([dup, dup])).toHaveLength(1)
  })
})

describe('pitchToScreenForTracking: связка на поле → экранная', () => {
  it('plink → link: те же id, вид, заливка и кольца; точки — по разметке; метров нет', () => {
    const cal = sampleCalibration()
    const plink = {
      id,
      space: 'pitch',
      calibrationId: cal.id,
      type: 'plink',
      points: [
        { x: 12, y: 16 },
        { x: 12, y: 24 },
        { x: 12, y: 33 }
      ],
      closed: true,
      fillOpacity: 0.2,
      rings: false,
      labels: true,
      style,
      glow: true,
      underPlayers: false,
      timing: { mode: 'range' as const, start: 1, duration: 4 }
    } as unknown as Annotation
    const out = pitchToScreenForTracking(plink, cal, 1.5) as unknown as Record<string, unknown>
    expect(out.type).toBe('link')
    expect(out.space).toBe('screen')
    expect(out.id).toBe(id)
    expect(out.closed).toBe(true)
    expect(out.fillOpacity).toBe(0.2)
    expect(out.rings).toBe(false)
    expect(out.glow).toBe(true)
    expect(out.underPlayers).toBe(false)
    expect('labels' in out).toBe(false)
    expect('calibrationId' in out).toBe(false)
    expect((out.points as unknown[]).length).toBe(3)
    expect(AnnotationSchema.safeParse(out).success).toBe(true)
  })
})
