import { openVideoFromDialog } from '../features/player/importVideo'
import { VideoView } from '../features/player/VideoView'
import { ru } from '../i18n/ru'
import { usePlayerStore } from '../store/playerStore'
import { CloseIcon, FolderOpenIcon } from '../ui/icons'
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

function ImportBanner(): React.JSX.Element | null {
  const message = usePlayerStore((s) => s.importError)
  if (!message) return null
  return (
    <div className="banner" role="alert" data-testid="import-error">
      <span>{message}</span>
      <button
        type="button"
        className="icon-btn icon-btn--small"
        onClick={() => usePlayerStore.getState().setImportError(null)}
        aria-label={ru.stage.dismiss}
        title={ru.stage.dismiss}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

export function VideoStage(): React.JSX.Element {
  const source = usePlayerStore((s) => s.source)
  const status = usePlayerStore((s) => s.status)
  const dragActive = usePlayerStore((s) => s.dragActive)

  return (
    <section className={dragActive ? 'stage stage--drop' : 'stage'} aria-label={ru.stage.label}>
      <div className="stage__canvas">
        {source && <VideoView id={source.id} url={source.url} />}
        {!source && (
          <EmptyState
            icon={<VideoIcon />}
            title={ru.stage.emptyTitle}
            hint={ru.stage.emptyHint}
            action={
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void openVideoFromDialog()}
              >
                <FolderOpenIcon />
                {ru.topBar.openVideo}
              </button>
            }
            footnote={ru.stage.formats}
          />
        )}
        {status === 'error' && (
          <div className="stage__error" role="alert" data-testid="playback-error">
            {ru.stage.playbackError}
          </div>
        )}
        <ImportBanner />
        {dragActive && <div className="stage__drop-hint">{ru.stage.dropHere}</div>}
      </div>
    </section>
  )
}
