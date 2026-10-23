/** Сцена доски: фон вида и элементы в кадре или в момент времени. Один компонент для экрана и экспорта. */
import type { JSX, ReactNode } from 'react'
import { sceneAt, sceneAtFrame } from '../../../../shared/board/resolve'
import type { Board } from '../../../../shared/board/schema'
import { BoardItemView } from './BoardItemView'
import { BOARD_H, BOARD_W } from './art/constants'
import { pitchView } from './art/pitchViews'

export interface BoardSceneProps {
  board: Board
  frame?: number
  time?: number
  selectedIds?: readonly string[]
  /** Слой поверх элементов (ручки и черновик редактора); в экспорт не попадает — там его не передают. */
  children?: ReactNode
  /** Слой между фоном и элементами (тень прошлого кадра в редакторе). */
  underlay?: ReactNode
}

export function BoardScene({
  board,
  frame,
  time,
  selectedIds,
  children,
  underlay
}: BoardSceneProps): JSX.Element {
  const items = time !== undefined ? sceneAt(board, time) : sceneAtFrame(board, frame ?? 0)
  const { Background } = pitchView(board.view)
  const at = time !== undefined ? { 'data-time': time } : { 'data-frame': frame ?? 0 }
  return (
    <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} data-board-scene {...at}>
      <Background />
      {underlay}
      {items.map((it) => (
        <BoardItemView key={it.id} item={it} selected={selectedIds?.includes(it.id) ?? false} />
      ))}
      {children}
    </svg>
  )
}
