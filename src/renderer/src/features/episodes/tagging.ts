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
    end
  }
  useEpisodesStore.getState().add(episode)
  const feedback = useFeedbackStore.getState()
  feedback.flashTag(tag.id)
  feedback.show({
    text: `Эпизод «${tag.name}» ${fmtRange(start, end)}`,
    kind: 'info',
    color: tag.color
  })
}
