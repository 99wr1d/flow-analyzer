// Подтверждение удаления проекта: файл уходит в Корзину, а не стирается навсегда.
import { useRef, useState } from 'react'
import { ru } from '../../i18n/ru'
import { useFocusTrap } from '../export/useFocusTrap'
import { closeDelete, useDialogsStore } from './dialogsStore'
import { deleteCard } from './libraryActions'
import type { LibraryCard } from '../../../../shared/library'

function DeleteForm({ card }: { card: LibraryCard }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  useFocusTrap(ref, true, () => {
    if (!busy) closeDelete()
  })

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    await deleteCard(card)
    closeDelete()
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
            {ru.start.deleteTitle(card.title)}
          </h2>
          <p id="delete-text" className="modal__text">
            {ru.start.deleteText}
          </p>
          <p className="pcard__path" title={card.path}>
            {card.path}
          </p>
        </div>
        <footer className="modal__foot modal__foot--end">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-autofocus
            data-testid="delete-cancel"
            onClick={closeDelete}
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
  return card ? <DeleteForm card={card} /> : null
}
