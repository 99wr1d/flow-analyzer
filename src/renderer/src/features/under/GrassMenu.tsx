// Кнопка «Газон» в панели стиля и окно настроек ключа: пипетка, чувствительность, мягкость края, сброс, показ маски.
import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  MAX_GRASS_BLEND,
  MAX_GRASS_SIMILARITY,
  MIN_GRASS_BLEND,
  MIN_GRASS_SIMILARITY
} from '../../../../shared/grassKey'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { GrassIcon } from '../../ui/icons'
import { useFeedbackStore } from '../episodes/feedbackStore'
import { formatTime } from '../player/format'
import { ensureGrassEstimate, takeColorFromFrame, useGrassKey, useGrassStore } from './grassStore'

function Slider({
  label,
  hint,
  testId,
  value,
  min,
  max,
  onChange
}: {
  label: string
  hint: string
  testId: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const percent = Math.round(value * 100)
  return (
    <div className="inspector__slider" title={hint}>
      <span className="field__label">{label}</span>
      <span className="inspector__value" data-testid={`${testId}-value`}>
        {ru.grass.value(percent)}
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

function Popover(): React.JSX.Element {
  const key = useGrassKey()
  const estimate = useGrassStore((s) => s.estimate)
  const eyedropper = useGrassStore((s) => s.eyedropper)
  const maskView = useGrassStore((s) => s.maskView)
  const setTuning = useGrassStore((s) => s.setTuning)
  const setEyedropper = useGrassStore((s) => s.setEyedropper)
  const setMaskView = useGrassStore((s) => s.setMaskView)
  const resetAuto = useGrassStore((s) => s.resetAuto)
  const videoId = usePlayerStore((s) => s.source?.id)
  const rootRef = useRef<HTMLDivElement>(null)
  const notFound = key.auto && estimate !== null && estimate.videoId === videoId && !estimate.found

  // Кнопка может оказаться у левого края (панель в две строки): тогда окно открывается вправо от кнопки, а не влево.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el && el.getBoundingClientRect().left < 8) {
      el.style.right = 'auto'
      el.style.left = '0'
    }
  }, [])

  // Окно открыли — цвет газона нужен для показа: определяем его по текущему кадру.
  useEffect(() => {
    ensureGrassEstimate()
  }, [])

  return (
    <div
      ref={rootRef}
      className="grass-popover"
      role="dialog"
      aria-label={ru.grass.title}
      data-testid="grass-popover"
    >
      <p className="grass-popover__intro">{ru.grass.intro}</p>
      <div className="grass-popover__color">
        <span
          className="grass-popover__swatch"
          style={{ background: key.color }}
          data-testid="grass-swatch"
          data-color={key.color}
          data-auto={key.auto ? 'true' : 'false'}
        />
        <span className="grass-popover__mode" data-testid="grass-mode">
          {key.auto
            ? key.from !== undefined
              ? ru.grass.colorAutoFrame(formatTime(key.from, { tenths: true }))
              : ru.grass.colorAuto
            : key.from !== undefined
              ? ru.grass.colorFrame(formatTime(key.from, { tenths: true }))
              : ru.grass.colorManual}
        </span>
        <button
          type="button"
          className={eyedropper ? 'chip-btn chip-btn--active' : 'chip-btn'}
          aria-pressed={eyedropper}
          title={ru.grass.eyedropperHint}
          data-testid="grass-eyedropper"
          onClick={(e) => {
            setEyedropper(!eyedropper)
            e.currentTarget.blur()
          }}
        >
          {ru.grass.eyedropper}
        </button>
      </div>
      <button
        type="button"
        className="btn"
        title={ru.grass.sampleHint}
        data-testid="grass-sample"
        onClick={(e) => {
          const result = takeColorFromFrame()
          if (result !== 'ok') {
            useFeedbackStore.getState().show({ text: ru.grass.sampleFailed(result), kind: 'warn' })
          }
          e.currentTarget.blur()
        }}
      >
        {ru.grass.sample}
      </button>
      {notFound && (
        <p className="grass-popover__warn" data-testid="grass-not-found">
          {ru.grass.notFound}
        </p>
      )}
      <Slider
        label={ru.grass.similarity}
        hint={ru.grass.similarityHint}
        testId="grass-similarity"
        value={key.similarity}
        min={MIN_GRASS_SIMILARITY}
        max={MAX_GRASS_SIMILARITY}
        onChange={(similarity) => setTuning({ similarity })}
      />
      <Slider
        label={ru.grass.blend}
        hint={ru.grass.blendHint}
        testId="grass-blend"
        value={key.blend}
        min={MIN_GRASS_BLEND}
        max={MAX_GRASS_BLEND}
        onChange={(blend) => setTuning({ blend })}
      />
      <label className="inspector__check" title={ru.grass.showMaskHint}>
        <input
          type="checkbox"
          checked={maskView}
          data-testid="grass-mask"
          onChange={(e) => {
            setMaskView(e.target.checked)
            e.currentTarget.blur()
          }}
        />
        <span>{ru.grass.showMask}</span>
      </label>
      <p className="field__hint">{ru.grass.showMaskHint}</p>
      <button
        type="button"
        className="btn"
        title={ru.grass.resetHint}
        data-testid="grass-reset"
        onClick={(e) => {
          resetAuto()
          e.currentTarget.blur()
        }}
      >
        {ru.grass.reset}
      </button>
    </div>
  )
}

/** Кнопка «Газон» с выпадающим окном настроек. */
export function GrassMenu(): React.JSX.Element {
  const open = useGrassStore((s) => s.popover)
  const setPopover = useGrassStore((s) => s.setPopover)
  const ref = useRef<HTMLDivElement>(null)

  // Закрытие: щелчок вне окна (кроме режима пипетки — щелчок по картинке задаёт цвет) и Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (useGrassStore.getState().eyedropper) return
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        setPopover(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const state = useGrassStore.getState()
      if (state.eyedropper) state.setEyedropper(false)
      else setPopover(false)
      e.stopPropagation()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, setPopover])

  return (
    <div className="grass-menu" ref={ref}>
      <button
        type="button"
        className={open ? 'chip-btn chip-btn--sq chip-btn--active' : 'chip-btn chip-btn--sq'}
        aria-pressed={open}
        aria-haspopup="dialog"
        aria-label={ru.grass.button}
        title={`${ru.grass.button}. ${ru.grass.buttonHint}`}
        data-testid="grass-button"
        onClick={(e) => {
          setPopover(!open)
          e.currentTarget.blur()
        }}
      >
        <GrassIcon size={17} />
      </button>
      {open && <Popover />}
    </div>
  )
}
