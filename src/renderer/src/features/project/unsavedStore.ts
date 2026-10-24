// Вопрос «Сохранить изменения в проекте?». Ответ приходит промисом, поэтому им удобно пользоваться из любой команды.
import { create } from 'zustand'

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/** document — «Сохранить изменения?»; video — идёт сохранение видео доски, закрытие его остановит. */
export type UnsavedKind = 'document' | 'video'

interface UnsavedState {
  open: boolean
  kind: UnsavedKind
}

let resolver: ((choice: UnsavedChoice) => void) | null = null

export const useUnsavedStore = create<UnsavedState>()(() => ({ open: false, kind: 'document' }))

/** Показывает вопрос. Если другой вопрос уже открыт, он считается отменённым. */
export function askUnsaved(kind: UnsavedKind = 'document'): Promise<UnsavedChoice> {
  resolver?.('cancel')
  return new Promise((resolve) => {
    resolver = resolve
    useUnsavedStore.setState({ open: true, kind })
  })
}

export function answerUnsaved(choice: UnsavedChoice): void {
  const current = resolver
  resolver = null
  useUnsavedStore.setState({ open: false })
  current?.(choice)
}
