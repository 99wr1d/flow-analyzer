import { useMemo } from 'react'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { formatTime } from '../player/format'
import { seekTo } from '../player/videoElement'
import { useAnnotationsStore } from './annotationsStore'
import { MAX_LANES, assignLanes } from './lanes'

const LANE_H = 12
const LANE_GAP = 3
const PAD = 4
const LABEL_H = 14

/** Дорожка «Рисунки»: отрезок — полоса, «только кадр» — тонкая отметка. Клик выбирает рисунок и ведёт к его началу. */
export function AnnotationTrack(): React.JSX.Element {
  const items = useAnnotationsStore((s) => s.items)
  const selectedId = useAnnotationsStore((s) => s.selectedId)
  const select = useAnnotationsStore((s) => s.select)
  const duration = usePlayerStore((s) => s.duration)
  const fps = usePlayerStore((s) => s.fps)
  const ready = usePlayerStore((s) => s.status === 'ready')

  const laid = useMemo(() => assignLanes(items, fps), [items, fps])
  const byId = useMemo(() => new Map(items.map((a) => [a.id, a])), [items])
  const lanes = Math.min(MAX_LANES, Math.max(1, ...laid.map((l) => l.lane + 1)))
  const height = LABEL_H + PAD * 2 + lanes * LANE_H + (lanes - 1) * LANE_GAP

  return (
    <div
      className="anno-track"
      style={{ height }}
      role="group"
      aria-label={ru.annotations.trackLabel}
      data-testid="annotation-track"
    >
      <span className="anno-track__label">
        {ru.annotations.trackLabel}
        {ready && items.length === 0 && <> · {ru.annotations.trackEmpty}</>}
      </span>
      {ready &&
        duration > 0 &&
        laid.map((l) => {
          const a = byId.get(l.id)
          if (!a) return null
          const left = Math.max(0, Math.min(100, (l.start / duration) * 100))
          const right = Math.max(0, Math.min(100, (l.end / duration) * 100))
          const isFrame = a.timing.mode === 'frame'
          const color = a.style.color
          const label = `${ru.annotations.types[a.type]}, ${formatTime(a.timing.start, { tenths: true })}`
          return (
            <button
              key={l.id}
              type="button"
              className={[
                'anno-track__item',
                isFrame ? 'anno-track__item--frame' : '',
                l.id === selectedId ? 'anno-track__item--selected' : ''
              ].join(' ')}
              style={{
                left: `${left}%`,
                width: isFrame ? undefined : `${Math.max(right - left, 0)}%`,
                top: LABEL_H + PAD + l.lane * (LANE_H + LANE_GAP),
                height: LANE_H,
                background: color
              }}
              title={`${label}. ${ru.annotations.trackItem}`}
              aria-label={label}
              aria-pressed={l.id === selectedId}
              data-testid="track-item"
              data-id={l.id}
              data-mode={a.timing.mode}
              onClick={(e) => {
                select(l.id)
                seekTo(a.timing.start)
                e.currentTarget.blur()
              }}
            />
          )
        })}
    </div>
  )
}
