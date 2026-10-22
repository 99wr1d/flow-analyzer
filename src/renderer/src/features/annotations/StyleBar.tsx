import { useEffect, useRef, useState } from 'react'
import { canBeUnder, isUnderPlayers } from '../../../../shared/annotations'
import { ru } from '../../i18n/ru'
import { GrassMenu } from '../under/GrassMenu'
import { TrackButton } from '../tracking/TrackButton'
import { useKeyHint } from '../commands/useKeys'
import { redoAny, undoAny, useCanRedo, useCanUndo } from '../history/unified'
import {
  DashedLineIcon,
  DottedLineIcon,
  PitchIcon,
  RedoIcon,
  SolidLineIcon,
  UnderPlayersIcon,
  UndoIcon
} from '../../ui/icons'
import { formatTime } from '../player/format'
import { CALIBRATION_VALIDITY } from '../../../../shared/pitch/calibration'
import { startCalibration } from '../pitch/pitchActions'
import { usePitchStore } from '../pitch/pitchStore'
import { useActiveCalibration } from '../pitch/usePitch'
import { selectedAnnotation, underForNew, useAnnotationsStore } from './annotationsStore'
import {
  LEVELS,
  MAX_REVEAL,
  MIN_REVEAL,
  PALETTE,
  TEXT_SIZES,
  isLineType,
  levelOf,
  textLevelOf,
  type CurrentStyle,
  type Level,
  type TextLevel
} from './styles'

/** Стиль, который сейчас «в руках»: у выбранного рисунка — его, иначе — для новых. */
function useShownStyle(): CurrentStyle {
  const style = useAnnotationsStore((s) => s.style)
  const selected = useAnnotationsStore(selectedAnnotation)
  const tool = useAnnotationsStore((s) => s.tool)
  if (!selected) return tool === 'circle' ? { ...style, level: style.ringLevel } : style
  const isText = selected.type === 'text' || selected.type === 'ptext'
  return {
    ...style,
    color: selected.style.color,
    level: levelOf(selected),
    textLevel: textLevelOf(selected),
    dash: isText ? style.dash : selected.style.dash,
    textBackground: isText ? selected.style.background : style.textBackground,
    // Тень выбранной подписи — её собственная (у старой подписи поля нет — значит, прежний контур, т. е. не «тень»).
    textShadow: isText ? selected.style.shadow === true : style.textShadow,
    // Свечение выбранного кольца — его собственное (у старого кольца поля нет — значит, свечения нет), а не умолчание для новых.
    glow:
      selected.type === 'circle' || selected.type === 'ring' ? selected.glow === true : style.glow,
    // Вид и пульс выбранного кольца — его собственные (у старого поля нет — значит, «кольцо» без пульса).
    look:
      selected.type === 'circle' || selected.type === 'ring'
        ? (selected.look ?? 'ring')
        : style.look,
    pulse:
      selected.type === 'circle' || selected.type === 'ring'
        ? selected.pulse === true
        : style.pulse,
    // Свечение и проявление выбранной линии — её собственные (у старой линии полей нет — значит, выключены).
    lineGlow: isLineType(selected.type)
      ? (selected as { glow?: boolean }).glow === true
      : style.lineGlow,
    reveal: isLineType(selected.type)
      ? ((selected as { reveal?: number }).reveal ?? null)
      : style.reveal,
    revealSecs: isLineType(selected.type)
      ? ((selected as { reveal?: number }).reveal ?? style.revealSecs)
      : style.revealSecs,
    // Вид выбранного прожектора — его собственный (у старого поля нет — значит, «овал»).
    form:
      selected.type === 'spot' || selected.type === 'pspot' ? (selected.form ?? 'oval') : style.form
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

/** Разметка поля: кнопка-значок, переключатель «На поле» и маленькая пометка, какая разметка действует сейчас. */
function PitchControls(): React.JSX.Element {
  const active = useActiveCalibration()
  const onPitch = usePitchStore((s) => s.onPitch)
  const calibrating = usePitchStore((s) => s.draft !== null)
  const setOnPitch = usePitchStore((s) => s.setOnPitch)
  const hint = useKeyHint('pitch:calibrate')
  const stale = active ? Math.abs(active.offset) > CALIBRATION_VALIDITY : false
  const full = active
    ? ru.pitch.active(formatTime(active.calibration.time, { tenths: true }), active.offset)
    : ru.pitch.activeNone
  const short = active
    ? ru.pitch.activeShort(formatTime(active.calibration.time, { tenths: true }))
    : ru.pitch.activeNoneShort
  const state = !active ? 'none' : stale ? 'stale' : 'ok'
  return (
    <>
      <span className="style-bar__sep" />
      <div className="style-bar__group">
        <button
          type="button"
          className="chip-btn chip-btn--sq"
          disabled={calibrating}
          title={`${ru.pitch.calibrate}. ${ru.pitch.calibrateHint}${hint}`}
          aria-label={ru.pitch.calibrate}
          data-testid="pitch-calibrate"
          onClick={(e) => {
            startCalibration()
            e.currentTarget.blur()
          }}
        >
          <PitchIcon size={17} />
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
          className={`style-bar__status style-bar__status--${state}`}
          data-testid="pitch-active"
          data-stale={stale ? 'true' : 'false'}
          data-full={full}
          title={stale ? `${full}. ${ru.pitch.stale}` : full}
        >
          <i className="style-bar__dot" aria-hidden="true" />
          <span className="style-bar__status-text">{short}</span>
        </span>
      </div>
    </>
  )
}

/** «Под игроками»: у выбранного рисунка — его значение, иначе — для новых рисунков (отдельно на поле и на экране). */
function UnderToggle(): React.JSX.Element {
  const selected = useAnnotationsStore(selectedAnnotation)
  const tool = useAnnotationsStore((s) => s.tool)
  const underNew = useAnnotationsStore((s) => s.underNew)
  const setProps = useAnnotationsStore((s) => s.setProps)
  const setUnderNew = useAnnotationsStore((s) => s.setUnderNew)
  const onPitch = usePitchStore((s) => s.onPitch)
  const active = useActiveCalibration()
  const type = selected ? selected.type : tool
  const space: 'pitch' | 'screen' = selected
    ? selected.space === 'pitch'
      ? 'pitch'
      : 'screen'
    : tool === 'ruler' || (onPitch && active)
      ? 'pitch'
      : 'screen'
  const enabled = type !== 'select' && canBeUnder(type)
  const value = selected ? isUnderPlayers(selected) : underForNew(type, space, underNew)
  return (
    <button
      type="button"
      className={
        value && enabled ? 'chip-btn chip-btn--sq chip-btn--active' : 'chip-btn chip-btn--sq'
      }
      disabled={!enabled}
      aria-pressed={value && enabled}
      title={`${ru.grass.underPlayers}. ${ru.grass.underPlayersHint}`}
      aria-label={ru.grass.underPlayers}
      data-testid="under-toggle"
      onClick={(e) => {
        if (selected) setProps(selected.id, { underPlayers: !value })
        else setUnderNew(space, !value)
        e.currentTarget.blur()
      }}
    >
      <UnderPlayersIcon size={17} />
    </button>
  )
}

/** «Свечение» кольца/круга и линий: у выбранного — его значение, иначе — для новых. Для остальных рисунков недоступно. */
function GlowToggle({ shown }: { shown: CurrentStyle }): React.JSX.Element {
  const selected = useAnnotationsStore(selectedAnnotation)
  const tool = useAnnotationsStore((s) => s.tool)
  const setStyle = useAnnotationsStore((s) => s.setStyle)
  const type = selected ? selected.type : tool
  const line = isLineType(type)
  const enabled = type === 'circle' || type === 'ring' || line
  const value = line ? shown.lineGlow : shown.glow
  const on = enabled && value
  return (
    <button
      type="button"
      className={on ? 'chip-btn chip-btn--tight chip-btn--active' : 'chip-btn chip-btn--tight'}
      disabled={!enabled}
      aria-pressed={on}
      title={line ? ru.annotations.glowLineHint : ru.annotations.glowHint}
      data-testid="glow-toggle"
      onClick={(e) => {
        setStyle(line ? { lineGlow: !value } : { glow: !value })
        e.currentTarget.blur()
      }}
    >
      {ru.annotations.glow}
    </button>
  )
}

/** Сейчас настраивается кольцо или круг (выбранный рисунок или инструмент). */
function useRingContext(): boolean {
  const selected = useAnnotationsStore(selectedAnnotation)
  const tool = useAnnotationsStore((s) => s.tool)
  const type = selected ? selected.type : tool
  return type === 'circle' || type === 'ring'
}

/** «Кольцо / Мишень» и «Пульс» кольца/круга: у выбранного — его значения, иначе — для новых. Для остальных рисунков недоступны. */
function LookControls({ shown }: { shown: CurrentStyle }): React.JSX.Element {
  const setStyle = useAnnotationsStore((s) => s.setStyle)
  const pulseOn = shown.pulse
  return (
    <>
      {(['ring', 'target'] as const).map((look) => {
        const on = shown.look === look
        return (
          <button
            key={look}
            type="button"
            className={
              on ? 'chip-btn chip-btn--tight chip-btn--active' : 'chip-btn chip-btn--tight'
            }
            aria-pressed={on}
            title={look === 'ring' ? ru.annotations.lookRingHint : ru.annotations.lookTargetHint}
            data-testid={`look-${look}`}
            onClick={(e) => {
              setStyle({ look })
              e.currentTarget.blur()
            }}
          >
            {look === 'ring' ? ru.annotations.lookRing : ru.annotations.lookTarget}
          </button>
        )
      })}
      <button
        type="button"
        className={
          pulseOn ? 'chip-btn chip-btn--tight chip-btn--active' : 'chip-btn chip-btn--tight'
        }
        aria-pressed={pulseOn}
        title={ru.annotations.pulseHint}
        data-testid="pulse-toggle"
        onClick={(e) => {
          setStyle({ pulse: !shown.pulse })
          e.currentTarget.blur()
        }}
      >
        {ru.annotations.pulse}
      </button>
    </>
  )
}

/** Сейчас настраивается линия (стрелка, линия, кривая): выбранный рисунок или инструмент. */
function useLineContext(): boolean {
  const selected = useAnnotationsStore(selectedAnnotation)
  const tool = useAnnotationsStore((s) => s.tool)
  return isLineType(selected ? selected.type : tool)
}

/**
 * «Проявление» линии и его длительность (малое окно со ползунком 0,2–3 с): у выбранной линии — её значения,
 * иначе — для новых. Длительность запоминается и пока проявление выключено.
 */
function RevealControls({ shown }: { shown: CurrentStyle }): React.JSX.Element {
  const setStyle = useAnnotationsStore((s) => s.setStyle)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const on = shown.reveal !== null
  const secs = shown.reveal ?? shown.revealSecs

  // Окно закрывается щелчком вне его и по Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      e.stopPropagation()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        className={on ? 'chip-btn chip-btn--tight chip-btn--active' : 'chip-btn chip-btn--tight'}
        aria-pressed={on}
        title={ru.annotations.revealHint}
        data-testid="reveal-toggle"
        onClick={(e) => {
          setOpen(false)
          setStyle({ reveal: on ? null : shown.revealSecs, revealSecs: secs })
          e.currentTarget.blur()
        }}
      >
        {ru.annotations.reveal}
      </button>
      {on && (
        <div className="reveal-menu" ref={ref}>
          <button
            type="button"
            className={
              open ? 'chip-btn chip-btn--tight chip-btn--active' : 'chip-btn chip-btn--tight'
            }
            aria-pressed={open}
            aria-haspopup="dialog"
            title={ru.annotations.revealDuration}
            data-testid="reveal-duration"
            onClick={(e) => {
              setOpen(!open)
              e.currentTarget.blur()
            }}
          >
            {ru.annotations.revealSeconds(secs)}
          </button>
          {open && (
            <div
              className="reveal-popover"
              role="dialog"
              aria-label={ru.annotations.revealDuration}
              data-testid="reveal-popover"
            >
              <span className="field__label">{ru.annotations.revealDuration}</span>
              <input
                type="range"
                min={MIN_REVEAL * 10}
                max={MAX_REVEAL * 10}
                step={1}
                value={Math.round(secs * 10)}
                aria-label={ru.annotations.revealDuration}
                data-testid="reveal-slider"
                onChange={(e) => {
                  const v = Number(e.target.value) / 10
                  setStyle({ reveal: v, revealSecs: v })
                }}
                onPointerUp={(e) => e.currentTarget.blur()}
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** Сейчас настраивается прожектор (выбранный рисунок или инструмент). */
function useSpotContext(): boolean {
  const selected = useAnnotationsStore(selectedAnnotation)
  const tool = useAnnotationsStore((s) => s.tool)
  const type = selected ? selected.type : tool
  return type === 'spot' || type === 'pspot'
}

/** «Овал / Столб» прожектора: у выбранного — его значение, иначе — для новых. */
function FormControls({ shown }: { shown: CurrentStyle }): React.JSX.Element {
  const setStyle = useAnnotationsStore((s) => s.setStyle)
  return (
    <>
      {(['oval', 'pillar'] as const).map((form) => {
        const on = shown.form === form
        return (
          <button
            key={form}
            type="button"
            className={
              on ? 'chip-btn chip-btn--tight chip-btn--active' : 'chip-btn chip-btn--tight'
            }
            aria-pressed={on}
            title={form === 'oval' ? ru.annotations.formOvalHint : ru.annotations.formPillarHint}
            data-testid={`form-${form}`}
            onClick={(e) => {
              setStyle({ form })
              e.currentTarget.blur()
            }}
          >
            {form === 'oval' ? ru.annotations.formOval : ru.annotations.formPillar}
          </button>
        )
      })}
    </>
  )
}

export function StyleBar(): React.JSX.Element {
  const shown = useShownStyle()
  const context = useContextType()
  // Для кольца/круга вместо кнопок подписи (они ему не нужны) показываются «Кольцо / Мишень» и «Пульс»: панель остаётся в одну строку.
  const ringContext = useRingContext()
  const spotContext = useSpotContext()
  const lineContext = useLineContext()
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
      {context === 'text' ? (
        <div className="style-bar__group" role="group" aria-label={ru.annotations.textSize}>
          {TEXT_SIZES.map((l, i) => (
            <button
              key={l.label}
              type="button"
              className={shown.textLevel === i ? 'seg-btn seg-btn--active' : 'seg-btn'}
              title={`${ru.annotations.textSize}: ${l.label.toLowerCase()}`}
              aria-label={`${ru.annotations.textSize}: ${l.label.toLowerCase()}`}
              aria-pressed={shown.textLevel === i}
              data-testid={`text-size-${i}`}
              onClick={(e) => {
                setStyle({ textLevel: i as TextLevel })
                e.currentTarget.blur()
              }}
            >
              <span className="seg-btn__bar" style={{ height: 2 + i * 2 }} />
            </button>
          ))}
        </div>
      ) : (
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
      )}
      <span className="style-bar__gap" />
      <div className="style-bar__group" role="group" aria-label={ru.annotations.dash}>
        {(['solid', 'dashed', 'dotted'] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={shown.dash === d ? 'seg-btn seg-btn--active' : 'seg-btn'}
            disabled={context === 'text' || context === 'ruler'}
            title={ru.annotations[d]}
            aria-label={ru.annotations[d]}
            aria-pressed={shown.dash === d}
            data-testid={`dash-${d}`}
            onClick={(e) => {
              setStyle({ dash: d })
              e.currentTarget.blur()
            }}
          >
            {d === 'solid' ? (
              <SolidLineIcon size={18} />
            ) : d === 'dashed' ? (
              <DashedLineIcon size={18} />
            ) : (
              <DottedLineIcon size={18} />
            )}
          </button>
        ))}
      </div>
      {!ringContext && !spotContext && !lineContext && (
        <>
          <button
            type="button"
            className={
              shown.textBackground
                ? 'chip-btn chip-btn--sq chip-btn--active'
                : 'chip-btn chip-btn--sq'
            }
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
          <button
            type="button"
            className={
              shown.textShadow ? 'chip-btn chip-btn--sq chip-btn--active' : 'chip-btn chip-btn--sq'
            }
            disabled={context === 'shape' || context === 'ruler'}
            title={ru.annotations.textShadow}
            aria-pressed={shown.textShadow}
            data-testid="text-shadow"
            onClick={(e) => {
              setStyle({ textShadow: !shown.textShadow })
              e.currentTarget.blur()
            }}
          >
            <span style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>Aa</span>
          </button>
        </>
      )}
      <GlowToggle shown={shown} />
      {ringContext && <LookControls shown={shown} />}
      {spotContext && <FormControls shown={shown} />}
      {lineContext && <RevealControls shown={shown} />}
      <PitchControls />
      <span className="style-bar__sep" />
      <div className="style-bar__group">
        <UnderToggle />
        <GrassMenu />
      </div>
      <TrackButton />
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
