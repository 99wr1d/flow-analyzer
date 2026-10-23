/** Сцена доски: фон вида и элементы в кадре или в момент времени. Один компонент для экрана и экспорта. */
import type { JSX } from 'react'
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
}

export function BoardScene({ board, frame, time, selectedIds }: BoardSceneProps): JSX.Element {
  const items = time !== undefined ? sceneAt(board, time) : sceneAtFrame(board, frame ?? 0)
  const { Background } = pitchView(board.view)
  const at = time !== undefined ? { 'data-time': time } : { 'data-frame': frame ?? 0 }
  return (
    <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} data-board-scene {...at}>
      <Background />
      {items.map((it) => (
        <BoardItemView key={it.id} item={it} selected={selectedIds?.includes(it.id) ?? false} />
      ))}
    </svg>
  )
}
