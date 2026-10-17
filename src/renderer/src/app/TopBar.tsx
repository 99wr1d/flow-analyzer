import { ru } from '../i18n/ru'
import { Logo } from '../ui/Logo'

export function TopBar(): React.JSX.Element {
  return (
    <header className="top-bar">
      <div className="top-bar__brand">
        <Logo />
        <span className="top-bar__name">{ru.appName}</span>
      </div>
      <div className="top-bar__sep" aria-hidden="true" />
      <div className="top-bar__project">
        <span className="top-bar__project-label">{ru.topBar.projectLabel}</span>
        <span className="top-bar__project-name">{ru.topBar.newProject}</span>
      </div>
    </header>
  )
}
