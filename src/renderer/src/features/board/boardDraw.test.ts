import { describe, expect, it } from 'vitest'
import { BoardElementSchema, newBoard } from '../../../../shared/board/schema'
import { addItem } from '../../../../shared/board/edit'
import type { BoardDraw } from './boardStore'
import { toolForSection } from './boardStore'
import { drawElement, nextNumber, placeElement, textElement } from './boardDraw'
import { pitchView } from './art/pitchViews'

const ANN = '22222222-2222-4222-8222-222222222222'
const board = newBoard('Тест', new Date('2026-10-23T10:00:00Z'))

describe('placeElement', () => {
  it('фигура: точка щелчка, масштаб вида поля, цвет кисти', () => {
    const tool = toolForSection('gk')
    if (tool.kind !== 'place') throw new Error('ожидался place')
    const el = placeElement(tool.el, { x: 0.3, y: 0.7 }, 'box-front', '#ff0000', board)
    expect(el.kind).toBe('figure')
    if (el.kind !== 'figure') return
    expect(el.pos).toEqual({ x: 0.3, y: 0.7 })
    expect(el.scale).toBeCloseTo(pitchView('box-front').scaleAt(0.7), 3)
    expect(el.color).toBe('#ff0000')
    expect(BoardElementSchema.safeParse(el).success).toBe(true)
  })

  it('номер: следующий свободный', () => {
    const tool = toolForSection('numbers')
    if (tool.kind !== 'place') throw new Error('ожидался place')
    const first = placeElement(tool.el, { x: 0.5, y: 0.5 }, 'box-front', null, board)
    const b2 = addItem(board, first, 0, '33333333-3333-4333-8333-333333333333')
    expect(nextNumber(board)).toBe(1)
    expect(nextNumber(b2)).toBe(2)
  })
})

describe('drawElement', () => {
  const path = [
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.25 },
    { x: 0.5, y: 0.4 }
  ]
  const kinds: BoardDraw[] = [
    'arrow',
    'arrow-dashed',
    'line',
    'curve',
    'wavy',
    'pen',
    'pen-dashed',
    'hatch-rect',
    'hatch-tri',
    'hatch-ellipse'
  ]
  for (const k of kinds) {
    it(`${k}: проходит схему`, () => {
      const el = drawElement(k, path, '#ffffff', ANN)
      expect(el).not.toBeNull()
      expect(BoardElementSchema.safeParse(el).success).toBe(true)
    })
  }

  it('щелчок без протяжки ничего не рисует', () => {
    expect(drawElement('arrow', [{ x: 0.5, y: 0.5 }], '#ffffff', ANN)).toBeNull()
    expect(
      drawElement(
        'hatch-rect',
        [
          { x: 0.5, y: 0.5 },
          { x: 0.6, y: 0.501 }
        ],
        '#ffffff',
        ANN
      )
    ).toBeNull()
  })

  it('пунктир у пунктирной стрелки, толщина не тоньше 0.006', () => {
    const el = drawElement('arrow-dashed', path, '#ffffff', ANN)
    if (el?.kind !== 'shape' || el.ann.type !== 'arrow') throw new Error('ожидалась стрелка')
    expect(el.ann.style.dash).toBe('dashed')
    expect(el.ann.style.width).toBeGreaterThanOrEqual(0.006)
  })

  it('текст проходит схему', () => {
    expect(
      BoardElementSchema.safeParse(textElement('Шаг', { x: 0.4, y: 0.4 }, '#ffffff', ANN)).success
    ).toBe(true)
  })
})

describe('за краем поля', () => {
  const out = [
    { x: 0.8, y: 0.5 },
    { x: 1.2, y: 0.6 },
    { x: 1.4, y: -0.3 }
  ]
  for (const k of ['arrow', 'pen', 'hatch-rect'] as const) {
    it(`${k}: точки прижимаются к краю, элемент создаётся и проходит схему`, () => {
      const el = drawElement(k, out, '#ffffff', ANN)
      expect(el).not.toBeNull()
      expect(BoardElementSchema.safeParse(el).success).toBe(true)
      const b2 = addItem(board, el!, 0, '44444444-4444-4444-8444-444444444444')
      expect(b2.items).toHaveLength(1)
    })
  }

  it('подпись у края', () => {
    const el = textElement('Край', { x: 1.3, y: -0.2 }, '#ffffff', ANN)
    expect(BoardElementSchema.safeParse(el).success).toBe(true)
  })
})
