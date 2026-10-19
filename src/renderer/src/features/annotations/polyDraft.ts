// Рисунки из нескольких щелчков (зона, связи игроков): пока вершины ставятся, рисунок — черновик.
// Черновик живёт в отдельном хранилище: им управляют и мышь (слой рисунков), и клавиши (Enter, Esc, Backspace).
import { create } from 'zustand'
import {
  defaultDuration,
  frameCenter,
  DEFAULT_FREEZE,
  type Annotation,
  type Chain,
  type GroundChain,
  type GroundZone,
  type Zone
} from '../../../../shared/annotations'
import { canClosePolygon, canFinishChain } from '../../../../shared/tools/polygon'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { useFeedbackStore } from '../episodes/feedbackStore'
import { useAnnotationsStore } from './annotationsStore'
import { shapeStyleOf } from './styles'

export type PolyTool = 'zone' | 'chain'

export interface PolyDraft {
  tool: PolyTool
  space: 'screen' | 'pitch'
  calibrationId: string | null
  /** Вершины: доли кадра (экран) или метры (поле). */
  points: Array<{ x: number; y: number }>
  /** Время, на котором начат рисунок. */
  start: number
  /** Положение курсора (в тех же единицах) — для резиновой линии к следующей вершине. */
  hover: { x: number; y: number } | null
}

interface PolyDraftState {
  draft: PolyDraft | null
  begin: (d: Omit<PolyDraft, 'points' | 'hover'>) => void
  addPoint: (p: { x: number; y: number }) => void
  setHover: (p: { x: number; y: number } | null) => void
  /** Убирает последнюю вершину; когда вершин не осталось — отменяет черновик. */
  removeLast: () => void
  cancel: () => void
}

export const usePolyDraft = create<PolyDraftState>()((set) => ({
  draft: null,
  begin: (d) => set({ draft: { ...d, points: [], hover: null } }),
  addPoint: (p) =>
    set((s) => (s.draft ? { draft: { ...s.draft, points: [...s.draft.points, p] } } : {})),
  setHover: (hover) => set((s) => (s.draft ? { draft: { ...s.draft, hover } } : {})),
  removeLast: () =>
    set((s) => {
      if (!s.draft) return {}
      const points = s.draft.points.slice(0, -1)
      return points.length === 0 ? { draft: null } : { draft: { ...s.draft, points } }
    }),
  cancel: () => set({ draft: null })
}))

export const polyDraftActive = (): boolean => usePolyDraft.getState().draft !== null

/** Рисунок, который получится из черновика (с вершиной под курсором — для предпросмотра). */
export function draftAnnotation(d: PolyDraft, withHover: boolean): Annotation {
  const points = withHover && d.hover ? [...d.points, d.hover] : d.points
  const { style, options } = useAnnotationsStore.getState()
  const base = { id: 'poly-draft', style: shapeStyleOf(style) }
  const { duration } = usePlayerStore.getState()
  const timing =
    d.space === 'pitch'
      ? ({
          mode: 'frame',
          start: frameCenter(d.start, usePlayerStore.getState().fps),
          freezeSeconds: DEFAULT_FREEZE
        } as const)
      : ({ mode: 'range', start: d.start, duration: defaultDuration(d.start, duration) } as const)
  if (d.space === 'pitch') {
    const ground = {
      ...base,
      space: 'pitch' as const,
      calibrationId: d.calibrationId ?? '',
      timing
    }
    return d.tool === 'zone'
      ? ({
          ...ground,
          type: 'pzone',
          points,
          opacity: options.opacity,
          showArea: options.areaLabel
        } satisfies GroundZone)
      : ({
          ...ground,
          type: 'pchain',
          points,
          fill: options.fill,
          labels: options.labels
        } satisfies GroundChain)
  }
  const screen = { ...base, space: 'screen' as const, timing }
  return d.tool === 'zone'
    ? ({ ...screen, type: 'zone', points, opacity: options.opacity } satisfies Zone)
    : ({ ...screen, type: 'chain', points, fill: options.fill } satisfies Chain)
}

/** Можно ли завершить черновик (зона — от трёх вершин не на одной прямой, связь — от двух). */
export function canFinishDraft(d: PolyDraft): boolean {
  return d.tool === 'zone' ? canClosePolygon(d.points) : canFinishChain(d.points)
}

/** Завершает рисунок (Enter, двойной щелчок, щелчок по первой вершине). true — рисунок создан. */
export function finishPolyDraft(): boolean {
  const d = usePolyDraft.getState().draft
  if (!d) return false
  if (!canFinishDraft(d)) {
    useFeedbackStore.getState().show({
      text: d.tool === 'zone' ? ru.annotations.zoneNeedPoints : ru.annotations.chainNeedPoints,
      kind: 'warn'
    })
    return false
  }
  usePolyDraft.getState().cancel()
  useAnnotationsStore.getState().add({ ...draftAnnotation(d, false), id: crypto.randomUUID() })
  return true
}

/** Esc: отмена черновика (инструмент остаётся). true — было что отменять. */
export function cancelPolyDraft(): boolean {
  if (!polyDraftActive()) return false
  usePolyDraft.getState().cancel()
  return true
}

/** Backspace/Delete во время рисования: убрать последнюю вершину. */
export function removeLastDraftPoint(): boolean {
  if (!polyDraftActive()) return false
  usePolyDraft.getState().removeLast()
  return true
}

// Смена инструмента или рисунка отменяет недорисованный рисунок.
useAnnotationsStore.subscribe((s, prev) => {
  if (s.tool !== prev.tool && polyDraftActive()) usePolyDraft.getState().cancel()
})
