// История изменений (отмена/повтор) — чистые функции без зависимости от zustand.
import type { Annotation } from '../../../../shared/annotations'

export const HISTORY_LIMIT = 100
/** Правки одного вида подряд в пределах этого времени (мс) склеиваются в один шаг отмены. */
export const COALESCE_MS = 800

export interface HistoryState {
  items: Annotation[]
  past: Annotation[][]
  future: Annotation[][]
  lastKey: string | null
  lastAt: number
}

export function createHistory(items: Annotation[] = []): HistoryState {
  return { items, past: [], future: [], lastKey: null, lastAt: 0 }
}

function pushPast(past: Annotation[][], snapshot: Annotation[]): Annotation[][] {
  const next = [...past, snapshot]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}

/** Меняет список без записи в историю (промежуточные кадры перетаскивания). */
export function preview(h: HistoryState, items: Annotation[]): HistoryState {
  return { ...h, items }
}

/** Новое состояние = шаг истории. key+now склеивают быстрые правки одного поля (например, ввод цифр). */
export function commit(
  h: HistoryState,
  items: Annotation[],
  opts: { key?: string; now?: number } = {}
): HistoryState {
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
export function commitFrom(h: HistoryState, before: Annotation[]): HistoryState {
  if (before === h.items) return h
  return { items: h.items, past: pushPast(h.past, before), future: [], lastKey: null, lastAt: 0 }
}

export function undo(h: HistoryState): HistoryState {
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

export function redo(h: HistoryState): HistoryState {
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
