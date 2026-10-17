import { ru } from '../../i18n/ru'
import { CloseIcon } from '../../ui/icons'
import { discardRecovery, restoreRecovery } from './actions'
import { useProjectStore } from './projectStore'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function Dismiss({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="icon-btn icon-btn--small"
      onClick={onClick}
      aria-label={ru.stage.dismiss}
      title={ru.stage.dismiss}
    >
      <CloseIcon size={14} />
    </button>
  )
}

/** Не модальная плашка: найдена копия работы после сбоя. */
function RecoveryBanner(): React.JSX.Element | null {
  const items = useProjectStore((s) => s.recovery)
  const item = items[0]
  if (!item) return null
  const more = items.length - 1
  return (
    <div
      className="banner banner--info"
      role="region"
      aria-label={ru.project.recoveryLabel}
      data-testid="recovery-banner"
    >
      <span>
        {ru.project.recoveryFound(formatWhen(item.savedAt))}
        <span className="banner__sub">
          {' '}
          · {item.name}
          {more > 0 ? ` · ${ru.project.recoveryMore(more)}` : ''}
        </span>
      </span>
      <button
        type="button"
        className="btn btn--small btn--primary"
        data-testid="recovery-restore"
        onClick={() => void restoreRecovery(item)}
      >
        {ru.project.recoveryRestore}
      </button>
      <button
        type="button"
        className="btn btn--small"
        data-testid="recovery-discard"
        onClick={() => void discardRecovery(item)}
      >
        {ru.project.recoveryDelete}
      </button>
    </div>
  )
}

/** Ошибка сохранения/открытия: понятный текст и свёрнутые подробности. Состояние приложения при этом не меняется. */
function ProblemBanner(): React.JSX.Element | null {
  const problem = useProjectStore((s) => s.problem)
  const clear = useProjectStore((s) => s.setProblem)
  if (!problem) return null
  return (
    <div className="banner banner--error" role="alert" data-testid="project-error">
      <div className="banner__body">
        <span data-testid="project-error-message">{problem.message}</span>
        {problem.details && (
          <details className="banner__details">
            <summary>{ru.project.details}</summary>
            <pre data-testid="project-error-details">{problem.details}</pre>
          </details>
        )}
      </div>
      <Dismiss onClick={() => clear(null)} />
    </div>
  )
}

/** Неблокирующее предупреждение (например, размер видео отличается). */
function WarningBanner(): React.JSX.Element | null {
  const warning = useProjectStore((s) => s.warning)
  const clear = useProjectStore((s) => s.setWarning)
  if (!warning) return null
  return (
    <div className="banner banner--warn" role="status" data-testid="project-warning">
      <span>{warning}</span>
      <Dismiss onClick={() => clear(null)} />
    </div>
  )
}

export function ProjectBanners(): React.JSX.Element {
  return (
    <div className="banner-stack">
      <ProblemBanner />
      <WarningBanner />
      <RecoveryBanner />
    </div>
  )
}
