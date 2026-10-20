// Разбиение подборки на «куски чтения»: каждый кусок — отдельный вход ffmpeg с быстрой перемоткой (-ss до -i).
// Раньше подборка читала и декодировала всё видео от первого до последнего эпизода (на 90-минутном матче с эпизодами
// в начале и в конце — полтора часа декодирования ради 3 минут результата). Теперь близкие эпизоды читаются одним куском,
// а далёкие — разными: пропущенное между ними не декодируется. Чистые функции, проверяются юнит-тестами.

export interface Span {
  start: number
  end: number
}

export interface ReadChunk {
  /** Смещение входа (-ss): начало самого раннего эпизода куска. */
  offset: number
  /** Сколько секунд читать от смещения (-t). */
  span: number
  /** Номера эпизодов (в порядке подборки), которые берутся из этого куска. */
  clips: number[]
}

/**
 * Пропуск, который проще продекодировать, чем открыть ещё один вход (перемотка + запуск декодера ≈ 0,2–0,3 с;
 * декодирование 12 секунд видео 1080p25 — примерно столько же).
 */
export const CHUNK_GAP_SECONDS = 12
/**
 * Больше входов за один запуск ffmpeg не открываем: у каждого свой декодер и буферы (память), а при сотнях эпизодов
 * подборка всё равно читает почти всё видео.
 */
export const MAX_READ_CHUNKS = 24

function gapBetween(a: ReadChunk, b: ReadChunk): number {
  return b.offset - (a.offset + a.span)
}

/**
 * Группирует эпизоды (в порядке подборки) в куски чтения. Эпизод попадает в текущий кусок, если пропуск до него
 * не больше maxGap секунд. Если кусков больше maxChunks, самые близкие соседние склеиваются, пока их не останется maxChunks.
 */
export function planReadChunks(
  clips: readonly Span[],
  maxGap: number = CHUNK_GAP_SECONDS,
  maxChunks: number = MAX_READ_CHUNKS
): ReadChunk[] {
  const chunks: ReadChunk[] = []
  clips.forEach((c, index) => {
    const last = chunks[chunks.length - 1]
    if (last && c.start >= last.offset && c.start - (last.offset + last.span) <= maxGap) {
      const end = Math.max(last.offset + last.span, c.end)
      last.span = end - last.offset
      last.clips.push(index)
      return
    }
    chunks.push({ offset: c.start, span: c.end - c.start, clips: [index] })
  })

  while (chunks.length > Math.max(1, maxChunks)) {
    // Склеиваем пару с самым маленьким пропуском (пересечение даёт отрицательный пропуск — склеивается первым).
    let best = 0
    let bestGap = Infinity
    for (let i = 0; i + 1 < chunks.length; i += 1) {
      const gap = gapBetween(chunks[i], chunks[i + 1])
      if (gap < bestGap) {
        bestGap = gap
        best = i
      }
    }
    const a = chunks[best]
    const b = chunks[best + 1]
    const offset = Math.min(a.offset, b.offset)
    const end = Math.max(a.offset + a.span, b.offset + b.span)
    chunks.splice(best, 2, { offset, span: end - offset, clips: [...a.clips, ...b.clips] })
  }
  return chunks
}

/** Сколько секунд видео придётся прочитать и декодировать (для сравнения планов и для отчётов). */
export function decodedSeconds(chunks: readonly ReadChunk[]): number {
  return chunks.reduce((sum, c) => sum + c.span, 0)
}
