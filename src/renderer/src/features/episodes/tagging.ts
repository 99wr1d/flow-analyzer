// Действия разметки: быстрый и точный тег, метки Начало/Конец. Вызываются и клавишами, и кнопками.
import { marksRange, quickRange, type Episode } from '../../../../shared/episodes'
import type { TagDef } from '../../../../shared/settings'
import { usePlayerStore } from '../../store/playerStore'
import { formatTime } from '../player/format'
import { getCurrentTime } from '../player/videoElement'
import { useSettingsStore } from '../settings/settingsStore'
import { useEpisodesStore } from './episodesStore'
import { useFeedbackStore } from './feedbackStore'

export const fmt = (t: number): string => formatTime(t, { tenths: true })
export const fmtRange = (start: number, end: number): string => `${fmt(start)}–${fmt(end)}`

const isReady = (): boolean => usePlayerStore.getState().status === 'ready'

function warn(text: string): void {
  useFeedbackStore.getState().show({ text, kind: 'warn' })
}

/** Ставит метку «Начало» на текущее время. */
export function markIn(): void {
  if (!isReady()) return
  useEpisodesStore.getState().setIn(getCurrentTime())
}

/** Ставит метку «Конец» на текущее время. */
export function markOut(): void {
  if (!isReady()) return
  useEpisodesStore.getState().setOut(getCurrentTime())
}

export function clearMarks(): void {
  useEpisodesStore.getState().clearMarks()
}

/**
 * Создаёт эпизод для тега. Если стоят обе метки (Начало < Конец) — ровно по ним и метки сбрасываются;
 * иначе — [t − до, t + после] около текущего момента. Воспроизведение не останавливается.
 */
export function applyTag(tagId: string): void {
  if (!isReady()) return
  const tag = useSettingsStore.getState().settings.tags.find((t) => t.id === tagId)
  if (!tag) return
  const { duration } = usePlayerStore.getState()
  const episodes = useEpisodesStore.getState()

  let range
  let precise = false
  if (episodes.inPoint !== null && episodes.outPoint !== null) {
    const result = marksRange(episodes.inPoint, episodes.outPoint, duration)
    if (!result.ok) {
      warn(
        result.error === 'short'
          ? 'Отрезок между метками короче 0.2 с — эпизод не создан'
          : 'Конец раньше начала — эпизод не создан. Поправьте метки (I и O)'
      )
      return
    }
    range = result.range
    precise = true
  } else {
    range = quickRange(getCurrentTime(), tag.preSeconds, tag.postSeconds, duration)
  }
  if (!range) {
    warn('Видео слишком короткое для эпизода')
    return
  }
  createEpisode(tag, range.start, range.end)
  if (precise) episodes.clearMarks()
}

function createEpisode(tag: TagDef, start: number, end: number): void {
  const episode: Episode = {
    id: crypto.randomUUID(),
    tagId: tag.id,
    tagName: tag.name,
    tagColor: tag.color,
    start,
    end,
    rating: null,
    review: false
  }
  useEpisodesStore.getState().add(episode)
  const feedback = useFeedbackStore.getState()
  feedback.flashTag(tag.id)
  feedback.show({
    text: `Эпизод «${tag.name}» ${fmtRange(start, end)}`,
    kind: 'info',
    color: tag.color,
    episodeId: episode.id
  })
}

export type RateKind = 'good' | 'bad' | 'review'

/** Эпизод для горячих клавиш оценки: выбранный, иначе созданный последним. */
export function rateTarget(): Episode | null {
  const { items, selectedId } = useEpisodesStore.getState()
  return items.find((e) => e.id === selectedId) ?? items[items.length - 1] ?? null
}

/** Оценка эпизода с подтверждением в подсказке. Возвращает false, если оценивать нечего. */
export function rateEpisode(id: string, kind: RateKind): boolean {
  const store = useEpisodesStore.getState()
  if (!store.items.some((e) => e.id === id)) return false
  if (kind === 'review') store.toggleReview(id)
  else store.toggleRating(id, kind)
  const episode = useEpisodesStore.getState().items.find((e) => e.id === id)
  if (!episode) return false
  const text =
    kind === 'review'
      ? episode.review
        ? 'Отмечено «разобрать»'
        : 'Отметка «разобрать» снята'
      : episode.rating
        ? episode.rating === 'good'
          ? 'Оценка: хорошо'
          : 'Оценка: плохо'
        : 'Оценка снята'
  useFeedbackStore.getState().show({
    text: `${text} · «${episode.tagName}» ${fmtRange(episode.start, episode.end)}`,
    kind: 'info',
    color: episode.tagColor,
    episodeId: id
  })
  return true
}

/** Горячая клавиша оценки: применяется к выбранному эпизоду, иначе к последнему созданному. */
export function rateCurrent(kind: RateKind): void {
  const target = rateTarget()
  if (!target) {
    warn('Нет эпизода для оценки — сначала отметьте эпизод тегом')
    return
  }
  rateEpisode(target.id, kind)
}
