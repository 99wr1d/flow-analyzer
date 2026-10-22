import { describe, expect, it } from 'vitest'
import {
  AnnotationSchema,
  defaultDuration,
  frameCenter,
  isVisible,
  parseDuration,
  parseFreeze,
  type Annotation
} from './annotations'

const base = {
  space: 'screen' as const,
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  style: { color: '#ffd60a', width: 0.008, dash: 'solid' as const }
}
const range = (start: number, duration: number): Annotation => ({
  ...base,
  type: 'arrow',
  p1: { x: 0.1, y: 0.1 },
  p2: { x: 0.5, y: 0.5 },
  timing: { mode: 'range', start, duration }
})
const frameAt = (start: number): Annotation => ({
  ...range(0, 1),
  timing: { mode: 'frame', start, freezeSeconds: 3 }
})

describe('isVisible: отрезок', () => {
  const a = range(2, 3)
  it('границы: включительно слева, исключительно справа', () => {
    expect(isVisible(a, 1.999, 25)).toBe(false)
    expect(isVisible(a, 2, 25)).toBe(true)
    expect(isVisible(a, 4.999, 25)).toBe(true)
    expect(isVisible(a, 5, 25)).toBe(false)
    expect(isVisible(a, 5.2, 25)).toBe(false)
  })
})

describe('isVisible: только кадр', () => {
  for (const fps of [25, 30]) {
    it(`виден ровно в одном кадре при ${fps} к/с`, () => {
      const n = 12
      const a = frameAt(frameCenter((n + 0.3) / fps, fps))
      expect(isVisible(a, (n - 0.5) / fps, fps)).toBe(false)
      expect(isVisible(a, n / fps, fps)).toBe(true)
      expect(isVisible(a, (n + 0.5) / fps, fps)).toBe(true)
      expect(isVisible(a, (n + 0.999) / fps, fps)).toBe(true)
      expect(isVisible(a, (n + 1) / fps, fps)).toBe(false)
      expect(isVisible(a, (n + 1.5) / fps, fps)).toBe(false)
    })
  }
  it('frameCenter: середина кадра', () => {
    expect(frameCenter(0, 25)).toBeCloseTo(0.02)
    expect(frameCenter(0.2, 25)).toBeCloseTo(0.22)
    expect(frameCenter(0.0399, 25)).toBeCloseTo(0.02)
  })
})

describe('длительность', () => {
  it('по умолчанию 3 секунды, но не дальше конца видео', () => {
    expect(defaultDuration(0, 10)).toBe(3)
    expect(defaultDuration(8.5, 10)).toBeCloseTo(1.5)
    expect(defaultDuration(9.95, 10)).toBe(0.2)
    expect(defaultDuration(1, 0)).toBe(3)
  })
  it('разбор ввода', () => {
    expect(parseDuration('2')).toEqual({ ok: true, value: 2 })
    expect(parseDuration(' 2,5 ')).toEqual({ ok: true, value: 2.5 })
    expect(parseDuration('0.2')).toEqual({ ok: true, value: 0.2 })
    expect(parseDuration('60')).toEqual({ ok: true, value: 60 })
    expect(parseDuration('')).toEqual({ ok: false, error: 'empty' })
    expect(parseDuration('abc')).toEqual({ ok: false, error: 'nan' })
    expect(parseDuration('-1')).toEqual({ ok: false, error: 'nan' })
    expect(parseDuration('1e3')).toEqual({ ok: false, error: 'nan' })
    expect(parseDuration('0.1')).toEqual({ ok: false, error: 'range' })
    expect(parseDuration('60.5')).toEqual({ ok: false, error: 'range' })
  })
})

describe('схемы zod', () => {
  it('принимают корректные рисунки', () => {
    expect(AnnotationSchema.safeParse(range(1, 3)).success).toBe(true)
    expect(AnnotationSchema.safeParse(frameAt(1.02)).success).toBe(true)
    expect(
      AnnotationSchema.safeParse({
        ...base,
        type: 'text',
        pos: { x: 0.2, y: 0.3 },
        text: '  Пас  ',
        style: { color: '#ffffff', size: 0.06, background: true },
        timing: { mode: 'range', start: 0, duration: 3 }
      }).success
    ).toBe(true)
  })
  it('отклоняют некорректные', () => {
    const bad = (v: unknown): boolean => AnnotationSchema.safeParse(v).success
    expect(bad({ ...range(1, 3), p1: { x: 1.2, y: 0 } })).toBe(false)
    expect(bad({ ...range(1, 3), id: 'не-uuid' })).toBe(false)
    expect(bad({ ...range(1, 3), type: 'star' })).toBe(false)
    expect(bad(range(1, 0.1))).toBe(false)
    expect(bad(range(1, 61))).toBe(false)
    expect(bad(range(-1, 3))).toBe(false)
    expect(bad({ ...range(1, 3), style: { ...base.style, color: 'red' } })).toBe(false)
    expect(bad({ ...range(1, 3), style: { ...base.style, dash: 'wavy' } })).toBe(false)
    const text = {
      ...base,
      type: 'text',
      pos: { x: 0.2, y: 0.3 },
      style: { color: '#ffffff', size: 0.06, background: true },
      timing: { mode: 'frame', start: 1, freezeSeconds: 3 }
    }
    expect(bad({ ...text, text: '   ' })).toBe(false)
    expect(bad({ ...text, text: 'x'.repeat(201) })).toBe(false)
    expect(bad({ ...text, text: 'ok' })).toBe(true)
  })
})

describe('стоп-кадр (freezeSeconds)', () => {
  const frame = (extra: Record<string, unknown>): unknown => ({
    ...range(1, 1),
    timing: { mode: 'frame', start: 1, ...extra }
  })
  it('без поля подставляется 3 с (старые проекты)', () => {
    const parsed = AnnotationSchema.safeParse(frame({}))
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.timing.mode === 'frame') {
      expect(parsed.data.timing.freezeSeconds).toBe(3)
    }
  })
  it('границы 0.5–30', () => {
    const ok = (v: unknown): boolean =>
      AnnotationSchema.safeParse(frame({ freezeSeconds: v })).success
    expect(ok(0.5)).toBe(true)
    expect(ok(30)).toBe(true)
    expect(ok(0.4)).toBe(false)
    expect(ok(30.5)).toBe(false)
    expect(ok('3')).toBe(false)
  })
  it('parseFreeze: запятая, ошибки', () => {
    expect(parseFreeze('2,5')).toEqual({ ok: true, value: 2.5 })
    expect(parseFreeze('')).toEqual({ ok: false, error: 'empty' })
    expect(parseFreeze('abc')).toEqual({ ok: false, error: 'nan' })
    expect(parseFreeze('0.2')).toEqual({ ok: false, error: 'range' })
    expect(parseFreeze('31')).toEqual({ ok: false, error: 'range' })
  })
})

describe('поля стилей 0.18', () => {
  const ok = (a: unknown): boolean => AnnotationSchema.safeParse(a).success
  const A = '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11'
  const timing = { mode: 'range', start: 0, duration: 2 }
  const style = { color: '#ffd60a', width: 0.008, dash: 'solid' }
  const circle = {
    id: A,
    space: 'screen',
    type: 'circle',
    p1: { x: 0.1, y: 0.1 },
    p2: { x: 0.3, y: 0.2 },
    style,
    timing
  }
  const ring = {
    id: A,
    space: 'pitch',
    calibrationId: A,
    type: 'ring',
    center: { x: 1, y: 1 },
    radius: 2,
    style,
    timing
  }
  const spot = {
    id: A,
    space: 'screen',
    type: 'spot',
    p1: { x: 0.1, y: 0.1 },
    p2: { x: 0.3, y: 0.2 },
    style,
    timing
  }
  const pspot = {
    id: A,
    space: 'pitch',
    calibrationId: A,
    type: 'pspot',
    center: { x: 1, y: 1 },
    radius: 2,
    style,
    timing
  }
  const arrow = { ...range(0, 2), id: A }

  it('вид линии «точки»', () => {
    expect(ok({ ...arrow, style: { ...style, dash: 'dotted' } })).toBe(true)
    expect(ok({ ...arrow, style: { ...style, dash: 'wavy' } })).toBe(false)
  })
  it('круг и кольцо: свечение, вид, пульс', () => {
    for (const c of [circle, ring]) {
      expect(ok({ ...c, glow: true, look: 'target', pulse: true })).toBe(true)
      expect(ok({ ...c, look: 'ring' })).toBe(true)
      expect(ok(c)).toBe(true)
      expect(ok({ ...c, look: 'star' })).toBe(false)
      expect(ok({ ...c, glow: 'yes' })).toBe(false)
      expect(ok({ ...c, pulse: 1 })).toBe(false)
    }
  })
  it('прожектор: овал или столб', () => {
    for (const s of [spot, pspot]) {
      expect(ok({ ...s, form: 'pillar' })).toBe(true)
      expect(ok({ ...s, form: 'oval' })).toBe(true)
      expect(ok({ ...s, form: 'cone' })).toBe(false)
    }
  })
  it('линии: свечение и проявление 0.2–3 с', () => {
    const lines = [
      arrow,
      { ...arrow, type: 'line' },
      { ...arrow, type: 'curve', c: { x: 0.3, y: 0.3 } },
      {
        id: A,
        space: 'pitch',
        calibrationId: A,
        type: 'parrow',
        p1: { x: 1, y: 1 },
        p2: { x: 5, y: 5 },
        style,
        timing
      },
      {
        id: A,
        space: 'pitch',
        calibrationId: A,
        type: 'pline',
        p1: { x: 1, y: 1 },
        p2: { x: 5, y: 5 },
        style,
        timing
      },
      {
        id: A,
        space: 'pitch',
        calibrationId: A,
        type: 'pcurve',
        p1: { x: 1, y: 1 },
        p2: { x: 5, y: 5 },
        c: { x: 3, y: 2 },
        style,
        timing
      }
    ]
    for (const l of lines) {
      expect(ok({ ...l, glow: true, reveal: 0.8 })).toBe(true)
      expect(ok({ ...l, reveal: 0.2 })).toBe(true)
      expect(ok({ ...l, reveal: 3 })).toBe(true)
      expect(ok({ ...l, reveal: 0.1 })).toBe(false)
      expect(ok({ ...l, reveal: 3.1 })).toBe(false)
      expect(ok({ ...l, glow: 1 })).toBe(false)
    }
  })
  it('подпись: тень; старая без поля читается без него', () => {
    const t = { id: A, space: 'screen', type: 'text', pos: { x: 0.1, y: 0.1 }, text: 'LW', timing }
    const withStyle = (st: object): unknown => ({ ...t, style: st })
    expect(ok(withStyle({ color: '#c6ff3d', size: 0.045, background: false, shadow: true }))).toBe(
      true
    )
    expect(ok(withStyle({ color: '#c6ff3d', size: 0.045, background: false, shadow: 'x' }))).toBe(
      false
    )
    const old = AnnotationSchema.parse(
      withStyle({ color: '#ffffff', size: 0.045, background: true })
    )
    expect(old.type === 'text' && 'shadow' in old.style).toBe(false)
  })
  it('старый рисунок после разбора не получает новых полей', () => {
    for (const a of [circle, ring, spot, pspot, arrow]) {
      const parsed = AnnotationSchema.parse(a) as Record<string, unknown>
      for (const k of ['glow', 'look', 'pulse', 'form', 'reveal']) expect(k in parsed).toBe(false)
    }
  })
})
