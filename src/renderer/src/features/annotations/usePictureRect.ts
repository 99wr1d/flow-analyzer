import { useEffect, useState } from 'react'
import { getVideoElement } from '../player/videoElement'
import { containRect, type Rect } from './geometry'

/**
 * Где внутри контейнера лежит сама картинка видео (без чёрных полей).
 * Пересчитывается при изменении размера контейнера и при смене видео.
 */
export function usePictureRect(
  hostRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  videoKey: string | undefined
): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!active || !host) {
      setRect(null)
      return
    }
    const measure = (): void => {
      const video = getVideoElement()
      const next = video
        ? containRect(host.clientWidth, host.clientHeight, video.videoWidth, video.videoHeight)
        : null
      setRect((prev) =>
        prev &&
        next &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.w === next.w &&
        prev.h === next.h
          ? prev
          : next
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    measure()
    return () => observer.disconnect()
  }, [hostRef, active, videoKey])

  return rect
}
