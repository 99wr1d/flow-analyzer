// Подсказка к диаграмме: появляется при наведении и при фокусе с клавиатуры, содержимое — обычный React (текст экранируется).
import { useCallback, useState, type ReactNode } from 'react'

interface TipState {
  x: number
  y: number
  content: ReactNode
  /** Не помещается справа от точки — рисуем слева. */
  flip: boolean
}

export interface TipApi {
  /** Колбэк-ref обёртки диаграммы (обёртка должна быть position: relative). */
  setWrap: (el: HTMLDivElement | null) => void
  wrap: HTMLDivElement | null
  /** Показать подсказку: x — левый край (или правый, если не помещается), y — верх; координаты внутри обёртки. */
  showAt: (x: number, y: number, content: ReactNode) => void
  /** Показать у элемента (для фокуса с клавиатуры); top — верх подсказки внутри обёртки. */
  showFor: (el: Element, content: ReactNode, top?: number) => void
  hide: () => void
  node: ReactNode
}

export function useChartTip(): TipApi {
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  const [tip, setTip] = useState<TipState | null>(null)

  const showAt = useCallback(
    (x: number, y: number, content: ReactNode) => {
      setTip({ x, y, content, flip: x > (wrap?.clientWidth ?? 0) - 230 })
    },
    [wrap]
  )
  const showFor = useCallback(
    (el: Element, content: ReactNode, top?: number) => {
      const box = wrap?.getBoundingClientRect()
      if (!box) return
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2 - box.left + 12
      setTip({ x, y: top ?? r.top - box.top - 6, content, flip: x > box.width - 230 })
    },
    [wrap]
  )
  const hide = useCallback(() => setTip(null), [])

  const node = tip ? (
    <div
      className={tip.flip ? 'chart-tip chart-tip--left' : 'chart-tip'}
      style={{ left: tip.x, top: tip.y }}
      role="presentation"
      data-testid="stats-tooltip"
    >
      {tip.content}
    </div>
  ) : null
  return { setWrap, wrap, showAt, showFor, hide, node }
}

/** Позиция указателя внутри обёртки. */
export function pointerIn(
  wrap: HTMLElement | null,
  e: { clientX: number; clientY: number }
): { x: number; y: number } {
  const r = wrap?.getBoundingClientRect()
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}
