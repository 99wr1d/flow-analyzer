import { useEffect, useState } from 'react'
import { ru } from '../../i18n/ru'
import { cancelExport } from './exportActions'
import { useExportStore } from './exportStore'
import { estimateRemainingMs, formatClock, formatRemaining } from './selection'

function Bar(props: { label: string; fraction: number; testId: string }): React.JSX.Element {
  const percent = Math.round(Math.min(1, Math.max(0, props.fraction)) * 100)
  return (
    <div className="progress">
      <div className="progress__head">
        <span>{props.label}</span>
        <span className="progress__pct">{percent}%</span>
      </div>
      <div
        className="progress__track"
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        data-testid={props.testId}
        data-percent={percent}
      >
        <div className="progress__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** Шаг 2: идёт экспорт. */
export function ExportRunning(): React.JSX.Element {
  const progress = useExportStore((s) => s.progress)
  const startedAt = useExportStore((s) => s.startedAt)
  const cancelling = useExportStore((s) => s.cancelling)
  const compilation = useExportStore((s) => s.mode === 'compilation' && s.scope !== 'whole')
  const preparing = useExportStore((s) => s.preparing)
  const [now, setNow] = useState(() => Date.now())

  // Таймер тикает сам: ffmpeg может долго ничего не присылать (например, ищет начало эпизода).
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  const elapsed = startedAt ? now - startedAt : 0
  const remaining = progress ? estimateRemainingMs(elapsed, progress.overallFraction) : null

  return (
    <>
      <div className="modal__body export__body export__body--run" aria-live="polite">
        {preparing !== null ? (
          <div className="export__waiting" data-testid="export-preparing">
            <p className="export__waiting-title">{ru.export.preparing}</p>
            <p className="export__hint">
              {ru.export.preparingProgress(preparing.done, preparing.total)}
            </p>
            <p className="export__hint">{ru.export.preparingHint}</p>
          </div>
        ) : progress === null ? (
          <div className="export__waiting" data-testid="export-waiting">
            <p className="export__waiting-title">{ru.export.chooseTarget}</p>
            <p className="export__hint">{ru.export.chooseTargetHint}</p>
          </div>
        ) : (
          <>
            <div className="export__current" data-testid="export-current">
              <span className="export__current-step">
                {compilation
                  ? ru.export.compiling
                  : ru.export.clipOf(progress.index + 1, progress.count)}
              </span>
              <span className="export__current-name" title={progress.name}>
                {progress.name}
              </span>
            </div>
            {!compilation && (
              <Bar
                label={ru.export.current}
                fraction={progress.clipFraction}
                testId="export-clip-progress"
              />
            )}
            <Bar
              label={compilation ? ru.export.compiling : ru.export.overall}
              fraction={progress.overallFraction}
              testId="export-progress"
            />
            <div className="export__time" data-testid="export-time">
              {ru.export.elapsed(formatClock(elapsed / 1000))}
              {remaining !== null && ` · ${ru.export.remaining(formatRemaining(remaining))}`}
            </div>
          </>
        )}
      </div>
      <footer className="modal__foot modal__foot--end">
        <button
          type="button"
          className="btn btn--danger"
          disabled={cancelling}
          data-testid="export-cancel"
          onClick={() => void cancelExport()}
        >
          {cancelling ? ru.export.stopping : ru.export.stop}
        </button>
      </footer>
    </>
  )
}
