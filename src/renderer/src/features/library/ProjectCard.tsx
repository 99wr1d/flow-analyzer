// Карточка проекта на стартовом экране: эскиз, название, тип, сводка и меню действий.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryCard } from '../../../../shared/library'
import { ru } from '../../i18n/ru'
import { AlertIcon, FilmIcon, MoreIcon } from '../../ui/icons'
import {
  agoText,
  dateText,
  drawingsText,
  durationText,
  episodesText,
  modifiedKey
} from './cardsView'
import { useDialogsStore } from './dialogsStore'
import { locateCard, openCard, removeCard, revealCard } from './libraryActions'

/** Эскиз приходит байтами: из них собирается blob-адрес (он освобождается, когда карточка исчезает). */
function useThumbUrl(bytes: Uint8Array | null): string | null {
  const [made, setMade] = useState<{ bytes: Uint8Array; url: string } | null>(null)
  useEffect(() => {
    if (!bytes) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
    // blob-адрес создаётся во внешней системе (браузер), поэтому его положение в состояние допустимо здесь.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMade({ bytes, url })
    return () => URL.revokeObjectURL(url)
  }, [bytes])
  return bytes && made?.bytes === bytes ? made.url : null
}

function Thumb({ card }: { card: LibraryCard }): React.JSX.Element {
  const url = useThumbUrl(card.thumb)
  const duration = durationText(card.videoDuration)
  return (
    <div className="pcard__thumb">
      {url ? (
        <img
          className="pcard__img"
          src={url}
          alt={ru.start.thumbAlt}
          draggable={false}
          data-testid="card-thumb"
        />
      ) : (
        <span className="pcard__ph" aria-hidden="true">
          {card.status === 'ok' ? <FilmIcon size={34} /> : <AlertIcon size={30} />}
        </span>
      )}
      {duration && <span className="pcard__duration">{duration}</span>}
    </div>
  )
}

function CardMenu({
  card,
  onClose
}: {
  card: LibraryCard
  onClose: (returnFocus: boolean) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const ok = card.status === 'ok'
  const removable = card.status !== 'ok' || !card.inDefaultFolder

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const onPointerDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose(true)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
      )
      if (items.length === 0) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'ArrowDown' ? index + 1 : index - 1
      items[(next + items.length) % items.length].focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  const run = (action: () => unknown): void => {
    onClose(false)
    void action()
  }

  const item = (
    label: string,
    testId: string,
    action: () => unknown,
    title?: string
  ): React.JSX.Element => (
    <button
      type="button"
      role="menuitem"
      className="menu__item"
      title={title}
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
      aria-label={ru.start.menuAria(card.title)}
      data-testid="card-menu"
    >
      {ok && item(ru.start.menuOpen, 'card-open', () => openCard(card))}
      {card.status === 'missing' &&
        item(ru.start.locate, 'card-locate', () => locateCard(card), ru.start.locateTitle)}
      {card.status !== 'missing' &&
        item(ru.start.menuReveal, 'card-reveal', () => revealCard(card))}
      {ok &&
        item(ru.start.menuProps, 'card-props', () =>
          useDialogsStore.setState({
            properties: {
              kind: 'card',
              path: card.path,
              meta: {
                title: card.title,
                type: card.type,
                ...(card.date ? { date: card.date } : {}),
                ...(card.notes ? { notes: card.notes } : {})
              }
            }
          })
        )}
      <div className="menu__sep" role="separator" />
      {card.status !== 'missing' &&
        item(
          ru.start.menuDelete,
          'card-delete',
          () => useDialogsStore.setState({ deleting: card }),
          ru.start.menuDeleteTitle
        )}
      {removable ? (
        item(ru.start.menuRemove, 'card-remove', () => removeCard(card), ru.start.menuRemoveTitle)
      ) : (
        <p className="menu__note" data-testid="card-keep-note">
          {ru.start.menuKeepNote}
        </p>
      )}
    </div>
  )
}

export function ProjectCard({ card, now }: { card: LibraryCard; now: number }): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const ok = card.status === 'ok'
  const close = useCallback((returnFocus: boolean): void => {
    setMenuOpen(false)
    if (returnFocus) moreRef.current?.focus()
  }, [])

  const stats = ok ? ru.start.stats(episodesText(card.episodes), drawingsText(card.drawings)) : ''
  const when = ok
    ? card.updatedAt
      ? ru.start.modified(agoText(modifiedKey(card), now))
      : ru.start.neverModified
    : ''

  const body = (
    <>
      <Thumb card={card} />
      <div className="pcard__body">
        <div className="pcard__title" title={card.title} data-testid="card-title">
          {card.title}
        </div>
        {ok ? (
          <>
            <div className="pcard__line">
              <span className={`badge badge--${card.type}`} data-testid="card-type">
                {ru.projectTypes[card.type]}
              </span>
              {card.date && (
                <span className="pcard__date" data-testid="card-date">
                  {dateText(card.date)}
                </span>
              )}
            </div>
            <div className="pcard__video" title={card.videoFileName ?? undefined}>
              {card.videoFileName ?? ru.start.noVideo}
            </div>
            <div className="pcard__stats" data-testid="card-stats">
              {stats}
            </div>
            <div className="pcard__when" data-testid="card-when">
              {when}
            </div>
          </>
        ) : card.status === 'missing' ? (
          <>
            <div className="pcard__problem" data-testid="card-missing">
              {ru.start.missingTitle}
            </div>
            <div className="pcard__video">{ru.start.missingHint}</div>
            <div className="pcard__path" title={card.path}>
              {card.path}
            </div>
          </>
        ) : (
          <>
            <div className="pcard__problem" data-testid="card-error">
              {ru.start.unreadableTitle}
            </div>
            <div className="pcard__video">{card.error}</div>
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
      className={`pcard pcard--${card.status}`}
      data-testid="project-card"
      data-path={card.path}
      data-status={card.status}
      data-type={card.type}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuOpen(true)
      }}
    >
      {ok ? (
        <button
          type="button"
          className="pcard__open"
          aria-label={ru.start.openAria(card.title)}
          data-testid="card-open-main"
          onClick={() => void openCard(card)}
        >
          {body}
        </button>
      ) : (
        <div className="pcard__open pcard__open--static">{body}</div>
      )}
      {card.status === 'missing' && (
        <div className="pcard__actions">
          <button
            type="button"
            className="btn btn--small"
            title={ru.start.locateTitle}
            data-testid="card-locate-btn"
            onClick={() => void locateCard(card)}
          >
            {ru.start.locate}
          </button>
          <button
            type="button"
            className="btn btn--small"
            title={ru.start.menuRemoveTitle}
            data-testid="card-remove-btn"
            onClick={() => void removeCard(card)}
          >
            {ru.start.menuRemove}
          </button>
        </div>
      )}
      <button
        ref={moreRef}
        type="button"
        className="icon-btn pcard__more"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={ru.start.menuAria(card.title)}
        title={ru.start.menuAria(card.title)}
        data-testid="card-menu-btn"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MoreIcon size={18} />
      </button>
      {menuOpen && <CardMenu card={card} onClose={close} />}
    </article>
  )
}
