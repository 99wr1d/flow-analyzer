import { describe, expect, it } from 'vitest'
import type { Annotation } from './annotations'
import {
  GLOW_ALPHA,
  GLOW_LAYERS,
  GLOW_REACH,
  PULSE_PERIOD,
  PULSE_STEPS,
  dashStyle,
  glowStack,
  isTimeVarying,
  pulseActive,
  pulsePhase,
  textShadowLayers,
  revealFraction
} from './styleFx'

const arrow = (
  extra: object,
  timing: object = { mode: 'range', start: 2, duration: 4 }
): Annotation =>
  ({
    id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
    space: 'screen',
    type: 'arrow',
    p1: { x: 0.1, y: 0.1 },
    p2: { x: 0.5, y: 0.5 },
    style: { color: '#ffffff', width: 0.01, dash: 'solid' },
    timing,
    ...extra
  }) as Annotation

describe('revealFraction', () => {
  it('без поля reveal линия целиком', () => {
    expect(revealFraction(arrow({}), 2)).toBe(1)
  })
  it('начало, середина, после N', () => {
    const a = arrow({ reveal: 1 })
    expect(revealFraction(a, 2)).toBe(0)
    expect(revealFraction(a, 2.5)).toBeCloseTo(0.5)
    expect(revealFraction(a, 3)).toBe(1)
    expect(revealFraction(a, 5)).toBe(1)
  })
  it('до начала отрезка — 0 (не отрицательная)', () => {
    expect(revealFraction(arrow({ reveal: 1 }), 1)).toBe(0)
  })
  it('отрезок короче N: N = 0.8 · отрезка', () => {
    const a = arrow({ reveal: 3 }, { mode: 'range', start: 0, duration: 1 })
    expect(revealFraction(a, 0.4)).toBeCloseTo(0.5)
    expect(revealFraction(a, 0.8)).toBe(1)
  })
  it('режим «кадр» — целиком', () => {
    const a = arrow({ reveal: 1 }, { mode: 'frame', start: 2, freezeSeconds: 3 })
    expect(revealFraction(a, 2)).toBe(1)
  })
  it('зависит только от времени: тот же момент — та же доля', () => {
    const a = arrow({ reveal: 1.2 })
    expect(revealFraction(a, 2.6)).toBe(revealFraction(a, 2.6))
  })
})

describe('pulsePhase', () => {
  it('период 1.5 с, значения в [0, 1)', () => {
    expect(PULSE_PERIOD).toBe(1.5)
    expect(pulsePhase(0)).toBe(0)
    expect(pulsePhase(0.75)).toBeCloseTo(0.5)
    expect(pulsePhase(0.3)).toBeCloseTo(pulsePhase(0.3 + 1.5 * 7))
    for (const t of [0, 0.1, 1.49, 1.5, 99.9]) {
      expect(pulsePhase(t)).toBeGreaterThanOrEqual(0)
      expect(pulsePhase(t)).toBeLessThan(1)
    }
  })
})

describe('pulsePhase: ступени', () => {
  it('фаза — кратная 1/PULSE_STEPS, не больше PULSE_STEPS разных значений', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 20000; i += 1) {
      const p = pulsePhase(i * 0.00123)
      expect(Math.round(p * PULSE_STEPS)).toBeCloseTo(p * PULSE_STEPS, 9)
      seen.add(p)
    }
    expect(seen.size).toBe(PULSE_STEPS)
  })
  it('в пределах ступени фаза не меняется, на границе скачок, не вперёд времени', () => {
    expect(pulsePhase(0.001)).toBe(0)
    expect(pulsePhase(1.5 / PULSE_STEPS - 0.001)).toBe(0)
    expect(pulsePhase(1.5 / PULSE_STEPS + 0.001)).toBe(1 / PULSE_STEPS)
    expect(pulsePhase(1.49999)).toBe((PULSE_STEPS - 1) / PULSE_STEPS)
  })
})

describe('pulseActive', () => {
  const ring = (extra: object, mode: 'range' | 'frame' = 'range'): Annotation =>
    ({
      id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
      space: 'screen',
      type: 'ring',
      p1: { x: 0.1, y: 0.1 },
      p2: { x: 0.2, y: 0.2 },
      style: { color: '#ffffff', width: 0.01, dash: 'solid' },
      timing:
        mode === 'range' ? { mode, start: 0, duration: 3 } : { mode, start: 0, freezeSeconds: 2 },
      ...extra
    }) as unknown as Annotation
  it('только кольцо/круг с pulse и отрезком', () => {
    expect(pulseActive(ring({ pulse: true }))).toBe(true)
    expect(pulseActive(ring({ pulse: true }, 'frame'))).toBe(false)
    expect(pulseActive(ring({}))).toBe(false)
    expect(pulseActive(arrow({ pulse: true }))).toBe(false)
  })
})

describe('isTimeVarying', () => {
  it('обычный рисунок — нет', () => expect(isTimeVarying(arrow({}))).toBe(false))
  it('проявление — да', () => expect(isTimeVarying(arrow({ reveal: 0.8 }))).toBe(true))
  it('пульс — да, пульс выключен — нет', () => {
    const c = { type: 'circle', p1: { x: 0.1, y: 0.1 }, p2: { x: 0.2, y: 0.2 } }
    expect(isTimeVarying(arrow({ ...c, pulse: true }))).toBe(true)
    expect(isTimeVarying(arrow({ ...c, pulse: false }))).toBe(false)
  })
  it('пульс в режиме «кадр» — нет (стоп-кадр без волны)', () => {
    const c = { type: 'circle', p1: { x: 0.1, y: 0.1 }, p2: { x: 0.2, y: 0.2 }, pulse: true }
    expect(isTimeVarying(arrow(c, { mode: 'frame', start: 2, freezeSeconds: 3 }))).toBe(false)
  })
  it('проявление в режиме «кадр» не меняется со временем', () => {
    expect(isTimeVarying(arrow({ reveal: 1 }, { mode: 'frame', start: 2, freezeSeconds: 3 }))).toBe(
      false
    )
  })
})

describe('glowStack: ореол «стопкой» полупрозрачных линий', () => {
  it('слои от внешнего к внутреннему, вылет за обводку 2-3 её толщины', () => {
    const stack = glowStack(4, 4)
    expect(stack).toHaveLength(GLOW_LAYERS)
    const widths = stack.map((l) => l.width)
    expect([...widths].sort((a, b) => b - a)).toEqual(widths)
    expect(widths[0]).toBeCloseTo(4 + 2 * GLOW_REACH * 4)
    expect(GLOW_REACH).toBeGreaterThanOrEqual(2)
    expect(GLOW_REACH).toBeLessThanOrEqual(3)
    expect(widths[GLOW_LAYERS - 1]).toBeGreaterThan(4)
  })
  it('у самой обводки ореол накопленно около 15% непрозрачности (едва заметный, как в образце)', () => {
    const stack = glowStack(6, 6)
    const through = stack.reduce((acc, l) => acc * (1 - l.opacity), 1)
    expect(1 - through).toBeGreaterThan(0.1)
    expect(1 - through).toBeLessThan(0.2)
    expect(stack.every((l) => l.opacity === GLOW_ALPHA)).toBe(true)
  })
  it('для кромки (база 0) ширина слоя — только вылет', () => {
    expect(glowStack(0, 5)[0].width).toBeCloseTo(2 * GLOW_REACH * 5)
  })
  it('сверхтонкая обводка получает ореол не уже двух пикселей', () => {
    expect(glowStack(1, 0.2)[0].width).toBeGreaterThanOrEqual(1 + 2 * GLOW_REACH * 2 - 1e-9)
  })
})

describe('textShadowLayers: тонкая тень подписи без плашки', () => {
  it('слои от широкого мягкого к узкому плотному, тень лежит чуть ниже текста и не тяжёлая', () => {
    const l = textShadowLayers(20)
    expect(l.length).toBeGreaterThanOrEqual(2)
    const widths = l.map((x) => x.width)
    expect([...widths].sort((a, b) => b - a)).toEqual(widths)
    expect(l.every((x) => x.dy > 0 && x.opacity > 0 && x.opacity <= 0.6)).toBe(true)
    expect(widths[0]).toBeLessThan(20 * 0.3)
  })
})

describe('dashStyle: точки', () => {
  it('сплошная — без штриховки; штрих — как раньше', () => {
    expect(dashStyle('solid', 4, 100).array).toBeUndefined()
    expect(dashStyle('dashed', 4, 100)).toEqual({ array: '9.6 7.2', cap: 'butt' })
  })

  it('точки: круглые концы, шаг ≈ 2.5 толщины, точка на обоих концах', () => {
    const s = dashStyle('dotted', 4, 100)
    expect(s.cap).toBe('round')
    const [dash, gap] = s.array!.split(' ').map(Number)
    expect(dash).toBeLessThan(0.01)
    expect(dash + gap).toBeGreaterThan(9)
    expect(dash + gap).toBeLessThan(11)
    // Последняя точка лежит на линии, а не за её концом.
    const dots = Math.floor((100 - 0.001) / (dash + gap)) + 1
    expect(dots).toBe(11)
  })

  it('короткая линия — хотя бы две точки', () => {
    const [dash, gap] = dashStyle('dotted', 6, 5).array!.split(' ').map(Number)
    expect(Math.floor(5 / (dash + gap)) + 1).toBeGreaterThanOrEqual(2)
  })

  it('замкнутая: шаг делит периметр поровну', () => {
    const [dash, gap] = dashStyle('dotted', 4, 100, true).array!.split(' ').map(Number)
    expect(100 / (dash + gap)).toBeCloseTo(10, 6)
  })
})
