// Выбор эпизодов для экспорта, проверка запаса по краям, подсчёт итогов и оставшегося времени. Чистые функции.
import { MAX_PADDING } from '../../../../shared/export'
import { prepareClips, totalDuration } from '../../../../shared/exportRanges'
import type { Episode } from '../../../../shared/episodes'

/** Какие эпизоды экспортировать: видимые по фильтру, все или отмеченные вручную. */
export type Scope = 'visible' | 'all' | 'pick'

/** Эпизоды, которые сейчас видны в списке (по порядку начала). */
export function visibleEpisodes(sorted: readonly Episode[], filter: readonly string[]): Episode[] {
  return filter.length === 0 ? [...sorted] : sorted.filter((e) => filter.includes(e.tagId))
}

export function chooseEpisodes(
  scope: Scope,
  sorted: readonly Episode[],
  filter: readonly string[],
  picked: ReadonlySet<string>
): Episode[] {
  if (scope === 'all') return [...sorted]
  if (scope === 'visible') return visibleEpisodes(sorted, filter)
  return sorted.filter((e) => picked.has(e.id))
}

export const PADDING_ERROR = `Введите число секунд от 0 до ${MAX_PADDING}, например 1.5`

export type PaddingParse = { ok: true; value: number } | { ok: false; error: string }

/** Запас по краям из текста поля. Принимает и точку, и запятую. */
export function parsePadding(text: string): PaddingParse {
  const clean = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(clean)) return { ok: false, error: PADDING_ERROR }
  const value = Number(clean)
  if (!Number.isFinite(value) || value < 0 || value > MAX_PADDING) {
    return { ok: false, error: PADDING_ERROR }
  }
  return { ok: true, value }
}

export interface Summary {
  count: number
  /** Суммарная длительность клипов с учётом запаса (секунды). */
  seconds: number
}

export function summarize(
  episodes: readonly Episode[],
  padding: number,
  videoDuration: number
): Summary {
  const clips = episodes.map((e) => ({ start: e.start, end: e.end, label: e.tagName }))
  const prepared = prepareClips(clips, videoDuration > 0 ? videoDuration : null, padding)
  const seconds = prepared.ok
    ? totalDuration(prepared.clips)
    : clips.reduce((sum, c) => sum + (c.end - c.start), 0)
  return { count: episodes.length, seconds }
}

/** «0:45», «12:03», «1:02:03». */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Сколько ещё ждать, мс. null — слишком рано судить (мало сделано или прошло мало времени). */
export function estimateRemainingMs(elapsedMs: number, fraction: number): number | null {
  if (!(fraction >= 0.03) || fraction >= 1 || elapsedMs < 1500) return null
  return (elapsedMs * (1 - fraction)) / fraction
}

/** «меньше минуты», «около 3 мин», «около 1 ч 05 мин». */
export function formatRemaining(ms: number): string {
  const minutes = Math.ceil(ms / 60000)
  if (minutes <= 1) return 'меньше минуты'
  if (minutes < 60) return `около ${minutes} мин`
  return `около ${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, '0')} мин`
}

/** «5 файлов» с правильным склонением. */
export function pluralFiles(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} файл`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} файла`
  return `${n} файлов`
}

/** «из 1 эпизода», «из 2 эпизодов» (родительный падеж: после «из»). */
export function episodesGenitive(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? `${n} эпизода` : `${n} эпизодов`
}
