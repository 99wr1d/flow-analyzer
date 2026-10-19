import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_FREEZE,
  MAX_DURATION,
  MAX_FREEZE,
  MIN_DURATION,
  MIN_FREEZE,
  LOUPE_ZOOMS,
  MAX_DIM,
  MAX_ZONE_OPACITY,
  MIN_DIM,
  MIN_ZONE_OPACITY,
  canBeUnder,
  defaultDuration,
  frameCenter,
  isUnderPlayers,
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

/** Ползунок в процентах: затемнение прожектора и прозрачность заливки зоны. */
function PercentSlider({
  label,
  testId,
  value,
  min,
  max,
  onChange
}: {
  label: string
  testId: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const percent = Math.round(value * 100)
  return (
    <div className="inspector__slider">
      <span className="field__label">{label}</span>
      <span className="inspector__value" data-testid={`${testId}-value`}>
        {ru.annotations.dimValue(percent)}
      </span>
      <input
        type="range"
        min={Math.round(min * 100)}
        max={Math.round(max * 100)}
        step={1}
        value={percent}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={(e) => e.currentTarget.blur()}
      />
    </div>
  )
}

function CheckField({
  label,
  testId,
  checked,
  onChange
}: {
  label: string
  testId: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="inspector__check">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(e) => {
          onChange(e.target.checked)
          e.currentTarget.blur()
        }}
      />
      <span>{label}</span>
    </label>
  )
}

/** Свойства, которые есть только у новых видов рисунков (прожектор, лупа, зона, перо, связи). */
function ToolProps({ annotation: a }: { annotation: Annotation }): React.JSX.Element | null {
  const setProps = useAnnotationsStore((s) => s.setProps)
  let body: React.JSX.Element | null = null
  if (a.type === 'spot' || a.type === 'pspot') {
    body = (
      <>
        <PercentSlider
          label={ru.annotations.dim}
          testId="prop-dim"
          value={a.dim}
          min={MIN_DIM}
          max={MAX_DIM}
          onChange={(dim) => setProps(a.id, { dim })}
        />
        {a.type === 'pspot' && (
          <CheckField
            label={ru.annotations.beam}
            testId="prop-beam"
            checked={a.beam}
            onChange={(beam) => setProps(a.id, { beam })}
          />
        )}
      </>
    )
  } else if (a.type === 'loupe') {
    body = (
      <div>
        <span className="field__label" title={ru.annotations.zoomHint}>
          {ru.annotations.zoom}
        </span>
        <div
          className="segmented segmented--three"
          role="group"
          aria-label={ru.annotations.zoom}
          title={ru.annotations.zoomHint}
        >
          {LOUPE_ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              className={a.zoom === z ? 'segmented__btn segmented__btn--active' : 'segmented__btn'}
              aria-pressed={a.zoom === z}
              data-testid={`zoom-${String(z).replace('.', '')}`}
              onClick={(e) => {
                setProps(a.id, { zoom: z })
                e.currentTarget.blur()
              }}
            >
              ×{z}
            </button>
          ))}
        </div>
      </div>
    )
  } else if (a.type === 'zone' || a.type === 'pzone') {
    body = (
      <>
        <PercentSlider
          label={ru.annotations.fillOpacity}
          testId="prop-opacity"
          value={a.opacity}
          min={MIN_ZONE_OPACITY}
          max={MAX_ZONE_OPACITY}
          onChange={(opacity) => setProps(a.id, { opacity })}
        />
        {a.type === 'pzone' && (
          <CheckField
            label={ru.annotations.areaLabel}
            testId="prop-area"
            checked={a.showArea}
            onChange={(showArea) => setProps(a.id, { showArea })}
          />
        )}
        <p className="field__hint">{ru.annotations.nodeHint}</p>
      </>
    )
  } else if (a.type === 'pen' || a.type === 'ppen') {
    body = (
      <CheckField
        label={ru.annotations.arrowHead}
        testId="prop-arrow"
        checked={a.arrow}
        onChange={(arrow) => setProps(a.id, { arrow })}
      />
    )
  } else if (a.type === 'chain' || a.type === 'pchain') {
    body = (
      <>
        <CheckField
          label={ru.annotations.chainFill}
          testId="prop-fill"
          checked={a.fill}
          onChange={(fill) => setProps(a.id, { fill })}
        />
        {a.type === 'pchain' && (
          <CheckField
            label={ru.annotations.chainLabels}
            testId="prop-labels"
            checked={a.labels}
            onChange={(labels) => setProps(a.id, { labels })}
          />
        )}
        <p className="field__hint">{ru.annotations.nodeHint}</p>
      </>
    )
  }
  const under = canBeUnder(a.type) ? (
    <CheckField
      label={ru.grass.underPlayers}
      testId="prop-under"
      checked={isUnderPlayers(a)}
      onChange={(underPlayers) => setProps(a.id, { underPlayers })}
    />
  ) : null
  if (!body && !under) return null
  return (
    <>
      <div className="inspector__section">{ru.annotations.props}</div>
      <div className="inspector__props" data-testid="tool-props">
        {under}
        {under && <p className="field__hint">{ru.grass.underPlayersHint}</p>}
        {body}
      </div>
    </>
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
      <ToolProps annotation={selected} />
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
