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

/** Состояние оценки, если вызывающий его уже знает (строка списка): тогда кнопка не ищет эпизод в хранилище. */
interface RateState {
  rating: 'good' | 'bad' | null
  review: boolean
}

function RateButton({
  episodeId,
  kind,
  size,
  state,
  onToggle
}: {
  episodeId: string
  kind: RateKind
  size: number
  state?: RateState
  onToggle: (kind: RateKind) => void
}): React.JSX.Element {
  const fromStore = useEpisodesStore((s) => {
    if (state) return false
    const e = s.items.find((x) => x.id === episodeId)
    return kind === 'review' ? e?.review === true : e?.rating === kind
  })
  const active = state ? (kind === 'review' ? state.review : state.rating === kind) : fromStore
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
  rating,
  review,
  onToggle
}: {
  episodeId: string
  size?: number
  /** Если заданы оба, оценка берётся отсюда (строка списка), иначе читается из хранилища (подсказка после тега). */
  rating?: 'good' | 'bad' | null
  review?: boolean
  onToggle: (kind: RateKind) => void
}): React.JSX.Element {
  const state = rating !== undefined && review !== undefined ? { rating, review } : undefined
  return (
    <div className="rate-group" role="group" aria-label={ru.ratings.groupLabel}>
      {KINDS.map((kind) => (
        <RateButton
          key={kind}
          episodeId={episodeId}
          kind={kind}
          size={size}
          state={state}
          onToggle={onToggle}
        />
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
