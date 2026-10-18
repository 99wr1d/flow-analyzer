// Статистика по эпизодам: чистые функции без интерфейса и Electron. Используются окном «Статистика» и тестами.
import type { Episode } from './episodes'

/** Что нужно от эпизода для статистики (id и заметка не нужны). */
export type StatsEpisode = Pick<Episode, 'tagId' | 'tagName' | 'tagColor' | 'start' | 'end'> &
  Partial<Pick<Episode, 'rating' | 'review'>>

/** Доля хороших среди оценённых (хорошо / (хорошо + плохо)), %. null — оценённых эпизодов нет. */
export function goodPercent(good: number, bad: number): number | null {
  return good + bad > 0 ? (good / (good + bad)) * 100 : null
}

/** Тег из настроек: если он ещё существует, его имя и цвет главнее снимка в эпизодах. */
export interface StatsTagInfo {
  id: string
  name: string
  color: string
}

export interface TagStat {
  tagId: string
  name: string
  color: string
  count: number
  /** Сумма длительностей эпизодов тега, с (после обрезки по границам видео). */
  total: number
  /** Средняя длительность, с (0, если эпизодов нет). */
  avg: number
  /** Доля от числа эпизодов, % (0–100). */
  shareCount: number
  /** Доля от суммы времени всех тегов, % (0–100). Сумма по тегам даёт 100. */
  shareTime: number
  /** Начало первого и последнего по времени эпизода тега, с. */
  first: number
  last: number
  /** Оценки: сколько эпизодов хороших, плохих и помеченных «разобрать». */
  good: number
  bad: number
  review: number
  /** % хороших среди оценённых; null — оценок нет. */
  goodPercent: number | null
}

export interface OverallStats {
  episodes: number
  /** Время, покрытое эпизодами: пересечения считаются один раз (объединение отрезков), с. */
  taggedTime: number
  /** taggedTime в процентах от длительности видео (0, если длительность неизвестна). */
  taggedPercent: number
  /** Простая сумма длительностей всех эпизодов (пересечения считаются дважды), с. */
  sumTime: number
  tags: number
  /** Средняя длительность эпизода, с. */
  avg: number
  /** Длительность видео, с. */
  videoDuration: number
  good: number
  bad: number
  review: number
  goodPercent: number | null
}

export interface TimeBin {
  index: number
  start: number
  end: number
  /** Сколько эпизодов началось в этом отрезке (по тегам и всего). */
  counts: Record<string, number>
  total: number
}

export interface TimeDistribution {
  /** Размер отрезка, с. */
  size: number
  bins: TimeBin[]
  /** Наибольшее число эпизодов в одном отрезке. */
  max: number
}

export interface Stats {
  /** Теги, по убыванию числа эпизодов (при равенстве — по имени). Этот же порядок и цвет используют диаграммы. */
  tags: TagStat[]
  overall: OverallStats
  distribution: TimeDistribution
}

export type BinChoice = 'auto' | 60 | 300 | 600 | 900
export const BIN_CHOICES: readonly BinChoice[] = ['auto', 60, 300, 600, 900]

/** Размер отрезка по умолчанию — 5 минут. */
export const DEFAULT_BIN_SECONDS = 300
export const MIN_AUTO_BINS = 4
/** «Круглые» размеры отрезков для автоподбора, от большего к меньшему (с). */
const AUTO_SIZES = [300, 120, 60, 30, 15, 10, 5, 2, 1] as const

/**
 * Автоподбор размера отрезка: самый крупный «круглый» размер не больше 5 минут, при котором выходит
 * не меньше четырёх отрезков; но не меньше 1 секунды. Видео от 20 минут получает 5-минутные отрезки,
 * 10-минутное — 2-минутные (5 отрезков), 4-секундное — секундные (4 отрезка).
 */
export function autoBinSeconds(duration: number): number {
  if (!(duration > 0)) return DEFAULT_BIN_SECONDS
  for (const size of AUTO_SIZES) {
    if (Math.ceil(duration / size - 1e-9) >= MIN_AUTO_BINS) return size
  }
  return 1
}

export function resolveBinSeconds(choice: BinChoice, duration: number): number {
  return choice === 'auto' ? autoBinSeconds(duration) : choice
}

const EPS = 1e-9

interface Clamped {
  start: number
  end: number
}

/** Обрезает отрезок по границам видео. Если длительность неизвестна (≤ 0), обрезается только по нулю. */
function clampRange(e: StatsEpisode, duration: number): Clamped {
  const hi = duration > 0 ? duration : Number.POSITIVE_INFINITY
  const start = Math.min(hi, Math.max(0, Number.isFinite(e.start) ? e.start : 0))
  const end = Math.min(hi, Math.max(start, Number.isFinite(e.end) ? e.end : start))
  return { start, end }
}

/** Длина объединения отрезков (пересечения считаются один раз). */
export function unionLength(ranges: readonly Clamped[]): number {
  if (ranges.length === 0) return 0
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  let total = 0
  let curStart = sorted[0].start
  let curEnd = sorted[0].end
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i]
    if (r.start <= curEnd) {
      if (r.end > curEnd) curEnd = r.end
    } else {
      total += curEnd - curStart
      curStart = r.start
      curEnd = r.end
    }
  }
  return total + (curEnd - curStart)
}

interface TagAcc {
  tagId: string
  name: string
  color: string
  count: number
  total: number
  first: number
  last: number
  good: number
  bad: number
  review: number
}

export interface StatsOptions {
  /** Теги из настроек (для актуальных имён и цветов). */
  knownTags?: readonly StatsTagInfo[]
  bin?: BinChoice
}

/** Считает всю статистику. episodes — в порядке создания (последний снимок имени тега считается самым свежим). */
export function computeStats(
  episodes: readonly StatsEpisode[],
  videoDuration: number,
  options: StatsOptions = {}
): Stats {
  const duration = videoDuration > 0 && Number.isFinite(videoDuration) ? videoDuration : 0
  const known = new Map((options.knownTags ?? []).map((t) => [t.id, t]))
  const acc = new Map<string, TagAcc>()
  const ranges: Clamped[] = new Array<Clamped>(episodes.length)
  let sumTime = 0

  for (let i = 0; i < episodes.length; i++) {
    const e = episodes[i]
    const r = clampRange(e, duration)
    ranges[i] = r
    const len = r.end - r.start
    sumTime += len
    let t = acc.get(e.tagId)
    if (!t) {
      t = {
        tagId: e.tagId,
        name: e.tagName,
        color: e.tagColor,
        count: 0,
        total: 0,
        first: r.start,
        last: r.start,
        good: 0,
        bad: 0,
        review: 0
      }
      acc.set(e.tagId, t)
    } else {
      // Самый свежий снимок — последний по порядку.
      t.name = e.tagName
      t.color = e.tagColor
    }
    t.count += 1
    if (e.rating === 'good') t.good += 1
    else if (e.rating === 'bad') t.bad += 1
    if (e.review) t.review += 1
    t.total += len
    if (r.start < t.first) t.first = r.start
    if (r.start > t.last) t.last = r.start
  }

  const n = episodes.length
  const tags: TagStat[] = [...acc.values()].map((t) => {
    const k = known.get(t.tagId)
    return {
      tagId: t.tagId,
      name: k ? k.name : t.name,
      color: k ? k.color : t.color,
      count: t.count,
      total: t.total,
      avg: t.count > 0 ? t.total / t.count : 0,
      shareCount: n > 0 ? (t.count / n) * 100 : 0,
      shareTime: sumTime > EPS ? (t.total / sumTime) * 100 : 0,
      first: t.first,
      last: t.last,
      good: t.good,
      bad: t.bad,
      review: t.review,
      goodPercent: goodPercent(t.good, t.bad)
    }
  })
  tags.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))

  const taggedTime = unionLength(ranges)
  const overall: OverallStats = {
    episodes: n,
    taggedTime,
    taggedPercent: duration > 0 ? Math.min(100, (taggedTime / duration) * 100) : 0,
    sumTime,
    tags: tags.length,
    avg: n > 0 ? sumTime / n : 0,
    videoDuration: duration,
    good: tags.reduce((sum, t) => sum + t.good, 0),
    bad: tags.reduce((sum, t) => sum + t.bad, 0),
    review: tags.reduce((sum, t) => sum + t.review, 0),
    goodPercent: goodPercent(
      tags.reduce((sum, t) => sum + t.good, 0),
      tags.reduce((sum, t) => sum + t.bad, 0)
    )
  }

  const size = resolveBinSeconds(options.bin ?? 'auto', duration)
  const distribution = distribute(episodes, ranges, duration, size)
  return { tags, overall, distribution }
}

/** Эпизод попадает в отрезок, где лежит его начало (после обрезки по видео). */
function distribute(
  episodes: readonly StatsEpisode[],
  ranges: readonly Clamped[],
  duration: number,
  size: number
): TimeDistribution {
  // Без известной длительности отрезки строим по самому позднему началу.
  let span = duration
  if (!(span > 0)) for (const r of ranges) span = Math.max(span, r.start)
  const count = Math.max(1, Math.ceil(span / size - EPS))
  const bins: TimeBin[] = Array.from({ length: count }, (_, index) => ({
    index,
    start: index * size,
    end: Math.min(span > 0 ? span : size, (index + 1) * size),
    counts: {},
    total: 0
  }))
  for (let i = 0; i < episodes.length; i++) {
    const idx = Math.min(count - 1, Math.max(0, Math.floor(ranges[i].start / size + EPS)))
    const b = bins[idx]
    b.counts[episodes[i].tagId] = (b.counts[episodes[i].tagId] ?? 0) + 1
    b.total += 1
  }
  let max = 0
  for (const b of bins) if (b.total > max) max = b.total
  return { size, bins, max }
}

/** Эпизоды, у которых тег входит в фильтр (пустой фильтр — все). */
export function filterByTags<T extends Pick<StatsEpisode, 'tagId'>>(
  episodes: readonly T[],
  filter: readonly string[]
): T[] {
  if (filter.length === 0) return [...episodes]
  const set = new Set(filter)
  return episodes.filter((e) => set.has(e.tagId))
}
