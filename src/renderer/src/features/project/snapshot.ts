// Снимок работы для сохранения: что именно уходит в файл проекта.
import type { Episode } from '../../../../shared/episodes'
import { MAX_PROJECT_TAGS, type ProjectSaveRequest } from '../../../../shared/project'
import type { TagDef } from '../../../../shared/settings'
import { usePlayerStore } from '../../store/playerStore'
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { useEpisodesStore } from '../episodes/episodesStore'
import { getCurrentTime } from '../player/videoElement'
import { useSettingsStore } from '../settings/settingsStore'

/**
 * Теги для файла: все теги из настроек плюс теги, которые остались только в эпизодах (их удалили из настроек).
 * Для таких тегов берутся имя и цвет из самого эпизода.
 */
export function buildTagSnapshot(
  settingsTags: readonly TagDef[],
  episodes: readonly Episode[]
): TagDef[] {
  const result = new Map<string, TagDef>()
  for (const tag of settingsTags) result.set(tag.id, { ...tag })
  for (const e of episodes) {
    if (!result.has(e.tagId) && /^[A-Za-z0-9_-]{1,40}$/.test(e.tagId)) {
      result.set(e.tagId, {
        id: e.tagId,
        name: e.tagName,
        color: e.tagColor,
        preSeconds: 5,
        postSeconds: 5
      })
    }
  }
  return [...result.values()].slice(0, MAX_PROJECT_TAGS)
}

/** Данные для сохранения. null — видео не загружено, сохранять нечего. */
export function buildSaveRequest(currentPath: string | null): ProjectSaveRequest | null {
  const player = usePlayerStore.getState()
  if (!player.source) return null
  const episodes = useEpisodesStore.getState().items
  const knownFps = player.fpsSource !== 'default'
  return {
    videoId: player.source.id,
    annotations: useAnnotationsStore.getState().items,
    episodes,
    tags: buildTagSnapshot(useSettingsStore.getState().settings.tags, episodes),
    lastTime: Math.max(0, getCurrentTime()),
    ...(knownFps ? { fps: player.fps, fpsSource: player.fpsSource } : {}),
    currentPath
  }
}
