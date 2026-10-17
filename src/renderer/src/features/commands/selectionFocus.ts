// Что удалять по клавише Delete: рисунок или эпизод. Побеждает тот, что выбран позже.
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { useEpisodesStore } from '../episodes/episodesStore'

let last: 'annotation' | 'episode' | null = null

useAnnotationsStore.subscribe((s, prev) => {
  if (s.selectedId !== null && s.selectedId !== prev.selectedId) last = 'annotation'
})
useEpisodesStore.subscribe((s, prev) => {
  if (s.selectedId !== null && s.selectedId !== prev.selectedId) last = 'episode'
})

/** Удаляет выбранное: сначала то, что выбрано последним; если оно уже не выбрано — другое. Возвращает true, если что-то удалено. */
export function deleteSelection(): boolean {
  const a = useAnnotationsStore.getState()
  const e = useEpisodesStore.getState()
  const order =
    last === 'episode' ? (['episode', 'annotation'] as const) : (['annotation', 'episode'] as const)
  for (const kind of order) {
    if (kind === 'annotation' && a.selectedId) {
      a.remove(a.selectedId)
      return true
    }
    if (kind === 'episode' && e.selectedId) {
      e.remove(e.selectedId)
      return true
    }
  }
  return false
}
