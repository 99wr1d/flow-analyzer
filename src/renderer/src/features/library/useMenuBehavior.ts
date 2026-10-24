import { useEffect } from 'react'

/** Поведение выпадающего меню карточки: фокус на первый пункт, закрытие по клику снаружи и Esc, стрелки. */
export function useMenuBehavior(
  ref: React.RefObject<HTMLDivElement | null>,
  onClose: (returnFocus: boolean) => void
): void {
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const onPointerDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose(true)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
      )
      if (items.length === 0) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'ArrowDown' ? index + 1 : index - 1
      items[(next + items.length) % items.length].focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [ref, onClose])
}
