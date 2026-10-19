import { AnnotationLayer } from '../features/annotations/AnnotationLayer'
import { StyleBar } from '../features/annotations/StyleBar'
import { CalibrationMode } from '../features/pitch/CalibrationMode'
import { usePitchStore } from '../features/pitch/pitchStore'
import { Toast } from '../features/episodes/Toast'
import { openVideoFromDialog } from '../features/player/importVideo'
import { ProjectBanners } from '../features/project/ProjectBanners'
import { VideoView } from '../features/player/VideoView'
import { ru } from '../i18n/ru'
import { usePlayerStore } from '../store/playerStore'
import { FolderOpenIcon } from '../ui/icons'
import { EmptyState } from '../ui/EmptyState'
import { ImportBanner, SettingsWarning } from './NoticeBanners'

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
  const source = usePlayerStore((s) => s.source)
  const status = usePlayerStore((s) => s.status)
  const dragActive = usePlayerStore((s) => s.dragActive)
  // Во время разметки поля слева (или справа) откладывается место под панель: она не должна закрывать картинку.
  const calibrationSide = usePitchStore((s) => (s.draft ? s.panelSide : null))

  return (
    <section className={dragActive ? 'stage stage--drop' : 'stage'} aria-label={ru.stage.label}>
      {source && status === 'ready' && <StyleBar />}
      <div
        className={
          calibrationSide ? `stage__canvas stage__canvas--cal-${calibrationSide}` : 'stage__canvas'
        }
      >
        {source && <VideoView id={source.id} url={source.url} />}
        {source && <AnnotationLayer />}
        {source && status === 'ready' && <CalibrationMode />}
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
        <SettingsWarning />
        <ProjectBanners />
        <Toast />
        {dragActive && <div className="stage__drop-hint">{ru.stage.dropHere}</div>}
      </div>
    </section>
  )
}
