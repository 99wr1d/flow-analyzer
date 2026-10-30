import { IDENTITY3, inv3, mul3, type Mat3 } from '../pitch/linalg'
import { MAX_CHAIN_SPAN, type FrameMotion } from './types'

/**
 * Цепочка движений камеры по кадрам.
 * Движение кадра i (H_i) переводит точку кадра i−1 в кадр i.
 */
export class MotionChain {
  private readonly motions = new Map<number, FrameMotion>()

  push(m: FrameMotion): void {
    this.motions.set(m.index, m)
  }

  /**
   * Матрица «точка в кадре from → точка в кадре to» (в долях кадра).
   * Вперёд (from < to): H_to · … · H_(from+1); назад — обратная к прямой.
   * null: на пути нет движения, оно ненадёжно, есть обрыв, участок длиннее MAX_CHAIN_SPAN или матрица вырождена.
   */
  between(from: number, to: number): Mat3 | null {
    if (from === to) return IDENTITY3
    if (from > to) {
      const fwd = this.between(to, from)
      return fwd ? inv3(fwd) : null
    }
    if (to - from > MAX_CHAIN_SPAN) return null
    let acc: Mat3 = IDENTITY3
    for (let i = from + 1; i <= to; i += 1) {
      const m = this.motions.get(i)
      if (!m || !m.reliable) return null
      acc = mul3(m.H, acc)
    }
    return acc
  }

  /** Обрыв (смена плана): движение кадра index не определено, всё до index не связано с тем, что после. */
  cut(index: number): void {
    this.motions.set(index, { index, H: IDENTITY3, reliable: false, inliers: 0 })
  }

  toJSON(): FrameMotion[] {
    return [...this.motions.values()].sort((a, b) => a.index - b.index)
  }

  static from(list: FrameMotion[]): MotionChain {
    const chain = new MotionChain()
    for (const m of list) chain.push(m)
    return chain
  }
}
