// Действия доски тренера: сохранить, картинка, видео, проигрывание, кадры. Их вызывают и кнопки, и команды (клавиши).
import { addFrame, deleteItem } from '../../../../shared/board/edit'
import { safeFileName } from '../../../../shared/board/fileName'
import { BOARD_VIDEO_FPS, MAX_STAGE_BATCH } from '../../../../shared/board/ipc'
import { LEAD_IN, boardDuration } from '../../../../shared/board/resolve'
import { newBoard, type Board } from '../../../../shared/board/schema'
import { useViewStore } from '../../app/viewStore'
import { ru } from '../../i18n/ru'
import { renderBoardPng, renderBoardThumb, renderBoardVideoFrames } from './boardRender'
import { useBoardStore } from './boardStore'
import { useBoardUi } from './boardUi'

const THUMB_LIMIT = 80_000

/** Кадры рисуются из Blob (обычный ArrayBuffer); схема IPC ждёт именно такой Uint8Array. */
const bytes = (a: Uint8Array): Uint8Array<ArrayBuffer> => a as Uint8Array<ArrayBuffer>

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : ru.board.unknownError

const store = (): ReturnType<typeof useBoardStore.getState> => useBoardStore.getState()
const ui = (): ReturnType<typeof useBoardUi.getState> => useBoardUi.getState()

/** Можно ли править доску: открыта и не проигрывается. */
export const canEditBoard = (): boolean => store().board !== null && !store().playing

/** Применяет правку; ошибку показывает пользователю. true — получилось. */
export function applyBoard(fn: (b: Board) => Board): boolean {
  if (!canEditBoard()) return false
  const error = store().apply(fn)
  if (error) ui().notify('error', error)
  return error === null
}

// --- Документ ---

/** Открывает новую пустую доску (кнопка «Новая доска» появится на начальном экране в Task 12). */
export function openNewBoard(): void {
  stopBoardPlay()
  ui().reset()
  store().load(newBoard(ru.board.newTitle, new Date()), null)
  useViewStore.getState().setView('board')
}

/** «← Главная». Task 12 добавит вопрос о несохранённых изменениях. */
export async function goHome(): Promise<void> {
  stopBoardPlay()
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
  useViewStore.getState().setView('start')
  store().reset()
  ui().reset()
}

let saving = false

/** Сохраняет доску (обновляет обложку). saveAs — новым файлом в папке досок. true — записано. */
export async function saveBoard(saveAs = false): Promise<boolean> {
  const { board, path } = store()
  if (!board || saving) return false
  saving = true
  try {
    let thumb: string | undefined
    try {
      const url = await renderBoardThumb(board)
      if (url.startsWith('data:image/jpeg;base64,') && url.length <= THUMB_LIMIT) thumb = url
    } catch {
      thumb = undefined // без обложки доска всё равно сохраняется
    }
    const next: Board = { ...board, updatedAt: new Date().toISOString() }
    if (thumb) next.thumb = thumb
    else delete next.thumb
    const result = await window.api.saveBoard({ path: saveAs ? null : path, board: next })
    const now = store()
    if (now.board === board) {
      // Пока сохраняли, доску не меняли: запоминаем обложку и дату без записи в историю.
      useBoardStore.setState({ board: next })
      now.markSaved(result.path)
    } else {
      useBoardStore.setState({ path: result.path })
    }
    ui().notify('info', ru.board.saved(next.title))
    return true
  } catch (error) {
    ui().notify('error', `${ru.board.saveFailed}: ${messageOf(error)}`)
    return false
  } finally {
    saving = false
  }
}

/** Имя файла картинки: название доски, и номер кадра, если кадров больше одного. */
export function imageName(board: Board, frame: number): string {
  const base = safeFileName(board.title)
  return board.frameCount > 1 ? `${base} — ${ru.board.frameWord} ${frame + 1}` : base
}

export async function saveImage(): Promise<boolean> {
  const { board, frame } = store()
  if (!board) return false
  try {
    const png = await renderBoardPng(board, frame)
    const result = await window.api.saveBoardImage({
      suggestedName: imageName(board, frame),
      png: bytes(png)
    })
    if (!result) return false
    ui().notify('info', ru.board.imageSaved(result.path))
    return true
  } catch (error) {
    ui().notify('error', `${ru.board.imageFailed}: ${messageOf(error)}`)
    return false
  }
}

// --- Видео ---

let videoAbort: AbortController | null = null
let videoToken: string | null = null

export const canSaveVideo = (): boolean => (store().board?.frameCount ?? 0) > 1 && ui().job === null

export async function saveVideo(): Promise<boolean> {
  const { board } = store()
  if (!board || !canSaveVideo()) return false
  const total = Math.ceil(boardDuration(board) * BOARD_VIDEO_FPS)
  let started: { token: string; path: string } | null
  try {
    started = await window.api.exportBoardVideo({
      suggestedName: safeFileName(board.title),
      frameCount: total,
      fps: BOARD_VIDEO_FPS
    })
  } catch (error) {
    ui().notify('error', `${ru.board.videoFailed}: ${messageOf(error)}`)
    return false
  }
  if (!started) return false
  const { token, path } = started
  const abort = new AbortController()
  videoAbort = abort
  videoToken = token
  ui().setJob({ phase: 'render', done: 0, total })
  const offProgress = window.api.onBoardVideoProgress((p) => {
    if (p.token === token) ui().setJob({ phase: 'encode', done: p.done, total: p.total })
  })
  try {
    let batch: Uint8Array<ArrayBuffer>[] = []
    let start = 0
    // Одинаковые подряд кадры — один и тот же массив: отправляем как есть (IPC копирует), не передаём владение.
    for await (const { index, png } of renderBoardVideoFrames(board, { signal: abort.signal })) {
      batch.push(bytes(png))
      if (batch.length === MAX_STAGE_BATCH) {
        await window.api.stageBoardFrames({ token, start, pngs: batch })
        start = index + 1
        batch = []
        ui().setJob({ phase: 'render', done: start, total })
      }
    }
    abort.signal.throwIfAborted()
    if (batch.length > 0) await window.api.stageBoardFrames({ token, start, pngs: batch })
    ui().setJob({ phase: 'encode', done: 0, total })
    abort.signal.throwIfAborted()
    await window.api.finishBoardVideo(token)
    ui().notify('info', ru.board.videoSaved(path))
    return true
  } catch (error) {
    await window.api.cancelBoardVideo(token).catch(() => undefined)
    if (abort.signal.aborted) ui().notify('info', ru.board.videoCancelled)
    else ui().notify('error', `${ru.board.videoFailed}: ${messageOf(error)}`)
    return false
  } finally {
    offProgress()
    videoAbort = null
    videoToken = null
    ui().setJob(null)
  }
}

/** «Отмена» в строке состояния. */
export function cancelVideo(): void {
  videoAbort?.abort()
  if (videoToken) void window.api.cancelBoardVideo(videoToken).catch(() => undefined)
}

// --- Проигрывание ---

let raf = 0

/** Кадр, ближайший ко времени t проигрывания. */
export function frameAtTime(board: Board, t: number): number {
  const s = (t - LEAD_IN) / board.transition
  return Math.max(0, Math.min(board.frameCount - 1, Math.round(s)))
}

export function startBoardPlay(): void {
  const { board, setPlaying, setFrame } = store()
  if (!board || board.frameCount < 2) return
  cancelAnimationFrame(raf)
  setPlaying(true)
  const duration = boardDuration(board)
  const t0 = performance.now()
  const tick = (): void => {
    if (!store().playing) return
    const t = (performance.now() - t0) / 1000
    if (t >= duration) {
      setFrame(board.frameCount - 1)
      stopBoardPlay()
      return
    }
    ui().setPlayTime(t)
    raf = requestAnimationFrame(tick)
  }
  ui().setPlayTime(0)
  raf = requestAnimationFrame(tick)
}

/** Остановить: доска остаётся на кадре, ближайшем к моменту остановки. */
export function stopBoardPlay(): void {
  cancelAnimationFrame(raf)
  const { board, playing } = store()
  const t = ui().playTime
  if (playing) store().setPlaying(false)
  if (board && t !== null && playing) store().setFrame(frameAtTime(board, t))
  ui().setPlayTime(null)
}

export function toggleBoardPlay(): void {
  if (store().playing) stopBoardPlay()
  else startBoardPlay()
}

// --- Правка и кадры ---

export function boardUndo(): void {
  if (canEditBoard()) store().undo()
}

export function boardRedo(): void {
  if (canEditBoard()) store().redo()
}

export function deleteSelected(): void {
  const ids = store().selection
  if (ids.length === 0) return
  applyBoard((b) => ids.reduce((acc, id) => deleteItem(acc, id), b))
}

export function stepBoardFrame(delta: number): void {
  if (!canEditBoard()) return
  store().setFrame(store().frame + delta)
}

/** «+»: новый кадр после текущего (копия текущего), и переход на него. */
export function addFrameHere(): void {
  const frame = store().frame
  if (applyBoard((b) => addFrame(b, frame))) store().setFrame(frame + 1)
}

export function selectBoardTool(): void {
  store().setTool({ kind: 'select' })
  ui().setHand(false)
}

/** Esc: остановить проигрывание → инструмент «Выбор» → снять выделение. */
export function boardEscape(): void {
  if (store().playing) return stopBoardPlay()
  if (ui().hand) return ui().setHand(false)
  if (store().tool.kind !== 'select') return store().setTool({ kind: 'select' })
  if (store().selection.length > 0) store().select([])
}
