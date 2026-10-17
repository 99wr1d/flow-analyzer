import { ru } from '../i18n/ru'
import { EmptyState } from '../ui/EmptyState'

function VideoIcon(): React.JSX.Element {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M10.2 9.4v5.2l4.4-2.6z" strokeLinejoin="round" />
    </svg>
  )
}

export function VideoStage(): React.JSX.Element {
  return (
    <section className="stage" aria-label={ru.stage.label}>
      <div className="stage__canvas">
        <EmptyState icon={<VideoIcon />} title={ru.stage.emptyTitle} hint={ru.stage.emptyHint} />
      </div>
    </section>
  )
}
