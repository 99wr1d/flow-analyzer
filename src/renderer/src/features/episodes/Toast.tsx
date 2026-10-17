import { useEffect } from 'react'
import { useFeedbackStore } from './feedbackStore'

const SHOW_MS = 2600

/** Короткое подтверждение внизу картинки: «Эпизод «Атака» 00:12.0–00:22.0». Само исчезает. */
export function Toast(): React.JSX.Element | null {
  const toast = useFeedbackStore((s) => s.toast)
  const hide = useFeedbackStore((s) => s.hide)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => hide(toast.nonce), SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [toast, hide])

  if (!toast) return null
  return (
    <div
      key={toast.nonce}
      className={toast.kind === 'warn' ? 'toast toast--warn' : 'toast'}
      style={toast.color ? ({ '--tag': toast.color } as React.CSSProperties) : undefined}
      role="status"
      aria-live="polite"
      data-testid="toast"
      data-kind={toast.kind}
    >
      {toast.kind === 'info' && <span className="toast__dot" aria-hidden="true" />}
      {toast.text}
    </div>
  )
}
