import { useEffect } from 'react'
import { usePlayerStore } from '../../store/playerStore'
import { useAnnotationsStore, type Tool } from './annotationsStore'

/** Клавиши по физическому положению (e.code): работают и в русской раскладке. */
const TOOL_KEYS: Record<string, Tool> = {
  KeyV: 'select',
  KeyA: 'arrow',
  KeyL: 'line',
  KeyC: 'circle',
  KeyT: 'text'
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && target.type !== 'range'
}

/** V A L C T — инструменты, Esc — «Выбор»/снять выделение, Delete — удалить, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. */
export function useAnnotationShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing || isTyping(e.target)) return
      if (usePlayerStore.getState().status !== 'ready') return
      const store = useAnnotationsStore.getState()

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) {
          e.preventDefault()
          store.undo()
        } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
          e.preventDefault()
          store.redo()
        }
        return
      }
      if (e.altKey || e.shiftKey) return

      const tool = TOOL_KEYS[e.code]
      if (tool) {
        if (e.repeat) return
        e.preventDefault()
        store.setTool(tool)
        return
      }
      if (e.code === 'Escape') {
        if (store.tool !== 'select') store.setTool('select')
        else store.select(null)
        return
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && store.selectedId) {
        e.preventDefault()
        store.remove(store.selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
