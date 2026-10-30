// Выбор матрицы «экран кадра → пространство трекера» для очередного кадра при учёте движения камеры.
import type { MotionChain } from '../../shared/camera/chain'
import { IDENTITY3, mul3, type Mat3 } from '../../shared/pitch/linalg'

export interface TransformChoice {
  /** Экран кадра frameIndex → пространство трекера. */
  T: Mat3
  anchorIndex: number
  anchorT: Mat3
}

/**
 * Первый кадр (anchorIndex === null): опора на нём, T = единичная.
 * Путь до опорного кадра есть: T = anchorT · between(кадр, опора).
 * Пути нет (обрыв, ненадёжный кадр, участок длиннее MAX_CHAIN_SPAN): если надёжно хотя бы движение от предыдущего
 * кадра, T = prevT · between(кадр, кадр−1) (точка экрана j → экран j−1 → пространство трекера); иначе «нулевое движение»
 * T = prevT. В обоих случаях кадр становится новой опорой.
 */
export function selectTransform(args: {
  chain: Pick<MotionChain, 'between'>
  frameIndex: number
  anchorIndex: number | null
  anchorT: Mat3
  prevT: Mat3
}): TransformChoice {
  const { chain, frameIndex, anchorIndex, anchorT, prevT } = args
  if (anchorIndex === null) return { T: IDENTITY3, anchorIndex: frameIndex, anchorT: IDENTITY3 }
  const toAnchor = chain.between(frameIndex, anchorIndex)
  if (toAnchor) return { T: mul3(anchorT, toAnchor), anchorIndex, anchorT }
  const step = chain.between(frameIndex, frameIndex - 1)
  const T = step ? mul3(prevT, step) : prevT
  return { T, anchorIndex: frameIndex, anchorT: T }
}
