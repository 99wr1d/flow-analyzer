// Действия с ключами анимации выбранного рисунка: их вызывают и кнопки панели «Рисунок», и команды с клавиатуры.
import { isAnimated, keyIndexAt, keysOf, neighbourKey } from '../../../../shared/animation'
import { frameCenter, type Annotation } from '../../../../shared/annotations'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { useFeedbackStore } from '../episodes/feedbackStore'
import { getVideoElement, seekTo } from '../player/videoElement'
import { useAnnotationsStore } from './annotationsStore'

/** Кадр (середина), на котором сейчас стоит видео. */
export function currentFrameTime(): number {
  const { currentTime, fps } = usePlayerStore.getState()
  return frameCenter(getVideoElement()?.currentTime ?? currentTime, fps)
}

function selected(): Annotation | null {
  const s = useAnnotationsStore.getState()
  return s.items.find((a) => a.id === s.selectedId) ?? null
}

/** Выбранный рисунок анимирован и виден (иначе команды с ключами недоступны). */
export function canUseKeys(): boolean {
  const a = selected()
  return !!a && isAnimated(a)
}

/** К предыдущему / следующему ключу выбранного рисунка. Возвращает false, если такого ключа нет. */
export function gotoKey(dir: -1 | 1): boolean {
  const a = selected()
  if (!a || !isAnimated(a)) return false
  const { fps } = usePlayerStore.getState()
  const index = neighbourKey(a, currentFrameTime(), dir, fps)
  if (index === null) return false
  seekTo(keysOf(a)[index].t)
  useAnnotationsStore.getState().selectKey(index)
  return true
}

/** «Ключ здесь»: новый ключ на текущем кадре. false — рисунок не анимирован или ключ здесь уже есть. */
export function addKeyHere(): boolean {
  const a = selected()
  if (!a || !isAnimated(a)) return false
  const { fps } = usePlayerStore.getState()
  const t = currentFrameTime()
  if (keyIndexAt(a, t, fps) >= 0) {
    useFeedbackStore.getState().show({ text: ru.annotations.keyExists, kind: 'warn' })
    return false
  }
  const before = keysOf(a).length
  useAnnotationsStore.getState().addKey(a.id, t, fps)
  const now = selected()
  if (now && keysOf(now).length === before) {
    useFeedbackStore.getState().show({ text: ru.annotations.keysMax, kind: 'warn' })
    return false
  }
  return true
}

/** «Анимировать»: первый ключ на текущем кадре. */
export function startAnimationNow(): void {
  const a = selected()
  if (!a || isAnimated(a)) return
  const { fps, duration } = usePlayerStore.getState()
  useAnnotationsStore.getState().startAnimation(a.id, currentFrameTime(), fps, duration)
}

/** «Убрать анимацию»: рисунок застывает в геометрии текущего кадра. */
export function stopAnimationNow(): void {
  const a = selected()
  if (!a || !isAnimated(a)) return
  useAnnotationsStore.getState().stopAnimation(a.id, currentFrameTime())
}

/** «Удалить ключ» на текущем кадре. */
export function removeKeyHere(): boolean {
  const a = selected()
  if (!a || !isAnimated(a)) return false
  const index = keyIndexAt(a, currentFrameTime(), usePlayerStore.getState().fps)
  if (index < 0) return false
  useAnnotationsStore.getState().removeKey(a.id, index)
  return true
}
