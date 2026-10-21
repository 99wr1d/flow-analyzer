// Состояние проекта: путь, имя, признак «есть несохранённые изменения». Сами данные (рисунки, эпизоды) лежат в своих хранилищах.
import { create } from 'zustand'
import { UNTITLED_PROJECT, type ProjectMeta, type RecoveryItem } from '../../../../shared/project'

export interface ProjectProblem {
  message: string
  /** Технические подробности: показываются свёрнутыми. */
  details?: string
}

/** Проект ждёт, пока пользователь укажет перенесённое видео. */
export interface RelinkRequest {
  ticket: string
  name: string
  videoFileName: string
  /** Открытие идёт из копии работы (после сбоя): ключ этой копии. */
  recoveryKey: string | null
}

export interface ProjectState {
  /** Файл проекта; null — проект ещё не сохранялся. */
  path: string | null
  name: string
  /** Описание проекта (название, тип, дата, заметки). null — не задано: имя берётся из имени файла. */
  meta: ProjectMeta | null
  /** Кадр-обложка проекта, секунды; null — не выбран (эскиз выбирается сам). */
  coverTime: number | null
  dirty: boolean
  /** Растёт при каждом изменении работы: по нему видно, изменилось ли что-то за время сохранения. */
  version: number
  lastSavedAt: number | null
  saving: boolean
  problem: ProjectProblem | null
  warning: string | null
  relink: RelinkRequest | null
  recovery: RecoveryItem[]
}

export interface ProjectActions {
  markDirty: () => void
  /** Проект сохранён. Если за время записи работа ещё менялась (version ушла вперёд), он остаётся «грязным». */
  markSaved: (path: string, name: string, savedAt: number, versionAtSave: number) => void
  /** Проект загружен целиком (открытие или восстановление). */
  setLoaded: (info: {
    path: string | null
    name: string
    dirty: boolean
    meta: ProjectMeta | null
    coverTime: number | null
  }) => void
  /** «Сделать этот кадр обложкой»: проект становится «грязным». */
  setCover: (time: number) => void
  /** Правка описания в окне «Свойства проекта»: имя проекта следует за названием, проект становится «грязным». */
  setMeta: (meta: ProjectMeta) => void
  /** Чистый безымянный проект (новое видео или «Новый проект»). */
  reset: () => void
  setSaving: (saving: boolean) => void
  setProblem: (problem: ProjectProblem | null) => void
  setWarning: (warning: string | null) => void
  setRelink: (request: RelinkRequest | null) => void
  setRecovery: (items: RecoveryItem[]) => void
}

export const useProjectStore = create<ProjectState & ProjectActions>()((set) => ({
  path: null,
  name: UNTITLED_PROJECT,
  meta: null,
  coverTime: null,
  dirty: false,
  version: 0,
  lastSavedAt: null,
  saving: false,
  problem: null,
  warning: null,
  relink: null,
  recovery: [],

  markDirty: () => set((s) => ({ dirty: true, version: s.version + 1 })),
  markSaved: (path, name, savedAt, versionAtSave) =>
    set((s) => ({ path, name, lastSavedAt: savedAt, dirty: s.version !== versionAtSave })),
  setMeta: (meta) => set((s) => ({ meta, name: meta.title, dirty: true, version: s.version + 1 })),
  setCover: (coverTime) => set((s) => ({ coverTime, dirty: true, version: s.version + 1 })),
  setLoaded: ({ path, name, dirty, meta, coverTime }) =>
    set((s) => ({
      path,
      name,
      meta,
      coverTime,
      dirty,
      version: s.version + 1,
      lastSavedAt: null,
      problem: null,
      relink: null
    })),
  reset: () =>
    set((s) => ({
      path: null,
      name: UNTITLED_PROJECT,
      meta: null,
      coverTime: null,
      dirty: false,
      version: s.version + 1,
      lastSavedAt: null,
      warning: null
    })),
  setSaving: (saving) => set({ saving }),
  setProblem: (problem) => set({ problem }),
  setWarning: (warning) => set({ warning }),
  setRelink: (relink) => set({ relink }),
  setRecovery: (recovery) => set({ recovery })
}))
