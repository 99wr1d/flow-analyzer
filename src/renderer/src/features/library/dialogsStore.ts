// Окна «Новый проект» и «Свойства проекта». Они открываются и с рабочей области, и со стартового экрана.
import { create } from 'zustand'
import type { LibraryCard } from '../../../../shared/library'
import type { ProjectMeta } from '../../../../shared/project'

export type PropertiesTarget =
  /** Проект, открытый сейчас: правка меняет состояние и делает проект «несохранённым». */
  | { kind: 'workspace' }
  /** Проект из списка (не открыт): правка пишется прямо в его файл. */
  | { kind: 'card'; path: string; meta: ProjectMeta }

interface DialogsState {
  newProject: boolean
  properties: PropertiesTarget | null
  /** Карточка, которую предлагают удалить (ждёт подтверждения). */
  deleting: LibraryCard | null
}

export const useDialogsStore = create<DialogsState>()(() => ({
  newProject: false,
  properties: null,
  deleting: null
}))

export const closeNewProject = (): void => useDialogsStore.setState({ newProject: false })
export const closeProperties = (): void => useDialogsStore.setState({ properties: null })
export const closeDelete = (): void => useDialogsStore.setState({ deleting: null })
