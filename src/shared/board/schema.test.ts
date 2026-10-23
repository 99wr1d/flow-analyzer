import { describe, expect, it } from 'vitest'
import { BoardSchema, boardToFile, newBoard, parseBoardText } from './schema'

const now = new Date('2026-10-23T10:00:00.000Z')
const ID = '11111111-1111-4111-8111-111111111111'

const figure = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'figure',
  set: 'gk',
  pose: 'set',
  facing: 'front',
  pos: { x: 0.5, y: 0.5 },
  scale: 1,
  rotation: 0,
  color: '#ff0000',
  ...over
})

const item = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ID,
  show: { from: 0, to: 0 },
  el: figure(),
  states: [],
  ...over
})

const withItems = (items: unknown[], frameCount = 3): Record<string, unknown> => ({
  ...newBoard('Бросок', now),
  frameCount,
  items
})

describe('схема доски', () => {
  it('новая доска валидна: один кадр, пусто', () => {
    const b = newBoard('Бросок', now)
    expect(() => BoardSchema.parse(b)).not.toThrow()
    expect(b.frameCount).toBe(1)
    expect(b.items.length).toBe(0)
    expect(b.view).toBe('box-front')
  })

  it('круг boardToFile → parseBoardText', () => {
    const b = newBoard('Бросок', now)
    const r = parseBoardText(boardToFile(b))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.board).toEqual(b)
  })

  it('поза должна принадлежать набору', () => {
    expect(
      BoardSchema.safeParse(withItems([item({ el: figure({ set: 'player', pose: 'dive-low' }) })]))
        .success
    ).toBe(false)
    expect(BoardSchema.safeParse(withItems([item()])).success).toBe(true)
  })

  it('show.to < frameCount', () => {
    expect(BoardSchema.safeParse(withItems([item({ show: { from: 0, to: 3 } })], 3)).success).toBe(
      false
    )
    expect(BoardSchema.safeParse(withItems([item({ show: { from: 0, to: 2 } })], 3)).success).toBe(
      true
    )
  })

  it('show.to >= show.from', () => {
    expect(BoardSchema.safeParse(withItems([item({ show: { from: 2, to: 1 } })])).success).toBe(
      false
    )
  })

  it('states: frame строго растёт и > show.from', () => {
    const st = (frame: number): Record<string, unknown> => ({ frame })
    expect(BoardSchema.safeParse(withItems([item({ states: [st(2), st(2)] })])).success).toBe(false)
    expect(BoardSchema.safeParse(withItems([item({ states: [st(0)] })])).success).toBe(false)
    expect(
      BoardSchema.safeParse(withItems([item({ show: { from: 1, to: 2 }, states: [st(1)] })]))
        .success
    ).toBe(false)
    expect(BoardSchema.safeParse(withItems([item({ states: [st(1), st(2)] })])).success).toBe(true)
  })

  it('states: frame < frameCount', () => {
    expect(BoardSchema.safeParse(withItems([item({ states: [{ frame: 3 }] })], 3)).success).toBe(
      false
    )
  })

  it('версии и формат', () => {
    const base = JSON.parse(boardToFile(newBoard('x', now)))
    const r2 = parseBoardText(JSON.stringify({ ...base, version: 2 }))
    expect(r2.ok === false && r2.error).toBe('newer')
    const r3 = parseBoardText('{')
    expect(r3.ok === false && r3.error).toBe('json')
    const r4 = parseBoardText(JSON.stringify({ ...base, format: 'other' }))
    expect(r4.ok === false && r4.error).toBe('format')
    const r5 = parseBoardText(JSON.stringify({ ...base, frameCount: 0 }))
    expect(r5.ok === false && r5.error).toBe('invalid')
  })

  it('shape: ann', () => {
    const arrow = {
      id: ID,
      type: 'arrow',
      p1: { x: 0.1, y: 0.1 },
      p2: { x: 0.9, y: 0.9 },
      style: { color: '#ffffff', width: 0.006, dash: 'solid' }
    }
    const ok = BoardSchema.safeParse(withItems([item({ el: { kind: 'shape', ann: arrow } })]))
    expect(ok.success).toBe(true)
    expect(
      BoardSchema.safeParse(
        withItems([item({ el: { kind: 'shape', ann: { ...arrow, type: 'loupe' } } })])
      ).success
    ).toBe(false)
    const timing = { mode: 'range', start: 0, duration: 3 }
    expect(
      BoardSchema.safeParse(withItems([item({ el: { kind: 'shape', ann: { ...arrow, timing } } })]))
        .success
    ).toBe(false)
  })
})
