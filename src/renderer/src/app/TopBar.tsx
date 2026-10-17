import { openVideoFromDialog } from '../features/player/importVideo'
import { ru } from '../i18n/ru'
import { usePlayerStore } from '../store/playerStore'
import { FolderOpenIcon } from '../ui/icons'
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
      <FileName />
      <div className="top-bar__spacer" />
      <button
        type="button"
        className="btn"
        onClick={() => void openVideoFromDialog()}
        title={ru.topBar.openVideoTitle}
        data-testid="open-video"
      >
        <FolderOpenIcon />
        {ru.topBar.openVideo}
      </button>
    </header>
  )
}
