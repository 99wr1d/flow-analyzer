import { useMemo } from 'react'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { seekTo } from '../player/videoElement'
import { readableOn } from './color'
import { filterEpisodes } from '../../../../shared/episodes'
import { useEpisodesStore } from './episodesStore'
import { MAX_LANES, assignEpisodeLanes } from './lanes'
import { RatingMarks } from './RatingButtons'
import { fmtRange } from './tagging'

/** Дорожка «Эпизоды» на таймлайне: полосы цвета тега. Клик выбирает эпизод и ведёт к его началу. */
export function EpisodeTrack(): React.JSX.Element {
  const items = useEpisodesStore((s) => s.items)
  const selectedId = useEpisodesStore((s) => s.selectedId)
  const filter = useEpisodesStore((s) => s.filter)
  const ratingFilter = useEpisodesStore((s) => s.ratingFilter)
  const select = useEpisodesStore((s) => s.select)
  const duration = usePlayerStore((s) => s.duration)
  const ready = usePlayerStore((s) => s.status === 'ready')

  const laid = useMemo(() => assignEpisodeLanes(items), [items])
  const byId = useMemo(() => new Map(items.map((e) => [e.id, e])), [items])
  const shown = useMemo(
    () => new Set(filterEpisodes(items, filter, ratingFilter).map((e) => e.id)),
    [items, filter, ratingFilter]
  )
  const filtering = filter.length > 0 || ratingFilter.length > 0
  const lanes = Math.min(MAX_LANES, Math.max(1, ...laid.map((l) => l.lane + 1)))

  return (
    <div
      className="timeline__track ep-track"
      role="group"
      aria-label={ru.episodes.trackLabel}
      data-testid="episode-track"
    >
      <span className="anno-track__label">
        {ru.episodes.trackLabel}
        {ready && items.length === 0 && <> · {ru.timeline.noMarks}</>}
      </span>
      {!ready && <span className="timeline__empty">{ru.timeline.empty}</span>}
      {ready && duration > 0 && (
        <div className="ep-track__lanes">
          {laid.map((l) => {
            const e = byId.get(l.id)
            if (!e) return null
            const left = Math.max(0, Math.min(100, (e.start / duration) * 100))
            const right = Math.max(0, Math.min(100, (e.end / duration) * 100))
            const dimmed = filtering && !shown.has(e.id)
            const rated = e.rating === 'good' ? ', хорошо' : e.rating === 'bad' ? ', плохо' : ''
            const label = `${e.tagName}, ${fmtRange(e.start, e.end)}${rated}${e.review ? ', разобрать' : ''}`
            return (
              <button
                key={e.id}
                type="button"
                className={[
                  'ep-bar',
                  e.id === selectedId ? 'ep-bar--selected' : '',
                  dimmed ? 'ep-bar--dim' : ''
                ].join(' ')}
                style={{
                  left: `${left}%`,
                  width: `${Math.max(right - left, 0)}%`,
                  top: `${(l.lane / lanes) * 100}%`,
                  height: `calc(${100 / lanes}% - 3px)`,
                  background: e.tagColor,
                  color: readableOn(e.tagColor)
                }}
                title={`${label}. ${ru.episodes.trackItem}`}
                aria-label={label}
                aria-pressed={e.id === selectedId}
                data-testid="episode-bar"
                data-id={e.id}
                data-tag-id={e.tagId}
                data-rating={e.rating ?? 'none'}
                data-review={e.review ? 'true' : 'false'}
                onClick={(ev) => {
                  select(e.id)
                  seekTo(e.start)
                  ev.currentTarget.blur()
                }}
              >
                <RatingMarks rating={e.rating} review={e.review} />
                <span className="ep-bar__label">{e.tagName}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
