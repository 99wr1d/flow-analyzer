// Что удалять по клавише Delete: рисунок или эпизод. Побеждает тот, что выбран позже.
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { ru } from '../../i18n/ru'
import { useFeedbackStore } from '../episodes/feedbackStore'
import { removeLastDraftPoint } from '../annotations/polyDraft'
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
  // Рисуется зона или связь: Delete/Backspace убирает последнюю поставленную вершину.
  if (removeLastDraftPoint()) return true
  // Выбрана вершина зоны или связи: удаляется только она (если вершин остаётся достаточно).
  const node = useAnnotationsStore.getState()
  if (last !== 'episode' && node.selectedNode !== null) {
    if (!node.removeSelectedNode()) {
      useFeedbackStore.getState().show({ text: ru.annotations.nodeMin, kind: 'warn' })
    }
    return true
  }
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
