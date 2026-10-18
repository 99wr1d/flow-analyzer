import { useRef } from 'react'
import { ru } from '../../i18n/ru'
import { CloseIcon } from '../../ui/icons'
import { answerClosePrompt, closeExportDialog } from './exportActions'
import { useExportStore } from './exportStore'
import { ExportForm } from './ExportForm'
import { ExportResultView } from './ExportResult'
import { ExportRunning } from './ExportRunning'
import { useFocusTrap } from './useFocusTrap'

/** Вопрос при закрытии окна приложения посреди экспорта. */
function ClosePrompt(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true, () => answerClosePrompt(false))
  return (
    <div className="modal-backdrop modal-backdrop--top" data-testid="export-close-backdrop">
      <div
        ref={ref}
        className="modal modal--small"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="export-close-title"
        aria-describedby="export-close-text"
        data-testid="export-close-prompt"
      >
        <div className="modal__body modal__body--prompt">
          <h2 id="export-close-title" className="modal__title">
            {ru.export.closePromptTitle}
          </h2>
          <p id="export-close-text" className="modal__text">
            {ru.export.closePromptText}
          </p>
        </div>
        <footer className="modal__foot modal__foot--end">
          <button
            type="button"
            className="btn btn--danger"
            data-testid="export-close-stop"
            onClick={() => answerClosePrompt(true)}
          >
            {ru.export.closeStop}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-autofocus
            data-testid="export-close-keep"
            onClick={() => answerClosePrompt(false)}
          >
            {ru.export.closeKeep}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** Окно «Экспорт клипов»: настройки → ход работы → результат. Пока идёт экспорт, закрыть его можно только отменой. */
export function ExportDialog(): React.JSX.Element | null {
  const open = useExportStore((s) => s.open)
  const phase = useExportStore((s) => s.phase)
  const closePrompt = useExportStore((s) => s.closePrompt)
  const ref = useRef<HTMLDivElement>(null)

  useFocusTrap(
    ref,
    open && !closePrompt,
    () => {
      if (useExportStore.getState().phase !== 'running') closeExportDialog()
    },
    phase
  )

  if (!open) return null
  return (
    <>
      <div className="modal-backdrop" data-testid="export-backdrop">
        <div
          ref={ref}
          className="modal export"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-title"
          data-testid="export-dialog"
          data-phase={phase}
        >
          <header className="modal__head">
            <h2 id="export-title" className="modal__title">
              {ru.export.title}
            </h2>
            {phase !== 'running' && (
              <button
                type="button"
                className="icon-btn"
                onClick={closeExportDialog}
                title={`${ru.export.close} (Esc)`}
                aria-label={ru.export.close}
                data-testid="export-close"
              >
                <CloseIcon size={16} />
              </button>
            )}
          </header>
          {phase === 'form' && <ExportForm />}
          {phase === 'running' && <ExportRunning />}
          {phase === 'result' && <ExportResultView />}
        </div>
      </div>
      {closePrompt && <ClosePrompt />}
    </>
  )
}
