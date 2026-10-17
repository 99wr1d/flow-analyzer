// Доступные скорости воспроизведения и переключение «медленнее / быстрее».

export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.5, 2] as const

export function formatRate(rate: number): string {
  return `${rate}×`
}

/** Следующая скорость из списка: direction -1 — медленнее, +1 — быстрее. На краях остаётся на месте. */
export function stepRate(current: number, direction: -1 | 1): number {
  const rates: readonly number[] = PLAYBACK_RATES
  if (direction > 0) {
    return rates.find((r) => r > current + 1e-9) ?? rates[rates.length - 1]
  }
  const lower = rates.filter((r) => r < current - 1e-9)
  return lower.length > 0 ? lower[lower.length - 1] : rates[0]
}
