import { create } from 'zustand'
import {
  DEFAULT_DIM,
  canBeUnder,
  DEFAULT_RING_FILL,
  newUnderDefault,
  DEFAULT_LOUPE_ZOOM,
  DEFAULT_ZONE_OPACITY,
  type Annotation,
  type Ease,
  type Timing
} from '../../../../shared/annotations'
import {
  addKeyHere,
  flatten,
  isAnimated,
  keysOf,
  removeKey,
  removeVertexAllKeys,
  retimeKey,
  setKeyEase,
  startAnimation
} from '../../../../shared/animation'
import { minVertices } from '../../../../shared/tools/points'
import {
  commit,
  commitFrom,
  createHistory,
  preview,
  redo,
  undo,
  type HistoryState
} from './history'
import { DEFAULT_STYLE, LEVELS, TEXT_SIZES, applyFxPatch, type CurrentStyle } from './styles'

export type Tool =
  | 'select'
  | 'arrow'
  | 'line'
  | 'circle'
  | 'text'
  | 'ruler'
  | 'spot'
  | 'curve'
  | 'pen'
  | 'zone'
  | 'loupe'
  | 'chain'
export const TOOLS: Tool[] = [
  'select',
  'arrow',
  'curve',
  'line',
  'circle',
  'text',
  'ruler',
  'spot',
  'zone',
  'chain',
  'pen',
  'loupe'
]
/** Инструменты рейки по группам: основные, разметка поля и анализ, дополнительные. */
export const TOOL_GROUPS: Array<{ id: string; tools: Tool[] }> = [
  { id: 'basic', tools: ['select', 'arrow', 'curve', 'line', 'circle', 'text'] },
  { id: 'field', tools: ['ruler', 'spot', 'zone', 'chain'] },
  { id: 'advanced', tools: ['pen', 'loupe'] }
]

/** Свойства новых рисунков (запоминаются: последнее выбранное значение действует для следующих рисунков). */
export interface ToolOptions {
  dim: number
  zoom: number
  opacity: number
  areaLabel: boolean
  beam: boolean
  arrow: boolean
  fill: boolean
  labels: boolean
  /** Заливка нового круга и кольца. */
  fillOpacity: number
}
export const DEFAULT_OPTIONS: ToolOptions = {
  dim: DEFAULT_DIM,
  zoom: DEFAULT_LOUPE_ZOOM,
  opacity: DEFAULT_ZONE_OPACITY,
  areaLabel: true,
  beam: true,
  arrow: false,
  fill: false,
  labels: true,
  fillOpacity: DEFAULT_RING_FILL
}
/** Свойство рисунка → поле в ToolOptions. */
const PROP_TO_OPTION: Record<string, keyof ToolOptions> = {
  dim: 'dim',
  zoom: 'zoom',
  opacity: 'opacity',
  showArea: 'areaLabel',
  beam: 'beam',
  arrow: 'arrow',
  fill: 'fill',
  labels: 'labels',
  fillOpacity: 'fillOpacity'
}
/** Свойства рисунка, которые можно менять в панели «Рисунок». */
export type PropPatch = Partial<{
  dim: number
  zoom: number
  opacity: number
  showArea: boolean
  beam: boolean
  arrow: boolean
  fill: boolean
  labels: boolean
  fillOpacity: number
  underPlayers: boolean
}>

export interface UnderNew {
  pitch: boolean | null
  screen: boolean | null
}

/** «Под игроками» для нового рисунка вида type в месте space: запомненный выбор или умолчание по виду. */
export function underForNew(type: string, space: 'pitch' | 'screen', underNew: UnderNew): boolean {
  return underNew[space] ?? newUnderDefault(type, space)
}

export interface AnnotationsState extends HistoryState {
  selectedId: string | null
  tool: Tool
  /** Стиль для новых рисунков; при выбранном рисунке изменения применяются и к нему. */
  style: CurrentStyle
  /** Свойства новых рисунков (прожектор, лупа, зона…). */
  options: ToolOptions
  /** Выбранная вершина зоны или связи игроков (Delete удаляет её). */
  selectedNode: number | null
  /**
   * «Под игроками» для новых рисунков: последний выбор отдельно для рисунков на поле и на экране.
   * null — пользователь ещё не выбирал: действует умолчание по виду рисунка (newUnderDefault).
   */
  underNew: UnderNew
  /** Выбранный ключ выбранного рисунка (ромбик на дорожке): Delete убирает его. */
  selectedKey: number | null
}

export interface AnnotationsActions {
  /** Выбирает ключ выбранного рисунка (null — снимает выбор). */
  selectKey: (index: number | null) => void
  /** «Анимировать»: первый ключ в кадре момента t. */
  startAnimation: (id: string, t: number, fps: number, videoDuration: number) => void
  /** «Ключ здесь»: ключ с текущей геометрией в кадре момента t. */
  addKey: (id: string, t: number, fps: number) => void
  removeKey: (id: string, index: number) => void
  setKeyEase: (id: string, index: number, ease: Ease) => void
  /** «Убрать анимацию»: рисунок застывает в геометрии момента t. */
  stopAnimation: (id: string, t: number) => void
  /** Сдвиг ключа без записи в историю (перетаскивание ромбика); завершается commitFrom. */
  previewRetime: (before: Annotation[], id: string, index: number, t: number, fps: number) => void
  selectNode: (index: number | null) => void
  /** Запоминает выбор «Под игроками» для новых рисунков на поле / на экране. */
  setUnderNew: (space: 'pitch' | 'screen', under: boolean) => void
  /** Меняет свойства выбранного рисунка (и запоминает их для новых). */
  setProps: (id: string, patch: PropPatch) => void
  /** Удаляет выбранную вершину; false — нельзя (мало вершин) или вершина не выбрана. */
  removeSelectedNode: () => boolean
  setTool: (tool: Tool) => void
  select: (id: string | null) => void
  setStyle: (patch: Partial<CurrentStyle>) => void
  add: (annotation: Annotation) => void
  remove: (id: string) => void
  /** Заменяет рисунок целиком одним шагом истории (слежение: ключи и перевод «поле → экран»). */
  replaceAnnotation: (id: string, annotation: Annotation) => void
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

/** Новому рисунку, которому это имеет смысл, выставляется последний выбор «Под игроками» для его места. */
export function withUnder(a: Annotation, underNew: AnnotationsState['underNew']): Annotation {
  if (!canBeUnder(a.type) || (a as { underPlayers?: boolean }).underPlayers !== undefined) return a
  return {
    ...a,
    underPlayers: underForNew(a.type, a.space === 'pitch' ? 'pitch' : 'screen', underNew)
  } as Annotation
}

function withSelection(s: AnnotationsState, h: HistoryState): Partial<AnnotationsState> {
  const exists = s.selectedId !== null && h.items.some((a) => a.id === s.selectedId)
  const sel = exists ? s.selectedId : null
  const target = h.items.find((a) => a.id === sel)
  const keyOk = s.selectedKey !== null && !!target && s.selectedKey < keysOf(target).length
  return { ...h, selectedId: sel, selectedKey: keyOk ? s.selectedKey : null }
}

function restyle(a: Annotation, patch: Partial<CurrentStyle>): Annotation {
  if (a.type === 'text' || a.type === 'ptext') {
    const shadow = patch.textShadow ?? a.style.shadow
    return {
      ...a,
      style: {
        color: patch.color ?? a.style.color,
        size: patch.textLevel !== undefined ? TEXT_SIZES[patch.textLevel].size : a.style.size,
        background: patch.textBackground ?? a.style.background,
        ...(shadow !== undefined ? { shadow } : {})
      }
    } as Annotation
  }
  return applyFxPatch(
    {
      ...a,
      style: {
        color: patch.color ?? a.style.color,
        width: patch.level !== undefined ? LEVELS[patch.level].width : a.style.width,
        dash: patch.dash ?? a.style.dash
      }
    } as Annotation,
    patch
  )
}

const initial = (): AnnotationsState => ({
  ...createHistory(),
  selectedId: null,
  tool: 'select',
  style: DEFAULT_STYLE,
  options: DEFAULT_OPTIONS,
  selectedNode: null,
  selectedKey: null,
  underNew: { pitch: null, screen: null }
})

export const useAnnotationsStore = create<AnnotationsState & AnnotationsActions>()((set) => ({
  ...initial(),

  setTool: (tool) => set((s) => ({ tool, selectedId: tool === 'select' ? s.selectedId : null })),
  select: (selectedId) =>
    set((s) => ({
      selectedId,
      selectedNode: selectedId === s.selectedId ? s.selectedNode : null,
      selectedKey: selectedId === s.selectedId ? s.selectedKey : null
    })),
  selectNode: (selectedNode) =>
    set((s) => ({ selectedNode, selectedKey: selectedNode !== null ? null : s.selectedKey })),
  selectKey: (selectedKey) =>
    set((s) => ({ selectedKey, selectedNode: selectedKey !== null ? null : s.selectedNode })),

  startAnimation: (id, t, fps, videoDuration) =>
    set((s) => {
      const items = s.items.map((a) => (a.id === id ? startAnimation(a, t, fps, videoDuration) : a))
      return { ...commit(s, items), selectedKey: null }
    }),
  addKey: (id, t, fps) =>
    set((s) => {
      const items = s.items.map((a) => (a.id === id ? addKeyHere(a, t, fps) : a))
      return { ...commit(s, items), selectedKey: null }
    }),
  removeKey: (id, index) =>
    set((s) => {
      const items = s.items.map((a) => (a.id === id ? removeKey(a, index) : a))
      return { ...commit(s, items), selectedKey: null }
    }),
  setKeyEase: (id, index, ease) =>
    set((s) => {
      const items = s.items.map((a) => (a.id === id ? setKeyEase(a, index, ease) : a))
      return { ...commit(s, items, { key: `ease:${id}:${index}` }) }
    }),
  stopAnimation: (id, t) =>
    set((s) => {
      const items = s.items.map((a) => (a.id === id ? flatten(a, t) : a))
      return { ...commit(s, items), selectedKey: null }
    }),
  previewRetime: (before, id, index, t, fps) =>
    set((s) => ({
      ...preview(
        s,
        before.map((a) => (a.id === id ? retimeKey(a, index, t, fps) : a))
      )
    })),

  setUnderNew: (space, under) => set((s) => ({ underNew: { ...s.underNew, [space]: under } })),

  setProps: (id, patch) =>
    set((s) => {
      const target = s.items.find((a) => a.id === id)
      if (!target) return {}
      const options = { ...s.options }
      for (const [prop, value] of Object.entries(patch)) {
        const option = PROP_TO_OPTION[prop]
        if (option) (options as Record<string, unknown>)[option] = value
      }
      const items = s.items.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a))
      // «Под игроками» запоминается для новых рисунков того же места (поле / экран).
      const underNew =
        patch.underPlayers !== undefined
          ? { ...s.underNew, [target.space === 'pitch' ? 'pitch' : 'screen']: patch.underPlayers }
          : s.underNew
      return {
        options,
        underNew,
        ...commit(s, items, { key: 'prop:' + id + ':' + Object.keys(patch).join(',') })
      }
    }),

  removeSelectedNode: () => {
    let done = false
    set((s) => {
      const target = s.items.find((a) => a.id === s.selectedId)
      const index = s.selectedNode
      if (
        !target ||
        index === null ||
        !('points' in target) ||
        target.points.length - 1 < minVertices(target)
      ) {
        return {}
      }
      done = true
      const items = s.items.map((a) => (a.id === target.id ? removeVertexAllKeys(a, index) : a))
      return { selectedNode: null, ...commit(s, items) }
    })
    return done
  },

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
    set((s) => ({
      ...commit(s, [...s.items, withUnder(annotation, s.underNew)]),
      selectedId: annotation.id,
      selectedNode: null,
      selectedKey: null
    })),

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

  replaceAnnotation: (id, annotation) =>
    set((s) => {
      if (!s.items.some((a) => a.id === id)) return {}
      const items = s.items.map((a) => (a.id === id ? annotation : a))
      return { ...commit(s, items), selectedKey: null, selectedNode: null }
    }),

  setTiming: (id, timing, key) =>
    set((s) => {
      const items = s.items.map((a) => (a.id === id ? { ...a, timing } : a))
      return { ...commit(s, items, { key }) }
    }),

  setText: (id, text) =>
    set((s) => {
      const items = s.items.map((a) =>
        a.id === id && (a.type === 'text' || a.type === 'ptext') ? { ...a, text } : a
      )
      return { ...commit(s, items) }
    }),

  preview: (items) => set((s) => ({ ...preview(s, items) })),
  commitFrom: (before) => set((s) => ({ ...commitFrom(s, before) })),
  undo: () => set((s) => withSelection(s, undo(s))),
  redo: () => set((s) => withSelection(s, redo(s))),
  reset: () =>
    set((s) => ({
      ...initial(),
      tool: s.tool,
      style: s.style,
      options: s.options,
      underNew: s.underNew
    })),
  load: (items) =>
    set((s) => ({
      ...initial(),
      ...createHistory(items),
      tool: s.tool,
      style: s.style,
      options: s.options,
      underNew: s.underNew
    }))
}))

/** Выбранный рисунок анимирован (есть хотя бы один ключ). */
export const selectedIsAnimated = (s: AnnotationsState): boolean => {
  const a = s.items.find((x) => x.id === s.selectedId)
  return !!a && isAnimated(a)
}

export const selectedAnnotation = (s: AnnotationsState): Annotation | null =>
  s.items.find((a) => a.id === s.selectedId) ?? null
