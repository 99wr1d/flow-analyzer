// Слой «под игроками» на экране: WebGL2-холст между видео и SVG с рисунками (см. underGl.ts).
// Растр рисунков (SVG → холст) обновляется только когда меняется набор видимых рисунков, их геометрия, стиль или размер
// картинки; кадр видео загружается в текстуру на каждый показанный кадр (requestVideoFrameCallback), пока слой нужен.
// Никакого перерисовывания React на кадр: всё делает GPU.
import { useEffect, useMemo, useRef } from 'react'
import { isMoving } from '../../../../shared/animation'
import type { Annotation } from '../../../../shared/annotations'
import type { Calibration } from '../../../../shared/pitch/calibration'
import { usePlayerStore } from '../../store/playerStore'
import { useLiveList } from '../annotations/animClock'
import type { Rect } from '../annotations/geometry'
import { buildOverlaySvg, rasterizeSvg } from '../export/renderOverlays'
import { getVideoElement } from '../player/videoElement'
import { effectiveKey, ensureGrassEstimate, grassValues, useGrassStore } from './grassStore'
import { UnderRenderer } from './underGl'

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

/** Холст не больше этой ширины в пикселях (на очень больших экранах хватает меньшего разрешения). */
const MAX_CANVAS_WIDTH = 2560
/** Пока под игроками есть движущийся рисунок, растр обновляется каждый кадр — разрешение ограничено сильнее. */
const MAX_MOVING_CANVAS_WIDTH = 1280

// Подпись набора рисунков: у рисунка, который не менялся, ссылка остаётся той же, поэтому номер по ссылке не меняется.
const ids = new WeakMap<object, number>()
let nextId = 1
const refId = (a: object): number => {
  let n = ids.get(a)
  if (n === undefined) {
    n = nextId
    nextId += 1
    ids.set(a, n)
  }
  return n
}

interface Props {
  rect: Rect
  /** Рисунки, которые лежат под игроками и видны сейчас (в порядке слоёв). */
  items: readonly Annotation[]
  calibrations: readonly Calibration[]
  /** Рисунки на поле, показанные далеко от кадра разметки (бледнее). */
  dimmedIds: ReadonlySet<string>
}

export function UnderCanvas({
  rect,
  items: stored,
  calibrations,
  dimmedIds
}: Props): React.JSX.Element {
  // Движущиеся рисунки: геометрия на показанный кадр (перерисовка на каждый кадр только при движении).
  const items = useLiveList(stored)
  const moving = stored.some(isMoving)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<UnderRenderer | null>(null)
  const rasterRef = useRef<HTMLCanvasElement | null>(null)
  const maskView = useGrassStore((s) => s.maskView)
  const grassUser = useGrassStore((s) => s.userKey)
  const grassEstimate = useGrassStore((s) => s.estimate)
  const videoId = usePlayerStore((s) => s.source?.id)
  const key = effectiveKey({ userKey: grassUser, estimate: grassEstimate }, videoId)
  const active = stored.length > 0 || maskView
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const scale = Math.max(
    0.5,
    Math.min(dpr, (moving ? MAX_MOVING_CANVAS_WIDTH : MAX_CANVAS_WIDTH) / Math.max(1, rect.w))
  )
  const pxW = Math.max(2, Math.round(rect.w * scale))
  const pxH = Math.max(2, Math.round(rect.h * scale))

  const signature = useMemo(
    () => items.map((a) => `${a.id}#${refId(a)}${dimmedIds.has(a.id) ? '!' : ''}`).join(','),
    [items, dimmedIds]
  )
  // Что нужно в обработчиках без перезапуска эффектов, лежит в ссылках (обновляются после каждой отрисовки).
  const live = useRef({ active, maskView, pxW, pxH })
  const renderNow = useRef<() => void>(() => {})
  useEffect(() => {
    live.current = { active, maskView, pxW, pxH }
    /** Загрузить кадр и перерисовать. */
    renderNow.current = (): void => {
      const r = rendererRef.current
      const canvas = canvasRef.current
      const video = getVideoElement()
      if (!r || !canvas || !video) return
      if (r.lost) {
        useGrassStore.getState().setWebgl('failed')
        return
      }
      if (!live.current.active) {
        r.clear()
        return
      }
      ensureGrassEstimate()
      if (!r.uploadVideo(video)) return
      const state = useGrassStore.getState()
      const values = grassValues(effectiveKey(state, usePlayerStore.getState().source?.id))
      r.resize(live.current.pxW, live.current.pxH)
      r.render(values, state.maskView)
      canvas.dataset.frames = String(Number(canvas.dataset.frames ?? '0') + 1)
    }
  })

  // Создание и уничтожение WebGL-контекста.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      rendererRef.current = new UnderRenderer(canvas)
      canvas.dataset.renderer = 'webgl2'
    } catch {
      canvas.dataset.renderer = 'none'
      useGrassStore.getState().setWebgl('failed')
      return
    }
    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  // Растр рисунков: только когда изменился набор, геометрия, стиль или размер. Растеризация асинхронна:
  // если за время работы набор снова изменился (перетаскивание), делается только последний вариант.
  const queue = useRef<{ busy: boolean; next: (() => Promise<void>) | null }>({
    busy: false,
    next: null
  })
  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    const job = async (): Promise<void> => {
      const renderer = rendererRef.current
      if (!renderer) return
      if (items.length === 0) {
        renderer.setDrawing(null)
        renderNow.current()
        return
      }
      const svg = buildOverlaySvg(items, rect.w, rect.h, calibrations, {
        part: 'under',
        scale: pxW / rect.w,
        dimmedIds
      })
      rasterRef.current ??= document.createElement('canvas')
      const raster = rasterRef.current
      raster.width = pxW
      raster.height = pxH
      await rasterizeSvg(svg, raster, pxW, pxH)
      if (!rendererRef.current) return
      rendererRef.current.setDrawing(raster)
      const canvas = canvasRef.current
      if (canvas) canvas.dataset.rasters = String(Number(canvas.dataset.rasters ?? '0') + 1)
      renderNow.current()
    }
    const q = queue.current
    q.next = job
    if (q.busy) return
    q.busy = true
    void (async () => {
      try {
        while (q.next) {
          const current = q.next
          q.next = null
          await current().catch(() => undefined)
        }
      } finally {
        q.busy = false
      }
    })()
    // items и dimmedIds входят в signature; calibrations нужны для проекции рисунков на поле.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, calibrations, rect.w, rect.h, pxW, pxH])

  // Кадры видео: пока слой нужен, каждый показанный кадр загружается в текстуру.
  useEffect(() => {
    const video = getVideoElement() as FrameVideo | null
    if (!video) return
    renderNow.current()
    if (!active) return
    let frame = 0
    const loop = (): void => {
      renderNow.current()
      frame = video.requestVideoFrameCallback!(loop)
    }
    if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(loop)
    // Перемотка на паузе и первые кадры: перерисовываем и по событиям элемента.
    const draw = (): void => renderNow.current()
    const events = ['seeked', 'loadeddata', 'timeupdate', 'playing', 'pause'] as const
    for (const e of events) video.addEventListener(e, draw)
    return () => {
      for (const e of events) video.removeEventListener(e, draw)
      if (frame && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frame)
    }
  }, [active, videoId])

  // Настройки ключа или режим маски изменились — перерисовать текущий кадр.
  useEffect(() => {
    renderNow.current()
  }, [key.color, key.similarity, key.blend, maskView, pxW, pxH])

  return (
    <canvas
      ref={canvasRef}
      className="anno-under"
      data-testid="under-canvas"
      data-active={active ? 'true' : 'false'}
      data-mask={maskView ? 'true' : 'false'}
      data-items={items.length}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  )
}
