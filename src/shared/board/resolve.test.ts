import { describe, expect, it } from 'vitest'
import { smoothstep } from '../animation'
import { newBoard, type Board, type BoardItem } from './schema'
import {
  HOLD_END,
  LEAD_IN,
  boardDuration,
  elementAt,
  frameStart,
  sceneAt,
  sceneAtFrame,
  visibleAt
} from './resolve'

const ID = '00000000-0000-4000-8000-000000000001'
const ID2 = '00000000-0000-4000-8000-000000000002'

const figure = (over: Partial<BoardItem> = {}): BoardItem => ({
  id: ID,
  show: { from: 0, to: 3 },
  el: {
    kind: 'figure',
    set: 'gk',
    pose: 'set',
    facing: 'front',
    pos: { x: 0.2, y: 0.5 },
    scale: 1,
    rotation: 0,
    color: '#ffffff'
  },
  states: [],
  ...over
})

const board = (items: BoardItem[], frameCount = 4, transition = 1): Board => ({
  ...newBoard('t', new Date(0)),
  frameCount,
  transition,
  items
})

const posX = (e: ReturnType<typeof elementAt>): number => (e as { pos: { x: number } }).pos.x

describe('elementAt', () => {
  it('держит базовое значение до состояния и применяет его с его кадра', () => {
    const it = figure({ states: [{ frame: 2, geom: { pos: { x: 0.6, y: 0.5 } } }] })
    expect(posX(elementAt(it, 1))).toBe(0.2)
    expect(posX(elementAt(it, 2))).toBe(0.6)
    expect(posX(elementAt(it, 3))).toBe(0.6)
  })

  it('посторонний geom-ключ игнорируется', () => {
    const it = figure({ states: [{ frame: 1, geom: { foo: 1, p1: { x: 0, y: 0 }, scale: 2 } }] })
    const e = elementAt(it, 1) as unknown as Record<string, unknown>
    expect(e.foo).toBeUndefined()
    expect(e.p1).toBeUndefined()
    expect(e.scale).toBe(2)
  })

  it('pose и facing применяются только к фигуре', () => {
    const f = figure({ states: [{ frame: 1, pose: 'dive-low', facing: 'left' }] })
    const e = elementAt(f, 1) as { pose: string; facing: string }
    expect(e.pose).toBe('dive-low')
    expect(e.facing).toBe('left')
    const cone: BoardItem = {
      id: ID2,
      show: { from: 0, to: 3 },
      el: {
        kind: 'equip',
        item: 'cone',
        pos: { x: 0.1, y: 0.1 },
        scale: 1,
        rotation: 0,
        color: '#ffffff'
      },
      states: [{ frame: 1, pose: 'run', facing: 'left' }]
    }
    const c = elementAt(cone, 1) as unknown as Record<string, unknown>
    expect(c.pose).toBeUndefined()
    expect(c.facing).toBeUndefined()
  })

  it('shape: геометрия живёт в ann, чужие ключи игнорируются', () => {
    const it: BoardItem = {
      id: ID,
      show: { from: 0, to: 3 },
      el: {
        kind: 'shape',
        ann: {
          type: 'line',
          id: ID2,
          p1: { x: 0, y: 0 },
          p2: { x: 1, y: 1 },
          color: '#ffffff',
          width: 0.01
        } as never
      },
      states: [{ frame: 1, geom: { p2: { x: 0.5, y: 0.5 }, pos: { x: 9, y: 9 } } }]
    }
    const e = elementAt(it, 1) as unknown as { ann: Record<string, unknown> }
    expect(e.ann.p2).toEqual({ x: 0.5, y: 0.5 })
    expect(e.ann.pos).toBeUndefined()
  })
})

describe('время', () => {
  it('длительность и начало кадра', () => {
    const b = board([], 3, 1)
    expect(boardDuration(b)).toBe(3.5)
    expect(frameStart(b, 2)).toBe(LEAD_IN + 2)
    expect(HOLD_END).toBe(1)
  })

  it('visibleAt', () => {
    const it = figure({ show: { from: 1, to: 2 } })
    expect([0, 1, 2, 3].map((f) => visibleAt(it, f))).toEqual([false, true, true, false])
  })
})

describe('sceneAt', () => {
  const moving = figure({ states: [{ frame: 2, geom: { pos: { x: 0.6, y: 0.5 } } }] })

  it('внутри перехода позиция сглажена', () => {
    const b = board([moving])
    const s = sceneAt(b, LEAD_IN + 1.5)
    expect(posX(s[0].el)).toBeCloseTo(0.2 + 0.4 * smoothstep(0.5), 10)
    expect(s[0].opacity).toBe(1)
  })

  it('поза переключается на середине', () => {
    const it = figure({ states: [{ frame: 1, pose: 'dive-low' }] })
    const b = board([it])
    const pose = (t: number): string => (sceneAt(b, t)[0].el as { pose: string }).pose
    expect(pose(LEAD_IN + 0.4)).toBe('set')
    expect(pose(LEAD_IN + 0.6)).toBe('dive-low')
  })

  it('мяч с show 2..2 появляется и исчезает', () => {
    const ball: BoardItem = {
      id: ID2,
      show: { from: 2, to: 2 },
      el: {
        kind: 'equip',
        item: 'ball',
        pos: { x: 0.5, y: 0.5 },
        scale: 1,
        rotation: 0,
        color: '#ffffff'
      },
      states: []
    }
    const b = board([ball])
    expect(sceneAtFrame(b, 1)).toHaveLength(0)
    expect(sceneAt(b, LEAD_IN + 1.5)[0].opacity).toBe(0.5)
    expect(sceneAtFrame(b, 2)).toHaveLength(1)
    expect(sceneAtFrame(b, 3)).toHaveLength(0)
    expect(sceneAt(b, LEAD_IN + 3)).toHaveLength(0)
  })

  it('rotation идёт по кратчайшей дуге', () => {
    const it = figure({
      el: { ...figure().el, rotation: 170 } as never,
      states: [{ frame: 1, geom: { rotation: -170 } }]
    })
    const r = (sceneAt(board([it]), LEAD_IN + 0.5)[0].el as { rotation: number }).rotation
    expect(Math.abs(r)).toBeCloseTo(180, 6)
  })

  it('массивы точек разной длины не падают: берётся ближний кадр', () => {
    const pen: BoardItem = {
      id: ID,
      show: { from: 0, to: 3 },
      el: {
        kind: 'shape',
        ann: {
          type: 'pen',
          id: ID2,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
          ],
          color: '#ffffff',
          width: 0.01
        } as never
      },
      states: [
        {
          frame: 1,
          geom: {
            points: [
              { x: 0, y: 0 },
              { x: 0.5, y: 0.5 },
              { x: 1, y: 1 }
            ]
          }
        }
      ]
    }
    const b = board([pen])
    const n = (t: number): number =>
      (sceneAt(b, t)[0].el as unknown as { ann: { points: unknown[] } }).ann.points.length
    expect(n(LEAD_IN + 0.3)).toBe(2)
    expect(n(LEAD_IN + 0.7)).toBe(3)
  })

  it('массивы точек одинаковой длины интерполируются', () => {
    const pen: BoardItem = {
      id: ID,
      show: { from: 0, to: 3 },
      el: {
        kind: 'shape',
        ann: {
          type: 'pen',
          id: ID2,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
          ],
          color: '#ffffff',
          width: 0.01
        } as never
      },
      states: [
        {
          frame: 1,
          geom: {
            points: [
              { x: 0.2, y: 0 },
              { x: 1, y: 1 }
            ]
          }
        }
      ]
    }
    const pts = (
      sceneAt(board([pen]), LEAD_IN + 0.5)[0].el as unknown as { ann: { points: { x: number }[] } }
    ).ann.points
    expect(pts[0].x).toBeCloseTo(0.1, 10)
  })

  it('t вне диапазона не бросает', () => {
    const b = board([moving])
    expect(posX(sceneAt(b, -5)[0].el)).toBe(0.2)
    expect(posX(sceneAt(b, boardDuration(b) + 10)[0].el)).toBe(0.6)
    expect(posX(sceneAt(board([moving], 1), 3)[0].el)).toBe(0.2)
  })
})
