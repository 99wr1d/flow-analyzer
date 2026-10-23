import { describe, expect, it } from 'vitest'
import {
  addFrame,
  addItem,
  bringToFront,
  deleteItem,
  editGeom,
  hideFrom,
  removeFrame,
  sendToBack,
  setFacing,
  setPose,
  setShow,
  setStyle,
  setTitle,
  setTransition,
  setView
} from './edit'
import { elementAt } from './resolve'
import { BoardSchema, MAX_FRAMES, newBoard } from './schema'
import type { Board, BoardElement, BoardItem } from './schema'

const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const C = '00000000-0000-4000-8000-000000000003'

const figureEl: BoardElement = {
  kind: 'figure',
  set: 'gk',
  pose: 'set',
  facing: 'front',
  pos: { x: 0.2, y: 0.5 },
  scale: 1,
  rotation: 0,
  color: '#ffffff'
}
const ballEl: BoardElement = {
  kind: 'equip',
  item: 'ball',
  pos: { x: 0.5, y: 0.5 },
  scale: 1,
  rotation: 0,
  color: '#ffffff'
}
const arrowEl: BoardElement = {
  kind: 'shape',
  ann: {
    id: '00000000-0000-4000-8000-0000000000aa',
    space: 'screen',
    type: 'arrow',
    p1: { x: 0.1, y: 0.1 },
    p2: { x: 0.4, y: 0.4 },
    style: { color: '#ff0000', width: 0.01, dash: 'solid' }
  }
}

const item = (id: string, el: BoardElement, over: Partial<BoardItem> = {}): BoardItem => ({
  id,
  show: { from: 0, to: 2 },
  el,
  states: [],
  ...over
})
const board = (items: BoardItem[], frameCount = 3): Board => ({
  ...newBoard('t', new Date(0)),
  frameCount,
  items
})
const valid = (b: Board): Board => BoardSchema.parse(b)
const pos = (b: Board, id: string, f: number): unknown => {
  const el = elementAt(
    b.items.find((i) => i.id === id)!,
    f
  )
  return (el as { pos: { x: number } }).pos.x
}

describe('addItem', () => {
  it('добавляет сверху с показом от кадра до конца', () => {
    const b0 = board([item(A, figureEl)], 4)
    const b = addItem(b0, ballEl, 2, B)
    expect(b.items.at(-1)).toEqual({ id: B, show: { from: 2, to: 3 }, el: ballEl, states: [] })
    expect(b0.items).toHaveLength(1)
    valid(b)
  })
  it('ошибки: дубль id, кадр вне доски', () => {
    const b0 = board([item(A, figureEl)])
    expect(() => addItem(b0, ballEl, 0, A)).toThrow()
    expect(() => addItem(b0, ballEl, 3, B)).toThrow()
  })
})

describe('editGeom', () => {
  it('в кадре show.from меняет el без состояний', () => {
    const b = editGeom(board([item(A, figureEl)]), A, 0, { pos: { x: 0.9, y: 0.1 } })
    expect(b.items[0].states).toEqual([])
    expect((b.items[0].el as { pos: unknown }).pos).toEqual({ x: 0.9, y: 0.1 })
    valid(b)
  })
  it('в другом кадре делает upsert состояния и сливает поля', () => {
    let b = editGeom(board([item(A, figureEl)]), A, 1, { pos: { x: 0.5, y: 0.5 } })
    b = editGeom(b, A, 1, { scale: 2 })
    expect(b.items[0].states).toEqual([{ frame: 1, geom: { pos: { x: 0.5, y: 0.5 }, scale: 2 } }])
    expect(b.items[0].el).toEqual(figureEl)
    b = editGeom(b, A, 2, { rotation: 10 })
    expect(b.items[0].states.map((s) => s.frame)).toEqual([1, 2])
    valid(b)
  })
  it('shape: ключи внутри ann, чужие ключи — ошибка', () => {
    const b0 = board([item(A, arrowEl)])
    const b = editGeom(b0, A, 0, { p2: { x: 0.7, y: 0.7 } })
    expect((b.items[0].el as { ann: { p2: unknown } }).ann.p2).toEqual({ x: 0.7, y: 0.7 })
    expect(() => editGeom(b0, A, 0, { points: [] })).toThrow()
    valid(b)
  })
  it('ошибки: неизвестный ключ, нет элемента, кадр до появления', () => {
    const b0 = board([item(A, figureEl, { show: { from: 1, to: 2 } })])
    expect(() => editGeom(b0, A, 1, { p1: 1 })).toThrow()
    expect(() => editGeom(b0, B, 1, { scale: 1 })).toThrow()
    expect(() => editGeom(b0, A, 0, { scale: 1 })).toThrow()
  })
})

describe('setPose / setFacing', () => {
  it('база в show.from, состояние в другом кадре', () => {
    let b = setPose(board([item(A, figureEl)]), A, 0, 'step')
    expect((b.items[0].el as { pose: string }).pose).toBe('step')
    b = setPose(b, A, 2, 'dive-low')
    b = setFacing(b, A, 2, 'left')
    expect(b.items[0].states).toEqual([{ frame: 2, pose: 'dive-low', facing: 'left' }])
    valid(b)
  })
  it('ошибки: не фигура, чужая поза', () => {
    expect(() => setPose(board([item(A, ballEl)]), A, 0, 'set')).toThrow()
    expect(() => setPose(board([item(A, figureEl)]), A, 0, 'run')).toThrow()
    expect(() => setFacing(board([item(A, ballEl)]), A, 0, 'left')).toThrow()
  })
})

describe('setStyle', () => {
  it('цвет в кадре 2 меняет цвет во всех кадрах, состояния не трогает', () => {
    const st = [{ frame: 2, geom: { scale: 2 } }]
    const b = setStyle(board([item(A, figureEl, { states: st })]), A, { color: '#112233' })
    for (const f of [0, 1, 2])
      expect((elementAt(b.items[0], f) as { color: string }).color).toBe('#112233')
    expect(b.items[0].states).toEqual(st)
    valid(b)
  })
  it('shape: стиль внутри ann.style', () => {
    const b = setStyle(board([item(A, arrowEl)]), A, { color: '#00ff00', width: 0.02 })
    const ann = (b.items[0].el as { ann: { style: { color: string; width: number } } }).ann
    expect(ann.style.color).toBe('#00ff00')
    expect(ann.style.width).toBe(0.02)
    valid(b)
  })
  it('ошибки: геометрия, неверное значение', () => {
    const b0 = board([item(A, figureEl)])
    expect(() => setStyle(b0, A, { pos: {} })).toThrow()
    expect(() => setStyle(b0, A, { color: 'red' })).toThrow()
  })
})

describe('setShow / hideFrom', () => {
  it('сливает состояния frame <= from в базу, остальные сохраняет', () => {
    const states = [
      { frame: 1, geom: { pos: { x: 0.3, y: 0.5 } } },
      { frame: 2, geom: { pos: { x: 0.6, y: 0.5 } } }
    ]
    const b0 = board([item(A, figureEl, { states })])
    const b = setShow(b0, A, 1, 2)
    expect(b.items[0].show).toEqual({ from: 1, to: 2 })
    expect(b.items[0].states).toEqual([states[1]])
    expect(pos(b, A, 1)).toBe(0.3)
    expect(pos(b, A, 2)).toBe(0.6)
    valid(b)
  })
  it('раннее from не меняет базу; to < from — ошибка', () => {
    const b0 = board([item(A, figureEl, { show: { from: 1, to: 2 } })])
    const b = setShow(b0, A, 0, 1)
    expect(b.items[0].el).toEqual(figureEl)
    valid(b)
    expect(() => setShow(b0, A, 2, 1)).toThrow()
  })
  it('hideFrom скрывает с кадра, при frame <= from удаляет', () => {
    const b0 = board([item(A, figureEl, { show: { from: 1, to: 2 } })])
    expect(hideFrom(b0, A, 2).items[0].show).toEqual({ from: 1, to: 1 })
    expect(hideFrom(b0, A, 1).items).toEqual([])
    expect(hideFrom(b0, A, 0).items).toEqual([])
  })
})

describe('порядок и удаление', () => {
  const b0 = board([item(A, figureEl), item(B, ballEl), item(C, arrowEl)])
  it('deleteItem', () => {
    expect(deleteItem(b0, B).items.map((i) => i.id)).toEqual([A, C])
    expect(() => deleteItem(b0, '00000000-0000-4000-8000-0000000000ff')).toThrow()
  })
  it('bringToFront / sendToBack', () => {
    expect(bringToFront(b0, A).items.map((i) => i.id)).toEqual([B, C, A])
    expect(sendToBack(b0, C).items.map((i) => i.id)).toEqual([C, A, B])
  })
})

describe('addFrame', () => {
  it('сдвигает show/states после after, копия кадра after включая видимость', () => {
    const b0 = board(
      [
        item('00000000-0000-4000-8000-0000000000a1', arrowEl, { show: { from: 0, to: 0 } }),
        item(A, figureEl, {
          show: { from: 0, to: 1 },
          states: [{ frame: 1, geom: { pos: { x: 0.5, y: 0.5 } } }]
        })
      ],
      2
    )
    const b = addFrame(b0, 0)
    expect(b.frameCount).toBe(3)
    expect(b.items[0].show).toEqual({ from: 0, to: 1 })
    expect(b.items[1].show).toEqual({ from: 0, to: 2 })
    expect(b.items[1].states[0].frame).toBe(2)
    expect(pos(b, A, 1)).toBe(0.2)
    expect(pos(b, A, 2)).toBe(0.5)
    expect(b0.frameCount).toBe(2)
    valid(b)
  })
  it('from после after сдвигается; в конце доски элемент продолжается', () => {
    const b = addFrame(board([item(A, figureEl, { show: { from: 2, to: 2 } })]), 1)
    expect(b.items[0].show).toEqual({ from: 3, to: 3 })
    const e = addFrame(board([item(A, figureEl)]), 2)
    expect(e.items[0].show).toEqual({ from: 0, to: 3 })
    valid(b)
    valid(e)
  })
  it('предел кадров и неверный after — ошибка', () => {
    expect(() => addFrame({ ...board([]), frameCount: MAX_FRAMES }, 0)).toThrow()
    expect(() => addFrame(board([]), 3)).toThrow()
  })
})

describe('removeFrame', () => {
  it('состояние удалённого кадра переносится на следующий (позиция не меняется)', () => {
    const b0 = board([
      item(A, figureEl, { states: [{ frame: 1, geom: { pos: { x: 0.5, y: 0.5 } } }] })
    ])
    const b = removeFrame(b0, 1)
    expect(b.frameCount).toBe(2)
    expect(pos(b, A, 1)).toBe(0.5)
    expect(b.items[0].show).toEqual({ from: 0, to: 1 })
    valid(b)
  })
  it('слияние состояний кадра и следующего: следующее сверху', () => {
    const b0 = board(
      [
        item(A, figureEl, {
          show: { from: 0, to: 3 },
          states: [
            { frame: 1, geom: { pos: { x: 0.5, y: 0.5 }, scale: 2 }, pose: 'step' },
            { frame: 2, geom: { pos: { x: 0.8, y: 0.5 } } },
            { frame: 3, geom: { scale: 3 } }
          ]
        })
      ],
      4
    )
    const b = removeFrame(b0, 1)
    expect(b.items[0].states).toEqual([
      { frame: 1, geom: { pos: { x: 0.8, y: 0.5 }, scale: 2 }, pose: 'step' },
      { frame: 2, geom: { scale: 3 } }
    ])
    valid(b)
  })
  it('элемент, видимый только в удаляемом кадре, исчезает', () => {
    const b = removeFrame(board([item(A, ballEl, { show: { from: 1, to: 1 } })]), 1)
    expect(b.items).toEqual([])
  })
  it('удаление кадра 0 при show.from = 0: база = бывший кадр 1', () => {
    const b0 = board([
      item(A, figureEl, { states: [{ frame: 1, geom: { pos: { x: 0.5, y: 0.5 } } }] })
    ])
    const b = removeFrame(b0, 0)
    expect(b.items[0].show).toEqual({ from: 0, to: 1 })
    expect((b.items[0].el as { pos: { x: number } }).pos.x).toBe(0.5)
    expect(b.items[0].states).toEqual([])
    valid(b)
  })
  it('элементы после и до кадра сдвигаются/сохраняются; последний кадр', () => {
    const b0 = board([
      item(A, figureEl, { show: { from: 2, to: 2 } }),
      item(B, ballEl, { show: { from: 0, to: 1 } }),
      item(C, arrowEl, {
        states: [{ frame: 2, geom: { p1: { x: 0.3, y: 0.3 } } }]
      })
    ])
    const b = removeFrame(b0, 2)
    expect(b.items.map((i) => i.id)).toEqual([B, C])
    expect(b.items[1].show).toEqual({ from: 0, to: 1 })
    expect(b.items[1].states).toEqual([])
    const b2 = removeFrame(b0, 0)
    expect(b2.items.find((i) => i.id === A)!.show).toEqual({ from: 1, to: 1 })
    valid(b)
    valid(b2)
  })
  it('единственный кадр — ошибка', () => {
    expect(() => removeFrame(board([], 1), 0)).toThrow()
  })
})

describe('доска', () => {
  it('setTransition / setView / setTitle', () => {
    const b0 = board([])
    expect(setTransition(b0, 2).transition).toBe(2)
    expect(setView(b0, 'full-top').view).toBe('full-top')
    expect(setTitle(b0, 'Угловой').title).toBe('Угловой')
    expect(() => setTransition(b0, 0.1)).toThrow()
    expect(() => setTransition(b0, 9)).toThrow()
    expect(() => setTitle(b0, 'x'.repeat(121))).toThrow()
    valid(setTitle(setView(setTransition(b0, 2), 'half-angle'), 'ok'))
  })
})
