import { useEffect, useRef, useState } from 'react'
import { ru } from '../../i18n/ru'
import { HelpIcon } from '../../ui/icons'
import { openAbout, startTips } from './helpStore'

/** Кнопка «Справка» с меню: «Подсказки» (повторить тур) и «О программе». Стоит рядом с шестерёнкой настроек. */
export function HelpMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="help-menu" ref={rootRef}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title={ru.help.buttonTitle}
        aria-label={ru.help.button}
        data-testid="help-menu-button"
        onClick={(e) => {
          setOpen((v) => !v)
          e.currentTarget.blur()
        }}
      >
        <HelpIcon size={18} />
      </button>
      {open && (
        <div className="menu help-menu__list" role="menu" data-testid="help-menu">
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            data-testid="help-tips"
            onClick={() => {
              setOpen(false)
              startTips()
            }}
          >
            <span className="menu__label">{ru.help.tips}</span>
            <span className="menu__hint">{ru.help.tipsHint}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            data-testid="help-about"
            onClick={() => {
              setOpen(false)
              openAbout()
            }}
          >
            <span className="menu__label">{ru.help.about}</span>
            <span className="menu__hint">{ru.help.aboutHint}</span>
          </button>
        </div>
      )}
    </div>
  )
}
