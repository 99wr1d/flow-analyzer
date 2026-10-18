// Три кнопки оценки эпизода: «хорошо», «плохо», «разобрать». Используются в списке эпизодов и в подсказке после тега.
import { ru } from '../../i18n/ru'
import { ReviewIcon, ThumbDownIcon, ThumbUpIcon } from '../../ui/icons'
import { useKeyHint } from '../commands/useKeys'
import { useEpisodesStore } from './episodesStore'
import type { RateKind } from './tagging'

const ICONS = { good: ThumbUpIcon, bad: ThumbDownIcon, review: ReviewIcon } as const
const LABELS: Record<RateKind, string> = {
  good: ru.ratings.good,
  bad: ru.ratings.bad,
  review: ru.ratings.review
}
const COMMANDS: Record<RateKind, string> = {
  good: 'episodes:rate-good',
  bad: 'episodes:rate-bad',
  review: 'episodes:review'
}
const KINDS: RateKind[] = ['good', 'bad', 'review']

function RateButton({
  episodeId,
  kind,
  size,
  onToggle
}: {
  episodeId: string
  kind: RateKind
  size: number
  onToggle: (kind: RateKind) => void
}): React.JSX.Element {
  const active = useEpisodesStore((s) => {
    const e = s.items.find((x) => x.id === episodeId)
    return kind === 'review' ? e?.review === true : e?.rating === kind
  })
  const hint = useKeyHint(COMMANDS[kind])
  const Icon = ICONS[kind]
  return (
    <button
      type="button"
      className={`rate-btn rate-btn--${kind}${active ? ' rate-btn--active' : ''}`}
      aria-pressed={active}
      aria-label={LABELS[kind]}
      title={`${LABELS[kind]}${hint}`}
      data-testid={`rate-${kind}`}
      data-active={active ? 'true' : 'false'}
      onClick={(e) => {
        onToggle(kind)
        e.currentTarget.blur()
      }}
    >
      <Icon size={size} />
    </button>
  )
}

export function RatingButtons({
  episodeId,
  size = 15,
  onToggle
}: {
  episodeId: string
  size?: number
  onToggle: (kind: RateKind) => void
}): React.JSX.Element {
  return (
    <div className="rate-group" role="group" aria-label={ru.ratings.groupLabel}>
      {KINDS.map((kind) => (
        <RateButton key={kind} episodeId={episodeId} kind={kind} size={size} onToggle={onToggle} />
      ))}
    </div>
  )
}

/** Маленькие значки оценки без кнопок: для полосы эпизода на таймлайне. */
export function RatingMarks({
  rating,
  review
}: {
  rating: 'good' | 'bad' | null
  review: boolean
}): React.JSX.Element | null {
  if (!rating && !review) return null
  return (
    <span className="ep-bar__marks" aria-hidden="true" data-testid="episode-bar-marks">
      {rating === 'good' && (
        <span className="rmark rmark--good" data-mark="good">
          <ThumbUpIcon size={10} />
        </span>
      )}
      {rating === 'bad' && (
        <span className="rmark rmark--bad" data-mark="bad">
          <ThumbDownIcon size={10} />
        </span>
      )}
      {review && (
        <span className="rmark rmark--review" data-mark="review">
          <ReviewIcon size={10} />
        </span>
      )}
    </span>
  )
}
