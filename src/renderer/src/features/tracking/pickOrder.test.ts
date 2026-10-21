import { describe, expect, it } from 'vitest'
import { pickOrder } from './pickOrder'

describe('pickOrder: малая рамка выше большой', () => {
  it('сортирует по площади от большой к малой и хранит исходный индекс', () => {
    const big = { x: 0.3, y: 0.35, w: 0.06, h: 0.3 }
    const small = { x: 0.31, y: 0.36, w: 0.03, h: 0.12 }
    const mid = { x: 0.6, y: 0.4, w: 0.04, h: 0.2 }
    const order = pickOrder([small, big, mid])
    expect(order.map((o) => o.i)).toEqual([1, 2, 0])
    expect(order[2].c).toBe(small)
  })
  it('равные по площади остаются в исходном порядке', () => {
    const a = { x: 0, y: 0, w: 0.1, h: 0.1 }
    const b = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }
    expect(pickOrder([a, b]).map((o) => o.i)).toEqual([0, 1])
  })
})
