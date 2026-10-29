import { describe, expect, it } from 'vitest'
import { applyH } from '../pitch/homography'
import { IDENTITY3, type Mat3 } from '../pitch/linalg'
import { MotionChain } from './chain'
import { MAX_CHAIN_SPAN, type FrameMotion } from './types'

const shift = (tx: number, ty = 0): Mat3 => [1, 0, tx, 0, 1, ty, 0, 0, 1]
const motion = (index: number, H: Mat3, reliable = true): FrameMotion => ({ index, H, reliable, inliers: 50 })

/** Цепочка из кадров 1..n, в каждом сдвиг камеры на tx по x. */
function shifted(n: number, tx: number): MotionChain {
  const chain = new MotionChain()
  for (let i = 1; i <= n; i += 1) chain.push(motion(i, shift(tx)))
  return chain
}

describe('MotionChain', () => {
  it('between(a, a) — единичная матрица', () => {
    expect(shifted(3, 0.1).between(2, 2)).toEqual(IDENTITY3)
  })

  it('три сдвига +0.1: точка кадра 0 → кадр 3 уезжает на +0.3, обратно — на −0.3', () => {
    const chain = shifted(3, 0.1)
    const fwd = chain.between(0, 3)!
    const back = chain.between(3, 0)!
    const p = applyH(fwd, { x: 0.5, y: 0.4 })!
    expect(p.x).toBeCloseTo(0.8, 9)
    expect(p.y).toBeCloseTo(0.4, 9)
    const q = applyH(back, { x: 0.5, y: 0.4 })!
    expect(q.x).toBeCloseTo(0.2, 9)
    expect(q.y).toBeCloseTo(0.4, 9)
  })

  it('порядок перемножения: масштаб ×2 в кадре 1, затем сдвиг +0.1 в кадре 2 (не коммутируют)', () => {
    const chain = new MotionChain()
    chain.push(motion(1, [2, 0, 0, 0, 2, 0, 0, 0, 1]))
    chain.push(motion(2, shift(0.1, 0)))
    // (0.3, 0.2) -> масштаб (0.6, 0.4) -> сдвиг (0.7, 0.4); при обратном порядке вышло бы (0.8, 0.4)
    const p = applyH(chain.between(0, 2)!, { x: 0.3, y: 0.2 })!
    expect(p.x).toBeCloseTo(0.7, 9)
    expect(p.y).toBeCloseTo(0.4, 9)
    const q = applyH(chain.between(2, 0)!, { x: 0.7, y: 0.4 })!
    expect(q.x).toBeCloseTo(0.3, 9)
    expect(q.y).toBeCloseTo(0.2, 9)
    // средний участок: только сдвиг кадра 2
    const mid = applyH(chain.between(1, 2)!, { x: 0.6, y: 0.4 })!
    expect(mid.x).toBeCloseTo(0.7, 9)
    expect(mid.y).toBeCloseTo(0.4, 9)
  })

  it('ненадёжный кадр посередине даёт null в обе стороны', () => {
    const chain = shifted(4, 0.1)
    chain.push(motion(2, shift(0.1), false))
    expect(chain.between(0, 4)).toBeNull()
    expect(chain.between(4, 0)).toBeNull()
    expect(chain.between(2, 4)).not.toBeNull()
  })

  it('пропуск в цепочке даёт null', () => {
    const chain = new MotionChain()
    chain.push(motion(1, shift(0.1)))
    chain.push(motion(3, shift(0.1)))
    expect(chain.between(0, 3)).toBeNull()
  })

  it('после cut(5) между кадрами 4 и 6 связи нет, по сторонам обрыва — есть', () => {
    const chain = shifted(8, 0.1)
    chain.cut(5)
    expect(chain.between(4, 6)).toBeNull()
    expect(chain.between(6, 4)).toBeNull()
    expect(chain.between(5, 8)).not.toBeNull()
    expect(chain.between(0, 4)).not.toBeNull()
  })

  it('участок длиннее MAX_CHAIN_SPAN — null', () => {
    const chain = shifted(MAX_CHAIN_SPAN + 1, 0)
    expect(chain.between(0, MAX_CHAIN_SPAN)).not.toBeNull()
    expect(chain.between(0, MAX_CHAIN_SPAN + 1)).toBeNull()
  })

  it('from(toJSON()) даёт те же матрицы, обрывы сохраняются', () => {
    const chain = shifted(6, 0.05)
    chain.push(motion(3, shift(0.2, -0.1)))
    chain.cut(5)
    const copy = MotionChain.from(JSON.parse(JSON.stringify(chain.toJSON())))
    for (const [a, b] of [[0, 4], [4, 1], [2, 3], [4, 6], [5, 6]]) {
      expect(copy.between(a, b)).toEqual(chain.between(a, b))
    }
  })
})
