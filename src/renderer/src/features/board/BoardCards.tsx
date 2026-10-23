// Раздел «Доски» на начальном экране: карточки сохранённых досок.
import { useCallback, useRef, useState } from 'react'
import type { BoardCard } from '../../../../shared/board/ipc'
import { ru } from '../../i18n/ru'
import { AlertIcon, FilmIcon, MoreIcon } from '../../ui/icons'
import { useMenuBehavior } from '../library/useMenuBehavior'
import { askDeleteBoard, openBoardCard, revealBoardCard, useBoardLibrary } from './boardLibrary'
import { russianMessage } from './boardActions'
import { boardCardSummary } from './cardsText'

function BoardMenu({
  card,
  onClose
}: {
  card: BoardCard
  onClose: (returnFocus: boolean) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useMenuBehavior(ref, onClose)
  const run = (action: () => unknown): void => {
    onClose(false)
    void action()
  }
  const item = (label: string, testId: string, action: () => unknown): React.JSX.Element => (
    <button
      type="button"
      role="menuitem"
      className="menu__item"
      data-testid={testId}
      onClick={() => run(action)}
    >
      <span className="menu__label">{label}</span>
    </button>
  )
  return (
    <div
      ref={ref}
      className="menu pcard__menu"
      role="menu"
      aria-label={ru.board.cardMenuAria(card.title)}
      data-testid="board-card-menu"
    >
      {card.status === 'ok' &&
        item(ru.start.menuOpen, 'board-card-open', () => openBoardCard(card))}
      {item(ru.start.menuReveal, 'board-card-reveal', () => revealBoardCard(card))}
      <div className="menu__sep" role="separator" />
      {item(ru.start.menuDelete, 'board-card-delete', () => askDeleteBoard(card))}
    </div>
  )
}

function BoardCardView({ card, now }: { card: BoardCard; now: number }): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const ok = card.status === 'ok'
  const close = useCallback((returnFocus: boolean): void => {
    setMenuOpen(false)
    if (returnFocus) moreRef.current?.focus()
  }, [])
  const summary = boardCardSummary(card, now)

  const body = (
    <>
      <div className="pcard__thumb">
        {card.thumb ? (
          <img
            className="pcard__img"
            src={card.thumb}
            alt={ru.board.thumbAlt}
            draggable={false}
            data-testid="board-card-thumb"
          />
        ) : (
          <span className="pcard__ph" aria-hidden="true">
            {ok ? <FilmIcon size={34} /> : <AlertIcon size={30} />}
          </span>
        )}
      </div>
      <div className="pcard__body">
        <div className="pcard__title" title={card.title} data-testid="board-card-title">
          {card.title}
        </div>
        {ok ? (
          <>
            <div className="pcard__stats" data-testid="board-card-frames">
              {summary.frames}
            </div>
            <div className="pcard__when" data-testid="board-card-when">
              {summary.when}
            </div>
          </>
        ) : (
          <>
            <div className="pcard__problem" data-testid="board-card-error">
              {ru.board.unreadable}
            </div>
            <div className="pcard__video">{card.error ? russianMessage(card.error) : ''}</div>
            <div className="pcard__path" title={card.path}>
              {card.path}
            </div>
          </>
        )}
      </div>
    </>
  )

  return (
    <article
      className={`pcard pcard--${ok ? 'ok' : 'error'}`}
      data-testid="board-card"
      data-path={card.path}
      data-status={card.status}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuOpen(true)
      }}
    >
      {ok ? (
        <button
          type="button"
          className="pcard__open"
          aria-label={ru.board.cardAria(card.title)}
          data-testid="board-card-open-main"
          onClick={() => void openBoardCard(card)}
        >
          {body}
        </button>
      ) : (
        <div className="pcard__open pcard__open--static">{body}</div>
      )}
      <button
        ref={moreRef}
        type="button"
        className="icon-btn pcard__more"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={ru.board.cardMenuAria(card.title)}
        title={ru.board.cardMenuAria(card.title)}
        data-testid="board-card-menu-btn"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MoreIcon size={18} />
      </button>
      {menuOpen && <BoardMenu card={card} onClose={close} />}
    </article>
  )
}

/** Раздел под проектами; пока досок нет, не показывается. */
export function BoardCards(): React.JSX.Element | null {
  const cards = useBoardLibrary((s) => s.cards)
  const now = useBoardLibrary((s) => s.loadedAt)
  if (cards.length === 0) return null
  return (
    <section className="lib-boards" aria-label={ru.board.listTitle} data-testid="boards-section">
      <h2 className="lib-boards__title">{ru.board.listTitle}</h2>
      <div className="lib-grid" data-testid="boards-grid">
        {cards.map((card) => (
          <BoardCardView key={card.path} card={card} now={now} />
        ))}
      </div>
    </section>
  )
}
