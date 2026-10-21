import { useEffect, useRef } from 'react'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { usePictureRect } from '../annotations/usePictureRect'
import { answerConfirm, answerPick, cancelTrackingNow } from './trackingActions'
import { useTrackingStore } from './trackingStore'

/**
 * Панель слежения над видео: вопрос перед стартом, ход работы с «Отменой» и вопрос «Кто из них ваш?» с рамками игроков.
 * Esc отменяет слежение на любой стадии (до отмены ничего в рисунке не меняется).
 */
export function TrackingPanel(): React.JSX.Element | null {
  const phase = useTrackingStore((s) => s.phase)
  const done = useTrackingStore((s) => s.done)
  const total = useTrackingStore((s) => s.total)
  const confirmText = useTrackingStore((s) => s.confirmText)
  const cancelling = useTrackingStore((s) => s.cancelling)
  const pick = useTrackingStore((s) => s.pick)
  const runs = useTrackingStore((s) => s.runs)
  const videoId = usePlayerStore((s) => s.source?.id)
  const hostRef = useRef<HTMLDivElement>(null)
  const rect = usePictureRect(hostRef, phase !== 'idle', videoId)

  useEffect(() => {
    if (phase === 'idle') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      void cancelTrackingNow()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase])

  if (phase === 'idle') {
    return <span hidden data-testid="tracking-state" data-phase="idle" data-runs={runs} />
  }
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div
      ref={hostRef}
      className="track-host"
      data-testid="tracking-host"
      data-phase={phase}
      data-runs={runs}
    >
      {phase === 'asking' && pick && rect && (
        <div className="pick-shield" data-testid="pick-overlay">
          <div className="pick-banner" role="alert" data-testid="pick-text">
            {ru.tracking.pick}
          </div>
          {pick.candidates.map((c, i) => (
            <button
              key={i}
              type="button"
              className="pick-box"
              style={{
                left: rect.x + c.x * rect.w,
                top: rect.y + c.y * rect.h,
                width: c.w * rect.w,
                height: c.h * rect.h
              }}
              title={ru.tracking.pickBox}
              aria-label={`${ru.tracking.pickBox} ${i + 1}`}
              data-testid="pick-box"
              data-index={i}
              onClick={() => answerPick(i)}
            />
          ))}
        </div>
      )}
      <div className="track-panel" role="status" aria-live="polite" data-testid="tracking-panel">
        {phase === 'confirm' ? (
          <>
            <span className="track-panel__text" data-testid="tracking-confirm-text">
              {confirmText}
            </span>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="tracking-confirm-yes"
              onClick={() => answerConfirm(true)}
            >
              {ru.tracking.proceed}
            </button>
            <button
              type="button"
              className="btn"
              data-testid="tracking-confirm-no"
              onClick={() => answerConfirm(false)}
            >
              {ru.tracking.cancel}
            </button>
          </>
        ) : (
          <>
            {phase === 'running' && (
              <span className="track-panel__text">{ru.tracking.running}</span>
            )}
            {phase === 'running' && (
              <div
                className="track-panel__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={ru.tracking.progress(done, total)}
                title={ru.tracking.progress(done, total)}
                data-testid="tracking-progress"
                data-done={done}
                data-total={total}
              >
                <i style={{ width: `${percent}%` }} />
              </div>
            )}
            <button
              type="button"
              className="btn"
              disabled={cancelling}
              title={ru.tracking.cancelHint}
              data-testid="tracking-cancel"
              onClick={() => void cancelTrackingNow()}
            >
              {ru.tracking.cancel}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
