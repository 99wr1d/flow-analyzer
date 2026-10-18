// Модальное окно: фокус не выходит за его пределы, Esc вызывает onEscape, при закрытии фокус возвращается назад.
import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
  /** Меняется, когда содержимое окна заменилось (другой шаг): фокус снова ставится на [data-autofocus]. */
  refocusKey: unknown = null
): void {
  // При закрытии фокус возвращается туда, где был до открытия.
  useEffect(() => {
    if (!active) return
    const previous = document.activeElement
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus()
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    const root = ref.current
    const target = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root
    target?.focus()
  }, [active, ref, refocusKey])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onEscape()
        return
      }
      if (e.key !== 'Tab') return
      const root = ref.current
      if (!root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      )
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (!root.contains(current)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && current === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, ref, onEscape])
}
