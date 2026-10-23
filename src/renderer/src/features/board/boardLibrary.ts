// Список досок на начальном экране: загрузка, открытие карточки, удаление, «Показать в папке».
import { create } from 'zustand'
import type { BoardCard } from '../../../../shared/board/ipc'
import { ru } from '../../i18n/ru'
import { useLibraryStore } from '../library/libraryStore'
import { loadBoardFromFile } from './boardActions'

interface BoardLibraryState {
  cards: BoardCard[]
  loaded: boolean
  /** Когда список получен (для подписей «2 ч назад»). */
  loadedAt: number
  /** Карточка, которую предлагают удалить (ждёт подтверждения). */
  deleting: BoardCard | null
}

export const useBoardLibrary = create<BoardLibraryState>()(() => ({
  cards: [],
  loaded: false,
  loadedAt: 0,
  deleting: null
}))

const notice = (text: string): void => useLibraryStore.setState({ notice: text })

let sequence = 0

export async function refreshBoards(): Promise<void> {
  const mine = ++sequence
  try {
    const cards = await window.api.listBoards()
    if (mine !== sequence) return
    useBoardLibrary.setState({ cards, loaded: true, loadedAt: Date.now() })
  } catch {
    // Доски — дополнение к проектам: если список не получился, раздел просто не показывается.
    if (mine === sequence) useBoardLibrary.setState({ cards: [], loaded: true })
  }
}

export async function openBoardCard(card: BoardCard): Promise<void> {
  const error = await loadBoardFromFile(card.path)
  if (error) notice(`${ru.board.openFailed}: ${error}`)
}

export async function revealBoardCard(card: BoardCard): Promise<void> {
  try {
    await window.api.revealBoard(card.path)
  } catch {
    notice(ru.board.revealFailed)
  }
}

export const askDeleteBoard = (card: BoardCard): void =>
  useBoardLibrary.setState({ deleting: card })
export const closeBoardDelete = (): void => useBoardLibrary.setState({ deleting: null })

/** После подтверждения: файл доски уходит в Корзину. */
export async function deleteBoardCard(card: BoardCard): Promise<void> {
  try {
    await window.api.deleteBoard(card.path)
    notice(ru.board.deleted(card.title))
  } catch {
    notice(ru.board.deleteFailed)
  }
  await refreshBoards()
}
