// Лупа на экране: круглый canvas с увеличенным участком текущего кадра. Рисуется из элемента <video>,
// пока лупа видна (requestVideoFrameCallback), поэтому увеличенная картинка идёт вместе с видео.
// В экспорт лупа попадает через фильтр ffmpeg (см. main/ffmpeg/loupe.ts), а рамка и линия — через обычный слой рисунков.
import { useEffect, useRef } from 'react'
import type { Loupe } from '../../../../shared/annotations'
import { loupeGeometry } from '../../../../shared/tools/loupe'
import { getVideoElement } from '../player/videoElement'
import type { Rect } from './geometry'

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

function LoupeLens({ loupe: a, rect }: { loupe: Loupe; rect: Rect }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const radius = a.radius * rect.h
  const side = Math.max(2, Math.round(2 * radius))

  useEffect(() => {
    const canvas = ref.current
    const video = getVideoElement() as FrameVideo | null
    if (!canvas || !video) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(2, Math.round(side * dpr))
    canvas.height = canvas.width
    const draw = (): void => {
      if (video.readyState < 2 || !(video.videoWidth > 0)) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const g = loupeGeometry(a, video.videoWidth, video.videoHeight)
      ctx.save()
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(video, g.sx, g.sy, g.sw, g.sw, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    draw()
    let frame = 0
    const loop = (): void => {
      draw()
      frame = video.requestVideoFrameCallback!(loop)
    }
    if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(loop)
    // Перемотка на паузе и первые кадры: на всякий случай перерисовываем и по событиям элемента.
    const events = ['seeked', 'loadeddata', 'timeupdate', 'playing', 'pause'] as const
    for (const e of events) video.addEventListener(e, draw)
    return () => {
      for (const e of events) video.removeEventListener(e, draw)
      if (frame && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frame)
    }
  }, [a, side])

  return (
    <canvas
      ref={ref}
      className="anno-loupe"
      data-testid="loupe-canvas"
      data-id={a.id}
      style={{
        left: rect.x + a.pos.x * rect.w - side / 2,
        top: rect.y + a.pos.y * rect.h - side / 2,
        width: side,
        height: side
      }}
    />
  )
}

export function LoupeLenses({
  items,
  rect
}: {
  items: readonly Loupe[]
  rect: Rect
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <>
      {items.map((a) => (
        <LoupeLens key={a.id} loupe={a} rect={rect} />
      ))}
    </>
  )
}
