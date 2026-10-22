import { describe, expect, it } from 'vitest'
import { AnnotationSchema, type Annotation } from '../../../../shared/annotations'
import {
  DEFAULT_STYLE,
  LEVELS,
  PALETTE,
  TEXT_SIZES,
  levelOf,
  newDrawingFx,
  shapeStyleOf,
  textLevelOf,
  textStyleOf,
  type TextLevel
} from './styles'

const text = (size: number): Annotation =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    space: 'screen',
    type: 'text',
    pos: { x: 0.1, y: 0.1 },
    text: 'Пас',
    style: { color: '#ffffff', size, background: true },
    timing: { mode: 'range', start: 1, duration: 3 }
  }) as unknown as Annotation

describe('размеры текста (0.16.4)', () => {
  it('старые размеры 0.045 / 0.065 / 0.09 остались в шкале как есть', () => {
    const sizes = TEXT_SIZES.map((t) => t.size)
    for (const old of [0.045, 0.065, 0.09]) expect(sizes).toContain(old)
  })

  it('самый мелкий вдвое меньше прежнего самого мелкого, шкала возрастает', () => {
    expect(TEXT_SIZES[0].size).toBeCloseTo(0.045 / 2, 6)
    for (let i = 1; i < TEXT_SIZES.length; i += 1) {
      expect(TEXT_SIZES[i].size).toBeGreaterThan(TEXT_SIZES[i - 1].size)
    }
  })

  it('новая подпись по умолчанию мелкая, как у образца (0.032; прежняя была 0.065)', () => {
    expect(textStyleOf(DEFAULT_STYLE).size).toBe(0.032)
    expect(TEXT_SIZES[DEFAULT_STYLE.textLevel].size).toBe(0.032)
  })

  it('новая подпись по умолчанию лайм, остальные рисунки — прежний жёлтый', () => {
    expect(textStyleOf(DEFAULT_STYLE).color).toBe('#c6ff3d')
    expect(shapeStyleOf(DEFAULT_STYLE).color).toBe('#ffd60a')
  })

  it('сохранённый размер старого проекта попадает в тот же шаг и рисуется тем же размером', () => {
    for (const old of [0.045, 0.065, 0.09]) {
      const level = textLevelOf(text(old)) as TextLevel
      expect(TEXT_SIZES[level].size).toBe(old)
    }
  })

  it('толщина линий не изменилась', () => {
    expect(LEVELS.map((l) => l.width)).toEqual([0.006, 0.011, 0.018])
    expect(levelOf(text(0.09))).toBe(1)
  })
})

describe('новые стили 0.18: палитра и умолчания', () => {
  it('в палитре есть лайм, ярко-синий и оранжево-красный; старые цвета остались', () => {
    const values = PALETTE.map((c) => c.value)
    for (const c of ['#c6ff3d', '#2e8bff', '#ff5a1f']) expect(values).toContain(c)
    for (const c of ['#ffffff', '#ffd60a', '#ff3b30', '#4cc9f0', '#34d058', '#111827']) {
      expect(values).toContain(c)
    }
    for (const c of PALETTE) expect(c.value).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(values).size).toBe(values.length)
  })

  it('умолчания панели: свечение кольца вкл., подпись без плашки с тенью, линии без свечения и проявления', () => {
    expect(DEFAULT_STYLE).toMatchObject({
      dash: 'solid',
      glow: true,
      look: 'ring',
      pulse: false,
      form: 'oval',
      lineGlow: false,
      reveal: null,
      textBackground: false,
      textShadow: true
    })
  })

  it('новая подпись: без плашки, с тенью', () => {
    expect(textStyleOf(DEFAULT_STYLE)).toMatchObject({ background: false, shadow: true })
  })

  it('новое кольцо и круг получают свечение, вид «кольцо», без пульса — явно', () => {
    for (const t of ['circle', 'ring']) {
      expect(newDrawingFx(t, DEFAULT_STYLE)).toEqual({ glow: true, look: 'ring', pulse: false })
    }
  })

  it('новый прожектор — овал; новые стрелки/линии — свечение выкл., проявления нет, вид «сплошная»', () => {
    for (const t of ['spot', 'pspot'])
      expect(newDrawingFx(t, DEFAULT_STYLE)).toEqual({ form: 'oval' })
    for (const t of ['arrow', 'line', 'curve', 'parrow', 'pline', 'pcurve']) {
      const fx = newDrawingFx(t, DEFAULT_STYLE)
      expect(fx).toEqual({ glow: false })
      expect('reveal' in fx).toBe(false)
    }
    expect(shapeStyleOf(DEFAULT_STYLE).dash).toBe('solid')
  })

  it('прочие виды рисунков новых полей не получают', () => {
    for (const t of ['pen', 'ppen', 'zone', 'loupe', 'ruler', 'text', 'chain']) {
      expect(newDrawingFx(t, DEFAULT_STYLE)).toEqual({})
    }
  })

  it('выбор панели запоминается: новые рисунки берут его', () => {
    const s = {
      ...DEFAULT_STYLE,
      glow: false,
      look: 'target' as const,
      pulse: true,
      form: 'pillar' as const,
      lineGlow: true,
      reveal: 1.5,
      dash: 'dotted' as const,
      textBackground: true,
      textShadow: false
    }
    expect(newDrawingFx('ring', s)).toEqual({ glow: false, look: 'target', pulse: true })
    // «Столб» по умолчанию без затемнения кадра.
    expect(newDrawingFx('pspot', s)).toEqual({ form: 'pillar', dimmed: false })
    expect(newDrawingFx('spot', { ...s, form: 'oval' })).toEqual({ form: 'oval' })
    expect(newDrawingFx('arrow', s)).toEqual({ glow: true, reveal: 1.5 })
    expect(shapeStyleOf(s).dash).toBe('dotted')
    expect(textStyleOf(s)).toMatchObject({ background: true, shadow: false })
  })

  it('все умолчания проходят схему', () => {
    const ok = (a: unknown): boolean => AnnotationSchema.safeParse(a).success
    const id = '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11'
    const timing = { mode: 'range', start: 0, duration: 2 }
    const box = { p1: { x: 0.1, y: 0.1 }, p2: { x: 0.3, y: 0.2 } }
    const s = { ...DEFAULT_STYLE, lineGlow: true, reveal: 0.8 }
    expect(
      ok({
        id,
        space: 'screen',
        type: 'circle',
        ...box,
        style: shapeStyleOf(s),
        ...newDrawingFx('circle', s),
        timing
      })
    ).toBe(true)
    expect(
      ok({
        id,
        space: 'screen',
        type: 'arrow',
        ...box,
        style: shapeStyleOf(s),
        ...newDrawingFx('arrow', s),
        timing
      })
    ).toBe(true)
    expect(
      ok({
        id,
        space: 'screen',
        type: 'spot',
        ...box,
        style: shapeStyleOf(s),
        ...newDrawingFx('spot', s),
        timing
      })
    ).toBe(true)
    expect(
      ok({
        id,
        space: 'screen',
        type: 'text',
        pos: box.p1,
        text: 'N8',
        style: textStyleOf(s),
        timing
      })
    ).toBe(true)
  })
})

describe('толщина нового кольца', () => {
  it('по умолчанию «Тонкая», остальные рисунки — прежняя', () => {
    expect(DEFAULT_STYLE.ringLevel).toBe(0)
    expect(DEFAULT_STYLE.level).toBe(1)
  })
})
