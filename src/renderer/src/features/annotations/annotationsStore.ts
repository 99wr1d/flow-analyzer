import { create } from 'zustand'
import type { Annotation, Timing } from '../../../../shared/annotations'
import {
  commit,
  commitFrom,
  createHistory,
  preview,
  redo,
  undo,
  type HistoryState
} from './history'
import { DEFAULT_STYLE, LEVELS, type CurrentStyle } from './styles'

export type Tool = 'select' | 'arrow' | 'line' | 'circle' | 'text'
export const TOOLS: Tool[] = ['select', 'arrow', 'line', 'circle', 'text']

export interface AnnotationsState extends HistoryState {
  selectedId: string | null
  tool: Tool
  /** Стиль для новых рисунков; при выбранном рисунке изменения применяются и к нему. */
  style: CurrentStyle
}

export interface AnnotationsActions {
  setTool: (tool: Tool) => void
  select: (id: string | null) => void
  setStyle: (patch: Partial<CurrentStyle>) => void
  add: (annotation: Annotation) => void
  remove: (id: string) => void
  setTiming: (id: string, timing: Timing, key?: string) => void
  setText: (id: string, text: string) => void
  /** Промежуточное изменение при перетаскивании (без записи в историю). */
  preview: (items: Annotation[]) => void
  /** Конец перетаскивания: в историю записывается состояние до жеста. */
  commitFrom: (before: Annotation[]) => void
  undo: () => void
  redo: () => void
  /** Новое видео: рисунки и история очищаются. Инструмент и стиль сохраняются. */
  reset: () => void
  /** Загрузка проекта: рисунки заменяются, история пуста. */
  load: (items: Annotation[]) => void
}

function withSelection(s: AnnotationsState, h: HistoryState): Partial<AnnotationsState> {
  const exists = s.selectedId !== null && h.items.some((a) => a.id === s.selectedId)
  return { ...h, selectedId: exists ? s.selectedId : null }
}

function restyle(a: Annotation, patch: Partial<CurrentStyle>): Annotation {
  if (a.type === 'text') {
    return {
      ...a,
      style: {
        color: patch.color ?? a.style.color,
        size: patch.level !== undefined ? LEVELS[patch.level].text : a.style.size,
        background: patch.textBackground ?? a.style.background
      }
    }
  }
  return {
    ...a,
    style: {
      color: patch.color ?? a.style.color,
      width: patch.level !== undefined ? LEVELS[patch.level].width : a.style.width,
      dash: patch.dash ?? a.style.dash
    }
  }
}

const initial = (): AnnotationsState => ({
  ...createHistory(),
  selectedId: null,
  tool: 'select',
  style: DEFAULT_STYLE
})

export const useAnnotationsStore = create<AnnotationsState & AnnotationsActions>()((set) => ({
  ...initial(),

  setTool: (tool) => set((s) => ({ tool, selectedId: tool === 'select' ? s.selectedId : null })),
  select: (selectedId) => set({ selectedId }),

  setStyle: (patch) =>
    set((s) => {
      const style = { ...s.style, ...patch }
      const target = s.items.find((a) => a.id === s.selectedId)
      if (!target) return { style }
      const key = `style:${Object.keys(patch).join(',')}`
      const items = s.items.map((a) => (a.id === target.id ? restyle(a, patch) : a))
      return { style, ...commit(s, items, { key }) }
    }),

  add: (annotation) =>
    set((s) => ({ ...commit(s, [...s.items, annotation]), selectedId: annotation.id })),

  remove: (id) =>
    set((s) => {
      if (!s.items.some((a) => a.id === id)) return {}
      return withSelection(
        s,
        commit(
          s,
          s.items.filter((a) => a.id !== id)
        )
      )
    }),

  setTiming: (id, timing, key) =>
    set((s) => {
      const items = s.items.map((a) => (a.id === id ? { ...a, timing } : a))
      return { ...commit(s, items, { key }) }
    }),

  setText: (id, text) =>
    set((s) => {
      const items = s.items.map((a) => (a.id === id && a.type === 'text' ? { ...a, text } : a))
      return { ...commit(s, items) }
    }),

  preview: (items) => set((s) => ({ ...preview(s, items) })),
  commitFrom: (before) => set((s) => ({ ...commitFrom(s, before) })),
  undo: () => set((s) => withSelection(s, undo(s))),
  redo: () => set((s) => withSelection(s, redo(s))),
  reset: () => set((s) => ({ ...initial(), tool: s.tool, style: s.style })),
  load: (items) =>
    set((s) => ({ ...initial(), ...createHistory(items), tool: s.tool, style: s.style }))
}))

export const selectedAnnotation = (s: AnnotationsState): Annotation | null =>
  s.items.find((a) => a.id === s.selectedId) ?? null
