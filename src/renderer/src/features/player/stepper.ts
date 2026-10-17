// Покадровый переход с «склейкой» запросов.
//
// При удержании клавиши события приходят чаще, чем браузер успевает перематывать. Поэтому следующий seek
// отправляем только после события seeked предыдущего, а все нажатия за это время складываем в одно целевое
// число кадров (pending). Очередь из сотен перемоток не копится.
import { usePlayerStore } from '../../store/playerStore'
import { frameCenterTime, frameCount, frameIndexAt, targetFrame } from './frames'

/** Кадр, к которому хотим прийти (null — ничего не ждём). */
let pending: number | null = null
/** Кадр, на который уже отправлена перемотка и ждём seeked (null — перемотка не идёт). */
let inflight: number | null = null

/** Забыть незавершённые шаги (например, пользователь перемотал мышью или загрузил другой файл). */
export function resetStepper(): void {
  pending = null
  inflight = null
}

function issue(el: HTMLVideoElement): void {
  if (pending === null) return
  const { fps, duration } = usePlayerStore.getState()
  inflight = pending
  const time = frameCenterTime(inflight, fps, duration)
  el.currentTime = time
  // Линейка и ползунок обновляются сразу, не дожидаясь seeked.
  usePlayerStore.getState().setCurrentTime(time)
}

/** Сдвигает кадр на delta (отрицательное — назад). Ставит видео на паузу. */
export function stepFrames(el: HTMLVideoElement, delta: number): void {
  const { fps, duration } = usePlayerStore.getState()
  if (!el.paused) el.pause()
  const count = frameCount(duration, fps)
  const base = pending ?? frameIndexAt(el.currentTime, fps, duration)
  const target = targetFrame(base, delta, count)
  if (inflight === null && target === base) {
    // Уже на границе (первый/последний кадр): перематывать некуда. Но с конца (ended) возвращаем точное время.
    pending = null
    usePlayerStore.getState().setCurrentTime(el.currentTime)
    return
  }
  pending = target
  if (inflight === null) issue(el)
}

/** Вызывается из события seeked элемента <video>. */
export function handleSeeked(el: HTMLVideoElement): void {
  if (inflight === null) return
  const done = inflight
  inflight = null
  if (pending !== null && pending !== done) issue(el)
  else pending = null
}
