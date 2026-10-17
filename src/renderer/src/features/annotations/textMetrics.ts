// Ширина текста в пикселях для заданного размера шрифта: через canvas, а если его нет (тесты) — оценка.
export const TEXT_FONT_FAMILY = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
export const TEXT_FONT_WEIGHT = 700

let ctx: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, number>()

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx
  try {
    ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  } catch {
    ctx = null
  }
  return ctx
}

export function measureTextWidth(text: string, fontPx: number): number {
  const key = `${Math.round(fontPx * 10)}|${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const c = context()
  let width: number
  if (c) {
    c.font = `${TEXT_FONT_WEIGHT} ${fontPx}px ${TEXT_FONT_FAMILY}`
    width = c.measureText(text).width
  } else {
    width = text.length * fontPx * 0.58
  }
  if (cache.size > 500) cache.clear()
  cache.set(key, width)
  return width
}
