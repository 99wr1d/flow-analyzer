import { Inspector } from '../features/annotations/Inspector'
import { CalibrationsPanel } from '../features/pitch/CalibrationsPanel'
import { EpisodeList } from '../features/episodes/EpisodeList'
import { TagPanel } from '../features/episodes/TagPanel'
import { ru } from '../i18n/ru'

/** Правая панель: свойства выбранного рисунка, теги и список эпизодов. */
export function EpisodesPanel(): React.JSX.Element {
  return (
    <aside className="side-panel" aria-label={ru.episodes.title}>
      <Inspector />
      <CalibrationsPanel />
      <TagPanel />
      <EpisodeList />
    </aside>
  )
}
