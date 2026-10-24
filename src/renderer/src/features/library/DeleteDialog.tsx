// Подтверждение удаления проекта: файл уходит в Корзину, а не стирается навсегда.
import { useRef, useState } from 'react'
import { ru } from '../../i18n/ru'
import { useFocusTrap } from '../export/useFocusTrap'
import { closeDelete, useDialogsStore } from './dialogsStore'
import { deleteCard } from './libraryActions'
import { closeBoardDelete, deleteBoardCard, useBoardLibrary } from '../board/boardLibrary'

interface DeleteTarget {
  title: string
  heading: string
  text: string
  path: string
  confirm: () => Promise<void>
  close: () => void
}

function DeleteForm({ target }: { target: DeleteTarget }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  useFocusTrap(ref, true, () => {
    if (!busy) target.close()
  })

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    await target.confirm()
    target.close()
  }

  return (
    <div className="modal-backdrop" data-testid="delete-backdrop">
      <div
        ref={ref}
        className="modal modal--small"
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-text"
        data-testid="delete-dialog"
      >
        <div className="modal__body modal__body--prompt">
          <h2 id="delete-title" className="modal__title">
            {target.heading}
          </h2>
          <p id="delete-text" className="modal__text">
            {target.text}
          </p>
          <p className="pcard__path" title={target.path}>
            {target.path}
          </p>
        </div>
        <footer className="modal__foot modal__foot--end">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-autofocus
            data-testid="delete-cancel"
            onClick={target.close}
          >
            {ru.start.deleteCancel}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            data-testid="delete-confirm"
            onClick={() => void confirm()}
          >
            {busy ? ru.start.deleting : ru.start.deleteConfirm}
          </button>
        </footer>
      </div>
    </div>
  )
}

export function DeleteDialog(): React.JSX.Element | null {
  const card = useDialogsStore((s) => s.deleting)
  const board = useBoardLibrary((s) => s.deleting)
  if (card) {
    return (
      <DeleteForm
        target={{
          title: card.title,
          heading: ru.start.deleteTitle(card.title),
          text: ru.start.deleteText,
          path: card.path,
          confirm: () => deleteCard(card),
          close: closeDelete
        }}
      />
    )
  }
  if (board) {
    return (
      <DeleteForm
        target={{
          title: board.title,
          heading: ru.board.deleteTitle(board.title),
          text: ru.board.deleteText,
          path: board.path,
          confirm: () => deleteBoardCard(board),
          close: closeBoardDelete
        }}
      />
    )
  }
  return null
}
