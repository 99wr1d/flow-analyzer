import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_NOTE,
  editRange,
  episodeDuration,
  type Episode,
  type Range
} from '../../../../shared/episodes'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { filterEpisodes, RATING_FILTERS, type RatingFilter } from '../../../../shared/episodes'
import { ExportIcon, ReviewIcon, ThumbDownIcon, ThumbUpIcon, TrashIcon } from '../../ui/icons'
import { openExportDialog } from '../export/exportActions'
import { getCurrentTime, playVideo, seekTo } from '../player/videoElement'
import { selectedEpisode, sortEpisodes, useEpisodesStore } from './episodesStore'
import { RatingButtons } from './RatingButtons'
import { fmt, fmtRange, type RateKind } from './tagging'
import { VIRTUAL_THRESHOLD, buildOffsets, scrollToReveal, windowRange } from './windowing'

const RATING_ICONS: Record<RatingFilter, React.JSX.Element | null> = {
  good: <ThumbUpIcon size={13} />,
  bad: <ThumbDownIcon size={13} />,
  review: <ReviewIcon size={13} />,
  none: null
}
const RATING_NAMES: Record<RatingFilter, string> = {
  good: ru.ratings.good,
  bad: ru.ratings.bad,
  review: ru.ratings.review,
  none: ru.ratings.none
}

/** Фильтр по оценке: несколько чипов — «или»; вместе с тегами — «и». */
function RatingChips({ episodes }: { episodes: readonly Episode[] }): React.JSX.Element {
  const active = useEpisodesStore((s) => s.ratingFilter)
  const toggle = useEpisodesStore((s) => s.toggleRatingFilter)
  const counts = useMemo(() => {
    const c: Record<RatingFilter, number> = { good: 0, bad: 0, review: 0, none: 0 }
    for (const e of episodes) {
      if (e.rating === 'good') c.good += 1
      else if (e.rating === 'bad') c.bad += 1
      else c.none += 1
      if (e.review) c.review += 1
    }
    return c
  }, [episodes])
  return (
    <div
      className="chips chips--ratings"
      role="group"
      aria-label={ru.ratings.filterLabel}
      data-testid="rating-filter"
    >
      {RATING_FILTERS.map((kind) => (
        <button
          key={kind}
          type="button"
          className={`chip chip--rating chip--${kind}${active.includes(kind) ? ' chip--active' : ''}`}
          aria-pressed={active.includes(kind)}
          title={ru.ratings.filterTitle(RATING_NAMES[kind])}
          data-testid="rating-chip"
          data-rating={kind}
          onClick={(e) => {
            toggle(kind)
            e.currentTarget.blur()
          }}
        >
          {RATING_ICONS[kind]}
          {kind === 'none' && <span>{ru.ratings.none}</span>}
          <span className="chip__count">{counts[kind]}</span>
        </button>
      ))}
    </div>
  )
}

function FilterChips({ episodes }: { episodes: readonly Episode[] }): React.JSX.Element | null {
  const filter = useEpisodesStore((s) => s.filter)
  const ratingFilter = useEpisodesStore((s) => s.ratingFilter)
  const toggle = useEpisodesStore((s) => s.toggleFilter)
  const clear = useEpisodesStore((s) => s.clearFilters)

  // По одному чипу на тег, встречающийся среди эпизодов (имя и цвет берём из самих эпизодов).
  const tags = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string; count: number }>()
    for (const e of episodes) {
      const known = map.get(e.tagId)
      if (known) known.count += 1
      else map.set(e.tagId, { id: e.tagId, name: e.tagName, color: e.tagColor, count: 1 })
    }
    return [...map.values()]
  }, [episodes])

  if (tags.length === 0) return null
  return (
    <div
      className="chips"
      role="group"
      aria-label={ru.episodes.filter}
      data-testid="episode-filter"
    >
      {tags.map((t) => (
        <button
          key={t.id}
          type="button"
          className={filter.includes(t.id) ? 'chip chip--active' : 'chip'}
          style={{ '--tag': t.color } as React.CSSProperties}
          aria-pressed={filter.includes(t.id)}
          data-testid="filter-chip"
          data-tag-id={t.id}
          onClick={(e) => {
            toggle(t.id)
            e.currentTarget.blur()
          }}
        >
          <span className="chip__dot" aria-hidden="true" />
          {t.name}
          <span className="chip__count">{t.count}</span>
        </button>
      ))}
      {(filter.length > 0 || ratingFilter.length > 0) && (
        <button
          type="button"
          className="chip chip--reset"
          data-testid="filter-reset"
          onClick={(e) => {
            clear()
            e.currentTarget.blur()
          }}
        >
          {ru.episodes.filterReset}
        </button>
      )}
    </div>
  )
}

function TimeRow(props: {
  label: string
  value: number
  action: string
  actionTitle: string
  testId: string
  onNow: () => void
}): React.JSX.Element {
  return (
    <div className="ep-edit__row">
      <span className="field__label">{props.label}</span>
      <span className="inspector__value" data-testid={`${props.testId}-value`}>
        {fmt(props.value)}
      </span>
      <button
        type="button"
        className="btn btn--small"
        title={props.actionTitle}
        data-testid={props.testId}
        onClick={(e) => {
          props.onNow()
          e.currentTarget.blur()
        }}
      >
        {props.action}
      </button>
    </div>
  )
}

function EpisodeEditor({ episode }: { episode: Episode }): React.JSX.Element {
  const setRange = useEpisodesStore((s) => s.setRange)
  const setNote = useEpisodesStore((s) => s.setNote)
  const [error, setError] = useState<string | null>(null)

  const apply = (patch: Partial<Range>): void => {
    const { duration } = usePlayerStore.getState()
    const result = editRange(episode, patch, duration)
    if (!result.ok) {
      setError(ru.episodes.errorShort)
      return
    }
    setError(null)
    setRange(episode.id, result.range)
  }

  return (
    <div className="ep-edit" aria-label={ru.episodes.edit} data-testid="episode-editor">
      <TimeRow
        label={ru.episodes.start}
        value={episode.start}
        action={ru.episodes.useNow}
        actionTitle={ru.episodes.setStartNow}
        testId="episode-start-now"
        onNow={() => apply({ start: getCurrentTime() })}
      />
      <TimeRow
        label={ru.episodes.end}
        value={episode.end}
        action={ru.episodes.useNow}
        actionTitle={ru.episodes.setEndNow}
        testId="episode-end-now"
        onNow={() => apply({ end: getCurrentTime() })}
      />
      <div
        className="field__hint field__hint--error"
        role={error ? 'alert' : undefined}
        data-testid="episode-edit-error"
      >
        {error ?? ' '}
      </div>
      <label className="ep-edit__note">
        <span className="field__label">{ru.episodes.note}</span>
        <textarea
          className="input textarea"
          rows={2}
          maxLength={MAX_NOTE}
          value={episode.note ?? ''}
          placeholder={ru.episodes.notePlaceholder}
          data-testid="episode-note"
          onChange={(e) => setNote(episode.id, e.target.value)}
        />
      </label>
    </div>
  )
}

/** Оценка из строки списка. Хранилище берётся в момент нажатия: строка на него не подписана и не перерисовывается зря. */
function rateRow(id: string, kind: RateKind): void {
  const store = useEpisodesStore.getState()
  if (kind === 'review') store.toggleReview(id)
  else store.toggleRating(id, kind)
}

/**
 * Строка списка. memo: при добавлении или изменении одного эпизода перерисовывается только он (и выбранный),
 * а не все строки — иначе на тысяче эпизодов каждый тег заметно тормозил бы.
 */
const EpisodeRow = memo(function EpisodeRow({
  episode,
  selected
}: {
  episode: Episode
  selected: boolean
}): React.JSX.Element {
  const rowRef = useRef<HTMLLIElement>(null)

  // Выбрали на таймлайне — строка должна быть видна в списке.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <li
      ref={rowRef}
      className={selected ? 'ep-row ep-row--selected' : 'ep-row'}
      style={{ '--tag': episode.tagColor } as React.CSSProperties}
      data-ep-id={episode.id}
    >
      <div className="ep-row__line">
        <button
          type="button"
          className="ep-row__main"
          title={ru.episodes.row}
          aria-pressed={selected}
          data-testid="episode-row"
          data-id={episode.id}
          data-tag-id={episode.tagId}
          data-start={episode.start}
          data-end={episode.end}
          onClick={(e) => {
            useEpisodesStore.getState().select(episode.id)
            seekTo(episode.start)
            e.currentTarget.blur()
          }}
          onDoubleClick={() => {
            seekTo(episode.start)
            playVideo()
          }}
        >
          <span className="ep-row__dot" aria-hidden="true" />
          <span className="ep-row__name">{episode.tagName}</span>
          <span className="ep-row__dur">
            {episodeDuration(episode).toFixed(1)} {ru.episodes.seconds}
          </span>
          <span className="ep-row__time">{fmtRange(episode.start, episode.end)}</span>
          {episode.note && <span className="ep-row__note">{episode.note}</span>}
        </button>
        <RatingButtons
          episodeId={episode.id}
          rating={episode.rating}
          review={episode.review}
          onToggle={(kind) => rateRow(episode.id, kind)}
        />
        <button
          type="button"
          className="icon-btn icon-btn--small"
          title={`${ru.episodes.remove} (Delete)`}
          aria-label={ru.episodes.remove}
          data-testid="episode-delete"
          onClick={() => useEpisodesStore.getState().remove(episode.id)}
        >
          <TrashIcon size={15} />
        </button>
      </div>
      {selected && <EpisodeEditor key={episode.id} episode={episode} />}
    </li>
  )
})

/** Примерные высоты строк (px), пока настоящие не измерены: обычная, добавка за заметку, добавка за редактор выбранной. */
const ROW_EST = 52
const NOTE_EST = 17
const EDITOR_EST = 170

/**
 * Список эпизодов: фильтр по тегам, строки по порядку начала, правка выбранного.
 * Когда эпизодов больше VIRTUAL_THRESHOLD, в DOM лежат только строки около видимой области (остальное — пустое место
 * нужной высоты): список из 2000 эпизодов работает так же быстро, как из 20.
 */
export function EpisodeList(): React.JSX.Element {
  const items = useEpisodesStore((s) => s.items)
  const filter = useEpisodesStore((s) => s.filter)
  const ratingFilter = useEpisodesStore((s) => s.ratingFilter)
  const selected = useEpisodesStore(selectedEpisode)
  const ready = usePlayerStore((s) => s.status === 'ready')

  const sorted = useMemo(() => sortEpisodes(items), [items])
  const visible = useMemo(
    () => filterEpisodes(sorted, filter, ratingFilter),
    [sorted, filter, ratingFilter]
  )
  const selectedId = selected?.id ?? null

  const listRef = useRef<HTMLUListElement>(null)
  const virtual = visible.length > VIRTUAL_THRESHOLD
  const [view, setView] = useState({ top: 0, height: 600 })
  const [measured] = useState(() => new Map<string, number>())
  const [tick, setTick] = useState(0)

  const offsets = useMemo(() => {
    if (!virtual) return buildOffsets([])
    void tick // пересчёт после измерения настоящих высот
    return buildOffsets(
      visible.map(
        (e) =>
          measured.get(e.id) ??
          ROW_EST + (e.note ? NOTE_EST : 0) + (e.id === selectedId ? EDITOR_EST : 0)
      )
    )
  }, [virtual, visible, selectedId, measured, tick])

  // Размер списка (прокрутку отслеживает onScroll).
  useEffect(() => {
    const el = listRef.current
    if (!el || !virtual) return
    const sync = (): void =>
      setView((v) =>
        v.top === el.scrollTop && v.height === el.clientHeight
          ? v
          : { top: el.scrollTop, height: el.clientHeight }
      )
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [virtual])

  // Настоящие высоты показанных строк (шрифт, заметки, редактор выбранной) уточняют оценку.
  // Измеряем после отрисовки, в кадре анимации: состояние меняется не прямо в эффекте.
  useEffect(() => {
    if (!virtual) return
    const frame = requestAnimationFrame(() => {
      const el = listRef.current
      if (!el) return
      let changed = false
      el.querySelectorAll<HTMLElement>('li[data-ep-id]').forEach((li) => {
        const id = li.dataset.epId as string
        const h = Math.round((li.getBoundingClientRect().height + 2) * 2) / 2
        const before = measured.get(id)
        if (before === undefined || Math.abs(before - h) > 0.5) {
          measured.set(id, h)
          changed = true
        }
      })
      if (changed) setTick((t) => t + 1)
    })
    return () => cancelAnimationFrame(frame)
  }, [virtual, visible, selectedId, view.top, view.height, tick, measured])

  // Выбрали эпизод на таймлайне — прокручиваем список к нему, даже если его строки сейчас нет в DOM.
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    if (selectedId === null) {
      revealed.current = null
      return
    }
    if (!virtual || revealed.current === selectedId) return
    const el = listRef.current
    const index = visible.findIndex((e) => e.id === selectedId)
    if (!el || index < 0) return
    revealed.current = selectedId
    const to = scrollToReveal(offsets, index, el.scrollTop, el.clientHeight)
    if (to !== null) el.scrollTop = to
  }, [virtual, selectedId, visible, offsets])

  const range = virtual ? windowRange(offsets, view.top, view.height) : null
  const shown = range ? visible.slice(range.start, range.end) : visible

  return (
    <section className="episodes" aria-label={ru.episodes.title}>
      <div className="panel-header">
        <h2 className="panel-header__title">{ru.episodes.title}</h2>
        <span className="panel-header__count" data-testid="episode-count">
          {items.length}
        </span>
        <button
          type="button"
          className="btn btn--small panel-header__action"
          disabled={!ready}
          title={ready ? ru.export.openTitle : ru.export.openNeedVideo}
          data-testid="export-open"
          onClick={(e) => {
            openExportDialog()
            e.currentTarget.blur()
          }}
        >
          <ExportIcon size={14} />
          {ru.export.open}
        </button>
      </div>
      <FilterChips episodes={sorted} />
      {items.length > 0 && <RatingChips episodes={sorted} />}
      {items.length === 0 ? (
        <div className="side-panel__body">
          <div className="episodes__empty">
            <p className="side-panel__empty">{ru.episodes.empty}</p>
            <p className="episodes__empty-hint">{ru.episodes.emptyHint}</p>
          </div>
        </div>
      ) : (
        <ul
          ref={listRef}
          className="ep-list"
          data-testid="episode-list"
          data-virtual={virtual ? 'true' : 'false'}
          onScroll={
            virtual
              ? (e) => {
                  const el = e.currentTarget
                  setView((v) =>
                    v.top === el.scrollTop ? v : { top: el.scrollTop, height: el.clientHeight }
                  )
                }
              : undefined
          }
        >
          {range && range.before > 0 && (
            <li className="ep-spacer" aria-hidden="true" style={{ height: range.before }} />
          )}
          {shown.map((e) => (
            <EpisodeRow key={e.id} episode={e} selected={e.id === selectedId} />
          ))}
          {range && range.after > 0 && (
            <li className="ep-spacer" aria-hidden="true" style={{ height: range.after }} />
          )}
          {visible.length === 0 && (
            <li className="episodes__empty-hint episodes__filter-empty">
              {ratingFilter.length > 0 ? ru.episodes.filterEmptyRated : ru.episodes.filterEmpty}
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
