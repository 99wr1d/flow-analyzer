import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_NOTE,
  editRange,
  episodeDuration,
  type Episode,
  type Range
} from '../../../../shared/episodes'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { ExportIcon, TrashIcon } from '../../ui/icons'
import { openExportDialog } from '../export/exportActions'
import { getCurrentTime, playVideo, seekTo } from '../player/videoElement'
import { selectedEpisode, sortEpisodes, useEpisodesStore } from './episodesStore'
import { fmt, fmtRange } from './tagging'

function FilterChips({ episodes }: { episodes: readonly Episode[] }): React.JSX.Element | null {
  const filter = useEpisodesStore((s) => s.filter)
  const toggle = useEpisodesStore((s) => s.toggleFilter)
  const clear = useEpisodesStore((s) => s.clearFilter)

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
      {filter.length > 0 && (
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

function EpisodeRow({
  episode,
  selected
}: {
  episode: Episode
  selected: boolean
}): React.JSX.Element {
  const select = useEpisodesStore((s) => s.select)
  const remove = useEpisodesStore((s) => s.remove)
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
            select(episode.id)
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
        <button
          type="button"
          className="icon-btn icon-btn--small"
          title={`${ru.episodes.remove} (Delete)`}
          aria-label={ru.episodes.remove}
          data-testid="episode-delete"
          onClick={() => remove(episode.id)}
        >
          <TrashIcon size={15} />
        </button>
      </div>
      {selected && <EpisodeEditor key={episode.id} episode={episode} />}
    </li>
  )
}

/** Список эпизодов: фильтр по тегам, строки по порядку начала, правка выбранного. */
export function EpisodeList(): React.JSX.Element {
  const items = useEpisodesStore((s) => s.items)
  const filter = useEpisodesStore((s) => s.filter)
  const selected = useEpisodesStore(selectedEpisode)
  const ready = usePlayerStore((s) => s.status === 'ready')

  const sorted = useMemo(() => sortEpisodes(items), [items])
  const visible = useMemo(
    () => (filter.length === 0 ? sorted : sorted.filter((e) => filter.includes(e.tagId))),
    [sorted, filter]
  )

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
      {items.length === 0 ? (
        <div className="side-panel__body">
          <div className="episodes__empty">
            <p className="side-panel__empty">{ru.episodes.empty}</p>
            <p className="episodes__empty-hint">{ru.episodes.emptyHint}</p>
          </div>
        </div>
      ) : (
        <ul className="ep-list" data-testid="episode-list">
          {visible.map((e) => (
            <EpisodeRow key={e.id} episode={e} selected={e.id === selected?.id} />
          ))}
          {visible.length === 0 && (
            <li className="episodes__empty-hint episodes__filter-empty">
              {ru.episodes.filterEmpty}
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
