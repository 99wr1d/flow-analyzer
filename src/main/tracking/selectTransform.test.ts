import { describe, expect, it } from 'vitest'
import { MotionChain } from '../../shared/camera/chain'
import { applyH } from '../../shared/pitch/homography'
import { IDENTITY3, type Mat3 } from '../../shared/pitch/linalg'
import { selectTransform } from './selectTransform'

const shift = (tx: number): Mat3 => [1, 0, tx, 0, 1, 0, 0, 0, 1]
const stub = (fn: (a: number, b: number) => Mat3 | null): Pick<MotionChain, 'between'> => ({
  between: fn
})
const x0 = (m: Mat3): number => applyH(m, { x: 0.5, y: 0.5 })!.x

describe('selectTransform', () => {
  it('первый кадр: единичная, опора на нём', () => {
    const r = selectTransform({
      chain: stub(() => null),
      frameIndex: 5,
      anchorIndex: null,
      anchorT: IDENTITY3,
      prevT: IDENTITY3
    })
    expect(r).toEqual({ T: IDENTITY3, anchorIndex: 5, anchorT: IDENTITY3 })
  })

  it('обычный случай: T = anchorT · between, опора прежняя', () => {
    const r = selectTransform({
      chain: stub(() => shift(0.1)),
      frameIndex: 7,
      anchorIndex: 3,
      anchorT: shift(0.2),
      prevT: shift(0.25)
    })
    expect(r.anchorIndex).toBe(3)
    expect(x0(r.T)).toBeCloseTo(0.8, 9)
  })

  it('обрыв: T = prevT, переякорение на кадре', () => {
    const r = selectTransform({
      chain: stub(() => null),
      frameIndex: 7,
      anchorIndex: 3,
      anchorT: shift(0.2),
      prevT: shift(0.25)
    })
    expect(r.anchorIndex).toBe(7)
    expect(x0(r.T)).toBeCloseTo(0.75, 9)
    expect(r.anchorT).toBe(r.T)
  })

  it('участок до опоры слишком длинный, но шаг j→j−1 надёжен: T = prevT · between(j, j−1)', () => {
    const r = selectTransform({
      chain: stub((a, b) => (a === 7 && b === 6 ? shift(0.05) : null)),
      frameIndex: 7,
      anchorIndex: 3,
      anchorT: shift(0.2),
      prevT: shift(0.25)
    })
    expect(r.anchorIndex).toBe(7)
    expect(x0(r.T)).toBeCloseTo(0.8, 9)
    expect(r.anchorT).toBe(r.T)
  })
})
