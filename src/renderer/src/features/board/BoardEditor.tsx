// Экран доски тренера (раскладка A): сверху панель и виды поля, слева разделы, в центре поле, под ним ряд элементов и кадры.
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ru } from '../../i18n/ru'
import { CloseIcon } from '../../ui/icons'
import { stopBoardPlay } from './boardActions'
import { BoardCanvas } from './BoardCanvas'
import { BoardFrames } from './BoardFrames'
import { BoardItemBar } from './BoardItemBar'
import { BoardRail } from './BoardRail'
import { useBoardStore } from './boardStore'
import { BoardTopBar } from './BoardTopBar'
import { BoardTray } from './BoardTray'
import { useBoardUi } from './boardUi'
import { BoardViews } from './BoardViews'
import './board.css'
import './boardPanels.css'

const NOTICE_MS = 5000

function Notice(): JSX.Element | null {
  const notice = useBoardUi((s) => s.notice)
  useEffect(() => {
    if (notice?.kind !== 'info') return
    const t = setTimeout(() => useBoardUi.getState().clearNotice(), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])
  if (!notice) return null
  return (
    <div
      className={notice.kind === 'error' ? 'board-notice board-notice--error' : 'board-notice'}
      role={notice.kind === 'error' ? 'alert' : 'status'}
      data-testid="board-notice"
    >
      <span>{notice.text}</span>
      <button
        type="button"
        className="icon-btn icon-btn--small"
        onClick={() => useBoardUi.getState().clearNotice()}
        aria-label={ru.board.dismiss}
        title={ru.board.dismiss}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

export function BoardEditor(): JSX.Element | null {
  const hasBoard = useBoardStore((s) => s.board !== null)
  const root = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      // Ушли с экрана доски: проигрывание останавливается.
      stopBoardPlay()
    }
  }, [])

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void root.current?.requestFullscreen().catch(() => undefined)
  }

  if (!hasBoard) return null
  return (
    <div className="board-editor" ref={root} data-testid="board-editor">
      <BoardTopBar />
      <BoardViews fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} />
      <div className="board-body">
        <BoardRail />
        <main className="board-main">
          <BoardItemBar />
          <div className="board-canvas-wrap">
            <BoardCanvas />
            <Notice />
          </div>
          <BoardTray />
          <BoardFrames />
        </main>
      </div>
    </div>
  )
}
