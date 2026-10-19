import { ru } from '../../i18n/ru'
import { useKeyHint } from '../commands/useKeys'
import { redoAny, undoAny, useCanRedo, useCanUndo } from '../history/unified'
import { DashedLineIcon, PitchIcon, RedoIcon, SolidLineIcon, UndoIcon } from '../../ui/icons'
import { formatTime } from '../player/format'
import { CALIBRATION_VALIDITY } from '../../../../shared/pitch/calibration'
import { startCalibration } from '../pitch/pitchActions'
import { usePitchStore } from '../pitch/pitchStore'
import { useActiveCalibration } from '../pitch/usePitch'
import { selectedAnnotation, useAnnotationsStore } from './annotationsStore'
import { LEVELS, PALETTE, levelOf, type CurrentStyle, type Level } from './styles'

/** Стиль, который сейчас «в руках»: у выбранного рисунка — его, иначе — для новых. */
function useShownStyle(): CurrentStyle {
  const style = useAnnotationsStore((s) => s.style)
  const selected = useAnnotationsStore(selectedAnnotation)
  if (!selected) return style
  const isText = selected.type === 'text' || selected.type === 'ptext'
  return {
    color: selected.style.color,
    level: levelOf(selected),
    dash: isText ? style.dash : selected.style.dash,
    textBackground: isText ? selected.style.background : style.textBackground
  }
}

/** Рисунки без пунктира и без фона под текстом: линейка, прожектор, лупа. */
const NO_DASH = new Set(['ruler', 'spot', 'pspot', 'loupe'])

/** К какому виду рисунка относятся сейчас настройки: определяет, что в панели недоступно. */
function useContextType(): 'text' | 'shape' | 'ruler' | null {
  const selected = useAnnotationsStore(selectedAnnotation)
  const tool = useAnnotationsStore((s) => s.tool)
  if (selected) {
    if (selected.type === 'text' || selected.type === 'ptext') return 'text'
    return NO_DASH.has(selected.type) ? 'ruler' : 'shape'
  }
  if (tool === 'text') return 'text'
  if (NO_DASH.has(tool)) return 'ruler'
  if (tool === 'select') return null
  return 'shape'
}

/** Разметка поля: кнопка, переключатель «На поле» и пометка, какая разметка действует сейчас. */
function PitchControls(): React.JSX.Element {
  const active = useActiveCalibration()
  const onPitch = usePitchStore((s) => s.onPitch)
  const calibrating = usePitchStore((s) => s.draft !== null)
  const setOnPitch = usePitchStore((s) => s.setOnPitch)
  const hint = useKeyHint('pitch:calibrate')
  const stale = active ? Math.abs(active.offset) > CALIBRATION_VALIDITY : false
  return (
    <>
      <span className="style-bar__sep" />
      <button
        type="button"
        className="chip-btn chip-btn--icon"
        disabled={calibrating}
        title={`${ru.pitch.calibrateHint}${hint}`}
        data-testid="pitch-calibrate"
        onClick={(e) => {
          startCalibration()
          e.currentTarget.blur()
        }}
      >
        <PitchIcon size={16} />
        {ru.pitch.calibrate}
      </button>
      <button
        type="button"
        className={active && onPitch ? 'chip-btn chip-btn--active' : 'chip-btn'}
        disabled={!active}
        aria-pressed={active ? onPitch : false}
        title={active ? ru.pitch.onPitchHint : ru.pitch.onPitchOff}
        data-testid="pitch-on"
        onClick={(e) => {
          setOnPitch(!onPitch)
          e.currentTarget.blur()
        }}
      >
        {ru.pitch.onPitch}
      </button>
      <span
        className={stale ? 'style-bar__note style-bar__note--warn' : 'style-bar__note'}
        data-testid="pitch-active"
        data-stale={stale ? 'true' : 'false'}
        title={stale ? ru.pitch.stale : undefined}
      >
        {active
          ? ru.pitch.active(formatTime(active.calibration.time, { tenths: true }), active.offset)
          : ru.pitch.activeNone}
      </span>
    </>
  )
}

export function StyleBar(): React.JSX.Element {
  const shown = useShownStyle()
  const context = useContextType()
  const setStyle = useAnnotationsStore((s) => s.setStyle)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const undoHint = useKeyHint('general:undo')
  const redoHint = useKeyHint('general:redo')

  return (
    <div
      className="style-bar"
      role="toolbar"
      aria-label={ru.annotations.styleBar}
      data-testid="style-bar"
    >
      <div className="style-bar__group" role="group" aria-label={ru.annotations.color}>
        {PALETTE.map((c) => (
          <button
            key={c.value}
            type="button"
            className={shown.color === c.value ? 'swatch swatch--active' : 'swatch'}
            style={{ background: c.value }}
            title={c.name}
            aria-label={`${ru.annotations.color}: ${c.name}`}
            aria-pressed={shown.color === c.value}
            data-testid={`color-${c.value.slice(1)}`}
            onClick={(e) => {
              setStyle({ color: c.value })
              e.currentTarget.blur()
            }}
          />
        ))}
      </div>
      <span className="style-bar__sep" />
      <div className="style-bar__group" role="group" aria-label={ru.annotations.width}>
        {LEVELS.map((l, i) => (
          <button
            key={l.label}
            type="button"
            className={shown.level === i ? 'seg-btn seg-btn--active' : 'seg-btn'}
            title={`${ru.annotations.width}: ${l.label.toLowerCase()}`}
            aria-label={`${ru.annotations.width}: ${l.label.toLowerCase()}`}
            aria-pressed={shown.level === i}
            data-testid={`width-${i}`}
            onClick={(e) => {
              setStyle({ level: i as Level })
              e.currentTarget.blur()
            }}
          >
            <span className="seg-btn__bar" style={{ height: 2 + i * 2 }} />
          </button>
        ))}
      </div>
      <span className="style-bar__sep" />
      <div className="style-bar__group" role="group" aria-label={ru.annotations.dash}>
        {(['solid', 'dashed'] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={shown.dash === d ? 'seg-btn seg-btn--active' : 'seg-btn'}
            disabled={context === 'text' || context === 'ruler'}
            title={d === 'solid' ? ru.annotations.solid : ru.annotations.dashed}
            aria-label={d === 'solid' ? ru.annotations.solid : ru.annotations.dashed}
            aria-pressed={shown.dash === d}
            data-testid={`dash-${d}`}
            onClick={(e) => {
              setStyle({ dash: d })
              e.currentTarget.blur()
            }}
          >
            {d === 'solid' ? <SolidLineIcon size={18} /> : <DashedLineIcon size={18} />}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={shown.textBackground ? 'chip-btn chip-btn--active' : 'chip-btn'}
        disabled={context === 'shape' || context === 'ruler'}
        title={ru.annotations.textBackground}
        aria-pressed={shown.textBackground}
        data-testid="text-background"
        onClick={(e) => {
          setStyle({ textBackground: !shown.textBackground })
          e.currentTarget.blur()
        }}
      >
        Aa
      </button>
      <PitchControls />
      <span className="style-bar__spacer" />
      <button
        type="button"
        className="icon-btn"
        disabled={!canUndo}
        title={`${ru.annotations.undo}${undoHint}`}
        aria-label={ru.annotations.undo}
        data-testid="undo"
        onClick={(e) => {
          undoAny()
          e.currentTarget.blur()
        }}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="icon-btn"
        disabled={!canRedo}
        title={`${ru.annotations.redo}${redoHint}`}
        aria-label={ru.annotations.redo}
        data-testid="redo"
        onClick={(e) => {
          redoAny()
          e.currentTarget.blur()
        }}
      >
        <RedoIcon />
      </button>
    </div>
  )
}
