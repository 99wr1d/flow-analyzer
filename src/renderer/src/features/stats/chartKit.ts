// Мелочи для рукописных SVG-диаграмм: шкала, контраст цвета, скруглённый столбец, обрезка подписей.
import { useEffect, useState, type RefObject } from 'react'

/** Поверхность карточки диаграммы (панель окна): с ней сравнивается контраст цветов тегов. */
export const CHART_SURFACE = '#15181e'

/** Целые отметки шкалы 0…max: 3–5 отметок с «круглым» шагом (1, 2, 5, 10, 20, 50…). Верх шкалы ≥ max. */
export function niceTicks(max: number, target = 4): { ticks: number[]; top: number } {
  const safe = Number.isFinite(max) && max > 0 ? Math.ceil(max) : 1
  const raw = safe / target
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const frac = raw / pow
  const base = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  const step = Math.max(1, base * pow)
  const top = Math.ceil(safe / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)
  return { ticks, top }
}

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return 0
  return (
    0.2126 * channel(parseInt(m[1], 16)) +
    0.7152 * channel(parseInt(m[2], 16)) +
    0.0722 * channel(parseInt(m[3], 16))
  )
}

/** Контраст двух цветов #rrggbb по WCAG (1…21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Цвет тега слишком близок к фону (меньше 3:1): такому столбцу нужна тонкая обводка. */
export function needsOutline(color: string, surface: string = CHART_SURFACE): boolean {
  return contrastRatio(color, surface) < 3
}

/** Путь прямоугольника со скруглёнными верхними углами (основание ровное — столбец «растёт» от оси). */
export function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  return [
    `M${x} ${y + h}`,
    `V${y + rr}`,
    `Q${x} ${y} ${x + rr} ${y}`,
    `H${x + w - rr}`,
    `Q${x + w} ${y} ${x + w} ${y + rr}`,
    `V${y + h}`,
    'Z'
  ].join(' ')
}

/** Путь прямоугольника со скруглёнными правыми углами (горизонтальный столбец от левой оси). */
export function rightRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, h / 2, w))
  return [
    `M${x} ${y}`,
    `H${x + w - rr}`,
    `Q${x + w} ${y} ${x + w} ${y + rr}`,
    `V${y + h - rr}`,
    `Q${x + w} ${y + h} ${x + w - rr} ${y + h}`,
    `H${x}`,
    'Z'
  ].join(' ')
}

/** Обрезает подпись по числу знаков, добавляя «…». Полный текст остаётся в title/aria-label. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

/** Ширина элемента в пикселях; обновляется при изменении размера окна. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 600): number {
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (): void => {
      const w = Math.floor(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/** Клавиши для набора элементов с одной точкой входа по Tab: стрелки переходят к соседним, Home/End — к краям. */
export function rovingNext(
  key: string,
  index: number,
  count: number,
  vertical: boolean
): number | null {
  const prev = vertical ? 'ArrowUp' : 'ArrowLeft'
  const next = vertical ? 'ArrowDown' : 'ArrowRight'
  if (key === prev) return Math.max(0, index - 1)
  if (key === next) return Math.min(count - 1, index + 1)
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
