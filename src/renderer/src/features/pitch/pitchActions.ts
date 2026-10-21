// Действия с разметкой поля: начать, отменить, сохранить, удалить, перейти. Их вызывают и кнопки, и команды.
import { usePlayerStore } from '../../store/playerStore'
import { ru } from '../../i18n/ru'
import { useFeedbackStore } from '../episodes/feedbackStore'
import { getVideoElement, seekTo } from '../player/videoElement'
import { useCalibrationsStore } from './calibrationsStore'
import { canSaveDraft, draftFromCalibration, newDraft, toCalibration } from './draft'
import { usePitchStore } from './pitchStore'

/** Размер кадра видео в пикселях (0×0, если видео ещё не загружено). */
export function videoSize(): { w: number; h: number } {
  const el = getVideoElement()
  return { w: el?.videoWidth ?? 0, h: el?.videoHeight ?? 0 }
}

export const canCalibrate = (): boolean =>
  usePlayerStore.getState().status === 'ready' && usePitchStore.getState().draft === null

/** Режим разметки поля: видео ставится на паузу, начинается новая разметка. */
export function startCalibration(): void {
  if (!canCalibrate()) return
  const el = getVideoElement()
  const size = videoSize()
  if (!el || !(size.w > 0 && size.h > 0)) return
  if (!el.paused) el.pause()
  const pitch = usePitchStore.getState()
  usePitchStore
    .getState()
    .openDraft(
      newDraft(el.currentTime, size.w / size.h, pitch.lastTemplate, pitch.lastPitch ?? undefined)
    )
  useCalibrationsStore.getState().select(null)
}

/** Правка точек существующей разметки: видео переходит на её кадр. */
export function editCalibration(id: string): void {
  if (!canCalibrate()) return
  const c = useCalibrationsStore.getState().items.find((x) => x.id === id)
  if (!c) return
  const el = getVideoElement()
  if (el && !el.paused) el.pause()
  seekTo(c.time)
  usePitchStore.getState().openDraft(draftFromCalibration(c))
  useCalibrationsStore.getState().select(id)
}

export function cancelCalibration(): void {
  usePitchStore.getState().closeDraft()
}

/** «Отмена» / Esc: с поставленными точками сначала спрашивает, чтобы случайный щелчок не стёр работу. */
export function requestCancelCalibration(): void {
  const st = usePitchStore.getState()
  if (!st.draft) return
  if (st.draft.points.length > 0) st.setConfirmingCancel(true)
  else cancelCalibration()
}

/** Сохраняет разметку из черновика. true — сохранено. */
export function saveCalibration(now: Date = new Date()): boolean {
  const draft = usePitchStore.getState().draft
  if (!draft || !canSaveDraft(draft, videoSize())) return false
  const store = useCalibrationsStore.getState()
  const calibration = toCalibration(draft, draft.editingId ?? crypto.randomUUID(), now)
  if (draft.editingId) store.replace(calibration)
  else store.add(calibration)
  usePitchStore.getState().closeDraft()
  usePitchStore.getState().setOnPitch(true)
  return true
}

export function removeCalibration(id: string): void {
  useCalibrationsStore.getState().remove(id)
}

export function gotoCalibration(id: string): void {
  const c = useCalibrationsStore.getState().items.find((x) => x.id === id)
  if (!c) return
  seekTo(c.time)
  useCalibrationsStore.getState().select(id)
}

/** Инструмент «Линейка» нужна разметка: без неё подсказываем, что делать. */
export function explainNeedCalibration(): void {
  useFeedbackStore.getState().show({ text: ru.pitch.needCalibration, kind: 'warn' })
}
