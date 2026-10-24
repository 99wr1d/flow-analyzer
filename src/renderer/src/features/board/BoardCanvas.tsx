// Поле доски в редакторе: вписано 16:9, приближается и двигается; ручки выделения, черновик рисунка, подпись.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { sceneAtFrame, type ResolvedItem } from '../../../../shared/board/resolve'
import type { Board } from '../../../../shared/board/schema'
import { TextEditor } from '../annotations/TextEditor'
import { BoardItemView } from './BoardItemView'
import { BoardScene } from './BoardScene'
import { handlesFor, type Handle } from './boardHandles'
import { useBoardStore } from './boardStore'
import { useBoardUi } from './boardUi'
import { fitRect } from './canvasMath'
import { BOARD_H, BOARD_W } from './art/constants'
import { useBoardPointer } from './useBoardPointer'

/** Тень прошлого кадра: элементы, которые в этом кадре стоят иначе, — бледно на прежнем месте. */
function Ghosts({ board, frame }: { board: Board; frame: number }): JSX.Element | null {
  const ghosts = useMemo(() => {
    if (frame === 0) return []
    const now = new Map(sceneAtFrame(board, frame).map((it) => [it.id, JSON.stringify(it.el)]))
    return sceneAtFrame(board, frame - 1).filter((it) => {
      const cur = now.get(it.id)
      return cur !== undefined && cur !== JSON.stringify(it.el)
    })
  }, [board, frame])
  if (ghosts.length === 0) return null
  return (
    <g data-board-ghosts pointerEvents="none">
      {ghosts.map((it) => (
        <BoardItemView key={it.id} item={{ ...it, opacity: 0.32 }} selected={false} />
      ))}
    </g>
  )
}

function Handles({ handles, k }: { handles: Handle[]; k: number }): JSX.Element {
  const r = 7 / k
  return (
    <g data-board-handles pointerEvents="none">
      {handles.map((h) => {
        const x = h.x * BOARD_W
        const y = h.y * BOARD_H
        if (h.kind === 'rotate')
          return (
            <g key={h.kind} data-handle="rotate">
              <circle
                cx={x}
                cy={y}
                r={r * 1.15}
                fill="#2bd67b"
                stroke="#ffffff"
                strokeWidth={2 / k}
              />
              <path
                d={`M${x - r * 0.5} ${y + r * 0.1}a${r * 0.55} ${r * 0.55} 0 1 1 ${r * 0.5} ${r * 0.45}`}
                fill="none"
                stroke="#06210f"
                strokeWidth={1.6 / k}
              />
            </g>
          )
        if (h.kind === 'scale')
          return (
            <rect
              key={h.kind}
              data-handle="scale"
              x={x - r}
              y={y - r}
              width={2 * r}
              height={2 * r}
              rx={2 / k}
              fill="#ffffff"
              stroke="#2bd67b"
              strokeWidth={2.5 / k}
            />
          )
        return (
          <circle
            key={h.kind}
            data-handle={h.kind}
            cx={x}
            cy={y}
            r={h.kind === 'mid' ? r * 1.1 : r}
            fill={h.kind === 'mid' ? '#2bd67b' : '#ffffff'}
            stroke={h.kind === 'mid' ? '#ffffff' : '#2bd67b'}
            strokeWidth={2.5 / k}
          />
        )
      })}
    </g>
  )
}

export function BoardCanvas(): JSX.Element | null {
  const board = useBoardStore((s) => s.board)
  const frame = useBoardStore((s) => s.frame)
  const selection = useBoardStore((s) => s.selection)
  const playing = useBoardStore((s) => s.playing)
  const playTime = useBoardUi((s) => s.playTime)
  const zoom = useBoardUi((s) => s.zoom)
  const pan = useBoardUi((s) => s.pan)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = (): void => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useMemo(() => fitRect(size.w, size.h), [size])
  const ptr = useBoardPointer(viewportRef, stageRef, fit)
  if (!board) return null

  const shown = ptr.preview ?? board
  const k = fit.w > 0 ? (fit.w * zoom) / BOARD_W : 1
  let handles: Handle[] = []
  if (!playing && selection.length === 1 && !ptr.textEdit) {
    const item: ResolvedItem | undefined = sceneAtFrame(shown, frame).find(
      (it) => it.id === selection[0]
    )
    if (item) handles = handlesFor(item, k)
  }
  const isPlaying = playing && playTime !== null

  return (
    <div
      ref={stageRef}
      className="board-stage"
      data-testid="board-stage"
      style={{ cursor: isPlaying ? 'default' : ptr.cursor }}
      onPointerDown={ptr.onPointerDown}
      onPointerMove={ptr.onPointerMove}
      onPointerUp={ptr.onPointerUp}
      onPointerCancel={ptr.onPointerCancel}
      onDoubleClick={ptr.onDoubleClick}
      onWheel={ptr.onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={viewportRef}
        className="board-viewport"
        style={{
          left: fit.x,
          top: fit.y,
          width: fit.w,
          height: fit.h,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
        }}
      >
        {isPlaying ? (
          <BoardScene board={board} time={playTime} />
        ) : (
          <BoardScene
            board={shown}
            frame={frame}
            selectedIds={selection}
            underlay={<Ghosts board={shown} frame={frame} />}
          >
            {ptr.draft && (
              <BoardItemView item={{ id: 'draft', el: ptr.draft, opacity: 0.9 }} selected={false} />
            )}
            <Handles handles={handles} k={k} />
          </BoardScene>
        )}
        {ptr.textEdit && (
          <TextEditor
            x={ptr.textEdit.p.x * fit.w}
            y={ptr.textEdit.p.y * fit.h}
            style={{
              color: ptr.textEdit.color,
              size: ptr.textEdit.size,
              background: false,
              shadow: true
            }}
            videoHeight={fit.h}
            initial={ptr.textEdit.initial}
            onCommit={ptr.commitText}
            onCancel={ptr.cancelText}
          />
        )}
      </div>
    </div>
  )
}
