// Потоковая оценка движения камеры: кадры подаются по порядку, в памяти — только предыдущий серый кадр.
import { MotionChain } from '../../shared/camera/chain'
import { estimateMotion, type Gray, type MaskRect } from '../../shared/camera/estimate'
import type { FrameMotion } from '../../shared/camera/types'
import { IDENTITY3 } from '../../shared/pitch/linalg'
import type { DecodedFrame } from '../tracking/frames'
import { toGray } from './gray'

export class CameraEstimator {
  readonly chain: MotionChain
  private prev: Gray | null = null
  private prevBoxes: readonly MaskRect[] = []

  constructor(chain: MotionChain = new MotionChain()) {
    this.chain = chain
  }

  /**
   * Движение относительно предыдущего кадра; null — первый кадр или кадр после обрыва.
   * boxes — рамки игроков в долях кадра: маска — объединение рамок предыдущего и текущего кадров.
   */
  push(frame: DecodedFrame, boxes: readonly MaskRect[], cut: boolean): FrameMotion | null {
    const cur = toGray(frame)
    const prev = this.prev
    const masks = [...this.prevBoxes, ...boxes]
    this.prev = cur
    this.prevBoxes = boxes
    if (cut) {
      this.chain.cut(frame.index)
      return null
    }
    if (!prev) return null
    const est = estimateMotion(prev, cur, { masks })
    const motion: FrameMotion = {
      index: frame.index,
      H: est.reliable ? est.H : IDENTITY3,
      reliable: est.reliable,
      inliers: est.inliers
    }
    this.chain.push(motion)
    return motion
  }
}
