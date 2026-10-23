import { useEffect, useRef } from 'react'
import { ru } from '../../i18n/ru'
import { useViewStore } from '../../app/viewStore'
import { useBoardStore } from '../board/boardStore'
import { useProjectStore } from './projectStore'
import { answerUnsaved, useUnsavedStore } from './unsavedStore'

/** Модальное окно «Сохранить изменения в проекте?». Esc — отмена, Tab не выпускает фокус наружу. */
export function UnsavedDialog(): React.JSX.Element | null {
  const open = useUnsavedStore((s) => s.open)
  const kind = useUnsavedStore((s) => s.kind)
  const onBoard = useViewStore((s) => s.view === 'board')
  const projectName = useProjectStore((s) => s.name)
  const boardTitle = useBoardStore((s) => s.board?.title ?? '')
  const video = kind === 'video'
  const title = video
    ? ru.board.videoCloseTitle
    : onBoard
      ? ru.board.unsavedTitle(boardTitle)
      : ru.project.unsavedTitle(projectName)
  const text = video ? ru.board.videoCloseText : ru.project.unsavedText
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
            {title}
          </h2>
          <p id="unsaved-text" className="modal__text">
            {text}
          </p>
        </div>
        <footer className="modal__foot modal__foot--end">
          <button
            type="button"
            className="btn"
            data-testid="unsaved-cancel"
            onClick={() => answerUnsaved('cancel')}
          >
            {video ? ru.board.videoCloseKeep : ru.project.unsavedCancel}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            data-testid="unsaved-discard"
            onClick={() => answerUnsaved('discard')}
          >
            {video ? ru.board.videoCloseStop : ru.project.unsavedDiscard}
          </button>
          {!video && (
            <button
              type="button"
              className="btn btn--primary"
              data-autofocus
              data-testid="unsaved-save"
              onClick={() => answerUnsaved('save')}
            >
              {ru.project.unsavedSave}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
