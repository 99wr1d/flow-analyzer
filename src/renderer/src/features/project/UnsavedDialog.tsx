import { useEffect, useRef } from 'react'
import { ru } from '../../i18n/ru'
import { useProjectStore } from './projectStore'
import { answerUnsaved, useUnsavedStore } from './unsavedStore'

/** Модальное окно «Сохранить изменения в проекте?». Esc — отмена, Tab не выпускает фокус наружу. */
export function UnsavedDialog(): React.JSX.Element | null {
  const open = useUnsavedStore((s) => s.open)
  const name = useProjectStore((s) => s.name)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        answerUnsaved('cancel')
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [])
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!dialogRef.current?.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop" data-testid="unsaved-backdrop">
      <div
        ref={dialogRef}
        className="modal modal--small"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-text"
        data-testid="unsaved-dialog"
      >
        <div className="modal__body modal__body--prompt">
          <h2 id="unsaved-title" className="modal__title">
            {ru.project.unsavedTitle(name)}
          </h2>
          <p id="unsaved-text" className="modal__text">
            {ru.project.unsavedText}
          </p>
        </div>
        <footer className="modal__foot modal__foot--end">
          <button
            type="button"
            className="btn"
            data-testid="unsaved-cancel"
            onClick={() => answerUnsaved('cancel')}
          >
            {ru.project.unsavedCancel}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            data-testid="unsaved-discard"
            onClick={() => answerUnsaved('discard')}
          >
            {ru.project.unsavedDiscard}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-autofocus
            data-testid="unsaved-save"
            onClick={() => answerUnsaved('save')}
          >
            {ru.project.unsavedSave}
          </button>
        </footer>
      </div>
    </div>
  )
}
