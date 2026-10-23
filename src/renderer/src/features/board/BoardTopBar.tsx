// Верхняя панель доски: «← Главная», название (правится по щелчку), отменить/повторить, сохранить, видео, картинка.
import { useState } from 'react'
import type { JSX } from 'react'
import { setTitle } from '../../../../shared/board/edit'
import { MAX_TITLE } from '../../../../shared/board/schema'
import { ru } from '../../i18n/ru'
import { useKeyHint } from '../commands/useKeys'
import { FilmIcon, ImageIcon, RedoIcon, SaveIcon, UndoIcon } from '../../ui/icons'
import {
  applyBoard,
  boardRedo,
  boardUndo,
  goHome,
  saveBoard,
  saveImage,
  saveVideo
} from './boardActions'
import { useBoardStore } from './boardStore'
import { useBoardUi } from './boardUi'

function Title(): JSX.Element {
  const title = useBoardStore((s) => s.board?.title ?? '')
  const dirty = useBoardStore((s) => s.dirty)
  const playing = useBoardStore((s) => s.playing)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const commit = (): void => {
    setEditing(false)
    const next = draft.replace(/\s+/g, ' ').trim()
    if (next && next !== title) applyBoard((b) => setTitle(b, next))
  }

  return (
    <div className="board-top__title">
      {editing ? (
        <input
          className="input board-top__title-input"
          value={draft}
          maxLength={MAX_TITLE}
          autoFocus
          aria-label={ru.board.titleInput}
          data-testid="board-title-input"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="board-top__title-btn"
          title={ru.board.titleEdit}
          disabled={playing}
          data-testid="board-title"
          onClick={() => {
            setDraft(title)
            setEditing(true)
          }}
        >
          {title}
        </button>
      )}
      {dirty && (
        <span
          className="top-bar__dirty"
          title={ru.board.dirty}
          role="img"
          aria-label={ru.board.dirty}
          data-testid="board-dirty"
        >
          •
        </span>
      )}
    </div>
  )
}

export function BoardTopBar(): JSX.Element {
  const canUndo = useBoardStore((s) => s.past.length > 0 && !s.playing)
  const canRedo = useBoardStore((s) => s.future.length > 0 && !s.playing)
  const frames = useBoardStore((s) => s.board?.frameCount ?? 1)
  const busy = useBoardUi((s) => s.job !== null)
  const undoHint = useKeyHint('board:undo')
  const redoHint = useKeyHint('board:redo')
  const saveHint = useKeyHint('board:save')
  const imageHint = useKeyHint('board:save-image')
  const videoTitle =
    frames < 2
      ? ru.board.saveVideoNeedFrames
      : busy
        ? ru.board.saveVideoBusy
        : ru.board.saveVideoTitle
  return (
    <header className="top-bar board-top">
      <button
        type="button"
        className="btn btn--home"
        title={ru.board.homeTitle}
        data-testid="board-home"
        onClick={(e) => {
          e.currentTarget.blur()
          void goHome()
        }}
      >
        ← {ru.board.home}
      </button>
      <div className="top-bar__sep" aria-hidden="true" />
      <Title />
      <div className="top-bar__spacer" />
      <button
        type="button"
        className="icon-btn"
        disabled={!canUndo}
        title={`${ru.board.undo}${undoHint}`}
        aria-label={ru.board.undo}
        data-testid="board-undo"
        onClick={boardUndo}
      >
        <UndoIcon size={18} />
      </button>
      <button
        type="button"
        className="icon-btn"
        disabled={!canRedo}
        title={`${ru.board.redo}${redoHint}`}
        aria-label={ru.board.redo}
        data-testid="board-redo"
        onClick={boardRedo}
      >
        <RedoIcon size={18} />
      </button>
      <div className="top-bar__sep" aria-hidden="true" />
      <button
        type="button"
        className="btn"
        title={`${ru.board.saveTitle}${saveHint}`}
        data-testid="board-save"
        onClick={(e) => {
          e.currentTarget.blur()
          void saveBoard()
        }}
      >
        <SaveIcon />
        {ru.board.save}
      </button>
      <span className="board-top__wrap" title={videoTitle}>
        <button
          type="button"
          className="btn"
          disabled={frames < 2 || busy}
          title={videoTitle}
          data-testid="board-save-video"
          onClick={(e) => {
            e.currentTarget.blur()
            void saveVideo()
          }}
        >
          <FilmIcon />
          {ru.board.saveVideo}
        </button>
      </span>
      <button
        type="button"
        className="btn btn--primary"
        title={`${ru.board.saveImageTitle}${imageHint}`}
        data-testid="board-save-image"
        onClick={(e) => {
          e.currentTarget.blur()
          void saveImage()
        }}
      >
        <ImageIcon />
        {ru.board.saveImage}
      </button>
    </header>
  )
}
