import { useEffect, useRef } from 'react'
import { ru } from '../../i18n/ru'
import { cancelRelink, relinkVideo } from './actions'
import { useProjectStore } from './projectStore'

/** Видео проекта не найдено: предлагаем указать его вручную или отменить открытие. */
export function RelinkDialog(): React.JSX.Element | null {
  const request = useProjectStore((s) => s.relink)
  const dialogRef = useRef<HTMLDivElement>(null)
  const active = request !== null

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelRelink()
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
  }, [active])

  if (!request) return null
  return (
    <div className="modal-backdrop" data-testid="relink-backdrop">
      <div
        ref={dialogRef}
        className="modal modal--small"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="relink-title"
        aria-describedby="relink-text"
        data-testid="relink-dialog"
      >
        <div className="modal__body modal__body--prompt">
          <h2 id="relink-title" className="modal__title">
            {ru.project.relinkTitle}
          </h2>
          <p id="relink-text" className="modal__text">
            {ru.project.relinkText(request.videoFileName, request.name)}
          </p>
        </div>
        <footer className="modal__foot modal__foot--end">
          <button type="button" className="btn" data-testid="relink-cancel" onClick={cancelRelink}>
            {ru.project.relinkCancel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-autofocus
            data-testid="relink-pick"
            onClick={() => void relinkVideo()}
          >
            {ru.project.relinkPick}
          </button>
        </footer>
      </div>
    </div>
  )
}
