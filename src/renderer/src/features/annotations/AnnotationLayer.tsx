import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FREEZE,
  DEFAULT_LOUPE_RADIUS,
  DEFAULT_RING_RADIUS,
  DEFAULT_SPOT_RADIUS,
  MAX_PEN_POINTS,
  MAX_TEXT_LENGTH,
  MIN_RING_RADIUS,
  MIN_SPOT_RADIUS,
  defaultDuration,
  frameCenter,
  isPitchAnnotation,
  isSpotlight,
  isVisible,
  type Annotation,
  type GroundText,
  type Loupe,
  type PitchAnnotation,
  type Point,
  type ScreenAnnotation,
  type TextAnnotation
} from '../../../../shared/annotations'
import { isCalibrationFresh } from '../../../../shared/pitch/calibration'
import {
  handleAnchor,
  moveWorld,
  moveWorldHandle,
  snapWorldAngle
} from '../../../../shared/pitch/edit'
import type { Pt } from '../../../../shared/pitch/linalg'
import type { Projector } from '../../../../shared/pitch/projector'
import { worldDistance, type PitchHandleId } from '../../../../shared/pitch/shapes'
import { defaultControl } from '../../../../shared/tools/curve'
import { hasVertices, vertexIndex } from '../../../../shared/tools/points'
import { insertionPoint, pushVertex } from '../../../../shared/tools/polygon'
import { simplifyStroke } from '../../../../shared/tools/simplify'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { useCalibrationsStore } from '../pitch/calibrationsStore'
import { gridPath, gridPrimitives } from '../pitch/gridPaths'
import { hitPaint, paintOf, pitchHandleAt } from '../pitch/hitPitch'
import { usePitchStore } from '../pitch/pitchStore'
import { nearestUsable, projectorMapNow, useProjectors } from '../pitch/usePitch'
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
import { LoupeLenses } from './LoupeLenses'
import {
  cancelPolyDraft,
  draftAnnotation,
  finishPolyDraft,
  usePolyDraft,
  type PolyTool
} from './polyDraft'
import { HandlesView, ShapeView } from './ShapeView'
import { SpotlightDim } from './SpotlightDim'
import { shapeStyleOf, textStyleOf } from './styles'
import { TextEditor } from './TextEditor'
import { measureTextWidth } from './textMetrics'
import { usePictureRect } from './usePictureRect'

/** Минимальный размер нового рисунка в пикселях — защита от случайных точек. */
const MIN_LINE_PX = 12
const MIN_BOX_PX = 8
/** Минимальная длина линии на поле, метры. */
const MIN_GROUND_LENGTH = 0.3
/** Пока курсор ушёл от центра кольца меньше, чем на столько пикселей, радиус остаётся стандартным (клик = кольцо 1 м). */
const RING_DRAG_PX = 6
/** Щелчок без протягивания: прожектор и лупа получают размер по умолчанию. */
const CLICK_PX = 6
/** Размеры прожектора по умолчанию (доли высоты кадра): высокий эллипс вокруг игрока. */
const SPOT_RX = 0.042
const SPOT_RY = 0.08
/** Перо: точки ближе друг к другу (в пикселях) не собираются; допуск упрощения. */
const PEN_STEP_PX = 1.5
const PEN_TOLERANCE_PX = 1.8
const PEN_RAW_LIMIT = 3000
/** Следующая вершина ближе этого (в пикселях) к последней — это второй щелчок двойного щелчка. */
const VERTEX_MIN_PX = 4
/** Щелчок ближе этого к первой вершине зоны замыкает её. */
const CLOSE_PX = 10
/** Alt+щелчок добавляет вершину, если курсор не дальше этого от линии. */
const INSERT_PX = 12
/** Кривая новой стрелки изогнута на эту долю её длины. */
const CURVE_BEND = 0.28

type DrawTool = 'arrow' | 'line' | 'circle' | 'spot' | 'curve' | 'loupe'
type PitchDrawTool = 'arrow' | 'line' | 'circle' | 'ruler' | 'spot' | 'curve'
/** Инструменты, которые умеют рисовать на поле, когда включено «На поле». */
const PITCH_TOOLS = ['arrow', 'line', 'circle', 'text', 'spot', 'curve', 'pen', 'zone', 'chain']

interface PitchTarget {
  calibrationId: string
  projector: Projector
}

interface PenSample {
  x: number
  y: number
  norm: Point
  world: Pt | null
}

type Gesture =
  | { kind: 'draw'; tool: DrawTool; origin: Point; start: number; duration: number }
  | {
      kind: 'pdraw'
      tool: PitchDrawTool
      origin: Pt
      originPx: PxPoint
      target: PitchTarget
      start: number
      last: Pt
    }
  | {
      kind: 'pen'
      target: PitchTarget | null
      start: number
      duration: number
      raw: PenSample[]
    }
  | {
      kind: 'move'
      id: string
      before: Annotation[]
      origin: Point
      item: ScreenAnnotation
      box: BBox
    }
  | { kind: 'handle'; id: string; before: Annotation[]; handle: HandleId; item: ScreenAnnotation }
  | {
      kind: 'pmove'
      id: string
      before: Annotation[]
      origin: Pt
      item: PitchAnnotation
      projector: Projector
    }
  | {
      kind: 'phandle'
      id: string
      before: Annotation[]
      handle: PitchHandleId
      item: PitchAnnotation
      projector: Projector
    }

type EditorState =
  | {
      mode: 'new'
      pos: Point
      start: number
      duration: number
      pitch: { world: Pt; target: PitchTarget } | null
    }
  | { mode: 'edit'; id: string }

function pauseVideo(): void {
  const el = getVideoElement()
  if (el && !el.paused) el.pause()
}

function bboxFor(a: ScreenAnnotation, size: Size): BBox {
  if (a.type !== 'text') return bboxOf(a, undefined, size)
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

/**
 * Рисунки, видимые сейчас. Ключ — строка id (с «!» у рисунков на поле, показанных далеко от кадра разметки):
 * компонент перерисовывается, только когда набор или признак меняется.
 */
function useVisibleKey(items: Annotation[]): string {
  const calibrations = useCalibrationsStore((s) => s.items)
  const times = useMemo(() => new Map(calibrations.map((c) => [c.id, c.time])), [calibrations])
  return usePlayerStore((s) =>
    items
      .filter((a) => isVisible(a, s.currentTime, s.fps))
      .map((a) => {
        if (!isPitchAnnotation(a)) return a.id
        const t = times.get(a.calibrationId)
        return t !== undefined && !isCalibrationFresh({ time: t }, s.currentTime)
          ? `${a.id}!`
          : a.id
      })
      .join(',')
  )
}

/** Разметка, сетку которой показываем сейчас (id) или пусто. */
function useGridCalibrationId(): string {
  const show = usePitchStore((s) => s.showGrid)
  const items = useCalibrationsStore((s) => s.items)
  return usePlayerStore((s) => {
    if (!show) return ''
    const near = nearestUsable(items, s.currentTime)
    return near && isCalibrationFresh(near.calibration, s.currentTime) ? near.calibration.id : ''
  })
}

/** Куда рисовать новый рисунок: на поле (разметка + проектор) или null — на экране. */
function pitchTargetFor(tool: string, time: number): PitchTarget | null | 'missing' {
  const near = nearestUsable(useCalibrationsStore.getState().items, time)
  if (tool === 'ruler') {
    if (!near) return 'missing'
  } else if (!usePitchStore.getState().onPitch || !PITCH_TOOLS.includes(tool)) {
    return null
  }
  if (!near) return null
  const projector = projectorMapNow().get(near.calibration.id)
  return projector ? { calibrationId: near.calibration.id, projector } : null
}

/** Shift у ручки рисунка на экране: привязка к углам относительно соседней точки (круг — к кругу). */
function snapScreenHandle(
  item: ScreenAnnotation,
  handle: string,
  target: Point,
  size: Size
): Point {
  if (item.type === 'circle' || item.type === 'spot') {
    const b = bboxOf(item)
    const fixed = {
      x: handle === 'nw' || handle === 'sw' ? b.x1 : b.x0,
      y: handle === 'nw' || handle === 'ne' ? b.y1 : b.y0
    }
    return squareFrom(fixed, target, size)
  }
  if (item.type === 'arrow' || item.type === 'line' || item.type === 'curve') {
    if (handle !== 'p1' && handle !== 'p2') return target
    return snapAngle(handle === 'p1' ? item.p2 : item.p1, target, size)
  }
  if (item.type === 'zone' || item.type === 'chain') {
    const i = vertexIndex(handle)
    if (i === null) return target
    const anchor = item.points[i > 0 ? i - 1 : 1]
    return anchor ? snapAngle(anchor, target, size) : target
  }
  return target
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
  const selectedNode = useAnnotationsStore((s) => s.selectedNode)
  const tool = useAnnotationsStore((s) => s.tool)
  const poly = usePolyDraft((s) => s.draft)
  const visibleKey = useVisibleKey(items)
  const projectors = useProjectors()
  const gridId = useGridCalibrationId()
  const calibrations = useCalibrationsStore((s) => s.items)
  const lookup = (id: string): Projector | null | undefined => projectors.get(id)

  const { visible, staleIds } = useMemo(() => {
    const keys = visibleKey ? visibleKey.split(',') : []
    const ids = new Set(keys.map((k) => k.replace('!', '')))
    return {
      visible: items.filter((a) => ids.has(a.id) || a.id === selectedId),
      staleIds: new Set(keys.filter((k) => k.endsWith('!')).map((k) => k.slice(0, -1)))
    }
  }, [items, visibleKey, selectedId])

  // Недорисованная зона или связь отменяется, когда слой исчезает (новое видео, закрытие проекта).
  useEffect(() => () => void cancelPolyDraft(), [])

  const gridPathData = useMemo(() => {
    const c = calibrations.find((x) => x.id === gridId)
    const proj = c ? projectors.get(c.id) : null
    if (!c || !proj) return ''
    return gridPath(proj, gridPrimitives(c.template, c.pitch, c.rect ?? { w: 40, h: 16 }), size)
  }, [calibrations, gridId, projectors, size])

  const selected = visible.find((a) => a.id === selectedId) ?? null
  const editingId = editor?.mode === 'edit' ? editor.id : null

  const eventPoint = (e: { clientX: number; clientY: number }): { norm: Point; px: PxPoint } => {
    const box = svgRef.current!.getBoundingClientRect()
    const px = { x: e.clientX - box.left, y: e.clientY - box.top }
    return { norm: { x: px.x / box.width, y: px.y / box.height }, px }
  }

  /** Верхний рисунок (экранный или на поле) под курсором. */
  const topHitAny = (px: PxPoint): Annotation | null => {
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const a = visible[i]
      if (isPitchAnnotation(a)) {
        const paint = paintOf(a, lookup, size, measureTextWidth)
        if (paint && hitPaint(paint, px)) return a
      } else if (topHit([a], px, size, measureTextWidth)) {
        return a
      }
    }
    return null
  }

  /** Размер прожектора и лупы по умолчанию вокруг точки (рисунок остаётся внутри картинки). */
  const defaultSpot = (center: Point): { p1: Point; p2: Point } => {
    const rx = (SPOT_RX * size.h) / size.w
    const ry = SPOT_RY
    const cx = Math.min(1 - rx, Math.max(rx, center.x))
    const cy = Math.min(1 - ry, Math.max(ry, center.y))
    return { p1: { x: cx - rx, y: cy - ry }, p2: { x: cx + rx, y: cy + ry } }
  }

  const buildDraft = (
    g: Extract<Gesture, { kind: 'draw' }>,
    to: Point,
    shift: boolean
  ): Annotation => {
    const { style, options } = useAnnotationsStore.getState()
    const clamped = clampPoint(to)
    const moved = Math.hypot((clamped.x - g.origin.x) * size.w, (clamped.y - g.origin.y) * size.h)
    const timing = { mode: 'range' as const, start: g.start, duration: g.duration }
    const base = { id: crypto.randomUUID(), space: 'screen' as const, timing }
    if (g.tool === 'spot') {
      const box = moved < CLICK_PX ? defaultSpot(g.origin) : { p1: g.origin, p2: clamped }
      return { ...base, type: 'spot', ...box, dim: options.dim, style: shapeStyleOf(style) }
    }
    if (g.tool === 'loupe') {
      const radius = DEFAULT_LOUPE_RADIUS
      const rx = (radius * size.h) / size.w
      const clampLens = (p: Point): Point => ({
        x: Math.min(1 - rx, Math.max(rx, p.x)),
        y: Math.min(1 - radius, Math.max(radius, p.y))
      })
      const pos = moved < CLICK_PX ? clampLens(g.origin) : clampLens(clamped)
      return {
        ...base,
        type: 'loupe',
        pos,
        src: g.origin,
        radius,
        zoom: options.zoom,
        style: shapeStyleOf(style)
      }
    }
    let end = clamped
    if (shift)
      end =
        g.tool === 'circle'
          ? squareFrom(g.origin, clamped, size)
          : snapAngle(g.origin, clamped, size)
    if (g.tool === 'curve') {
      return {
        ...base,
        type: 'curve',
        p1: g.origin,
        p2: end,
        c: defaultControl(g.origin, end, CURVE_BEND, size),
        style: shapeStyleOf(style)
      }
    }
    return {
      ...base,
      type: g.tool,
      p1: g.origin,
      p2: end,
      style: shapeStyleOf(style)
    }
  }

  const pitchTiming = (start: number): PitchAnnotation['timing'] => ({
    mode: 'frame',
    start: frameCenter(start, usePlayerStore.getState().fps),
    freezeSeconds: DEFAULT_FREEZE
  })

  /** Рисунок на поле по жесту: origin → to (метры). px — расстояние курсора от начала в пикселях. */
  const buildPitchDraft = (
    g: Extract<Gesture, { kind: 'pdraw' }>,
    to: Pt,
    movedPx: number,
    shift: boolean,
    id?: string
  ): PitchAnnotation => {
    const { style: current, options } = useAnnotationsStore.getState()
    const style = shapeStyleOf(current)
    const base = {
      id: id ?? crypto.randomUUID(),
      space: 'pitch' as const,
      calibrationId: g.target.calibrationId,
      timing: pitchTiming(g.start)
    }
    if (g.tool === 'circle') {
      let radius = DEFAULT_RING_RADIUS
      if (movedPx >= RING_DRAG_PX) {
        radius = Math.max(MIN_RING_RADIUS, worldDistance(g.origin, to))
        if (shift) radius = Math.max(0.5, Math.round(radius * 2) / 2)
      }
      return { ...base, type: 'ring', center: g.origin, radius, style }
    }
    if (g.tool === 'spot') {
      let radius = DEFAULT_SPOT_RADIUS
      if (movedPx >= RING_DRAG_PX) {
        radius = Math.max(MIN_SPOT_RADIUS, worldDistance(g.origin, to))
        if (shift) radius = Math.max(0.5, Math.round(radius * 2) / 2)
      }
      return {
        ...base,
        type: 'pspot',
        center: g.origin,
        radius,
        dim: options.dim,
        beam: options.beam,
        style
      }
    }
    const end = shift ? snapWorldAngle(g.origin, to) : to
    if (g.tool === 'curve') {
      return {
        ...base,
        type: 'pcurve',
        p1: g.origin,
        p2: end,
        c: defaultControl(g.origin, end, CURVE_BEND),
        style
      }
    }
    const type = g.tool === 'arrow' ? 'parrow' : g.tool === 'line' ? 'pline' : 'ruler'
    return { ...base, type, p1: g.origin, p2: end, style }
  }

  /** Перо: рисунок по собранным точкам (на экране — доли кадра, на поле — метры). */
  const buildPen = (g: Extract<Gesture, { kind: 'pen' }>, raw: PenSample[]): Annotation | null => {
    const { style, options } = useAnnotationsStore.getState()
    const ss = shapeStyleOf(style)
    const pts = raw.length === 1 ? [raw[0], raw[0]] : raw
    if (g.target) {
      const points = pts.map((p) => p.world).filter((p): p is Pt => p !== null)
      if (points.length < 2) return null
      return {
        id: 'pen-draft',
        space: 'pitch',
        calibrationId: g.target.calibrationId,
        type: 'ppen',
        points,
        arrow: options.arrow,
        style: ss,
        timing: pitchTiming(g.start)
      }
    }
    return {
      id: 'pen-draft',
      space: 'screen',
      type: 'pen',
      points: pts.map((p) => clampPoint(p.norm)),
      arrow: options.arrow,
      style: ss,
      timing: { mode: 'range', start: g.start, duration: g.duration }
    }
  }

  /** Щелчок инструментом «Зона» или «Связи игроков». */
  const polyClick = (
    toolId: PolyTool,
    norm: Point,
    px: PxPoint,
    shift: boolean,
    now: number
  ): void => {
    const drafts = usePolyDraft.getState()
    let d = drafts.draft
    if (!d) {
      const target = pitchTargetFor(toolId, now)
      if (target === 'missing') return
      drafts.begin({
        tool: toolId,
        space: target ? 'pitch' : 'screen',
        calibrationId: target ? target.calibrationId : null,
        start: now
      })
      d = usePolyDraft.getState().draft
    }
    if (!d) return
    let point: { x: number; y: number } | null
    let projector: Projector | null | undefined = null
    if (d.space === 'pitch') {
      projector = d.calibrationId ? lookup(d.calibrationId) : null
      point = projector ? projector.toWorld(norm) : null
    } else {
      point = norm
    }
    if (!point) return
    // Для зоны щелчок рядом с первой вершиной замыкает её.
    if (d.tool === 'zone' && d.points.length >= 3) {
      const first = d.points[0]
      const firstNorm = d.space === 'pitch' ? projector?.toImage(first) : first
      if (firstNorm) {
        const dist = Math.hypot(firstNorm.x * size.w - px.x, firstNorm.y * size.h - px.y)
        if (dist <= CLOSE_PX) {
          finishPolyDraft()
          return
        }
      }
    }
    if (shift && d.points.length > 0) {
      const prev = d.points[d.points.length - 1]
      point =
        d.space === 'pitch' ? snapWorldAngle(prev, point) : snapAngle(prev, clampPoint(point), size)
    } else if (d.space === 'screen') {
      point = clampPoint(point)
    }
    // Второй щелчок двойного щелчка не добавляет лишнюю вершину.
    const minDist =
      d.space === 'pitch' ? 0.15 : VERTEX_MIN_PX / Math.max(1, Math.min(size.w, size.h))
    const next = pushVertex(d.points, point, minDist)
    if (next.length !== d.points.length) usePolyDraft.getState().addPoint(point)
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
        // Alt+щелчок по линии выбранной зоны или связи добавляет вершину.
        if (e.altKey && hasVertices(current)) {
          const inserted = insertVertex(current, px, store.items)
          if (inserted) {
            gesture.current = inserted.gesture
            store.preview(store.items.map((a) => (a.id === current.id ? inserted.item : a)))
            store.selectNode(inserted.index)
            svgRef.current?.setPointerCapture(e.pointerId)
            return
          }
        }
        if (isPitchAnnotation(current)) {
          const proj = lookup(current.calibrationId)
          const paint = proj ? paintOf(current, lookup, size, measureTextWidth) : null
          const handle = paint ? pitchHandleAt(paint, px) : null
          if (proj && handle) {
            const node = vertexIndex(handle)
            if (node !== null) store.selectNode(node)
            gesture.current = {
              kind: 'phandle',
              id: current.id,
              before: store.items,
              handle,
              item: current,
              projector: proj
            }
            svgRef.current?.setPointerCapture(e.pointerId)
            return
          }
        } else {
          const handle = handleAt(current, px, size)
          if (handle) {
            const node = vertexIndex(handle)
            if (node !== null) store.selectNode(node)
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
      }
      const hit = topHitAny(px)
      if (hit) {
        store.select(hit.id)
        store.selectNode(null)
        if (isPitchAnnotation(hit)) {
          const proj = lookup(hit.calibrationId)
          const world = proj?.toWorld(norm)
          if (proj && world) {
            gesture.current = {
              kind: 'pmove',
              id: hit.id,
              before: store.items,
              origin: world,
              item: hit,
              projector: proj
            }
            svgRef.current?.setPointerCapture(e.pointerId)
          }
        } else {
          gesture.current = {
            kind: 'move',
            id: hit.id,
            before: store.items,
            origin: norm,
            item: hit,
            box: bboxFor(hit, size)
          }
          svgRef.current?.setPointerCapture(e.pointerId)
        }
      } else {
        store.select(null)
      }
      return
    }

    if (norm.x < 0 || norm.x > 1 || norm.y < 0 || norm.y > 1) return

    if (store.tool === 'zone' || store.tool === 'chain') {
      pauseVideo()
      store.select(null)
      polyClick(store.tool, norm, px, e.shiftKey, now)
      return
    }

    const target = pitchTargetFor(store.tool, now)
    if (target === 'missing') return
    pauseVideo()
    store.select(null)

    if (store.tool === 'pen') {
      const world = target ? target.projector.toWorld(norm) : null
      if (target && !world) return
      const g: Extract<Gesture, { kind: 'pen' }> = {
        kind: 'pen',
        target,
        start: now,
        duration: defaultDuration(now, player.duration),
        raw: [{ x: px.x, y: px.y, norm, world }]
      }
      gesture.current = g
      setDraft(buildPen(g, g.raw))
      svgRef.current?.setPointerCapture(e.pointerId)
      return
    }

    if (target) {
      const world = target.projector.toWorld(norm)
      if (!world) return
      if (store.tool === 'text') {
        setEditor({
          mode: 'new',
          pos: norm,
          start: now,
          duration: 0,
          pitch: { world, target }
        })
        return
      }
      const g: Gesture = {
        kind: 'pdraw',
        tool: store.tool as PitchDrawTool,
        origin: world,
        originPx: px,
        target,
        start: now,
        last: world
      }
      gesture.current = g
      setDraft(buildPitchDraft(g, world, 0, e.shiftKey))
      svgRef.current?.setPointerCapture(e.pointerId)
      return
    }

    const duration = defaultDuration(now, player.duration)
    if (store.tool === 'text') {
      setEditor({ mode: 'new', pos: norm, start: now, duration, pitch: null })
      return
    }
    if (store.tool === 'ruler') return
    const g: Gesture = { kind: 'draw', tool: store.tool, origin: norm, start: now, duration }
    gesture.current = g
    setDraft(buildDraft(g, norm, e.shiftKey))
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  /** Alt+щелчок: вставляет вершину в ближайшее звено зоны или связи; дальше её можно сразу тащить. */
  const insertVertex = (
    current: Annotation,
    px: PxPoint,
    before: Annotation[]
  ): { item: Annotation; index: number; gesture: Gesture } | null => {
    if (!hasVertices(current)) return null
    const closed = current.type === 'zone' || current.type === 'pzone'
    const projector = isPitchAnnotation(current) ? lookup(current.calibrationId) : null
    if (isPitchAnnotation(current) && !projector) return null
    // Ищем ближайшее звено на картинке (в пикселях).
    const asPx = (p: { x: number; y: number }): { x: number; y: number } | null => {
      if (!projector) return { x: p.x * size.w, y: p.y * size.h }
      const img = projector.toImage(p)
      return img ? { x: img.x * size.w, y: img.y * size.h } : null
    }
    const vertices = current.points.map(asPx)
    if (vertices.some((v) => v === null)) return null
    const hit = insertionPoint(vertices as Array<{ x: number; y: number }>, px, closed)
    if (!hit || hit.dist > INSERT_PX) return null
    const normHit = { x: hit.point.x / size.w, y: hit.point.y / size.h }
    const newPoint = projector ? projector.toWorld(normHit) : clampPoint(normHit)
    if (!newPoint) return null
    const points = [...current.points]
    points.splice(hit.index, 0, newPoint)
    const item = { ...current, points } as Annotation
    const handle = `v${hit.index}`
    const g: Gesture = isPitchAnnotation(item)
      ? {
          kind: 'phandle',
          id: item.id,
          before,
          handle,
          item,
          projector: projector as Projector
        }
      : { kind: 'handle', id: item.id, before, handle, item: item as ScreenAnnotation }
    return { item, index: hit.index, gesture: g }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const g = gesture.current
    const { norm, px } = eventPoint(e)
    const store = useAnnotationsStore.getState()
    if (!g) {
      // Подсказка курсором: что лежит под мышью.
      const svg = svgRef.current
      if (!svg) return
      const pd = usePolyDraft.getState().draft
      if (pd) {
        // Резиновая линия к следующей вершине.
        if (pd.space === 'pitch') {
          const proj = pd.calibrationId ? lookup(pd.calibrationId) : null
          usePolyDraft.getState().setHover(proj ? proj.toWorld(norm) : null)
        } else {
          usePolyDraft.getState().setHover(clampPoint(norm))
        }
      }
      if (store.tool !== 'select') {
        svg.style.cursor = store.tool === 'text' ? 'text' : 'crosshair'
        return
      }
      const current = store.items.find((a) => a.id === store.selectedId)
      let overHandle = false
      if (current) {
        if (isPitchAnnotation(current)) {
          const paint = paintOf(current, lookup, size, measureTextWidth)
          overHandle = paint !== null && pitchHandleAt(paint, px) !== null
        } else {
          overHandle = handleAt(current, px, size) !== null
        }
      }
      if (overHandle) svg.style.cursor = 'grab'
      else svg.style.cursor = topHitAny(px) ? 'move' : 'default'
      return
    }
    if (g.kind === 'draw') {
      setDraft(buildDraft(g, norm, e.shiftKey))
    } else if (g.kind === 'pen') {
      const last = g.raw[g.raw.length - 1]
      if (Math.hypot(px.x - last.x, px.y - last.y) < PEN_STEP_PX) return
      if (g.raw.length >= PEN_RAW_LIMIT) return
      const world = g.target ? g.target.projector.toWorld(norm) : null
      if (g.target && !world) return
      g.raw.push({ x: px.x, y: px.y, norm, world })
      setDraft(buildPen(g, g.raw))
    } else if (g.kind === 'pdraw') {
      const world = g.target.projector.toWorld(norm) ?? g.last
      g.last = world
      setDraft(
        buildPitchDraft(
          g,
          world,
          Math.hypot(px.x - g.originPx.x, px.y - g.originPx.y),
          e.shiftKey,
          draft?.id
        )
      )
    } else if (g.kind === 'move') {
      const moved = moveBy(g.item, norm.x - g.origin.x, norm.y - g.origin.y, g.box)
      store.preview(store.items.map((a) => (a.id === g.id ? moved : a)))
    } else if (g.kind === 'pmove') {
      const world = g.projector.toWorld(norm)
      if (!world) return
      const moved = moveWorld(g.item, world.x - g.origin.x, world.y - g.origin.y)
      store.preview(store.items.map((a) => (a.id === g.id ? moved : a)))
    } else if (g.kind === 'phandle') {
      const world = g.projector.toWorld(norm)
      if (!world) return
      let target = world
      if (
        e.shiftKey &&
        g.item.type !== 'ring' &&
        g.item.type !== 'ptext' &&
        g.item.type !== 'pspot'
      ) {
        const anchor = handleAnchor(g.item, g.handle)
        if (anchor) target = snapWorldAngle(anchor, world)
      }
      const moved = moveWorldHandle(g.item, g.handle, target)
      store.preview(store.items.map((a) => (a.id === g.id ? moved : a)))
    } else {
      let target = clampPoint(norm)
      if (e.shiftKey && g.item.type !== 'text') {
        target = snapScreenHandle(g.item, g.handle, target, size)
      }
      const moved = moveHandle(g.item, g.handle, target, size)
      store.preview(store.items.map((a) => (a.id === g.id ? moved : a)))
    }
  }

  /** Лупа и прожектор после создания остаются целиком внутри картинки. */
  const keepInside = (a: Annotation): Annotation =>
    a.type === 'loupe' || a.type === 'spot'
      ? moveBy(a as ScreenAnnotation, 0, 0, bboxFor(a as ScreenAnnotation, size))
      : a

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
      if (!d || d.type === 'text' || isPitchAnnotation(d) || cancelled) return
      if (d.type === 'spot' || d.type === 'loupe') {
        store.add(keepInside(d))
        return
      }
      if (!('p1' in d) || !('p2' in d)) return
      const dx = Math.abs(d.p2.x - d.p1.x) * size.w
      const dy = Math.abs(d.p2.y - d.p1.y) * size.h
      const big =
        d.type === 'circle'
          ? dx >= MIN_BOX_PX && dy >= MIN_BOX_PX
          : Math.hypot(dx, dy) >= MIN_LINE_PX
      if (big) store.add(d)
    } else if (g.kind === 'pen') {
      setDraft(null)
      if (cancelled) return
      const pts = simplifyStroke(g.raw, PEN_TOLERANCE_PX, MAX_PEN_POINTS) as PenSample[]
      let length = 0
      for (let i = 1; i < pts.length; i += 1) {
        length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      }
      if (pts.length < 2 || length < MIN_LINE_PX) return
      const pen = buildPen(g, pts)
      if (pen) store.add({ ...pen, id: crypto.randomUUID() })
    } else if (g.kind === 'pdraw') {
      const d = draft
      setDraft(null)
      if (!d || !isPitchAnnotation(d) || cancelled) return
      if (d.type === 'ring' || d.type === 'pspot') {
        store.add(d)
        return
      }
      if (d.type === 'ptext' || !('p1' in d)) return
      const a = g.target.projector.toImage(d.p1)
      const b = g.target.projector.toImage(d.p2)
      const longEnough =
        a !== null &&
        b !== null &&
        Math.hypot((b.x - a.x) * size.w, (b.y - a.y) * size.h) >= MIN_LINE_PX &&
        worldDistance(d.p1, d.p2) >= MIN_GROUND_LENGTH
      if (longEnough) store.add(d)
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
    if (current.pitch) {
      const label: GroundText = {
        id: crypto.randomUUID(),
        space: 'pitch',
        calibrationId: current.pitch.target.calibrationId,
        type: 'ptext',
        pos: current.pitch.world,
        text: clean,
        style: textStyleOf(store.style),
        timing: pitchTiming(current.start)
      }
      store.add(label)
      return
    }
    const base: TextAnnotation = {
      id: crypto.randomUUID(),
      space: 'screen',
      type: 'text',
      pos: clampPoint(current.pos),
      text: clean,
      style: textStyleOf(store.style),
      timing: { mode: 'range', start: current.start, duration: current.duration }
    }
    store.add(moveBy(base, 0, 0, bboxFor(base, size)) as TextAnnotation)
  }

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const store = useAnnotationsStore.getState()
    // Двойной щелчок завершает зону или связь.
    if (usePolyDraft.getState().draft) {
      finishPolyDraft()
      return
    }
    if (store.tool !== 'select') return
    const { px } = eventPoint(e)
    const hit = topHitAny(px)
    if (hit && (hit.type === 'text' || hit.type === 'ptext')) {
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
  } else if (editedText && editedText.type === 'ptext') {
    const paint = paintOf(editedText, lookup, size, measureTextWidth)
    const label = paint?.label
    editorProps = {
      x: rect.x + (label ? label.x - label.w / 2 : 0),
      y: rect.y + (label ? label.y - label.h / 2 : 0),
      style: editedText.style,
      initial: editedText.text
    }
  }

  const draftProjector =
    draft && isPitchAnnotation(draft) ? (projectors.get(draft.calibrationId) ?? null) : null
  const polyPreview = poly ? draftAnnotation(poly, true) : null
  const polyBase = poly && poly.points.length > 0 ? draftAnnotation(poly, false) : null
  const polyProjector =
    polyPreview && isPitchAnnotation(polyPreview)
      ? (projectors.get(polyPreview.calibrationId) ?? null)
      : null

  // Прожекторы видны вместе: одна общая маска затемнения (в том числе черновик).
  const spotItems = useMemo(
    () => [...visible.filter(isSpotlight), ...(draft && isSpotlight(draft) ? [draft] : [])],
    [visible, draft]
  )
  const loupes = useMemo(
    () => [
      ...(visible.filter((a) => a.type === 'loupe') as Loupe[]),
      ...(draft && draft.type === 'loupe' ? [draft] : [])
    ],
    [visible, draft]
  )

  return (
    <>
      <LoupeLenses items={loupes} rect={rect} />
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
        onPointerLeave={() => usePolyDraft.getState().setHover(null)}
        onDoubleClick={onDoubleClick}
        onMouseDown={(e) => e.preventDefault()}
      >
        <SpotlightDim items={spotItems} size={size} projectorOf={lookup} />
        {gridPathData && (
          <>
            <defs>
              <clipPath id="pitch-grid-clip">
                <rect x={0} y={0} width={size.w} height={size.h} />
              </clipPath>
            </defs>
            <g
              className="pitch-grid"
              data-testid="pitch-grid"
              clipPath="url(#pitch-grid-clip)"
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
            >
              <path
                d={gridPathData}
                stroke="rgba(0,0,0,0.38)"
                strokeWidth={Math.max(1.4, size.h / 420) + 2.2}
              />
              <path
                d={gridPathData}
                stroke="rgba(255,255,255,0.82)"
                strokeWidth={Math.max(1.4, size.h / 420)}
              />
            </g>
          </>
        )}
        {visible
          .filter((a) => a.id !== editingId)
          .map((a) => (
            <ShapeView
              key={a.id}
              annotation={a}
              size={size}
              selected={a.id === selectedId}
              showHandles={tool === 'select'}
              projector={isPitchAnnotation(a) ? projectors.get(a.calibrationId) : undefined}
              dimmed={staleIds.has(a.id)}
            />
          ))}
        {draft && (
          <ShapeView
            annotation={draft}
            size={size}
            selected={false}
            showHandles={false}
            projector={draftProjector}
          />
        )}
        {polyPreview && (
          <g data-testid="poly-draft" data-points={poly?.points.length}>
            <ShapeView
              annotation={polyPreview}
              size={size}
              selected={false}
              showHandles={false}
              projector={polyProjector}
            />
            {polyBase && (
              <HandlesView annotation={polyBase} size={size} projector={polyProjector} />
            )}
          </g>
        )}
        {selected && tool === 'select' && !editor && (
          <HandlesView
            annotation={selected}
            size={size}
            projector={isPitchAnnotation(selected) ? projectors.get(selected.calibrationId) : null}
            selectedNode={selectedNode}
          />
        )}
      </svg>
      {poly && (
        <div
          className="poly-hint"
          data-testid="poly-hint"
          style={{ left: rect.x + 8, top: rect.y + 8 }}
        >
          {poly.tool === 'zone' ? ru.annotations.polyHintZone : ru.annotations.polyHintChain}
        </div>
      )}
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
