// Поля описания проекта: название, тип, дата, заметки. Общие для окон «Новый проект» и «Свойства проекта».
import { MAX_META_NOTES, MAX_META_TITLE, PROJECT_TYPES } from '../../../../shared/project'
import { ru } from '../../i18n/ru'
import type { MetaDraft, MetaErrors } from './metaDraft'

interface Props {
  /** Префикс testid: np — «Новый проект», props — «Свойства». */
  prefix: string
  draft: MetaDraft
  errors: MetaErrors
  disabled?: boolean
  onChange: (patch: Partial<MetaDraft>) => void
  autoFocusTitle?: boolean
}

export function MetaFields({
  prefix,
  draft,
  errors,
  disabled,
  onChange,
  autoFocusTitle
}: Props): React.JSX.Element {
  return (
    <>
      <label className="form-row">
        <span className="form-row__label">{ru.metaForm.title}</span>
        <input
          type="text"
          className="input input--wide"
          value={draft.title}
          maxLength={MAX_META_TITLE + 20}
          placeholder={ru.metaForm.titlePlaceholder}
          disabled={disabled}
          aria-invalid={errors.title ? true : undefined}
          data-autofocus={autoFocusTitle ? '' : undefined}
          data-testid={`${prefix}-title`}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <span
          className="form-row__error"
          role={errors.title ? 'alert' : undefined}
          data-testid={`${prefix}-title-error`}
        >
          {errors.title ?? ' '}
        </span>
      </label>

      <div className="form-row">
        <span className="form-row__label" id={`${prefix}-type-label`}>
          {ru.metaForm.type}
        </span>
        <div
          className="seg seg--wide"
          role="radiogroup"
          aria-labelledby={`${prefix}-type-label`}
          data-testid={`${prefix}-type`}
        >
          {PROJECT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={draft.type === type}
              disabled={disabled}
              className={draft.type === type ? 'seg__btn seg__btn--active' : 'seg__btn'}
              data-testid={`${prefix}-type-${type}`}
              onClick={() => onChange({ type })}
            >
              {ru.projectTypes[type]}
            </button>
          ))}
        </div>
        <span className="form-row__error"> </span>
      </div>

      <label className="form-row">
        <span className="form-row__label">{ru.metaForm.date}</span>
        <input
          type="date"
          className="input input--date"
          value={draft.date}
          disabled={disabled}
          title={ru.metaForm.dateHint}
          aria-invalid={errors.date ? true : undefined}
          data-testid={`${prefix}-date`}
          onChange={(e) => onChange({ date: e.target.value })}
        />
        <span className="form-row__error" role={errors.date ? 'alert' : undefined}>
          {errors.date ?? ' '}
        </span>
      </label>

      <label className="form-row">
        <span className="form-row__label">{ru.metaForm.notes}</span>
        <textarea
          className="input textarea input--wide"
          rows={3}
          value={draft.notes}
          maxLength={MAX_META_NOTES + 50}
          placeholder={ru.metaForm.notesPlaceholder}
          disabled={disabled}
          aria-invalid={errors.notes ? true : undefined}
          data-testid={`${prefix}-notes`}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
        <span className="form-row__error" role={errors.notes ? 'alert' : undefined}>
          {errors.notes ?? ' '}
        </span>
      </label>
    </>
  )
}
