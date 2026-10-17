// Единая отмена для рисунков и эпизодов: Ctrl+Z отменяет последнее действие любого вида.
// У каждого хранилища своя история; здесь только порядок: какое хранилище сделало шаг раньше или позже.
import type { Annotation } from '../../../../shared/annotations'
import type { Episode } from '../../../../shared/episodes'
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { useEpisodesStore } from '../episodes/episodesStore'

export type HistoryKind = 'annotations' | 'episodes'

export interface StepOrder {
  undo: HistoryKind[]
  redo: HistoryKind[]
}

const ORDER_LIMIT = 400

export const emptyOrder = (): StepOrder => ({ undo: [], redo: [] })

/** Новое действие: попадает в конец списка отмены, «повтор» сбрасывается. */
export function pushStep(order: StepOrder, kind: HistoryKind): StepOrder {
  const undo = [...order.undo, kind]
  return { undo: undo.length > ORDER_LIMIT ? undo.slice(-ORDER_LIMIT) : undo, redo: [] }
}

/** Убирает из порядка шаги вида kind: все (all) или только последний. */
export function dropStep(order: StepOrder, kind: HistoryKind, all: boolean): StepOrder {
  if (all) {
    return {
      undo: order.undo.filter((k) => k !== kind),
      redo: order.redo.filter((k) => k !== kind)
    }
  }
  const index = order.undo.lastIndexOf(kind)
  if (index === -1) return order
  return { ...order, undo: order.undo.filter((_, i) => i !== index) }
}

type Take = { kind: HistoryKind; order: StepOrder } | null

/** Берёт последний шаг, который ещё можно отменить (записи без шагов в истории пропускаются). */
export function takeUndo(order: StepOrder, can: (k: HistoryKind) => boolean): Take {
  const undo = [...order.undo]
  while (undo.length > 0) {
    const kind = undo.pop() as HistoryKind
    if (can(kind)) return { kind, order: { ...order, undo } }
  }
  return null
}

export function takeRedo(order: StepOrder, can: (k: HistoryKind) => boolean): Take {
  const redo = [...order.redo]
  while (redo.length > 0) {
    const kind = redo.pop() as HistoryKind
    if (can(kind)) return { kind, order: { ...order, redo } }
  }
  return null
}

// --- Связка с хранилищами ---

let order = emptyOrder()
let busy = false
let uninstall: (() => void) | null = null

const stores = { annotations: useAnnotationsStore, episodes: useEpisodesStore }
const other: Record<HistoryKind, HistoryKind> = { annotations: 'episodes', episodes: 'annotations' }

const canUndoKind = (k: HistoryKind): boolean => stores[k].getState().past.length > 0
const canRedoKind = (k: HistoryKind): boolean => stores[k].getState().future.length > 0

function watch(kind: HistoryKind): () => void {
  const store = stores[kind] as typeof useEpisodesStore
  return store.subscribe((s, prev) => {
    if (busy || s.past === prev.past) return
    if (s.past.length < prev.past.length) {
      // Отмена или сброс в обход общей истории: убираем соответствующую запись.
      order = dropStep(order, kind, s.past.length === 0)
      return
    }
    order = pushStep(order, kind)
    // Новое действие делает «повтор» чужой истории недоступным, как в обычном редакторе.
    const otherStore = stores[other[kind]] as typeof useEpisodesStore
    if (otherStore.getState().future.length > 0) otherStore.setState({ future: [] })
  })
}

/** Подключает общую историю. Вызывать один раз при запуске; повторный вызов безопасен. */
export function installUnifiedHistory(): () => void {
  if (!uninstall) {
    const offs = [watch('annotations'), watch('episodes')]
    uninstall = (): void => {
      offs.forEach((off) => off())
      uninstall = null
    }
  }
  return uninstall
}

export function undoAny(): void {
  const taken = takeUndo(order, canUndoKind)
  if (!taken) return
  order = taken.order
  busy = true
  try {
    stores[taken.kind].getState().undo()
  } finally {
    busy = false
  }
  order = { ...order, redo: [...order.redo, taken.kind] }
}

export function redoAny(): void {
  const taken = takeRedo(order, canRedoKind)
  if (!taken) return
  order = taken.order
  busy = true
  try {
    stores[taken.kind].getState().redo()
  } finally {
    busy = false
  }
  order = { ...order, undo: [...order.undo, taken.kind] }
}

/** Новое видео: всё, что было размечено, и общая история очищаются. */
export function resetWork(): void {
  busy = true
  try {
    useAnnotationsStore.getState().reset()
    useEpisodesStore.getState().reset()
  } finally {
    busy = false
  }
  order = emptyOrder()
}

/** Загрузка проекта: рисунки и эпизоды заменяются, общая история очищается. */
export function loadWork(annotations: Annotation[], episodes: Episode[]): void {
  busy = true
  try {
    useAnnotationsStore.getState().load(annotations)
    useEpisodesStore.getState().load(episodes)
  } finally {
    busy = false
  }
  order = emptyOrder()
}

export function useCanUndo(): boolean {
  const a = useAnnotationsStore((s) => s.past.length > 0)
  const e = useEpisodesStore((s) => s.past.length > 0)
  return a || e
}

export function useCanRedo(): boolean {
  const a = useAnnotationsStore((s) => s.future.length > 0)
  const e = useEpisodesStore((s) => s.future.length > 0)
  return a || e
}
