// Ряд под верхней панелью: миниатюры видов поля (щелчок меняет фон) и инструменты поля — выбор, рука, приближение, во весь экран.
import { memo } from 'react'
import type { JSX } from 'react'
import { setView } from '../../../../shared/board/edit'
import { ru } from '../../i18n/ru'
import { useKeyHint } from '../commands/useKeys'
import {
  FitIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  HandIcon,
  SelectIcon,
  ZoomInIcon,
  ZoomOutIcon
} from '../../ui/icons'
import { applyBoard, selectBoardTool } from './boardActions'
import { useBoardStore } from './boardStore'
import { MAX_ZOOM, MIN_ZOOM, useBoardUi } from './boardUi'
import { PITCH_VIEWS, type PitchView } from './art/pitchViews'
import { BOARD_H, BOARD_W } from './art/constants'

const ViewThumb = memo(function ViewThumb({ view }: { view: PitchView }): JSX.Element {
  const { Background } = view
  return (
    <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} width={64} height={36} aria-hidden="true">
      <Background />
    </svg>
  )
})

const ZOOM_STEP = 1.25

function zoomBy(factor: number): void {
  const ui = useBoardUi.getState()
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, ui.zoom * factor))
  // Приближение кнопками — к центру видимой части: сдвиг масштабируется вместе с полем.
  const k = zoom / ui.zoom
  ui.setView(zoom, { x: ui.pan.x * k, y: ui.pan.y * k })
}

interface Props {
  fullscreen: boolean
  onToggleFullscreen: () => void
}

export function BoardViews({ fullscreen, onToggleFullscreen }: Props): JSX.Element {
  const current = useBoardStore((s) => s.board?.view)
  const playing = useBoardStore((s) => s.playing)
  const selectActive = useBoardStore((s) => s.tool.kind === 'select')
  const hand = useBoardUi((s) => s.hand)
  const zoom = useBoardUi((s) => s.zoom)
  const selectHint = useKeyHint('board:select')
  return (
    <div className="board-views" data-testid="board-views">
      <span className="board-views__label">{ru.board.viewsLabel}</span>
      <div className="board-views__list" role="radiogroup" aria-label={ru.board.viewsGroup}>
        {PITCH_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={v.id === current}
            className={v.id === current ? 'board-view board-view--active' : 'board-view'}
            title={v.label}
            aria-label={v.label}
            disabled={playing}
            data-testid={`board-view-${v.id}`}
            onClick={(e) => {
              if (v.id !== current) applyBoard((b) => setView(b, v.id))
              e.currentTarget.blur()
            }}
          >
            <ViewThumb view={v} />
          </button>
        ))}
      </div>
      <div className="board-views__spacer" />
      <div className="board-views__tools" role="toolbar" aria-label={ru.board.viewsGroup}>
        <button
          type="button"
          className={selectActive && !hand ? 'tool-btn tool-btn--active' : 'tool-btn'}
          aria-pressed={selectActive && !hand}
          title={`${ru.board.selectTool}${selectHint}`}
          aria-label={ru.board.selectTool}
          disabled={playing}
          data-testid="board-tool-select"
          onClick={(e) => {
            selectBoardTool()
            e.currentTarget.blur()
          }}
        >
          <SelectIcon size={18} />
        </button>
        <button
          type="button"
          className={hand ? 'tool-btn tool-btn--active' : 'tool-btn'}
          aria-pressed={hand}
          title={ru.board.handTool}
          aria-label={ru.board.handTool}
          data-testid="board-tool-hand"
          onClick={(e) => {
            useBoardUi.getState().setHand(!hand)
            e.currentTarget.blur()
          }}
        >
          <HandIcon size={18} />
        </button>
        <div className="board-views__sep" aria-hidden="true" />
        <button
          type="button"
          className="tool-btn"
          title={ru.board.zoomOut}
          aria-label={ru.board.zoomOut}
          disabled={zoom <= MIN_ZOOM}
          data-testid="board-zoom-out"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <ZoomOutIcon size={18} />
        </button>
        <span className="board-views__zoom" data-testid="board-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="tool-btn"
          title={ru.board.zoomIn}
          aria-label={ru.board.zoomIn}
          disabled={zoom >= MAX_ZOOM}
          data-testid="board-zoom-in"
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <ZoomInIcon size={18} />
        </button>
        <button
          type="button"
          className="tool-btn"
          title={ru.board.zoomFit}
          aria-label={ru.board.zoomFit}
          disabled={zoom === 1}
          data-testid="board-zoom-fit"
          onClick={() => useBoardUi.getState().resetView()}
        >
          <FitIcon size={18} />
        </button>
        <button
          type="button"
          className={fullscreen ? 'tool-btn tool-btn--active' : 'tool-btn'}
          aria-pressed={fullscreen}
          title={fullscreen ? ru.board.fullscreenExit : ru.board.fullscreen}
          aria-label={fullscreen ? ru.board.fullscreenExit : ru.board.fullscreen}
          data-testid="board-fullscreen"
          onClick={(e) => {
            onToggleFullscreen()
            e.currentTarget.blur()
          }}
        >
          {fullscreen ? <FullscreenExitIcon size={18} /> : <FullscreenIcon size={18} />}
        </button>
      </div>
    </div>
  )
}
