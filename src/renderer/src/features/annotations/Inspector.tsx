import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_FREEZE,
  MAX_DURATION,
  MAX_FREEZE,
  MIN_DURATION,
  MIN_FREEZE,
  defaultDuration,
  frameCenter,
  parseDuration,
  isPitchAnnotation,
  parseFreeze,
  type Annotation,
  type Timing
} from '../../../../shared/annotations'
import { isCalibrationFresh } from '../../../../shared/pitch/calibration'
import { ru } from '../../i18n/ru'
import { useCalibrationsStore } from '../pitch/calibrationsStore'
import { useKeyHint } from '../commands/useKeys'
import { usePlayerStore } from '../../store/playerStore'
import { TrashIcon } from '../../ui/icons'
import { formatTime } from '../player/format'
import { selectedAnnotation, useAnnotationsStore } from './annotationsStore'

function DurationField({ annotation }: { annotation: Annotation }): React.JSX.Element | null {
  const setTiming = useAnnotationsStore((s) => s.setTiming)
  const timing = annotation.timing
  const current = timing.mode === 'range' ? timing.duration : 0
  const [text, setText] = useState(String(current))
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Пока поле не в фокусе, показываем фактическое значение (после отмены, смены рисунка и т. д.).
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setText(String(Math.round(current * 100) / 100))
      setError(null)
    }
  }, [current, annotation.id])

  if (timing.mode !== 'range') return null

  const onChange = (value: string): void => {
    setText(value)
    const parsed = parseDuration(value)
    if (!parsed.ok) {
      setError(ru.annotations.durationErrors[parsed.error])
      return
    }
    setError(null)
    setTiming(annotation.id, { ...timing, duration: parsed.value }, `duration:${annotation.id}`)
  }

  return (
    <label className="field">
      <span className="field__label">{ru.annotations.duration}</span>
      <input
        ref={inputRef}
        type="number"
        className={error ? 'input input--invalid' : 'input'}
        min={MIN_DURATION}
        max={MAX_DURATION}
        step={0.5}
        value={text}
        aria-invalid={error !== null}
        aria-describedby="duration-hint"
        data-testid="duration-input"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setText(String(Math.round(current * 100) / 100))
          setError(null)
        }}
      />
      <span
        id="duration-hint"
        className={error ? 'field__hint field__hint--error' : 'field__hint'}
        role={error ? 'alert' : undefined}
        data-testid="duration-hint"
      >
        {error ?? ' '}
      </span>
    </label>
  )
}

/** Стоп-кадр при экспорте: только для рисунков «Только кадр». */
function FreezeField({ annotation }: { annotation: Annotation }): React.JSX.Element | null {
  const setTiming = useAnnotationsStore((s) => s.setTiming)
  const timing = annotation.timing
  const current = timing.mode === 'frame' ? timing.freezeSeconds : 0
  const [text, setText] = useState(String(current))
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setText(String(Math.round(current * 100) / 100))
      setError(null)
    }
  }, [current, annotation.id])

  if (timing.mode !== 'frame') return null

  const onChange = (value: string): void => {
    setText(value)
    const parsed = parseFreeze(value)
    if (!parsed.ok) {
      setError(ru.annotations.freezeErrors[parsed.error])
      return
    }
    setError(null)
    setTiming(annotation.id, { ...timing, freezeSeconds: parsed.value }, `freeze:${annotation.id}`)
  }

  return (
    <label className="field">
      <span className="field__label">{ru.annotations.freeze}</span>
      <input
        ref={inputRef}
        type="number"
        className={error ? 'input input--invalid' : 'input'}
        min={MIN_FREEZE}
        max={MAX_FREEZE}
        step={0.5}
        value={text}
        aria-invalid={error !== null}
        aria-describedby="freeze-hint"
        data-testid="freeze-input"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setText(String(Math.round(current * 100) / 100))
          setError(null)
        }}
      />
      <span
        id="freeze-hint"
        className={error ? 'field__hint field__hint--error' : 'field__hint'}
        role={error ? 'alert' : undefined}
        data-testid="freeze-hint"
      >
        {error ?? ru.annotations.freezeHint}
      </span>
    </label>
  )
}

export function Inspector(): React.JSX.Element | null {
  const selected = useAnnotationsStore(selectedAnnotation)
  const setTiming = useAnnotationsStore((s) => s.setTiming)
  const remove = useAnnotationsStore((s) => s.remove)
  const fps = usePlayerStore((s) => s.fps)
  const removeHint = useKeyHint('general:delete')
  const calibration = useCalibrationsStore((s) =>
    selected && isPitchAnnotation(selected)
      ? s.items.find((c) => c.id === selected.calibrationId)
      : undefined
  )
  const pitchState =
    !selected || !isPitchAnnotation(selected) ? 'none' : calibration ? 'ok' : 'orphan'
  const isStale = usePlayerStore((s) =>
    calibration ? !isCalibrationFresh(calibration, s.currentTime) : false
  )
  if (!selected) return null

  const timing = selected.timing
  const setMode = (mode: Timing['mode']): void => {
    if (mode === timing.mode) return
    if (mode === 'frame') {
      setTiming(selected.id, {
        mode: 'frame',
        start: frameCenter(timing.start, fps),
        freezeSeconds: DEFAULT_FREEZE
      })
    } else {
      const { duration } = usePlayerStore.getState()
      setTiming(selected.id, {
        mode: 'range',
        start: timing.start,
        duration: defaultDuration(timing.start, duration)
      })
    }
  }
  const startNow = (): void => {
    const now = usePlayerStore.getState().currentTime
    setTiming(
      selected.id,
      timing.mode === 'frame'
        ? { ...timing, start: frameCenter(now, fps) }
        : { ...timing, start: now }
    )
  }

  return (
    <section className="inspector" aria-label={ru.annotations.inspector} data-testid="inspector">
      <div className="inspector__head">
        <span className="inspector__title">
          {ru.annotations.inspector}: {ru.annotations.types[selected.type]}
        </span>
        <button
          type="button"
          className="icon-btn icon-btn--small"
          title={`${ru.annotations.remove}${removeHint}`}
          aria-label={ru.annotations.remove}
          data-testid="annotation-delete"
          onClick={() => remove(selected.id)}
        >
          <TrashIcon size={15} />
        </button>
      </div>
      {pitchState === 'orphan' && (
        <p className="inspector__warn" data-testid="pitch-orphan">
          {ru.pitch.orphan}
        </p>
      )}
      {pitchState === 'ok' && isStale && (
        <p className="inspector__warn" data-testid="pitch-stale" title={ru.pitch.staleHint}>
          {ru.pitch.stale}
        </p>
      )}
      <div className="inspector__section">{ru.annotations.timing}</div>
      <div className="segmented" role="group" aria-label={ru.annotations.timing}>
        <button
          type="button"
          className={
            timing.mode === 'range' ? 'segmented__btn segmented__btn--active' : 'segmented__btn'
          }
          aria-pressed={timing.mode === 'range'}
          title={ru.annotations.modeRangeHint}
          data-testid="mode-range"
          onClick={(e) => {
            setMode('range')
            e.currentTarget.blur()
          }}
        >
          {ru.annotations.modeRange}
        </button>
        <button
          type="button"
          className={
            timing.mode === 'frame' ? 'segmented__btn segmented__btn--active' : 'segmented__btn'
          }
          aria-pressed={timing.mode === 'frame'}
          title={ru.annotations.modeFrameHint}
          data-testid="mode-frame"
          onClick={(e) => {
            setMode('frame')
            e.currentTarget.blur()
          }}
        >
          {ru.annotations.modeFrame}
        </button>
      </div>
      <DurationField annotation={selected} />
      <FreezeField annotation={selected} />
      <div className="inspector__row">
        <span className="field__label">{ru.annotations.startsAt}</span>
        <span className="inspector__value" data-testid="annotation-start">
          {formatTime(timing.start, { tenths: true })}
        </span>
      </div>
      <button
        type="button"
        className="btn inspector__wide"
        data-testid="start-now"
        onClick={(e) => {
          startNow()
          e.currentTarget.blur()
        }}
      >
        {ru.annotations.startFromNow}
      </button>
    </section>
  )
}
