import { useKeyHint } from '../features/commands/useKeys'
import { openVideoFromDialog } from '../features/player/importVideo'
import { ProjectMenu } from '../features/project/ProjectMenu'
import { useProjectStore } from '../features/project/projectStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { ru } from '../i18n/ru'
import { usePlayerStore } from '../store/playerStore'
import { FolderOpenIcon, GearIcon } from '../ui/icons'
import { Logo } from '../ui/Logo'

function FileName(): React.JSX.Element | null {
  const name = usePlayerStore((s) => s.source?.fileName)
  if (!name) return null
  return (
    <>
      <div className="top-bar__sep" aria-hidden="true" />
      <div className="top-bar__project top-bar__file">
        <span className="top-bar__project-label">{ru.topBar.fileLabel}</span>
        <span className="top-bar__file-name" title={name} data-testid="file-name">
          {name}
        </span>
      </div>
    </>
  )
}

function ProjectName(): React.JSX.Element {
  const name = useProjectStore((s) => s.name)
  const dirty = useProjectStore((s) => s.dirty)
  return (
    <>
      <span className="top-bar__project-name" title={name} data-testid="project-name">
        {name}
      </span>
      {dirty && (
        <span
          className="top-bar__dirty"
          title={ru.project.dirty}
          role="img"
          aria-label={ru.project.dirty}
          data-testid="project-dirty"
        >
          •
        </span>
      )}
    </>
  )
}

export function TopBar(): React.JSX.Element {
  const openHint = useKeyHint('general:open-video')
  const settingsHint = useKeyHint('general:settings')
  const openSettings = useSettingsStore((s) => s.openDialog)
  return (
    <header className="top-bar">
      <div className="top-bar__brand">
        <Logo />
        <span className="top-bar__name">{ru.appName}</span>
      </div>
      <div className="top-bar__sep" aria-hidden="true" />
      <div className="top-bar__project">
        <ProjectMenu />
        <ProjectName />
      </div>
      <FileName />
      <div className="top-bar__spacer" />
      <button
        type="button"
        className="btn"
        onClick={() => void openVideoFromDialog()}
        title={`${ru.topBar.openVideoTitle}${openHint}`}
        data-testid="open-video"
      >
        <FolderOpenIcon />
        {ru.topBar.openVideo}
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={(e) => {
          openSettings()
          e.currentTarget.blur()
        }}
        title={`${ru.topBar.settingsTitle}${settingsHint}`}
        aria-label={ru.topBar.settings}
        data-testid="open-settings"
      >
        <GearIcon size={18} />
      </button>
    </header>
  )
}
