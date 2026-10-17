import { useEffect, useState } from 'react'
import { ru } from '../i18n/ru'
import { formatStatus } from './platform'

export function StatusBar(): React.JSX.Element {
  const [text, setText] = useState<string>(ru.status.loading)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setText(formatStatus(info))
      })
      .catch(() => {
        if (!cancelled) {
          setText(ru.status.error)
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <footer className="status-bar" aria-label={ru.status.label}>
      <span
        className={failed ? 'status-bar__item status-bar__item--error' : 'status-bar__item'}
        data-testid="app-info"
      >
        {text}
      </span>
    </footer>
  )
}
