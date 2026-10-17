import type { ReactNode } from 'react'

interface Props {
  icon: ReactNode
  title: string
  hint?: string
}

export function EmptyState({ icon, title, hint }: Props): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="empty-state__title">{title}</div>
      {hint && <div className="empty-state__hint">{hint}</div>}
    </div>
  )
}
