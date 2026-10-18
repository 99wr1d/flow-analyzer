// Действия окна «Статистика»: открыть, закрыть, перейти по тегу или отрезку, выгрузить CSV.
import { UNTITLED_PROJECT } from '../../../../shared/project'
import { usePlayerStore } from '../../store/playerStore'
import { useEpisodesStore } from '../episodes/episodesStore'
import { seekTo } from '../player/videoElement'
import { useProjectStore } from '../project/projectStore'
import { useSettingsStore } from '../settings/settingsStore'
import { buildExportPayload, deriveStats } from './statsData'
import { DEFAULT_SORT, useStatsStore } from './statsStore'

const UNKNOWN_ERROR = 'Не удалось сохранить файл'
const set = useStatsStore.setState
const get = useStatsStore.getState

/** Статистика доступна, когда видео открыто (эпизодов может не быть — окно честно скажет об этом). */
export function canOpenStats(): boolean {
  return usePlayerStore.getState().status === 'ready'
}

export function openStats(): void {
  if (get().open || !canOpenStats()) return
  set({ open: true, bin: 'auto', respectFilter: false, sort: DEFAULT_SORT, save: { kind: 'idle' } })
}

export function closeStats(): void {
  if (get().open) set({ open: false })
}

/** Клик по тегу: он становится фильтром списка эпизодов, окно закрывается. */
export function showTagEpisodes(tagId: string): void {
  useEpisodesStore.getState().setFilter([tagId])
  closeStats()
}

/** Клик по столбцу: видео встаёт на начало отрезка, окно закрывается. */
export function seekToBin(start: number): void {
  seekTo(start)
  closeStats()
}

function currentData(): ReturnType<typeof deriveStats> {
  const episodes = useEpisodesStore.getState()
  const stats = get()
  return deriveStats({
    items: episodes.items,
    filter: episodes.filter,
    ratingFilter: episodes.ratingFilter,
    respectFilter: stats.respectFilter,
    duration: usePlayerStore.getState().duration,
    tags: useSettingsStore.getState().settings.tags,
    bin: stats.bin
  })
}

let exporting = false

/** «Выгрузить CSV»: данные уходят в main, он спрашивает место, проверяет данные и пишет файл. */
export async function exportStatsCsv(): Promise<void> {
  if (exporting) return
  const { episodes, stats } = currentData()
  if (episodes.length === 0) return
  const player = usePlayerStore.getState()
  const project = useProjectStore.getState()
  const saved = project.path !== null && project.name !== UNTITLED_PROJECT
  const stem = saved ? project.name : (player.source?.fileName.replace(/\.[^.]+$/, '') ?? null)
  const payload = buildExportPayload(stats, episodes, {
    fileStem: stem,
    videoId: player.source?.id ?? null,
    duration: player.duration
  })
  exporting = true
  set({ save: { kind: 'saving' } })
  try {
    const result = await window.api.exportStatsCsv(payload)
    set({
      save:
        result.status === 'saved' ? { kind: 'saved', fileName: result.fileName } : { kind: 'idle' }
    })
  } catch (error) {
    const text = error instanceof Error ? error.message : ''
    set({ save: { kind: 'error', message: /[А-Яа-я]/.test(text) ? text : UNKNOWN_ERROR } })
  } finally {
    exporting = false
  }
}

export function revealStatsFile(): void {
  window.api.revealStatsFile().catch(() => undefined)
}
