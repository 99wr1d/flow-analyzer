// История изменений (отмена/повтор) — чистые функции без зависимости от zustand.
import type { Annotation } from '../../../../shared/annotations'

export const HISTORY_LIMIT = 100
/** Правки одного вида подряд в пределах этого времени (мс) склеиваются в один шаг отмены. */
export const COALESCE_MS = 800

export interface HistoryState<T = Annotation> {
  items: T[]
  past: T[][]
  future: T[][]
  lastKey: string | null
  lastAt: number
}

export function createHistory<T = Annotation>(items: T[] = []): HistoryState<T> {
  return { items, past: [], future: [], lastKey: null, lastAt: 0 }
}

function pushPast<T>(past: T[][], snapshot: T[]): T[][] {
  const next = [...past, snapshot]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}

/** Меняет список без записи в историю (промежуточные кадры перетаскивания). */
export function preview<T>(h: HistoryState<T>, items: T[]): HistoryState<T> {
  return { ...h, items }
}

/** Новое состояние = шаг истории. key+now склеивают быстрые правки одного поля (например, ввод цифр). */
export function commit<T>(
  h: HistoryState<T>,
  items: T[],
  opts: { key?: string; now?: number } = {}
): HistoryState<T> {
  if (items === h.items) return h
  const now = opts.now ?? Date.now()
  const key = opts.key ?? null
  const merge =
    key !== null && key === h.lastKey && now - h.lastAt <= COALESCE_MS && h.past.length > 0
  return {
    items,
    past: merge ? h.past : pushPast(h.past, h.items),
    future: [],
    lastKey: key,
    lastAt: now
  }
}

/** Завершение перетаскивания: в историю попадает состояние ДО начала жеста. */
export function commitFrom<T>(h: HistoryState<T>, before: T[]): HistoryState<T> {
  if (before === h.items) return h
  return { items: h.items, past: pushPast(h.past, before), future: [], lastKey: null, lastAt: 0 }
}

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) return h
  const items = h.past[h.past.length - 1]
  return {
    items,
    past: h.past.slice(0, -1),
    future: [...h.future, h.items],
    lastKey: null,
    lastAt: 0
  }
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) return h
  const items = h.future[h.future.length - 1]
  return {
    items,
    past: pushPast(h.past, h.items),
    future: h.future.slice(0, -1),
    lastKey: null,
    lastAt: 0
  }
}
