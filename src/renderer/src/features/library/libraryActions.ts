// Действия стартового экрана: обновить список, открыть карточку, убрать, найти, показать в папке.
import type { LibraryCard } from '../../../../shared/library'
import { ru } from '../../i18n/ru'
import { openProject } from '../project/actions'
import { useLibraryStore } from './libraryStore'

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

const set = useLibraryStore.setState

let sequence = 0

/** Перечитывает список проектов. Устаревший ответ (если запросов было несколько) отбрасывается. */
export async function refreshLibrary(): Promise<void> {
  const mine = ++sequence
  set({ loading: true })
  try {
    const listing = await window.api.listLibrary()
    if (mine !== sequence) return
    set({
      cards: listing.cards,
      folder: listing.folder,
      loaded: true,
      loadedAt: Date.now(),
      loading: false,
      error: null
    })
  } catch (error) {
    if (mine !== sequence) return
    set({ loading: false, loaded: true, error: messageOf(error, ru.start.loadFailed) })
  }
}

export const dismissNotice = (): void => set({ notice: null })

/** Клик по карточке: открывает проект (с обычными вопросами — перепривязка видео, ошибки чтения). */
export async function openCard(card: LibraryCard): Promise<void> {
  set({ notice: null })
  await openProject(card.path)
}

export async function removeCard(card: LibraryCard): Promise<void> {
  try {
    await window.api.removeFromLibrary(card.path)
    set({ notice: ru.start.removed(card.title) })
  } catch (error) {
    set({ notice: messageOf(error, ru.start.removeFailed) })
  }
  await refreshLibrary()
}

/** После подтверждения: файл проекта уходит в Корзину. */
export async function deleteCard(card: LibraryCard): Promise<void> {
  try {
    await window.api.deleteProject(card.path)
    set({ notice: ru.start.deleted(card.title) })
  } catch (error) {
    set({ notice: messageOf(error, ru.start.deleteFailed) })
  }
  await refreshLibrary()
}

export async function revealCard(card: LibraryCard): Promise<void> {
  try {
    await window.api.revealProject(card.path)
  } catch (error) {
    set({ notice: messageOf(error, ru.start.revealFailed) })
  }
}

/** «Найти…» у пропавшего проекта: пользователь указывает новый файл. */
export async function locateCard(card: LibraryCard): Promise<void> {
  try {
    const found = await window.api.relocateProject(card.path)
    if (found) set({ notice: ru.start.located })
  } catch (error) {
    set({ notice: messageOf(error, ru.start.locateFailed) })
  }
  await refreshLibrary()
}
