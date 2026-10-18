// Окно «Новый проект»: название, тип, дата, заметки и видео. Файл создаёт main в папке проектов.
import { useRef, useState } from 'react'
import type { VideoSource } from '../../../../shared/ipc-contract'
import { ru } from '../../i18n/ru'
import { FilmIcon } from '../../ui/icons'
import { useFocusTrap } from '../export/useFocusTrap'
import { createProjectFromDialog } from '../project/actions'
import { useProjectStore } from '../project/projectStore'
import { closeNewProject, useDialogsStore } from './dialogsStore'
import { MetaFields } from './MetaFields'
import { validateDraft, type MetaDraft, type MetaErrors } from './metaDraft'
import { useLibraryStore } from './libraryStore'
import { todayIso } from './cardsView'

const stem = (fileName: string): string => fileName.replace(/\.[^.]+$/, '')

function NewProjectForm(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const folder = useLibraryStore((s) => s.folder)
  const [draft, setDraft] = useState<MetaDraft>({
    title: '',
    type: 'match',
    date: todayIso(),
    notes: ''
  })
  const [video, setVideo] = useState<VideoSource | null>(null)
  const [errors, setErrors] = useState<MetaErrors>({})
  const [videoError, setVideoError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useFocusTrap(ref, true, () => {
    if (!busy) closeNewProject()
  })

  const change = (patch: Partial<MetaDraft>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors({})
    setFailure(null)
  }

  const pickVideo = async (): Promise<void> => {
    setVideoError(null)
    try {
      const source = await window.api.openVideoDialog()
      if (!source) return
      setVideo(source)
      // Если название ещё пустое, подставляется имя видеофайла (своё название не затирается).
      if (draft.title.trim() === '') {
        setDraft((d) => ({ ...d, title: stem(source.fileName).slice(0, 80) }))
      }
    } catch (error) {
      setVideoError(error instanceof Error && error.message ? error.message : ru.stage.importFailed)
    }
  }

  const submit = async (): Promise<void> => {
    if (busy) return
    const checked = validateDraft(draft)
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    if (!video) {
      setVideoError(ru.newProject.needVideo)
      return
    }
    setBusy(true)
    setFailure(null)
    const ok = await createProjectFromDialog({ ...checked.meta, videoId: video.id })
    setBusy(false)
    if (ok) closeNewProject()
    else {
      // Подробное объяснение показывает плашка проекта; здесь короткая подсказка.
      setFailure(useProjectStore.getState().problem?.message ?? ru.newProject.failed)
    }
  }

  return (
    <div className="modal-backdrop" data-testid="new-project-backdrop">
      <div
        ref={ref}
        className="modal modal--form"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="np-heading"
        data-testid="new-project-dialog"
      >
        <header className="modal__head">
          <h2 id="np-heading" className="modal__title">
            {ru.newProject.title}
          </h2>
        </header>
        <form
          className="modal__body modal__form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <MetaFields
            prefix="np"
            draft={draft}
            errors={errors}
            disabled={busy}
            onChange={change}
            autoFocusTitle
          />
          <div className="form-row">
            <span className="form-row__label">{ru.newProject.video}</span>
            <div className="video-pick">
              <FilmIcon size={20} />
              <span
                className={video ? 'video-pick__name' : 'video-pick__name video-pick__name--none'}
                title={video?.fileName}
                data-testid="np-video-name"
              >
                {video ? video.fileName : ru.newProject.noVideo}
              </span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                data-testid="np-video"
                onClick={() => void pickVideo()}
              >
                {video ? ru.newProject.changeVideo : ru.newProject.pickVideo}
              </button>
            </div>
            <span
              className="form-row__error"
              role={videoError ? 'alert' : undefined}
              data-testid="np-video-error"
            >
              {videoError ?? ' '}
            </span>
          </div>
          {folder && <p className="modal__note">{ru.newProject.saveTo(folder)}</p>}
          {failure && (
            <p className="modal__fail" role="alert" data-testid="np-failure">
              {failure}
            </p>
          )}
        </form>
        <footer className="modal__foot modal__foot--end">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="np-cancel"
            onClick={closeNewProject}
          >
            {ru.newProject.cancel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            data-testid="np-create"
            onClick={() => void submit()}
          >
            {busy ? ru.newProject.creating : ru.newProject.create}
          </button>
        </footer>
      </div>
    </div>
  )
}

export function NewProjectDialog(): React.JSX.Element | null {
  const open = useDialogsStore((s) => s.newProject)
  return open ? <NewProjectForm /> : null
}
