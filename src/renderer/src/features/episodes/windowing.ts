// Окно прокрутки для длинных списков: какие строки показывать, а остальные заменять пустым местом.
// Чистые функции без React — проверяются юнит-тестами.

/** Короткие списки показываются целиком (так проще и привычнее); окно включается, когда строк больше. */
export const VIRTUAL_THRESHOLD = 100
/** Сколько строк запаса держать выше и ниже видимой области. */
export const OVERSCAN_ROWS = 8

/** Накопленные высоты: offsets[i] — верх строки i, offsets[n] — общая высота. */
export function buildOffsets(heights: readonly number[]): Float64Array {
  const offsets = new Float64Array(heights.length + 1)
  for (let i = 0; i < heights.length; i += 1) offsets[i + 1] = offsets[i] + heights[i]
  return offsets
}

/** Номер строки, внутри которой лежит координата y (двоичный поиск). Для y за пределами — крайняя строка. */
export function indexAt(offsets: Float64Array, y: number): number {
  const count = offsets.length - 1
  if (count <= 0) return 0
  if (y <= 0) return 0
  if (y >= offsets[count]) return count - 1
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface WindowRange {
  /** Первая показываемая строка. */
  start: number
  /** Следующая за последней показываемой (полуинтервал). */
  end: number
  /** Высота пустого места над показанными строками. */
  before: number
  /** Высота пустого места под показанными строками. */
  after: number
}

/** Строки, которые попадают в видимую область [scrollTop, scrollTop + viewport] плюс запас. */
export function windowRange(
  offsets: Float64Array,
  scrollTop: number,
  viewport: number,
  overscan: number = OVERSCAN_ROWS
): WindowRange {
  const count = offsets.length - 1
  if (count <= 0) return { start: 0, end: 0, before: 0, after: 0 }
  const first = indexAt(offsets, scrollTop)
  const last = indexAt(offsets, scrollTop + Math.max(0, viewport))
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, last + 1 + overscan)
  return { start, end, before: offsets[start], after: offsets[count] - offsets[end] }
}

/**
 * Куда прокрутить, чтобы строка index стала видна: null — она уже видна целиком (или не помещается и частично видна).
 * Прокручиваем минимально: к верхнему или нижнему краю.
 */
export function scrollToReveal(
  offsets: Float64Array,
  index: number,
  scrollTop: number,
  viewport: number
): number | null {
  if (index < 0 || index >= offsets.length - 1) return null
  const top = offsets[index]
  const bottom = offsets[index + 1]
  let target: number | null = null
  if (top < scrollTop) target = top
  else if (bottom > scrollTop + viewport) target = Math.max(0, Math.min(top, bottom - viewport))
  return target === scrollTop ? null : target
}
