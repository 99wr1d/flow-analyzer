// Модель эпизодов (размеченных отрезков видео). Общая для интерфейса, сохранения проекта (этап 8) и экспорта.
// Имя и цвет тега копируются в эпизод, чтобы файл проекта был самодостаточным.
import { z } from 'zod'

export const MIN_EPISODE = 0.2
export const MAX_NOTE = 500

const EPS = 1e-6

export const EpisodeSchema = z
  .object({
    id: z.uuid(),
    tagId: z.string().min(1).max(64),
    tagName: z.string().trim().min(1).max(40),
    tagColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    start: z.number().min(0),
    end: z.number().min(0),
    note: z.string().max(MAX_NOTE).optional()
  })
  .refine((e) => e.end - e.start >= MIN_EPISODE - EPS, {
    message: 'Эпизод короче 0.2 с',
    path: ['end']
  })
export const EpisodeListSchema = z.array(EpisodeSchema)

export type Episode = z.infer<typeof EpisodeSchema>
export interface Range {
  start: number
  end: number
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** Приводит отрезок к границам видео и минимальной длине. null — видео слишком короткое для эпизода. */
export function normalizeRange(start: number, end: number, duration: number): Range | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(duration >= MIN_EPISODE)) return null
  let s = clamp(Math.min(start, end), 0, duration)
  let e = clamp(Math.max(start, end), 0, duration)
  if (e - s < MIN_EPISODE - EPS) {
    // Расширяем в сторону конца видео, а если упёрлись — в сторону начала.
    e = Math.min(duration, s + MIN_EPISODE)
    s = Math.max(0, e - MIN_EPISODE)
  }
  return { start: round3(s), end: round3(e) }
}

/** Быстрый тег: [t − до, t + после], обрезанный по границам видео. */
export function quickRange(
  time: number,
  pre: number,
  post: number,
  duration: number
): Range | null {
  return normalizeRange(time - pre, time + post, duration)
}

export type MarksResult =
  { ok: true; range: Range } | { ok: false; error: 'order' | 'short' | 'duration' }

/** Точный тег по меткам Начало/Конец. Конец должен быть позже начала. */
export function marksRange(inPoint: number, outPoint: number, duration: number): MarksResult {
  if (!(outPoint > inPoint)) return { ok: false, error: 'order' }
  if (outPoint - inPoint < MIN_EPISODE - EPS) return { ok: false, error: 'short' }
  const range = normalizeRange(inPoint, outPoint, duration)
  return range ? { ok: true, range } : { ok: false, error: 'duration' }
}

export function episodeDuration(e: Pick<Episode, 'start' | 'end'>): number {
  return e.end - e.start
}

/** Новое начало/конец для правки эпизода. Ошибка, если отрезок получается короче минимума. */
export function editRange(
  episode: Pick<Episode, 'start' | 'end'>,
  patch: Partial<Range>,
  duration: number
): { ok: true; range: Range } | { ok: false; error: 'short' } {
  const start = clamp(patch.start ?? episode.start, 0, duration)
  const end = clamp(patch.end ?? episode.end, 0, duration)
  if (end - start < MIN_EPISODE - EPS) return { ok: false, error: 'short' }
  return { ok: true, range: { start: round3(start), end: round3(end) } }
}
