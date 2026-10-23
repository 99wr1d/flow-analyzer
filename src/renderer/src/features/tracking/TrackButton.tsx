import { useMemo } from 'react'
import { useCalibrationsStore } from '../pitch/calibrationsStore'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { TargetIcon } from '../../ui/icons'
import { selectedAnnotation, useAnnotationsStore } from '../annotations/annotationsStore'
import { FAILURE_TEXT, planFor, startTracking } from './trackingActions'
import { canTrack, isLinkType } from './trackingApply'
import { trackingBusy, useTrackingStore } from './trackingStore'

/**
 * «Следить за игроком» в панели стиля: у выбранного кольца, круга, прожектора и подписи с отрезком; у связки —
 * «Следить за игроками» (ведёт все точки).
 * Если отрезок растянут дальше последнего ключа слежения — «Продолжить слежение» (с последнего ключа).
 */
export function TrackButton(): React.JSX.Element | null {
  const annotation = useAnnotationsStore(selectedAnnotation)
  const busy = useTrackingStore(trackingBusy)
  // Подпись и доступность зависят от текущего кадра.
  const frame = usePlayerStore((s) => Math.floor(s.currentTime * s.fps + 1e-6))
  const duration = usePlayerStore((s) => s.duration)
  const calibrations = useCalibrationsStore((s) => s.items)
  // План считается один раз на кадр, а не на каждый такт времени.
  const plan = useMemo(
    () => (annotation && canTrack(annotation) ? planFor(annotation) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [annotation, frame, duration, calibrations]
  )
  if (!annotation || !plan) return null
  const resume = plan.ok && plan.mode === 'continue'
  const link = isLinkType(annotation)
  const label = resume
    ? ru.tracking.buttonContinue
    : link
      ? ru.tracking.buttonLink
      : ru.tracking.button
  const hint = link ? ru.tracking.buttonHintLink : ru.tracking.buttonHint
  const title = !plan.ok
    ? FAILURE_TEXT[plan.reason]
    : `${label}. ${resume ? ru.tracking.buttonHintContinue : hint}`
  return (
    <>
      <span className="style-bar__sep" />
      <button
        type="button"
        className="chip-btn track-btn"
        disabled={busy || !plan.ok}
        title={title}
        aria-label={label}
        data-testid="track-button"
        data-mode={plan.ok ? plan.mode : 'off'}
        onClick={(e) => {
          void startTracking(annotation.id)
          e.currentTarget.blur()
        }}
      >
        <TargetIcon size={15} />
        <span className="track-btn__text">{label}</span>
      </button>
    </>
  )
}
