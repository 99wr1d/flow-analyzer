import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_TEXT_LENGTH,
  defaultDuration,
  isVisible,
  type Annotation,
  type Point,
  type TextAnnotation
} from '../../../../shared/annotations'
import { usePlayerStore } from '../../store/playerStore'
import { getVideoElement } from '../player/videoElement'
import { useAnnotationsStore } from './annotationsStore'
import {
  bboxOf,
  clampPoint,
  moveBy,
  moveHandle,
  snapAngle,
  squareFrom,
  type BBox,
  type HandleId,
  type Rect,
  type Size
} from './geometry'
import { handleAt, textRect, topHit, type PxPoint } from './hit'
import { HandlesView, ShapeView } from './ShapeView'
import { shapeStyleOf, textStyleOf } from './styles'
import { TextEditor } from './TextEditor'
import { measureTextWidth } from './textMetrics'
import { usePictureRect } from './usePictureRect'

/** Минимальный размер нового рисунка в пикселях — защита от случайных точек. */
const MIN_LINE_PX = 12
const MIN_BOX_PX = 8

type DrawTool = 'arrow' | 'line' | 'circle'

type Gesture =
  | { kind: 'draw'; tool: DrawTool; origin: Point; start: number; duration: number }
  | { kind: 'move'; id: string; before: Annotation[]; origin: Point; item: Annotation; box: BBox }
  | { kind: 'handle'; id: string; before: Annotation[]; handle: HandleId; item: Annotation }

type EditorState =
  { mode: 'new'; pos: Point; start: number; duration: number } | { mode: 'edit'; id: string }

function pauseVideo(): void {
  const el = getVideoElement()
  if (el && !el.paused) el.pause()
}

function bboxFor(a: Annotation, size: Size): BBox {
  if (a.type !== 'text') return bboxOf(a)
  const r = textRect(a, size, measureTextWidth(a.text, a.style.size * size.h))
  return bboxOf(a, r, size)
}

/** Если выбранный рисунок перестал быть видимым из-за смены времени (воспроизведение, перемотка) — снимаем выделение. */
function useSelectionGuard(): void {
  useEffect(() => {
    return usePlayerStore.subscribe((s, prev) => {
      if (s.currentTime === prev.currentTime) return
      const { selectedId, items, select } = useAnnotationsStore.getState()
      if (!selectedId) return
      const a = items.find((x) => x.id === selectedId)
      if (!a || !isVisible(a, s.currentTime, s.fps)) select(null)
    })
  }, [])
}

/** Рисунки, видимые сейчас. Ключ — строка id: компонент перерисовывается, только когда набор меняется. */
function useVisibleKey(items: Annotation[]): string {
  return usePlayerStore((s) =>
    items
      .filter((a) => isVisible(a, s.currentTime, s.fps))
      .map((a) => a.id)
      .join(',')
  )
}

interface SurfaceProps {
  rect: Rect
}

function Surface({ rect }: SurfaceProps): React.JSX.Element {
  const size = useMemo<Size>(() => ({ w: rect.w, h: rect.h }), [rect.w, rect.h])
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)

  const items = useAnnotationsStore((s) => s.items)
  const selectedId = useAnnotationsStore((s) => s.selectedId)
  const tool = useAnnotationsStore((s) => s.tool)
  const visibleKey = useVisibleKey(items)

  const visible = useMemo(() => {
    const ids = new Set(visibleKey ? visibleKey.split(',') : [])
    return items.filter((a) => ids.has(a.id) || a.id === selectedId)
  }, [items, visibleKey, selectedId])

  const selected = visible.find((a) => a.id === selectedId) ?? null
  const editingId = editor?.mode === 'edit' ? editor.id : null

  const eventPoint = (e: { clientX: number; clientY: number }): { norm: Point; px: PxPoint } => {
    const box = svgRef.current!.getBoundingClientRect()
    const px = { x: e.clientX - box.left, y: e.clientY - box.top }
    return { norm: { x: px.x / box.width, y: px.y / box.height }, px }
  }

  const buildDraft = (
    g: Extract<Gesture, { kind: 'draw' }>,
    to: Point,
    shift: boolean
  ): Annotation => {
    const style = useAnnotationsStore.getState().style
    const clamped = clampPoint(to)
    let end = clamped
    if (shift)
      end =
        g.tool === 'circle'
          ? squareFrom(g.origin, clamped, size)
          : snapAngle(g.origin, clamped, size)
    return {
      id: crypto.randomUUID(),
      type: g.tool,
      p1: g.origin,
      p2: end,
      style: shapeStyleOf(style),
      timing: { mode: 'range', start: g.start, duration: g.duration }
    }
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return
    // Поле ввода текста (если открыто) закрываем, снимая с него фокус.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const { norm, px } = eventPoint(e)
    const store = useAnnotationsStore.getState()
    const player = usePlayerStore.getState()
    const video = getVideoElement()
    const now = video?.currentTime ?? player.currentTime

    if (store.tool === 'select') {
      const current = store.items.find((a) => a.id === store.selectedId)
      if (current && visible.some((a) => a.id === current.id)) {
        const handle = handleAt(current, px, size)
        if (handle) {
          gesture.current = {
            kind: 'handle',
            id: current.id,
            before: store.items,
            handle,
            item: current
          }
          svgRef.current?.setPointerCapture(e.pointerId)
          return
        }
      }
      const hit = topHit(visible, px, size, measureTextWidth)
      if (hit) {
        store.select(hit.id)
        gesture.current = {
          kind: 'move',
          id: hit.id,
          before: store.items,
          origin: norm,
          item: hit,
          box: bboxFor(hit, size)
        }
        svgRef.current?.setPointerCapture(e.pointerId)
      } else {
        store.select(null)
      }
      return
    }

    if (norm.x < 0 || norm.x > 1 || norm.y < 0 || norm.y > 1) return
    pauseVideo()
    const duration = defaultDuration(now, player.duration)
    if (store.tool === 'text') {
      store.select(null)
      setEditor({ mode: 'new', pos: norm, start: now, duration })
      return
    }
    const g: Gesture = { kind: 'draw', tool: store.tool, origin: norm, start: now, duration }
    gesture.current = g
    store.select(null)
    setDraft(buildDraft(g, norm, e.shiftKey))
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const g = gesture.current
    const { norm, px } = eventPoint(e)
    const store = useAnnotationsStore.getState()
    if (!g) {
      // Подсказка курсором: что лежит под мышью.
      const svg = svgRef.current
      if (!svg) return
      if (store.tool !== 'select') {
        svg.style.cursor = store.tool === 'text' ? 'text' : 'crosshair'
        return
      }
      const current = store.items.find((a) => a.id === store.selectedId)
      if (current && handleAt(current, px, size)) svg.style.cursor = 'grab'
      else svg.style.cursor = topHit(visible, px, size, measureTextWidth) ? 'move' : 'default'
      return
    }
    if (g.kind === 'draw') {
      setDraft(buildDraft(g, norm, e.shiftKey))
    } else if (g.kind === 'move') {
      const moved = moveBy(g.item, norm.x - g.origin.x, norm.y - g.origin.y, g.box)
      store.preview(store.items.map((a) => (a.id === g.id ? moved : a)))
    } else {
      let target = clampPoint(norm)
      if (e.shiftKey && g.item.type !== 'text') {
        if (g.item.type === 'circle') {
          const b = bboxOf(g.item)
          const fixed = {
            x: g.handle === 'nw' || g.handle === 'sw' ? b.x1 : b.x0,
            y: g.handle === 'nw' || g.handle === 'ne' ? b.y1 : b.y0
          }
          target = squareFrom(fixed, target, size)
        } else {
          target = snapAngle(g.handle === 'p1' ? g.item.p2 : g.item.p1, target, size)
        }
      }
      const moved = moveHandle(g.item, g.handle, target)
      store.preview(store.items.map((a) => (a.id === g.id ? moved : a)))
    }
  }

  const finish = (e: React.PointerEvent<SVGSVGElement>, cancelled: boolean): void => {
    const g = gesture.current
    gesture.current = null
    if (svgRef.current?.hasPointerCapture(e.pointerId))
      svgRef.current.releasePointerCapture(e.pointerId)
    if (!g) return
    const store = useAnnotationsStore.getState()
    if (g.kind === 'draw') {
      const d = draft
      setDraft(null)
      if (!d || d.type === 'text' || cancelled) return
      const dx = Math.abs(d.p2.x - d.p1.x) * size.w
      const dy = Math.abs(d.p2.y - d.p1.y) * size.h
      const big =
        d.type === 'circle'
          ? dx >= MIN_BOX_PX && dy >= MIN_BOX_PX
          : Math.hypot(dx, dy) >= MIN_LINE_PX
      if (big) store.add(d)
    } else if (cancelled) {
      store.preview(g.before)
    } else {
      store.commitFrom(g.before)
    }
  }

  const commitText = (text: string): void => {
    const current = editor
    setEditor(null)
    const store = useAnnotationsStore.getState()
    const clean = text.trim().slice(0, MAX_TEXT_LENGTH)
    if (!current || clean === '') return
    if (current.mode === 'edit') {
      store.setText(current.id, clean)
      return
    }
    const base: TextAnnotation = {
      id: crypto.randomUUID(),
      type: 'text',
      pos: clampPoint(current.pos),
      text: clean,
      style: textStyleOf(store.style),
      timing: { mode: 'range', start: current.start, duration: current.duration }
    }
    store.add(moveBy(base, 0, 0, bboxFor(base, size)))
  }

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const store = useAnnotationsStore.getState()
    if (store.tool !== 'select') return
    const { px } = eventPoint(e)
    const hit = topHit(visible, px, size, measureTextWidth)
    if (hit && hit.type === 'text') {
      pauseVideo()
      store.select(hit.id)
      setEditor({ mode: 'edit', id: hit.id })
    }
  }

  const editedText = editor?.mode === 'edit' ? items.find((a) => a.id === editor.id) : undefined
  const style = useAnnotationsStore.getState().style
  let editorProps: {
    x: number
    y: number
    style: TextAnnotation['style']
    initial: string
  } | null = null
  if (editor?.mode === 'new') {
    editorProps = {
      x: rect.x + editor.pos.x * size.w,
      y: rect.y + editor.pos.y * size.h,
      style: textStyleOf(style),
      initial: ''
    }
  } else if (editedText && editedText.type === 'text') {
    editorProps = {
      x: rect.x + editedText.pos.x * size.w,
      y: rect.y + editedText.pos.y * size.h,
      style: editedText.style,
      initial: editedText.text
    }
  }

  return (
    <>
      <svg
        ref={svgRef}
        className="anno-svg"
        data-testid="annotation-layer"
        data-tool={tool}
        width={rect.w}
        height={rect.h}
        style={{ left: rect.x, top: rect.y }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onDoubleClick={onDoubleClick}
        onMouseDown={(e) => e.preventDefault()}
      >
        {visible
          .filter((a) => a.id !== editingId)
          .map((a) => (
            <ShapeView
              key={a.id}
              annotation={a}
              size={size}
              selected={a.id === selectedId}
              showHandles={tool === 'select'}
            />
          ))}
        {draft && <ShapeView annotation={draft} size={size} selected={false} showHandles={false} />}
        {selected && tool === 'select' && !editor && (
          <HandlesView annotation={selected} size={size} />
        )}
      </svg>
      {editorProps && (
        <TextEditor
          key={
            editor?.mode === 'edit'
              ? editor.id
              : `new-${editor?.start}-${editor?.pos.x}-${editor?.pos.y}`
          }
          x={editorProps.x}
          y={editorProps.y}
          style={editorProps.style}
          videoHeight={size.h}
          initial={editorProps.initial}
          onCommit={commitText}
          onCancel={() => setEditor(null)}
        />
      )}
    </>
  )
}

/** Слой рисунков поверх видео: SVG точно по картинке (без чёрных полей) + редактор текста. */
export function AnnotationLayer(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const ready = usePlayerStore((s) => s.status === 'ready')
  const videoId = usePlayerStore((s) => s.source?.id)
  const rect = usePictureRect(hostRef, ready, videoId)
  useSelectionGuard()
  return (
    <div ref={hostRef} className="anno-host">
      {ready && rect && <Surface rect={rect} />}
    </div>
  )
}
