import { ru } from '../../i18n/ru'
import { AlertIcon, CheckCircleIcon } from '../../ui/icons'
import { closeExportDialog, revealExport } from './exportActions'
import { useExportStore } from './exportStore'
import { formatClock, pluralFiles } from './selection'

/** Шаг 3: чем закончилось. */
export function ExportResultView(): React.JSX.Element | null {
  const result = useExportStore((s) => s.result)
  if (!result) return null

  const made = result.files.length
  const failed = result.failures.length
  const partial = result.status === 'done' && failed > 0
  const tone =
    result.status === 'done' && !partial ? 'ok' : result.status === 'cancelled' ? 'neutral' : 'bad'

  let title: string
  let text: string | null = null
  if (result.status === 'cancelled') {
    title = ru.export.cancelledTitle
    text = made > 0 ? ru.export.cancelledKept(pluralFiles(made)) : ru.export.cancelledNone
  } else if (result.status === 'failed') {
    title = ru.export.failedTitle
  } else if (partial) {
    title = ru.export.donePartial(made, result.total)
  } else {
    title =
      result.mode === 'compilation'
        ? ru.export.doneCompilation
        : ru.export.doneTitle(pluralFiles(made))
  }

  return (
    <>
      <div className="modal__body export__body export__body--result">
        <div
          className={`export__verdict export__verdict--${tone}`}
          data-testid="export-result"
          data-status={result.status}
        >
          <span className="export__verdict-icon" aria-hidden="true">
            {tone === 'ok' ? <CheckCircleIcon size={28} /> : <AlertIcon size={28} />}
          </span>
          <div className="export__verdict-text">
            <h3 className="export__verdict-title" data-testid="export-result-title">
              {title}
            </h3>
            {text && <p className="export__verdict-sub">{text}</p>}
            {result.target && made > 0 && (
              <p className="export__path" title={result.target} data-testid="export-result-target">
                {result.target}
              </p>
            )}
            <p className="export__hint">
              {ru.export.elapsedTotal(formatClock(result.elapsedMs / 1000))}
            </p>
          </div>
        </div>

        {made > 0 && result.mode === 'files' && (
          <ul className="export__files" data-testid="export-files">
            {result.files.map((name) => (
              <li key={name} className="export__file" data-testid="export-file">
                {name}
              </li>
            ))}
          </ul>
        )}

        {failed > 0 && (
          <section className="export__fails" aria-label={ru.export.failures}>
            <h4 className="export__legend">{ru.export.failures}</h4>
            <ul>
              {result.failures.map((f, i) => (
                <li key={i} className="export__fail" data-testid="export-failure">
                  <div>
                    <strong>{f.label}</strong> — {f.message}
                  </div>
                  {f.details && (
                    <details className="banner__details">
                      <summary>{ru.export.details}</summary>
                      <pre>{f.details}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <footer className="modal__foot modal__foot--end">
        {made > 0 && (
          <button type="button" className="btn" data-testid="export-reveal" onClick={revealExport}>
            {ru.export.reveal}
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary"
          data-autofocus
          data-testid="export-done"
          onClick={closeExportDialog}
        >
          {ru.export.done}
        </button>
      </footer>
    </>
  )
}
