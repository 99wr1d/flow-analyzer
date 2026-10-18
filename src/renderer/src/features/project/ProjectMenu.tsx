import { useEffect, useRef, useState } from 'react'
import type { RecentProject } from '../../../../shared/project'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { ChevronDownIcon, ChevronRightIcon } from '../../ui/icons'
import { useFirstKey } from '../commands/useKeys'
import { useDialogsStore } from '../library/dialogsStore'
import { goHome, newProject, openProject, saveProject, saveProjectAs } from './actions'

function Item({
  label,
  hint,
  testId,
  disabled,
  onClick
}: {
  label: string
  hint?: string
  testId: string
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu__item"
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
    >
      <span className="menu__label">{label}</span>
      {hint && <kbd className="menu__hint">{hint}</kbd>}
    </button>
  )
}

/** Выпадающее меню «Проект»: новый, открыть, недавние, сохранить. */
export function ProjectMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hasVideo = usePlayerStore((s) => s.source !== null)

  const newKey = useFirstKey('project:new')
  const openKey = useFirstKey('project:open')
  const saveKey = useFirstKey('project:save')
  const saveAsKey = useFirstKey('project:save-as')
  const homeKey = useFirstKey('project:home')

  const close = (returnFocus: boolean): void => {
    setOpen(false)
    setRecentOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  // Список недавних читаем при каждом открытии меню: файлы могли исчезнуть.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.api
      .listRecentProjects()
      .then((list) => {
        if (!cancelled) setRecent(list)
      })
      .catch(() => {
        if (!cancelled) setRecent([])
      })
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => {
      cancelled = true
    }
  }, [open])

  // Клик мимо меню и Esc закрывают его; стрелки двигают выбор.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (recentOpen) {
          setRecentOpen(false)
          rootRef.current?.querySelector<HTMLElement>('[data-testid="menu-recent"]')?.focus()
        } else {
          close(true)
        }
        return
      }
      if (
        e.key !== 'ArrowDown' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowLeft'
      ) {
        return
      }
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !rootRef.current?.contains(active)) return
      const inSub = active.closest('.menu--sub') !== null
      if (e.key === 'ArrowRight' && active.dataset.testid === 'menu-recent') {
        e.preventDefault()
        setRecentOpen(true)
        return
      }
      if (e.key === 'ArrowLeft' && inSub) {
        e.preventDefault()
        setRecentOpen(false)
        rootRef.current.querySelector<HTMLElement>('[data-testid="menu-recent"]')?.focus()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return
      e.preventDefault()
      const items = Array.from(
        rootRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ).filter((el) => (el.closest('.menu--sub') !== null) === inSub)
      if (items.length === 0) return
      const index = items.indexOf(active)
      const next = e.key === 'ArrowDown' ? index + 1 : index - 1
      items[(next + items.length) % items.length].focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, recentOpen])

  const run = (action: () => unknown): void => {
    close(false)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    void action()
  }

  return (
    <div className="project-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={ru.project.menuTitle}
        data-testid="project-menu-button"
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {ru.project.menu}
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <div
          className="menu menu--main"
          role="menu"
          aria-label={ru.project.menuTitle}
          data-testid="project-menu"
        >
          <Item
            label={ru.project.new}
            hint={newKey}
            testId="menu-new"
            onClick={() => run(newProject)}
          />
          <Item
            label={ru.project.open}
            hint={openKey}
            testId="menu-open"
            onClick={() => run(() => openProject())}
          />
          <div className="menu__parent" onMouseEnter={() => setRecentOpen(true)}>
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              aria-haspopup="menu"
              aria-expanded={recentOpen}
              data-testid="menu-recent"
              onClick={() => setRecentOpen(true)}
            >
              <span className="menu__label">{ru.project.recent}</span>
              <ChevronRightIcon size={14} />
            </button>
            {recentOpen && (
              <div
                className="menu menu--sub"
                role="menu"
                aria-label={ru.project.recent}
                data-testid="recent-menu"
              >
                {recent.length === 0 ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    disabled
                    data-testid="recent-none"
                  >
                    <span className="menu__label">{ru.project.recentNone}</span>
                  </button>
                ) : (
                  recent.map((r) => (
                    <button
                      key={r.path}
                      type="button"
                      role="menuitem"
                      className="menu__item menu__item--recent"
                      title={r.path}
                      data-testid="recent-item"
                      data-path={r.path}
                      onClick={() => run(() => openProject(r.path))}
                    >
                      <span className="menu__label">{r.name}</span>
                      <span className="menu__path">{r.path}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="menu__sep" role="separator" />
          <Item
            label={ru.project.save}
            hint={saveKey}
            testId="menu-save"
            disabled={!hasVideo}
            onClick={() => run(() => saveProject())}
          />
          <Item
            label={ru.project.saveAs}
            hint={saveAsKey}
            testId="menu-save-as"
            disabled={!hasVideo}
            onClick={() => run(() => saveProjectAs())}
          />
          <Item
            label={ru.properties.menu}
            testId="menu-properties"
            disabled={!hasVideo}
            onClick={() =>
              run(() => useDialogsStore.setState({ properties: { kind: 'workspace' } }))
            }
          />
          <div className="menu__sep" role="separator" />
          <Item
            label={ru.topBar.home}
            hint={homeKey}
            testId="menu-home"
            onClick={() => run(goHome)}
          />
        </div>
      )}
    </div>
  )
}
