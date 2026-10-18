// Окно «Свойства проекта». Для открытого проекта правка попадает в файл при сохранении; для карточки со стартового
// экрана записывается прямо в файл проекта.
import { useRef, useState } from 'react'
import type { ProjectMeta } from '../../../../shared/project'
import { ru } from '../../i18n/ru'
import { useFocusTrap } from '../export/useFocusTrap'
import { useProjectStore } from '../project/projectStore'
import { closeProperties, useDialogsStore, type PropertiesTarget } from './dialogsStore'
import { refreshLibrary } from './libraryActions'
import { MetaFields } from './MetaFields'
import { draftFromMeta, validateDraft, type MetaDraft, type MetaErrors } from './metaDraft'

function initialMeta(target: PropertiesTarget): ProjectMeta {
  if (target.kind === 'card') return target.meta
  const project = useProjectStore.getState()
  return project.meta ?? { title: project.name, type: 'other' }
}

function PropertiesForm({ target }: { target: PropertiesTarget }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<MetaDraft>(() => draftFromMeta(initialMeta(target)))
  const [errors, setErrors] = useState<MetaErrors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useFocusTrap(ref, true, () => {
    if (!busy) closeProperties()
  })

  const submit = async (): Promise<void> => {
    if (busy) return
    const checked = validateDraft(draft)
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    if (target.kind === 'workspace') {
      useProjectStore.getState().setMeta(checked.meta)
      closeProperties()
      return
    }
    setBusy(true)
    try {
      await window.api.updateProjectMeta(target.path, checked.meta)
      closeProperties()
      void refreshLibrary()
    } catch (error) {
      setFailure(error instanceof Error && error.message ? error.message : ru.properties.failed)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" data-testid="properties-backdrop">
      <div
        ref={ref}
        className="modal modal--form"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="props-heading"
        data-testid="properties-dialog"
      >
        <header className="modal__head">
          <h2 id="props-heading" className="modal__title">
            {ru.properties.title}
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
            prefix="props"
            draft={draft}
            errors={errors}
            disabled={busy}
            autoFocusTitle
            onChange={(patch) => {
              setDraft((d) => ({ ...d, ...patch }))
              setErrors({})
              setFailure(null)
            }}
          />
          {target.kind === 'workspace' && (
            <p className="modal__note">{ru.properties.workspaceHint}</p>
          )}
          {failure && (
            <p className="modal__fail" role="alert" data-testid="props-failure">
              {failure}
            </p>
          )}
        </form>
        <footer className="modal__foot modal__foot--end">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="props-cancel"
            onClick={closeProperties}
          >
            {ru.properties.cancel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            data-testid="props-save"
            onClick={() => void submit()}
          >
            {busy
              ? ru.properties.saving
              : target.kind === 'card'
                ? ru.properties.saveFile
                : ru.properties.save}
          </button>
        </footer>
      </div>
    </div>
  )
}

export function PropertiesDialog(): React.JSX.Element | null {
  const target = useDialogsStore((s) => s.properties)
  return target ? <PropertiesForm target={target} /> : null
}
