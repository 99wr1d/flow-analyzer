import { useMemo, useRef } from 'react'
import { isAnimated, keysOf } from '../../../../shared/animation'
import type { Annotation } from '../../../../shared/annotations'
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
/** Сдвиг ромбика меньше этого (px) — это щелчок, а не перетаскивание. */
const DRAG_PX = 3

interface KeyDrag {
  id: string
  index: number
  before: Annotation[]
  startX: number
  moved: boolean
}

/**
 * Дорожка «Рисунки»: отрезок — полоса, «только кадр» — тонкая отметка. Клик выбирает рисунок и ведёт к его началу.
 * У анимированных рисунков на полосе — ромбики ключей: щелчок ведёт к ключу, перетаскивание сдвигает его.
 */
export function AnnotationTrack(): React.JSX.Element {
  const items = useAnnotationsStore((s) => s.items)
  const selectedId = useAnnotationsStore((s) => s.selectedId)
  const selectedKey = useAnnotationsStore((s) => s.selectedKey)
  const select = useAnnotationsStore((s) => s.select)
  const selectKey = useAnnotationsStore((s) => s.selectKey)
  const duration = usePlayerStore((s) => s.duration)
  const fps = usePlayerStore((s) => s.fps)
  const ready = usePlayerStore((s) => s.status === 'ready')
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<KeyDrag | null>(null)

  const laid = useMemo(() => assignLanes(items, fps), [items, fps])
  const byId = useMemo(() => new Map(items.map((a) => [a.id, a])), [items])
  const lanes = Math.min(MAX_LANES, Math.max(1, ...laid.map((l) => l.lane + 1)))
  const height = LABEL_H + PAD * 2 + lanes * LANE_H + (lanes - 1) * LANE_GAP

  /** Время (секунды видео) под указателем. */
  const timeAt = (clientX: number): number => {
    const box = rootRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0) return 0
    return Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration))
  }

  const onKeyDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    a: Annotation,
    index: number
  ): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const store = useAnnotationsStore.getState()
    select(a.id)
    selectKey(index)
    drag.current = { id: a.id, index, before: store.items, startX: e.clientX, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onKeyMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_PX) return
    d.moved = true
    useAnnotationsStore.getState().previewRetime(d.before, d.id, d.index, timeAt(e.clientX), fps)
  }
  const onKeyUp = (e: React.PointerEvent<HTMLButtonElement>, a: Annotation): void => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (!d) return
    const store = useAnnotationsStore.getState()
    if (d.moved) {
      // Один шаг отмены на весь сдвиг; выбранный ключ остаётся тем же.
      store.commitFrom(d.before)
      const now = store.items.find((x) => x.id === a.id)
      const key = now ? keysOf(now)[d.index] : undefined
      if (key) seekTo(key.t)
    } else {
      const key = keysOf(a)[d.index]
      if (key) seekTo(key.t)
    }
    e.currentTarget.blur()
  }

  return (
    <div
      ref={rootRef}
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
          const laneTop = LABEL_H + PAD + l.lane * (LANE_H + LANE_GAP)
          const keys = isAnimated(a) ? keysOf(a) : []
          return (
            <span key={l.id} style={{ display: 'contents' }}>
              <button
                type="button"
                className={[
                  'anno-track__item',
                  isFrame ? 'anno-track__item--frame' : '',
                  l.id === selectedId ? 'anno-track__item--selected' : ''
                ].join(' ')}
                style={{
                  left: `${left}%`,
                  width: isFrame ? undefined : `${Math.max(right - left, 0)}%`,
                  top: laneTop,
                  height: LANE_H,
                  background: color
                }}
                title={`${label}. ${ru.annotations.trackItem}`}
                aria-label={label}
                aria-pressed={l.id === selectedId}
                data-testid="track-item"
                data-id={l.id}
                data-mode={a.timing.mode}
                data-keys={keys.length}
                onClick={(e) => {
                  select(l.id)
                  seekTo(a.timing.start)
                  e.currentTarget.blur()
                }}
              />
              {keys.map((k, index) => (
                <button
                  key={index}
                  type="button"
                  className={[
                    'anno-track__key',
                    l.id === selectedId && index === selectedKey ? 'anno-track__key--selected' : ''
                  ].join(' ')}
                  style={{
                    left: `${Math.max(0, Math.min(100, (k.t / duration) * 100))}%`,
                    top: laneTop + LANE_H / 2 - 5
                  }}
                  title={`${ru.annotations.trackKey(index + 1, formatTime(k.t, { tenths: true }))}. ${ru.annotations.trackKeyHint}`}
                  aria-label={ru.annotations.trackKey(index + 1, formatTime(k.t, { tenths: true }))}
                  aria-pressed={l.id === selectedId && index === selectedKey}
                  data-testid="track-key"
                  data-id={l.id}
                  data-index={index}
                  data-time={k.t}
                  onPointerDown={(e) => onKeyDown(e, a, index)}
                  onPointerMove={onKeyMove}
                  onPointerUp={(e) => onKeyUp(e, a)}
                  onPointerCancel={(e) => onKeyUp(e, a)}
                />
              ))}
            </span>
          )
        })}
    </div>
  )
}
