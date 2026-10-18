// Подготовка отрезков для экспорта: проверка, запас по краям, обрезка по границам видео. Чистые функции.
import {
  DURATION_TOLERANCE,
  MAX_EXPORT_CLIPS,
  MAX_PADDING,
  MIN_CLIP_SECONDS,
  type ExportClip
} from './export'

export interface PreparedClip {
  /** Порядковый номер в хронологическом порядке (с 1). */
  number: number
  label: string
  /** Границы самого эпизода (для имени файла). */
  episodeStart: number
  /** Границы вырезаемого куска: с запасом и обрезанные по видео. */
  start: number
  end: number
}

export type PrepareResult = { ok: true; clips: PreparedClip[] } | { ok: false; error: string }

export const RANGE_ERRORS = {
  empty: 'Не выбрано ни одного эпизода',
  tooMany: `За один раз можно экспортировать не больше ${MAX_EXPORT_CLIPS} эпизодов`,
  badRange: 'У одного из эпизодов некорректные границы',
  outside: 'Один из эпизодов выходит за пределы видео',
  badPadding: `Запас по краям — от 0 до ${MAX_PADDING} секунд`
} as const

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * Проверяет эпизоды и применяет запас по краям. Результат — в хронологическом порядке.
 * duration = null — длительность видео неизвестна: верхнюю границу проверить нельзя.
 */
export function prepareClips(
  clips: readonly ExportClip[],
  duration: number | null,
  padding: number
): PrepareResult {
  if (clips.length === 0) return { ok: false, error: RANGE_ERRORS.empty }
  if (clips.length > MAX_EXPORT_CLIPS) return { ok: false, error: RANGE_ERRORS.tooMany }
  if (!Number.isFinite(padding) || padding < 0 || padding > MAX_PADDING) {
    return { ok: false, error: RANGE_ERRORS.badPadding }
  }
  const limit = duration !== null && duration > 0 ? duration : Infinity
  for (const c of clips) {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.start >= c.end) {
      return { ok: false, error: RANGE_ERRORS.badRange }
    }
    if (c.end - c.start < MIN_CLIP_SECONDS) return { ok: false, error: RANGE_ERRORS.badRange }
    if (c.start >= limit || c.end > limit + DURATION_TOLERANCE) {
      return { ok: false, error: RANGE_ERRORS.outside }
    }
  }
  const sorted = [...clips].sort((a, b) => a.start - b.start || a.end - b.end)
  return {
    ok: true,
    clips: sorted.map((c, i) => ({
      number: i + 1,
      label: c.label,
      episodeStart: c.start,
      start: round3(Math.max(0, c.start - padding)),
      end: round3(Math.min(limit, c.end + padding))
    }))
  }
}

export function totalDuration(clips: readonly Pick<PreparedClip, 'start' | 'end'>[]): number {
  return clips.reduce((sum, c) => sum + (c.end - c.start), 0)
}
