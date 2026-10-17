import { useRef } from 'react'
import { clamp } from './format'
import { seekTo } from './videoElement'
import { usePlayerStore } from '../../store/playerStore'

type PointerHandler = (e: React.PointerEvent<HTMLElement>) => void

function seekFromEvent(e: React.PointerEvent<HTMLElement>): void {
  const duration = usePlayerStore.getState().duration
  const rect = e.currentTarget.getBoundingClientRect()
  if (duration <= 0 || rect.width <= 0) return
  const fraction = clamp((e.clientX - rect.left) / rect.width, 0, 1)
  seekTo(fraction * duration)
}

/** Нажатие и перетаскивание по горизонтальной полосе = перемотка. Возвращает обработчики для элемента. */
export function useSeekPointer(): {
  onPointerDown: PointerHandler
  onPointerMove: PointerHandler
  onPointerUp: PointerHandler
  onPointerCancel: PointerHandler
} {
  const dragging = useRef(false)

  const end: PointerHandler = (e) => {
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return {
    onPointerDown: (e) => {
      if (e.button !== 0 || usePlayerStore.getState().status !== 'ready') return
      dragging.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      seekFromEvent(e)
    },
    onPointerMove: (e) => {
      if (dragging.current) seekFromEvent(e)
    },
    onPointerUp: end,
    onPointerCancel: end
  }
}
