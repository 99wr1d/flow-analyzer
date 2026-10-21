import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_FREEZE,
  MAX_DURATION,
  MAX_FREEZE,
  MIN_DURATION,
  MIN_FREEZE,
  LOUPE_ZOOMS,
  MAX_DIM,
  MAX_RING_FILL,
  MAX_ZONE_OPACITY,
  LEGACY_CIRCLE_FILL,
  LEGACY_RING_FILL,
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
import { easeOf, isAnimated, keyIndexAt, keysOf } from '../../../../shared/animation'
import { isCalibrationFresh } from '../../../../shared/pitch/calibration'
import { ru } from '../../i18n/ru'
import { useCalibrationsStore } from '../pitch/calibrationsStore'
import { useKeyHint } from '../commands/useKeys'
import { usePlayerStore } from '../../store/playerStore'
import { TrashIcon } from '../../ui/icons'
import { formatTime } from '../player/format'
import { useAnimClock } from './animClock'
import { selectedAnnotation, useAnnotationsStore } from './annotationsStore'
import {
  addKeyHere,
  gotoKey,
  removeKeyHere,
  startAnimationNow,
  stopAnimationNow
} from './keyActions'

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
  } else if (a.type === 'circle' || a.type === 'ring') {
    body = (
      <PercentSlider
        label={ru.annotations.fillOpacity}
        testId="prop-fill-opacity"
        value={a.fillOpacity ?? (a.type === 'ring' ? LEGACY_RING_FILL : LEGACY_CIRCLE_FILL)}
        min={0}
        max={MAX_RING_FILL}
        onChange={(fillOpacity) => setProps(a.id, { fillOpacity })}
      />
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

/** Анимация рисунка: ключи, переход между ними, навигация. */
function AnimationSection({ annotation: a }: { annotation: Annotation }): React.JSX.Element {
  const frame = useAnimClock((s) => s.frame)
  const fps = usePlayerStore((s) => s.fps)
  const setKeyEase = useAnnotationsStore((s) => s.setKeyEase)
  const prevHint = useKeyHint('anim:key-prev')
  const nextHint = useKeyHint('anim:key-next')
  const addHint = useKeyHint('anim:key-add')
  const t = (frame + 0.5) / (fps > 0 ? fps : 25)
  const animated = isAnimated(a)
  const keys = keysOf(a)
  const here = animated ? keyIndexAt(a, t, fps) : -1
  // Переход, которому принадлежит текущий момент: от ключа «здесь» или от ближайшего ключа раньше.
  let segment = -1
  if (animated) {
    segment = here >= 0 ? here : keys.filter((k) => k.t < t).length - 1
    if (segment < 0) segment = 0
  }
  const ease = segment >= 0 ? easeOf(keys[segment]) : 'ease'
  const canEase = animated && keys.length >= 2 && segment < keys.length - 1
  return (
    <>
      <div className="inspector__section">{ru.annotations.animation}</div>
      {!animated ? (
        <>
          <button
            type="button"
            className="btn inspector__wide"
            title={ru.annotations.animateHint}
            data-testid="anim-start"
            onClick={(e) => {
              startAnimationNow()
              e.currentTarget.blur()
            }}
          >
            {ru.annotations.animate}
          </button>
          <p className="field__hint">{ru.annotations.animateHint}</p>
        </>
      ) : (
        <div className="inspector__anim" data-testid="anim-section">
          <div className="inspector__row">
            <span className="field__label" data-testid="key-count" data-count={keys.length}>
              {ru.annotations.keysCount(keys.length)}
            </span>
            <span className="inspector__keynav">
              <button
                type="button"
                className="icon-btn icon-btn--small"
                title={`${ru.annotations.keyPrev}${prevHint}`}
                aria-label={ru.annotations.keyPrev}
                data-testid="key-prev"
                onClick={(e) => {
                  gotoKey(-1)
                  e.currentTarget.blur()
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--small"
                title={`${ru.annotations.keyNext}${nextHint}`}
                aria-label={ru.annotations.keyNext}
                data-testid="key-next"
                onClick={(e) => {
                  gotoKey(1)
                  e.currentTarget.blur()
                }}
              >
                ›
              </button>
            </span>
          </div>
          <div className="inspector__btns">
            <button
              type="button"
              className="btn"
              title={`${ru.annotations.keyAddHint}${addHint}`}
              disabled={here >= 0}
              data-testid="key-add"
              onClick={(e) => {
                addKeyHere()
                e.currentTarget.blur()
              }}
            >
              {ru.annotations.keyAdd}
            </button>
            <button
              type="button"
              className="btn"
              title={ru.annotations.keyRemoveHint}
              disabled={here < 0}
              data-testid="key-remove"
              onClick={(e) => {
                removeKeyHere()
                e.currentTarget.blur()
              }}
            >
              {ru.annotations.keyRemove}
            </button>
          </div>
          <span className="field__label">{ru.annotations.easeLabel}</span>
          <div
            className="segmented"
            role="group"
            aria-label={ru.annotations.easeLabel}
            data-testid="ease-group"
          >
            <button
              type="button"
              className={
                ease === 'ease' ? 'segmented__btn segmented__btn--active' : 'segmented__btn'
              }
              aria-pressed={ease === 'ease'}
              disabled={!canEase}
              title={ru.annotations.easeSmoothHint}
              data-testid="ease-smooth"
              onClick={(e) => {
                setKeyEase(a.id, segment, 'ease')
                e.currentTarget.blur()
              }}
            >
              {ru.annotations.easeSmooth}
            </button>
            <button
              type="button"
              className={
                ease === 'linear' ? 'segmented__btn segmented__btn--active' : 'segmented__btn'
              }
              aria-pressed={ease === 'linear'}
              disabled={!canEase}
              title={ru.annotations.easeLinearHint}
              data-testid="ease-linear"
              onClick={(e) => {
                setKeyEase(a.id, segment, 'linear')
                e.currentTarget.blur()
              }}
            >
              {ru.annotations.easeLinear}
            </button>
          </div>
          <p className="field__hint">{ru.annotations.animatedHint}</p>
          <button
            type="button"
            className="btn inspector__wide"
            title={ru.annotations.stopAnimationHint}
            data-testid="anim-stop"
            onClick={(e) => {
              stopAnimationNow()
              e.currentTarget.blur()
            }}
          >
            {ru.annotations.stopAnimation}
          </button>
        </div>
      )}
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
    if (mode === 'frame' && isAnimated(selected)) return
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
      <AnimationSection annotation={selected} />
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
          disabled={isAnimated(selected)}
          title={
            isAnimated(selected) ? ru.annotations.animatedFrameMode : ru.annotations.modeFrameHint
          }
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
