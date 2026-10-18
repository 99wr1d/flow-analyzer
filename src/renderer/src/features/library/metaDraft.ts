// Черновик описания проекта в формах «Новый проект» и «Свойства»: проверка и преобразование в ProjectMeta.
import {
  MAX_META_NOTES,
  MAX_META_TITLE,
  ProjectMetaSchema,
  type ProjectMeta,
  type ProjectType
} from '../../../../shared/project'
import { ru } from '../../i18n/ru'

export interface MetaDraft {
  title: string
  type: ProjectType
  /** ГГГГ-ММ-ДД или пустая строка. */
  date: string
  notes: string
}

export interface MetaErrors {
  title?: string
  date?: string
  notes?: string
}

export function draftFromMeta(meta: ProjectMeta): MetaDraft {
  return { title: meta.title, type: meta.type, date: meta.date ?? '', notes: meta.notes ?? '' }
}

/** Проверка черновика. Ошибки — понятные тексты для полей; ok — готовый ProjectMeta. */
export function validateDraft(
  draft: MetaDraft
): { ok: true; meta: ProjectMeta } | { ok: false; errors: MetaErrors } {
  const errors: MetaErrors = {}
  const title = draft.title.trim()
  if (title === '') errors.title = ru.metaForm.titleRequired
  else if (title.length > MAX_META_TITLE) errors.title = ru.metaForm.titleTooLong
  if (draft.notes.length > MAX_META_NOTES) errors.notes = ru.metaForm.notesTooLong
  const candidate = {
    title,
    type: draft.type,
    ...(draft.date !== '' ? { date: draft.date } : {}),
    ...(draft.notes.trim() !== '' ? { notes: draft.notes.trim() } : {})
  }
  const parsed = ProjectMetaSchema.safeParse(candidate)
  if (!parsed.success && Object.keys(errors).length === 0) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (key === 'date') errors.date = issue.message
      else if (key === 'title') errors.title = issue.message
    }
  }
  if (Object.keys(errors).length > 0 || !parsed.success) {
    return { ok: false, errors }
  }
  return { ok: true, meta: parsed.data }
}
