// Мышь на поле доски: поставить, выбрать, двигать, тянуть ручки, рисовать, двигать поле, приближать колесом.
import { useCallback, useRef, useState } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent
} from 'react'
import { addItem, deleteItem, editGeom, setStyle } from '../../../../shared/board/edit'
import { sceneAtFrame, type ResolvedItem } from '../../../../shared/board/resolve'
import type { Board, BoardElement } from '../../../../shared/board/schema'
import { applyBoard, canEditBoard } from './boardActions'
import { TEXT_SIZE, drawElement, placeElement, textElement } from './boardDraw'
import { dragHandle, handlesFor, type HandleKind } from './boardHandles'
import { useBoardStore, type BoardDraw } from './boardStore'
import { brushColor, useBoardUi } from './boardUi'
import { clampDelta, clientToBoard, hitTest, moveGeom, type Point } from './canvasMath'
import { BOARD_W } from './art/constants'

/** Сдвиг мыши меньше этого (пиксели экрана) — щелчок, а не протяжка. */
const CLICK_PX = 3
/** Радиус попадания по ручке, пиксели экрана. */
const HANDLE_HIT_PX = 11

type Drag =
  | { kind: 'move'; ids: string[]; start: Point; sx: number; sy: number; moved: boolean }
  | {
      kind: 'handle'
      id: string
      handle: HandleKind
      el: BoardElement
      start: Point
      sx: number
      sy: number
      moved: boolean
    }
  | { kind: 'draw'; draw: BoardDraw; points: Point[] }
  | { kind: 'pan'; sx: number; sy: number; pan0: { x: number; y: number } }
  /** Подпись открывается при отпускании кнопки: иначе нажатие мыши сразу уводит фокус из поля ввода. */
  | { kind: 'text'; p: Point; item?: ResolvedItem }

export interface TextEdit {
  p: Point
  /** Правка существующей подписи; нет — новая. */
  id?: string
  initial: string
  color: string
  size: number
}

const newId = (): string => crypto.randomUUID()
const DRAFT_ID = '00000000-0000-4000-8000-000000000000'
const isPen = (d: BoardDraw): boolean => d === 'pen' || d === 'pen-dashed'

/** Элемент в текущем кадре (только видимые). */
function sceneMap(board: Board, frame: number): Map<string, ResolvedItem> {
  return new Map(sceneAtFrame(board, frame).map((it) => [it.id, it]))
}

/** Сдвиг всех ids на общую величину, урезанную по краю для каждого. */
function moveAll(b: Board, frame: number, ids: string[], dx: number, dy: number): Board {
  const scene = sceneMap(b, frame)
  const els = ids.map((id) => scene.get(id)?.el).filter((e): e is BoardElement => !!e)
  let d = { x: dx, y: dy }
  for (const el of els) d = clampDelta(el, d.x, d.y)
  return ids.reduce((acc, id) => {
    const el = scene.get(id)?.el
    return el ? editGeom(acc, id, frame, moveGeom(el, d.x, d.y)) : acc
  }, b)
}

const isTextItem = (it: ResolvedItem | undefined): boolean =>
  it?.el.kind === 'shape' && it.el.ann.type === 'text'

export interface BoardPointer {
  /** Доска на время протяжки (до отпускания мыши в историю не попадает). */
  preview: Board | null
  /** Рисуемый сейчас элемент. */
  draft: BoardElement | null
  textEdit: TextEdit | null
  cursor: string
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
  onDoubleClick: (e: React.MouseEvent<HTMLElement>) => void
  onWheel: (e: ReactWheelEvent<HTMLElement>) => void
  commitText: (text: string) => void
  cancelText: () => void
}

/**
 * viewportRef — прямоугольник поля (16:9, с приближением); stageRef — вся область поля.
 * fit — размер поля без приближения, пиксели (для подписи и сдвига при приближении).
 */
export function useBoardPointer(
  viewportRef: RefObject<HTMLDivElement | null>,
  stageRef: RefObject<HTMLDivElement | null>,
  fit: { x: number; y: number; w: number; h: number }
): BoardPointer {
  const drag = useRef<Drag | null>(null)
  const [preview, setPreview] = useState<Board | null>(null)
  const [draft, setDraft] = useState<BoardElement | null>(null)
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null)
  const [cursor, setCursor] = useState('default')

  const toBoard = useCallback(
    (e: { clientX: number; clientY: number }): Point | null => {
      const r = viewportRef.current?.getBoundingClientRect()
      return r ? clientToBoard(r, e.clientX, e.clientY) : null
    },
    [viewportRef]
  )

  /** Пикселей экрана на пиксель доски сейчас. */
  const screenK = (): number => {
    const r = viewportRef.current?.getBoundingClientRect()
    return r && r.width > 0 ? r.width / BOARD_W : 1
  }

  const handleAt = (p: Point): { id: string; kind: HandleKind; el: BoardElement } | null => {
    const { board, frame, selection } = useBoardStore.getState()
    if (!board || selection.length !== 1) return null
    const item = sceneMap(board, frame).get(selection[0])
    if (!item) return null
    const k = screenK()
    const r = viewportRef.current?.getBoundingClientRect()
    if (!r) return null
    for (const h of handlesFor(item, k)) {
      const dx = (h.x - p.x) * r.width
      const dy = (h.y - p.y) * r.height
      if (Math.hypot(dx, dy) <= HANDLE_HIT_PX) return { id: item.id, kind: h.kind, el: item.el }
    }
    return null
  }

  const startText = (p: Point, existing?: ResolvedItem): void => {
    if (existing && existing.el.kind === 'shape' && existing.el.ann.type === 'text') {
      const a = existing.el.ann
      setTextEdit({
        p: a.pos,
        id: existing.id,
        initial: a.text,
        color: a.style.color,
        size: a.style.size
      })
      // Пока подпись правится, сама она не рисуется (иначе текст двоится).
      const board = useBoardStore.getState().board
      if (board) setPreview(deleteItem(board, existing.id))
      return
    }
    setTextEdit({
      p,
      initial: '',
      color: brushColor('text') ?? '#ffffff',
      size: TEXT_SIZE
    })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    if (textEdit) return // потеря фокуса поля ввода сама завершит подпись
    const st = useBoardStore.getState()
    const { board, frame, tool, selection } = st
    if (!board || e.button === 2) return
    const ui = useBoardUi.getState()
    const target = e.currentTarget
    if (e.button === 1 || ui.hand) {
      e.preventDefault()
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, pan0: ui.pan }
      target.setPointerCapture(e.pointerId)
      setCursor('grabbing')
      return
    }
    if (e.button !== 0 || !canEditBoard()) return
    const p = toBoard(e)
    if (!p || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return
    target.setPointerCapture(e.pointerId)

    const handle = handleAt(p)
    if (handle) {
      drag.current = {
        kind: 'handle',
        id: handle.id,
        el: handle.el,
        handle: handle.kind,
        start: p,
        sx: e.clientX,
        sy: e.clientY,
        moved: false
      }
      return
    }

    const scene = sceneAtFrame(board, frame)
    if (tool.kind === 'place') {
      const el = placeElement(tool.el, p, board.view, brushColor(st.section), board)
      const id = newId()
      if (applyBoard((b) => addItem(b, el, frame, id))) useBoardStore.getState().select([id])
      return
    }
    if (tool.kind === 'draw') {
      if (tool.draw === 'text') {
        const hit = hitTest(scene, p)
        const item = scene.find((it) => it.id === hit)
        drag.current = { kind: 'text', p, item: isTextItem(item) ? item : undefined }
        return
      }
      drag.current = { kind: 'draw', draw: tool.draw, points: [p] }
      return
    }
    // Выбор
    const hit = hitTest(scene, p)
    if (!hit) {
      if (!e.shiftKey) st.select([])
      return
    }
    let ids = selection
    if (e.shiftKey) {
      if (selection.includes(hit)) {
        st.select(selection.filter((id) => id !== hit))
        return
      }
      ids = [...selection, hit]
    } else if (!selection.includes(hit)) {
      ids = [hit]
    }
    st.select(ids)
    drag.current = { kind: 'move', ids, start: p, sx: e.clientX, sy: e.clientY, moved: false }
  }

  const hover = (e: ReactPointerEvent<HTMLElement>): void => {
    const { board, frame, tool, playing } = useBoardStore.getState()
    const ui = useBoardUi.getState()
    let next = 'default'
    if (ui.hand) next = 'grab'
    else if (board && !playing) {
      const p = toBoard(e)
      const inside = p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
      if (p && inside) {
        const h = handleAt(p)
        if (h) next = h.kind === 'rotate' ? 'grab' : h.kind === 'scale' ? 'nwse-resize' : 'move'
        else if (tool.kind === 'place') next = 'copy'
        else if (tool.kind === 'draw') next = tool.draw === 'text' ? 'text' : 'crosshair'
        else if (hitTest(sceneAtFrame(board, frame), p)) next = 'move'
      }
    }
    if (next !== cursor) setCursor(next)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current
    if (!d) return hover(e)
    const { board, frame } = useBoardStore.getState()
    if (!board || d.kind === 'text') return
    if (d.kind === 'pan') {
      const ui = useBoardUi.getState()
      ui.setView(
        ui.zoom,
        clampPan({ x: d.pan0.x + e.clientX - d.sx, y: d.pan0.y + e.clientY - d.sy }, ui.zoom, fit)
      )
      return
    }
    const p = toBoard(e)
    if (!p) return
    if (d.kind === 'draw') {
      if (isPen(d.draw)) {
        const last = d.points[d.points.length - 1]
        if (Math.hypot(p.x - last.x, p.y - last.y) > 0.0015) d.points.push(p)
      } else {
        d.points = [d.points[0], p]
      }
      const section = useBoardStore.getState().section
      setDraft(drawElement(d.draw, d.points, brushColor(section) ?? '#ffffff', DRAFT_ID))
      return
    }
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < CLICK_PX) return
    d.moved = true
    try {
      if (d.kind === 'move')
        setPreview(moveAll(board, frame, d.ids, p.x - d.start.x, p.y - d.start.y))
      else setPreview(dragHandle(board, d.id, frame, d.el, d.handle, d.start, p, e.shiftKey))
    } catch {
      // недопустимое положение (например, точка вне поля) — показываем последнее допустимое
    }
  }

  const finish = (e: ReactPointerEvent<HTMLElement>, commit: boolean): void => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    setPreview(null)
    setDraft(null)
    if (!d || !commit) return
    if (d.kind === 'pan') return setCursor(useBoardUi.getState().hand ? 'grab' : 'default')
    if (d.kind === 'text') return startText(d.p, d.item)
    const { frame } = useBoardStore.getState()
    const p = toBoard(e)
    if (!p) return
    if (d.kind === 'draw') {
      const pts = isPen(d.draw) ? d.points : [d.points[0], p]
      const section = useBoardStore.getState().section
      const el = drawElement(d.draw, pts, brushColor(section) ?? '#ffffff', newId())
      if (!el) return
      const id = newId()
      if (applyBoard((b) => addItem(b, el, frame, id))) useBoardStore.getState().select([id])
      return
    }
    if (!d.moved) return
    if (d.kind === 'move') {
      const { x: dx, y: dy } = { x: p.x - d.start.x, y: p.y - d.start.y }
      applyBoard((b) => moveAll(b, frame, d.ids, dx, dy))
    } else {
      applyBoard((b) => dragHandle(b, d.id, frame, d.el, d.handle, d.start, p, e.shiftKey))
    }
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLElement>): void => {
    const { board, frame, tool } = useBoardStore.getState()
    if (!board || tool.kind !== 'select' || !canEditBoard()) return
    const p = toBoard(e)
    if (!p) return
    const scene = sceneAtFrame(board, frame)
    const item = scene.find((it) => it.id === hitTest(scene, p))
    if (isTextItem(item)) startText(p, item)
  }

  const onWheel = (e: ReactWheelEvent<HTMLElement>): void => {
    const stage = stageRef.current?.getBoundingClientRect()
    if (!stage || e.deltaY === 0) return
    const ui = useBoardUi.getState()
    const zoom = Math.min(4, Math.max(1, ui.zoom * Math.exp(-e.deltaY * 0.0015)))
    // Точка под курсором остаётся на месте.
    const cx = fit.x + fit.w / 2
    const cy = fit.y + fit.h / 2
    const mx = e.clientX - stage.left
    const my = e.clientY - stage.top
    const vx = (mx - cx - ui.pan.x) / ui.zoom
    const vy = (my - cy - ui.pan.y) / ui.zoom
    const pan = clampPan({ x: mx - cx - zoom * vx, y: my - cy - zoom * vy }, zoom, fit)
    ui.setView(zoom, pan)
  }

  const commitText = (text: string): void => {
    const edit = textEdit
    setTextEdit(null)
    setPreview(null)
    const value = text.trim()
    if (!edit || !value) return
    const { frame } = useBoardStore.getState()
    if (edit.id) {
      const id = edit.id
      applyBoard((b) => setStyle(b, id, { text: value }))
      return
    }
    const el = textElement(value, edit.p, edit.color, newId())
    const id = newId()
    if (applyBoard((b) => addItem(b, el, frame, id))) useBoardStore.getState().select([id])
  }

  const cancelText = (): void => {
    setTextEdit(null)
    setPreview(null)
  }

  return {
    preview,
    draft,
    textEdit,
    cursor,
    onPointerDown,
    onPointerMove,
    onPointerUp: (e) => finish(e, true),
    onPointerCancel: (e) => finish(e, false),
    onDoubleClick,
    onWheel,
    commitText,
    cancelText
  }
}

/** Сдвиг поля при приближении: край поля не уходит внутрь области. */
export function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  fit: { w: number; h: number }
): { x: number; y: number } {
  const mx = ((zoom - 1) * fit.w) / 2
  const my = ((zoom - 1) * fit.h) / 2
  return { x: Math.max(-mx, Math.min(mx, pan.x)), y: Math.max(-my, Math.min(my, pan.y)) }
}
