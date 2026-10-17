// Вопрос «Сохранить изменения в проекте?». Ответ приходит промисом, поэтому им удобно пользоваться из любой команды.
import { create } from 'zustand'

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

interface UnsavedState {
  open: boolean
}

let resolver: ((choice: UnsavedChoice) => void) | null = null

export const useUnsavedStore = create<UnsavedState>()(() => ({ open: false }))

/** Показывает вопрос. Если другой вопрос уже открыт, он считается отменённым. */
export function askUnsaved(): Promise<UnsavedChoice> {
  resolver?.('cancel')
  return new Promise((resolve) => {
    resolver = resolve
    useUnsavedStore.setState({ open: true })
  })
}

export function answerUnsaved(choice: UnsavedChoice): void {
  const current = resolver
  resolver = null
  useUnsavedStore.setState({ open: false })
  current?.(choice)
}
