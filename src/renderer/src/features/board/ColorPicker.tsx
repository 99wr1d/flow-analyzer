// Кисть цвета: кнопка с текущим цветом, по щелчку — палитра из 10 цветов и «Свой цвет…».
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ru } from '../../i18n/ru'
import { PALETTE } from './boardUi'

interface Props {
  /** null — у каждого предмета свой цвет (показывается пёстрая кнопка). */
  value: string | null
  onChange: (color: string) => void
  label: string
  title: string
  testId: string
  disabled?: boolean
}

/** Свой цвет: применяется, когда окно выбора цвета закрыто (а не на каждое движение — иначе история правок засоряется). */
function CustomColor({
  initial,
  onPick
}: {
  initial: string
  onPick: (c: string) => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = (): void => onPick(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [onPick])
  return (
    <label className="board-color__custom">
      <input ref={ref} type="color" defaultValue={initial} aria-label={ru.board.customColor} />
      {ru.board.customColor}
    </label>
  )
}

export function ColorPicker({
  value,
  onChange,
  label,
  title,
  testId,
  disabled
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const pick = (c: string): void => {
    onChange(c)
    setOpen(false)
  }

  return (
    <div className="board-color" ref={root}>
      <button
        type="button"
        className="board-color__btn"
        title={title}
        aria-label={`${label}: ${value ?? ru.board.defaultColor}`}
        aria-expanded={open}
        disabled={disabled}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={value ? 'board-color__dot' : 'board-color__dot board-color__dot--mixed'}
          style={value ? { background: value } : undefined}
        />
        <span className="board-color__label">{label}</span>
      </button>
      {open && (
        <div className="board-color__pop" role="dialog" aria-label={label}>
          <div className="board-color__grid">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={c === value ? 'swatch swatch--active' : 'swatch'}
                style={{ background: c }}
                title={c}
                aria-label={c}
                data-testid={`${testId}-${c.slice(1)}`}
                onClick={() => pick(c)}
              />
            ))}
          </div>
          <CustomColor initial={value ?? '#ffffff'} onPick={pick} />
        </div>
      )}
    </div>
  )
}
