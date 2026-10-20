// Ход параллельного экспорта: общий прогресс из хода нескольких процессов ffmpeg (куски видео, звук, склейка).
// Чистая логика — проверяется юнит-тестами.

export interface ProgressTracker {
  /** Сколько секунд результата кусок уже записал (при повторе кусок начинается заново — передайте 0). */
  setChunk(index: number, seconds: number): void
  /** Кусок готов целиком. */
  doneChunk(index: number): void
  /** Доля работы над звуком / над склейкой, 0..1. */
  setAudio(fraction: number): void
  doneAudio(): void
  setMux(fraction: number): void
  doneMux(): void
  /** Общая доля 0..1. Никогда не убывает: повтор куска или откат на процессор не откатывает полосу назад. */
  fraction(): number
}

export interface ProgressWeights {
  /** Секунды результата по кускам (по номеру куска — как в setChunk). */
  chunks: readonly number[]
  /** Условная длина работы над звуком и над склейкой (в тех же секундах). 0 — этой работы нет. */
  audio: number
  mux: number
}

/** Звук и склейка — малая часть работы: по умолчанию по 3 % от длины результата. */
export function defaultWeights(
  chunkSeconds: readonly number[],
  hasAudio: boolean
): ProgressWeights {
  const total = chunkSeconds.reduce((a, b) => a + b, 0)
  return { chunks: chunkSeconds, audio: hasAudio ? total * 0.03 : 0, mux: total * 0.03 }
}

export function createProgressTracker(weights: ProgressWeights): ProgressTracker {
  const done = weights.chunks.map(() => 0)
  let audio = 0
  let mux = 0
  let best = 0
  const total = weights.chunks.reduce((a, b) => a + b, 0) + weights.audio + weights.mux
  const clamp = (value: number, max: number): number => Math.min(Math.max(0, value), max)
  return {
    setChunk(index, seconds) {
      if (index >= 0 && index < done.length) done[index] = clamp(seconds, weights.chunks[index])
    },
    doneChunk(index) {
      if (index >= 0 && index < done.length) done[index] = weights.chunks[index]
    },
    setAudio(fraction) {
      audio = clamp(fraction, 1) * weights.audio
    },
    doneAudio() {
      audio = weights.audio
    },
    setMux(fraction) {
      mux = clamp(fraction, 1) * weights.mux
    },
    doneMux() {
      mux = weights.mux
    },
    fraction() {
      if (total <= 0) return 0
      const value = (done.reduce((a, b) => a + b, 0) + audio + mux) / total
      best = Math.max(best, Math.min(1, value))
      return best
    }
  }
}
