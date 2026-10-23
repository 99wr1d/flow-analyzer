import { beforeEach, describe, expect, it } from 'vitest'
import { addFrame, addItem, deleteItem, removeFrame, setTitle } from '../../../../shared/board/edit'
import { BoardElementSchema, newBoard } from '../../../../shared/board/schema'
import { toolForSection, useBoardStore } from './boardStore'

const s = (): ReturnType<typeof useBoardStore.getState> => useBoardStore.getState()
const fresh = (): ReturnType<typeof newBoard> => newBoard('T', new Date('2026-01-01T00:00:00Z'))

describe('boardStore', () => {
  beforeEach(() => {
    s().reset()
    s().load(fresh(), null)
  })

  it('undo после addFrame + setFrame возвращает кадр 0 и один кадр', () => {
    expect(s().apply((b) => addFrame(b, 0))).toBeNull()
    s().setFrame(1)
    expect(s().frame).toBe(1)
    s().undo()
    expect(s().board?.frameCount).toBe(1)
    expect(s().frame).toBe(0)
  })

  it('undo и redo', () => {
    s().apply((b) => setTitle(b, 'A'))
    s().undo()
    expect(s().board?.title).toBe('T')
    s().redo()
    expect(s().board?.title).toBe('A')
  })

  it('undo восстанавливает выделение', () => {
    s().select(['x'])
    s().apply((b) => setTitle(b, 'A'))
    s().select(['y'])
    s().undo()
    expect(s().selection).toEqual(['x'])
  })

  it('setFrame ограничивает кадр и не пишет историю', () => {
    s().apply((b) => addFrame(b, 0))
    const n = s().past.length
    s().setFrame(9)
    expect(s().frame).toBe(1)
    s().setFrame(-3)
    expect(s().frame).toBe(0)
    expect(s().past.length).toBe(n)
  })

  it('dirty: true после apply, false после markSaved', () => {
    expect(s().dirty).toBe(false)
    s().apply((b) => setTitle(b, 'A'))
    expect(s().dirty).toBe(true)
    s().markSaved('/a.flowboard')
    expect(s().dirty).toBe(false)
    expect(s().path).toBe('/a.flowboard')
  })

  it('бросающая операция ничего не меняет и возвращает текст', () => {
    const before = s().board
    const err = s().apply((b) =>
      addItem(
        b,
        { kind: 'token', pos: { x: 2, y: 0 }, scale: 1, color: '#e53935', label: '' },
        0,
        'x'
      )
    )
    expect(typeof err).toBe('string')
    expect(s().past.length).toBe(0)
    expect(s().board).toBe(before)
    expect(s().dirty).toBe(false)
  })

  it('apply без доски возвращает ошибку', () => {
    s().reset()
    expect(typeof s().apply((b) => b)).toBe('string')
  })

  it('apply чистит future', () => {
    s().apply((b) => setTitle(b, 'A'))
    s().undo()
    s().apply((b) => setTitle(b, 'B'))
    expect(s().future.length).toBe(0)
  })

  it('101-я операция выталкивает первую', () => {
    for (let i = 1; i <= 101; i++) s().apply((b) => setTitle(b, `t${i}`))
    expect(s().past.length).toBe(100)
    for (let i = 0; i < 100; i++) s().undo()
    expect(s().board?.title).toBe('t1')
  })

  it('setSection выбирает инструмент размещения', () => {
    s().setSection('gk')
    const t = s().tool
    expect(t.kind).toBe('place')
    if (t.kind === 'place' && t.el.kind === 'figure') {
      expect(t.el.set).toBe('gk')
      expect(t.el.pose).toBe('set')
      expect(t.el.facing).toBe('front')
    } else throw new Error('ожидалась фигура')
    s().setSection('tokens')
    expect(s().tool).toMatchObject({
      kind: 'place',
      el: { kind: 'token', color: '#e53935', label: '' }
    })
    s().setSection('numbers')
    expect(s().tool).toMatchObject({
      kind: 'place',
      el: { kind: 'number', n: 1, color: '#1a1a1a' }
    })
    s().setSection('equipment')
    expect(s().tool).toMatchObject({
      kind: 'place',
      el: { kind: 'equip', item: 'ball', color: '#ffffff' }
    })
    s().setSection('arrows')
    expect(s().tool).toEqual({ kind: 'draw', draw: 'arrow' })
    s().setSection('pencil')
    expect(s().tool).toEqual({ kind: 'draw', draw: 'pen' })
    s().setSection('text')
    expect(s().tool).toEqual({ kind: 'draw', draw: 'text' })
    s().setSection('zones')
    expect(s().tool).toEqual({ kind: 'draw', draw: 'hatch-rect' })
  })

  it('load сбрасывает историю, reset очищает', () => {
    s().apply((b) => setTitle(b, 'A'))
    s().load(fresh(), '/p')
    expect(s().past).toEqual([])
    expect(s().dirty).toBe(false)
    s().reset()
    expect(s().board).toBeNull()
  })
  it('removeFrame на последнем кадре зажимает frame, undo возвращает его', () => {
    s().apply((b) => addFrame(b, 0))
    s().setFrame(1)
    expect(s().apply((b) => removeFrame(b, 1))).toBeNull()
    expect(s().frame).toBe(0)
    s().undo()
    expect(s().frame).toBe(1)
  })

  it('удаление выделенного элемента чистит выделение, undo возвращает', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    s().apply((b) =>
      addItem(
        b,
        { kind: 'token', pos: { x: 0.5, y: 0.5 }, scale: 1, color: '#e53935', label: '' },
        0,
        id
      )
    )
    s().select([id])
    s().apply((b) => deleteItem(b, id))
    expect(s().selection).toEqual([])
    s().undo()
    expect(s().selection).toEqual([id])
  })

  it('элементы по умолчанию всех разделов проходят схему', () => {
    for (const sec of ['equipment', 'gk', 'player', 'coach', 'tokens', 'numbers'] as const) {
      const t = toolForSection(sec)
      expect(t.kind).toBe('place')
      if (t.kind === 'place') expect(BoardElementSchema.safeParse(t.el).success).toBe(true)
    }
  })
})
