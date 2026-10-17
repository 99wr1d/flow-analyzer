import { Inspector } from '../features/annotations/Inspector'
import { ru } from '../i18n/ru'

export function EpisodesPanel(): React.JSX.Element {
  return (
    <aside className="side-panel" aria-label={ru.episodes.title}>
      <Inspector />
      <div className="panel-header">
        <h2 className="panel-header__title">{ru.episodes.title}</h2>
      </div>
      <div className="side-panel__body">
        <p className="side-panel__empty">{ru.episodes.empty}</p>
      </div>
    </aside>
  )
}
