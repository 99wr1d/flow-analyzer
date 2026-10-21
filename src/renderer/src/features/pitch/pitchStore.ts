// Состояние «поля» в интерфейсе: режим разметки (черновик), переключатель «На поле», сетка поля.
import { create } from 'zustand'
import type { Pt } from '../../../../shared/pitch/linalg'
import type { PitchSize } from '../../../../shared/pitch/landmarks'
import type { RectSize, TemplateId } from '../../../../shared/pitch/templates'
import {
  addPoint,
  beginExtra,
  setAddingExtra,
  movePoint,
  removeLast,
  selectPoint,
  setPitchSize,
  setRectSize,
  setTemplate,
  type CalibrationDraft
} from './draft'

export interface PitchUiState {
  /** Рисовать на поле, когда есть разметка (запоминается между инструментами). */
  onPitch: boolean
  /** Показывать сетку (линии) поля поверх видео. */
  showGrid: boolean
  /** Последний выбранный шаблон и размер поля: новая разметка начинается с них. */
  lastTemplate: TemplateId
  lastPitch: PitchSize | null
  /** Идёт разметка поля. */
  draft: CalibrationDraft | null
  /** Панель режима разметки слева или справа. */
  panelSide: 'left' | 'right'
  /** Показан вопрос «Сбросить разметку?» (отмена с уже поставленными точками). */
  confirmingCancel: boolean
}

export interface PitchUiActions {
  setOnPitch: (on: boolean) => void
  setShowGrid: (on: boolean) => void
  setPanelSide: (side: 'left' | 'right') => void
  setConfirmingCancel: (on: boolean) => void
  openDraft: (draft: CalibrationDraft) => void
  closeDraft: () => void
  addPoint: (image: Pt) => void
  movePoint: (index: number, image: Pt) => void
  removeLast: () => void
  selectPoint: (index: number | null) => void
  beginExtra: (pointId: string | null) => void
  setAddingExtra: (on: boolean) => void
  setTemplate: (template: TemplateId) => void
  setPitchSize: (size: Partial<PitchSize>) => void
  setRectSize: (size: Partial<RectSize>) => void
}

function change(
  fn: (d: CalibrationDraft) => CalibrationDraft
): (s: PitchUiState) => Partial<PitchUiState> {
  return (s) => (s.draft ? { draft: fn(s.draft) } : {})
}

export const usePitchStore = create<PitchUiState & PitchUiActions>()((set) => ({
  onPitch: true,
  showGrid: false,
  lastTemplate: 'penalty-left',
  lastPitch: null,
  draft: null,
  panelSide: 'left',
  confirmingCancel: false,

  setOnPitch: (onPitch) => set({ onPitch }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setPanelSide: (panelSide) => set({ panelSide }),
  setConfirmingCancel: (confirmingCancel) => set({ confirmingCancel }),
  openDraft: (draft) => set({ draft, confirmingCancel: false }),
  closeDraft: () =>
    set((s) => ({
      draft: null,
      confirmingCancel: false,
      lastTemplate: s.draft ? s.draft.template : s.lastTemplate,
      lastPitch: s.draft ? s.draft.pitch : s.lastPitch
    })),
  addPoint: (image) => set(change((d) => addPoint(d, image))),
  movePoint: (index, image) => set(change((d) => movePoint(d, index, image))),
  removeLast: () => set(change(removeLast)),
  selectPoint: (index) => set(change((d) => selectPoint(d, index))),
  beginExtra: (pointId) => set(change((d) => beginExtra(d, pointId))),
  setAddingExtra: (on) => set(change((d) => setAddingExtra(d, on))),
  setTemplate: (template) => set(change((d) => setTemplate(d, template))),
  setPitchSize: (size) => set(change((d) => setPitchSize(d, size))),
  setRectSize: (size) => set(change((d) => setRectSize(d, size)))
}))
