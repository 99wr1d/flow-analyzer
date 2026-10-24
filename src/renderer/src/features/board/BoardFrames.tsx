// Полоса кадров: ▶/⏸, кадры 1…N (правый щелчок — «Удалить кадр»), «+», длительность перехода.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { removeFrame, setTransition } from '../../../../shared/board/edit'
import { MAX_FRAMES, MAX_TRANSITION, MIN_TRANSITION } from '../../../../shared/board/schema'
import { useKeyHint } from '../commands/useKeys'
import { ru } from '../../i18n/ru'
import { PauseIcon, PlayIcon, PlusIcon } from '../../ui/icons'
import { addFrameHere, applyBoard, frameAtTime, toggleBoardPlay } from './boardActions'
import { useBoardStore } from './boardStore'
import { useBoardUi } from './boardUi'

interface Menu {
  frame: number
  x: number
  y: number
}

function FrameMenu({ menu, onClose }: { menu: Menu; onClose: () => void }): JSX.Element {
  const count = useBoardStore((s) => s.board?.frameCount ?? 1)
  useEffect(() => {
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof KeyboardEvent) e.stopPropagation()
      onClose()
    }
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element).closest?.('.board-menu')) onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return (
    <div
      className="board-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      data-testid="board-frame-menu"
    >
      <button
        type="button"
        role="menuitem"
        className="board-menu__item"
        disabled={count < 2}
        data-testid="board-frame-remove"
        onClick={() => {
          const f = menu.frame
          applyBoard((b) => removeFrame(b, f))
          onClose()
        }}
      >
        {ru.board.frames.remove}
      </button>
    </div>
  )
}

export function BoardFrames(): JSX.Element | null {
  const board = useBoardStore((s) => s.board)
  const frame = useBoardStore((s) => s.frame)
  const playing = useBoardStore((s) => s.playing)
  const playTime = useBoardUi((s) => s.playTime)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [transition, setDraft] = useState<number | null>(null)
  const playHint = useKeyHint('board:play')
  const addHint = useKeyHint('board:add-frame')
  if (!board) return null
  const count = board.frameCount
  const current = playing && playTime !== null ? frameAtTime(board, playTime) : frame
  const shownTransition = transition ?? board.transition
  const canPlay = count > 1
  const commitTransition = (): void => {
    if (transition === null) return
    const sec = Math.round(transition * 10) / 10
    setDraft(null)
    if (sec !== board.transition) applyBoard((b) => setTransition(b, sec))
  }

  return (
    <div
      className="board-frames"
      role="group"
      aria-label={ru.board.frames.group}
      data-testid="board-frames"
    >
      <button
        type="button"
        className="icon-btn icon-btn--primary"
        disabled={!canPlay}
        title={
          canPlay
            ? `${playing ? ru.board.frames.pause : ru.board.frames.play}${playHint}`
            : ru.board.frames.playNeedFrames
        }
        aria-label={playing ? ru.board.frames.pause : ru.board.frames.play}
        data-testid="board-play"
        onClick={(e) => {
          toggleBoardPlay()
          e.currentTarget.blur()
        }}
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <span className="board-frames__label">{ru.board.frames.label}</span>
      <div className="board-frames__list">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            className={i === current ? 'board-frame board-frame--active' : 'board-frame'}
            aria-pressed={i === current}
            aria-label={ru.board.frames.frame(i + 1)}
            title={ru.board.frames.frame(i + 1)}
            disabled={playing}
            data-testid={`board-frame-${i + 1}`}
            onClick={(e) => {
              useBoardStore.getState().setFrame(i)
              e.currentTarget.blur()
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              if (playing) return
              useBoardStore.getState().setFrame(i)
              setMenu({ frame: i, x: e.clientX, y: e.clientY })
            }}
          >
            {i + 1}
          </button>
        ))}
        <button
          type="button"
          className="board-frame board-frame--add"
          disabled={playing || count >= MAX_FRAMES}
          title={
            count >= MAX_FRAMES ? ru.board.frames.addLimit : `${ru.board.frames.add}${addHint}`
          }
          aria-label={ru.board.frames.add}
          data-testid="board-frame-add"
          onClick={(e) => {
            addFrameHere()
            e.currentTarget.blur()
          }}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      <div className="board-frames__spacer" />
      <label className="board-frames__transition" title={ru.board.frames.transitionTitle}>
        <span>{ru.board.frames.transition}</span>
        <input
          type="range"
          className="range"
          min={MIN_TRANSITION}
          max={MAX_TRANSITION}
          step={0.1}
          value={shownTransition}
          disabled={playing}
          data-testid="board-transition"
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commitTransition}
          onKeyUp={commitTransition}
          onBlur={commitTransition}
        />
        <span className="board-frames__value">{ru.board.frames.seconds(shownTransition)}</span>
      </label>
      {menu && <FrameMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
