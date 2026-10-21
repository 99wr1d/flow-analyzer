import { useEffect } from 'react'
import { RatingButtons } from './RatingButtons'
import { useFeedbackStore } from './feedbackStore'
import { rateEpisode } from './tagging'

const SHOW_MS = 2600
/** Если в подсказке есть кнопки оценки, она висит дольше: нужно успеть нажать. */
const SHOW_RATE_MS = 4500

/** Короткое подтверждение внизу картинки: «Эпизод «Атака» 00:12.0–00:22.0». Само исчезает. */
export function Toast(): React.JSX.Element | null {
  const toast = useFeedbackStore((s) => s.toast)
  const hide = useFeedbackStore((s) => s.hide)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(
      () => hide(toast.nonce),
      toast.ms ?? (toast.episodeId ? SHOW_RATE_MS : SHOW_MS)
    )
    return () => window.clearTimeout(timer)
  }, [toast, hide])

  if (!toast) return null
  return (
    <div
      key={toast.nonce}
      className={[
        'toast',
        toast.kind === 'warn' ? 'toast--warn' : '',
        toast.episodeId ? 'toast--rate' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={toast.color ? ({ '--tag': toast.color } as React.CSSProperties) : undefined}
      role="status"
      aria-live="polite"
      data-testid="toast"
      data-kind={toast.kind}
    >
      {toast.kind === 'info' && <span className="toast__dot" aria-hidden="true" />}
      <span className="toast__text">{toast.text}</span>
      {toast.episodeId && (
        <RatingButtons
          episodeId={toast.episodeId}
          size={16}
          onToggle={(kind) => rateEpisode(toast.episodeId as string, kind)}
        />
      )}
    </div>
  )
}
