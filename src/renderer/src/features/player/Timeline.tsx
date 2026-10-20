import { useEffect, useMemo, useRef, useState } from 'react'
import { AnnotationTrack } from '../annotations/AnnotationTrack'
import { EpisodeTrack } from '../episodes/EpisodeTrack'
import { MarkOverlay } from '../episodes/MarkOverlay'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { formatTime } from './format'
import { computeTicks } from './ticks'
import { useSeekPointer } from './useSeekPointer'

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/**
 * Бегунок. Двигается через transform на своём слое композитора: смена положения не вызывает раскладку и перерисовку
 * дорожек (на длинном матче под ним тысячи полос эпизодов; с left: % каждый кадр перерисовывал бы их все).
 */
function Playhead({ width }: { width: number }): React.JSX.Element {
  const fraction = usePlayerStore((s) =>
    s.duration > 0 ? Math.min(1, Math.max(0, s.currentTime / s.duration)) : 0
  )
  return (
    <div
      className="timeline__playhead"
      style={{ transform: `translateX(${Math.round(fraction * width * 10) / 10}px)` }}
      data-testid="playhead"
    />
  )
}

export function Timeline(): React.JSX.Element {
  const ready = usePlayerStore((s) => s.status === 'ready')
  const duration = usePlayerStore((s) => s.duration)
  const rulerRef = useRef<HTMLDivElement>(null)
  const width = useWidth(rulerRef)
  const pointer = useSeekPointer()

  const ticks = useMemo(() => computeTicks(duration, width), [duration, width])
  const withTenths = ticks.step < 1
  const hours = duration >= 3600

  return (
    <section className="timeline" aria-label={ru.timeline.label}>
      <div className="timeline__body">
        <div
          ref={rulerRef}
          className={ready ? 'timeline__ruler timeline__ruler--active' : 'timeline__ruler'}
          role={ready ? 'group' : undefined}
          aria-label={ready ? ru.timeline.ruler : undefined}
          aria-hidden={ready ? undefined : true}
          data-testid="ruler"
          {...pointer}
        >
          {ready &&
            ticks.minor.map((t) => (
              <div
                key={`m${t}`}
                className="timeline__tick timeline__tick--minor"
                style={{ left: `${(t / duration) * 100}%` }}
              />
            ))}
          {ready &&
            ticks.major.map((t) => (
              <div
                key={`M${t}`}
                className="timeline__tick"
                style={{ left: `${(t / duration) * 100}%` }}
              >
                <span className="timeline__tick-label">
                  {formatTime(t, { tenths: withTenths, hours })}
                </span>
              </div>
            ))}
          {ready && <MarkOverlay />}
        </div>
        <AnnotationTrack />
        <EpisodeTrack />
        {ready && <Playhead width={width} />}
      </div>
    </section>
  )
}
