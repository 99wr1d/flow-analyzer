// Адаптивные деления временной линейки.

const STEPS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200
]

/** Минимальное расстояние между подписями, px. */
export const MIN_LABEL_SPACING = 84

export interface Ticks {
  /** Шаг больших делений с подписью, сек. */
  step: number
  /** Времена больших делений. */
  major: number[]
  /** Времена малых делений (между большими). */
  minor: number[]
}

export function computeTicks(duration: number, widthPx: number): Ticks {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(widthPx) || widthPx <= 0) {
    return { step: 1, major: [], minor: [] }
  }
  const pxPerSecond = widthPx / duration
  const step = STEPS.find((s) => s * pxPerSecond >= MIN_LABEL_SPACING) ?? STEPS[STEPS.length - 1]
  const subdivisions = step === 15 || step === 30 || step === 1800 ? 3 : step === 0.2 ? 2 : 5
  const minorStep = step / subdivisions

  const major: number[] = []
  const minor: number[] = []
  const count = Math.floor(duration / minorStep + 1e-9)
  for (let i = 0; i <= count; i++) {
    const t = Math.round(i * minorStep * 1000) / 1000
    if (t > duration) break
    if (i % subdivisions === 0) major.push(t)
    else minor.push(t)
  }
  return { step, major, minor }
}
