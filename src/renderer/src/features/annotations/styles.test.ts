import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../../../shared/annotations'
import {
  DEFAULT_STYLE,
  LEVELS,
  TEXT_SIZES,
  levelOf,
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

  it('новая подпись по умолчанию на шаг мельче прежней (0.065 → 0.045)', () => {
    expect(textStyleOf(DEFAULT_STYLE).size).toBe(0.045)
    expect(TEXT_SIZES[DEFAULT_STYLE.textLevel].size).toBe(0.045)
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
